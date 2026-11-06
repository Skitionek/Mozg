'use strict'

/**
 * Databases hosted alongside Mozg: demand tracking and wake-up.
 *
 * A deployment can run its own copies of large databases (a ChEMBL Postgres
 * restored from its dump, Reactome's Neo4j graph) and let them scale to zero
 * when nobody is querying them.  Mozg is what knows whether anybody is:
 *
 *   - every query against a server-held source is counted while it runs and
 *     stamps the source's last use;
 *   - GET /demand/<source> reports 1 while a query is in flight or the source
 *     was used within MOZG_DEMAND_WINDOW_MS, else 0 — the Helm chart's KEDA
 *     ScaledObject polls it (metrics-api trigger) to scale the database
 *     between 0 and 1 replicas;
 *   - the first query after the database has scaled to zero finds nothing
 *     listening.  Instead of failing, it keeps retrying for up to
 *     MOZG_WAKE_TIMEOUT_MS while its own in-flight count is what makes KEDA
 *     bring the database back.  "Slow by design" includes a cold start.
 *
 * A source is server-held when its catalog connection takes any value from
 * the server's environment (see isServerHeld in sources.js) — the shape every
 * database the Helm chart deploys has.
 */

const state = new Map()

const demandWindowMs = () => Number(process.env.MOZG_DEMAND_WINDOW_MS) || 60_000
const wakeTimeoutMs = () => Number(process.env.MOZG_WAKE_TIMEOUT_MS) || 180_000

/** The catalog entry behind a connection, when it is one hosted with this server. */
function selfHostedEntry (connection) {
  if (!connection || !connection.source) return null
  try {
    const { getCatalog } = require('../catalog')
    const { isServerHeld } = require('./sources')
    const [entry] = getCatalog(connection.source)
    return isServerHeld(entry) ? entry : null
  } catch {
    return null
  }
}

function stateFor (source) {
  if (!state.has(source)) state.set(source, { inFlight: 0, lastUsed: null })
  return state.get(source)
}

/**
 * Demand for one source, in the shape KEDA's metrics-api trigger reads.
 * @param {string} source
 * @param {number} [now]
 */
function demandFor (source, now = Date.now()) {
  const s = state.get(source) || { inFlight: 0, lastUsed: null }
  const recent = s.lastUsed != null && now - s.lastUsed < demandWindowMs()
  return {
    source,
    demand: s.inFlight > 0 || recent ? 1 : 0,
    inFlight: s.inFlight,
    lastUsed: s.lastUsed != null ? new Date(s.lastUsed).toISOString() : null
  }
}

/** Demand for every server-held source in the catalog, used or not. */
function allDemand (now = Date.now()) {
  const { getCatalog, listCatalog } = require('../catalog')
  const { isServerHeld } = require('./sources')
  const names = listCatalog().filter((name) => {
    try {
      return isServerHeld(getCatalog(name)[0])
    } catch {
      return false
    }
  })
  return names.map((name) => demandFor(name, now))
}

// Error codes and messages that mean "nothing is answering yet" rather than
// "the request is wrong": refused or unresolvable while the pod is starting,
// Postgres still recovering, Neo4j's driver finding no server, a pooled
// connection the database closed when it scaled down (undici's "other side
// closed" for ArangoDB and Elasticsearch, MySQL's lost connection), and a
// MySQL server that accepted the connection but has not greeted yet, and
// PostgreSQL's connect timeout ("timeout expired"), where a network drops
// connections to a Service with no pods instead of refusing them.
const WAKE_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT',
  '57P01', '57P02', // Postgres: terminating connection (shut down, or crashed)
  '57P03', // Postgres: the database system is starting up
  'ServiceUnavailable', 'SessionExpired', 'Neo.TransientError.General.DatabaseUnavailable'
])
const WAKE_MESSAGE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ServiceUnavailable|starting up|Connection terminated unexpectedly|Could not perform discovery|Failed to connect to server|getaddrinfo|socket hang up|DatabaseUnavailable|other side closed|Connection lost|Handshake inactivity timeout|terminating connection due to administrator command|Connection ended unexpectedly|\btimeout expired\b/i

/** Whether an error means the database is not up yet (as opposed to the query being wrong). */
function isWakeError (err) {
  if (!err) return false
  if (WAKE_CODES.has(err.code)) return true
  if (Array.isArray(err.errors) && err.errors.some(isWakeError)) return true
  if (err.cause && err.cause !== err && isWakeError(err.cause)) return true
  return WAKE_MESSAGE.test(String(err.message || ''))
}

/**
 * Run a query against a source, counting it as demand and — for a source
 * hosted with this server — waiting out a cold start.
 *
 * @param {object} connection  the normalized connection (carries `source`)
 * @param {Function} run       performs the query
 * @param {object} [options]
 * @param {number} [options.timeoutMs]   how long to keep retrying (default MOZG_WAKE_TIMEOUT_MS)
 * @param {Function} [options.sleep]     injectable for tests
 */
async function withWake (connection, run, options = {}) {
  const entry = selfHostedEntry(connection)
  if (!entry) return run()

  const s = stateFor(entry.name)
  const timeoutMs = options.timeoutMs != null ? options.timeoutMs : wakeTimeoutMs()
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + timeoutMs

  s.inFlight++
  s.lastUsed = Date.now()
  try {
    let delay = 500
    for (;;) {
      try {
        return await run()
      } catch (err) {
        if (!isWakeError(err)) throw err
        if (Date.now() >= deadline) {
          const wrapped = new Error(`${entry.name} did not come up within ${Math.round(timeoutMs / 1000)} s (it may be scaled to zero and still starting): ${err.message}`)
          wrapped.cause = err
          throw wrapped
        }
        await sleep(Math.min(delay, Math.max(0, deadline - Date.now())))
        delay = Math.min(delay * 2, 5_000)
      }
    }
  } finally {
    s.inFlight--
    s.lastUsed = Date.now()
  }
}

/**
 * Combine per-pod demand reports: demand if any pod has it.
 * @param {string} source
 * @param {object[]} reports
 */
function combine (source, reports) {
  const used = reports.map((r) => r.lastUsed).filter(Boolean).sort()
  return {
    source,
    demand: reports.some((r) => r.demand > 0) ? 1 : 0,
    inFlight: reports.reduce((n, r) => n + (r.inFlight || 0), 0),
    lastUsed: used.length ? used[used.length - 1] : null
  }
}

/**
 * Demand across every Mozg pod.  Each pod only knows the queries it ran, and
 * KEDA polls through a Service that lands on one pod at a time, so with more
 * than one replica a busy pod could go unseen — the database would stay
 * asleep, or be scaled down mid-query.  When MOZG_PEERS names a headless
 * Service resolving to every pod, ask each of them and combine; a peer that
 * does not answer counts as no demand from it.
 * @param {string} source
 * @param {object} [options]
 * @param {Function} [options.lookup]  dns lookup (injectable for tests)
 * @param {Function} [options.fetch]
 */
async function clusterDemand (source, options = {}) {
  const local = demandFor(source)
  const peers = process.env.MOZG_PEERS
  if (!peers) return local

  const lookup = options.lookup || ((name) => require('node:dns').promises.lookup(name, { all: true }))
  const doFetch = options.fetch || globalThis.fetch
  const port = process.env.PORT || 4000
  let addresses
  try {
    addresses = (await lookup(peers)).map((a) => a.address)
  } catch {
    return local
  }

  const reports = await Promise.all(addresses.map(async (address) => {
    const host = address.includes(':') ? `[${address}]` : address
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2_000)
    try {
      const res = await doFetch(`http://${host}:${port}/demand/${source}?scope=local`, { signal: controller.signal })
      return res.ok ? await res.json() : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }))
  return combine(source, [local, ...reports.filter(Boolean)])
}

/**
 * HTTP handler for GET /demand and GET /demand/<source>.  A single source is
 * reported across all pods unless `?scope=local` (which is how pods ask each
 * other).
 * @returns {boolean} whether the request was handled
 */
function handleDemandRequest (pathname, res, searchParams) {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  if (pathname === '/demand' || pathname === '/demand/') {
    json(200, { sources: allDemand() })
    return true
  }
  const m = pathname.match(/^\/demand\/([a-z0-9][a-z0-9-]*)$/)
  if (!m) return false
  const { listCatalog } = require('../catalog')
  if (!listCatalog().includes(m[1])) {
    json(404, { error: `Unknown source: ${m[1]}` })
    return true
  }
  const local = searchParams && searchParams.get('scope') === 'local'
  if (local) {
    json(200, demandFor(m[1]))
    return true
  }
  clusterDemand(m[1]).then((body) => json(200, body), () => json(200, demandFor(m[1])))
  return true
}

/** Forget all demand (tests). */
function reset () {
  state.clear()
}

module.exports = { withWake, demandFor, allDemand, clusterDemand, combine, isWakeError, handleDemandRequest, selfHostedEntry, reset }
