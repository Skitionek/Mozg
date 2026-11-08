'use strict'

/**
 * Materialised views.
 *
 * Mozg is "slow by design": a query reads live data, wherever it lives, every
 * time.  That is the right default and a poor fit for a few queries that are
 * expensive, stable and asked again and again — "everything we know about this
 * protein", say, across five databases.  A *materialised view* is the one place
 * where precomputation is chosen, on purpose, for a named query:
 *
 *   - the operator defines it (MOZG_VIEWS; Helm `mozg.views`): a name, a query,
 *     and when to refresh it;
 *   - Mozg runs the query, keeps the rows, and answers
 *     `query(input: { view: "name", where: …, orderBy: …, limit: … })` from
 *     them, filtering, sorting and paging the stored rows;
 *   - every answer says how old it is (`meta.refreshedAt`, `ageMs`, `stale`),
 *     so nobody mistakes a stored answer for a live one;
 *   - a refresh that fails keeps the last good rows and records the error.
 *
 *   MOZG_VIEWS            JSON array of view definitions:
 *     { "name": "tp53", "description": "…",
 *       "query": { "source": "uniprot", "from": "protein", "where": {…}, "include": […] },
 *       "refresh": { "ttlMs": 86400000, "everyMs": 3600000, "onStart": true,
 *                    "staleWhileRevalidate": true, "minIntervalMs": 60000 },
 *       "maxRows": 10000 }
 *   MOZG_VIEWS_MAX_BYTES  total size of stored rows (default 128 MiB)
 *   MOZG_VIEWS_DEFAULT_LIMIT  rows returned when a read gives no limit (default 1000)
 *
 * Refresh timing, all optional:
 *   ttlMs          a snapshot older than this is stale (0 / absent: never)
 *   staleWhileRevalidate  answer a stale read from the old rows and refresh in
 *                  the background (default true); false makes the read wait
 *   everyMs        refresh on a timer, the first time at start
 *   onStart        refresh at start without a timer
 *   minIntervalMs  the most often `refreshView` may refresh it (default 60000)
 * A view with no snapshot yet makes its first read wait for one.
 *
 * Rows are kept in this process only, so each replica builds its own.  There is
 * deliberately no way for a caller to define or replace a view: with no
 * authentication in front of Mozg that would let anyone start recurring
 * queries against its upstreams.  A caller may ask for a refresh, which is
 * single-flight and limited to once per `minIntervalMs`.
 */

const { intOption } = require('./config')

const NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/i
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024
const DEFAULT_LIMIT = 1000
const DEFAULT_MAX_ROWS = 10_000
const HARD_MAX_ROWS = 1_000_000
const DEFAULT_MIN_INTERVAL_MS = 60_000

// ── Definitions ─────────────────────────────────────────────────────────────

function validateDefinition (raw, i) {
  const where = `MOZG_VIEWS[${i}]`
  if (!raw || typeof raw !== 'object') throw new Error(`${where} must be an object`)
  if (typeof raw.name !== 'string' || !NAME.test(raw.name)) throw new Error(`${where}: name must be letters, digits, - or _ (at most 63)`)
  const label = `${where} (${raw.name})`
  const q = raw.query
  if (!q || typeof q !== 'object') throw new Error(`${label} needs a query`)
  if (!q.source && !q.connection) throw new Error(`${label}: the query needs a source or a connection`)
  if (!q.from) throw new Error(`${label}: the query needs from`)
  for (const key of ['view', 'fresh']) if (key in q) throw new Error(`${label}: the query may not set ${key}`)
  const refresh = raw.refresh || {}
  for (const key of ['ttlMs', 'everyMs', 'minIntervalMs']) {
    if (refresh[key] != null && !(Number.isFinite(refresh[key]) && refresh[key] >= 0)) throw new Error(`${label}: refresh.${key} must be a number of milliseconds`)
  }
  if (refresh.everyMs != null && refresh.everyMs > 0 && refresh.everyMs < 1000) throw new Error(`${label}: refresh.everyMs under a second would hammer the sources`)
  const maxRows = raw.maxRows == null ? DEFAULT_MAX_ROWS : raw.maxRows
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > HARD_MAX_ROWS) throw new Error(`${label}: maxRows must be a whole number from 1 to ${HARD_MAX_ROWS}`)
  return {
    name: raw.name,
    description: raw.description || null,
    query: q,
    ttlMs: refresh.ttlMs || 0,
    everyMs: refresh.everyMs || 0,
    onStart: Boolean(refresh.onStart) || Boolean(refresh.everyMs),
    staleWhileRevalidate: refresh.staleWhileRevalidate !== false,
    minIntervalMs: refresh.minIntervalMs == null ? DEFAULT_MIN_INTERVAL_MS : refresh.minIntervalMs,
    maxRows
  }
}

function parseDefinitions (env = process.env) {
  const raw = env.MOZG_VIEWS
  if (!raw || !String(raw).trim()) return []
  let list
  try {
    list = JSON.parse(raw)
  } catch (err) {
    throw new Error(`MOZG_VIEWS is not valid JSON: ${err.message}`, { cause: err })
  }
  if (!Array.isArray(list)) throw new Error('MOZG_VIEWS must be a JSON array of views')
  const definitions = list.map(validateDefinition)
  const names = new Set()
  for (const d of definitions) {
    if (names.has(d.name.toLowerCase())) throw new Error(`MOZG_VIEWS defines "${d.name}" twice`)
    names.add(d.name.toLowerCase())
  }
  return definitions
}

/** `{ env: "VAR" }` anywhere in a query is read from the environment when the view refreshes, so a password need not sit in the definition. */
function resolveEnv (value, env) {
  if (Array.isArray(value)) return value.map((v) => resolveEnv(v, env))
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === 'env' && typeof value.env === 'string') {
      if (env[value.env] == null) throw new Error(`the environment variable ${value.env} is not set`)
      return env[value.env]
    }
    return Object.fromEntries(keys.map((k) => [k, resolveEnv(value[k], env)]))
  }
  return value
}

// ── Reading stored rows ─────────────────────────────────────────────────────

const OPERATORS = new Set(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'contains'])

/** Cells are compared as text when either side is not a number, so `where: { id: "1" }` finds 1. */
function same (a, b) {
  if (a == null || b == null) return a == null && b == null
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return String(a) === String(b)
}

function compare (a, b) {
  const x = typeof a === 'string' && a.trim() !== '' && !Number.isNaN(Number(a)) ? Number(a) : a
  const y = typeof b === 'string' && b.trim() !== '' && !Number.isNaN(Number(b)) ? Number(b) : b
  if (typeof x === 'number' && typeof y === 'number') return x - y
  return String(x).localeCompare(String(y))
}

function test (cell, condition, column) {
  const isOperators = condition && typeof condition === 'object' && !Array.isArray(condition)
  if (!isOperators) return same(cell, condition)
  return Object.entries(condition).every(([op, operand]) => {
    if (!OPERATORS.has(op)) throw new Error(`where.${column}: unknown operator "${op}". Use one of: ${[...OPERATORS].join(', ')}`)
    switch (op) {
      case 'eq': return same(cell, operand)
      case 'ne': return !same(cell, operand)
      case 'in': return [].concat(operand).some((v) => same(cell, v))
      case 'gt': return cell != null && compare(cell, operand) > 0
      case 'gte': return cell != null && compare(cell, operand) >= 0
      case 'lt': return cell != null && compare(cell, operand) < 0
      case 'lte': return cell != null && compare(cell, operand) <= 0
      case 'contains':
        if (Array.isArray(cell)) return cell.some((v) => same(v, operand))
        return cell != null && String(cell).toLowerCase().includes(String(operand).toLowerCase())
      default: return false
    }
  })
}

function approximateBytes (rows) {
  return JSON.stringify(rows).length
}

// ── The store ───────────────────────────────────────────────────────────────

class ViewStore {
  /**
   * @param {object} [options]
   * @param {object} [options.env]
   * @param {() => number} [options.now]
   * @param {(input: object) => Promise<object>} [options.run]  executes a query (the connector's)
   * @param {object} [options.telemetry]
   */
  constructor ({ env = process.env, now = Date.now, run, telemetry } = {}) {
    this.env = env
    this.now = now
    this.run = run || ((input) => require('./database/connector').executeQuery(input))
    this.telemetry = telemetry || require('./telemetry')
    this.maxBytes = intOption('MOZG_VIEWS_MAX_BYTES', DEFAULT_MAX_BYTES, env) || DEFAULT_MAX_BYTES
    this.defaultLimit = intOption('MOZG_VIEWS_DEFAULT_LIMIT', DEFAULT_LIMIT, env) || DEFAULT_LIMIT
    this.definitions = parseDefinitions(env)
    this.states = new Map(this.definitions.map((d) => [d.name.toLowerCase(), {
      definition: d, snapshot: null, refreshing: null, lastError: null, lastAttemptAt: 0, timer: null
    }]))
  }

  #state (name) {
    const state = this.states.get(String(name).toLowerCase())
    if (!state) {
      const known = this.definitions.map((d) => d.name)
      throw new Error(`Unknown view "${name}". ${known.length ? `Defined: ${known.join(', ')}.` : 'None is defined (MOZG_VIEWS).'}`)
    }
    return state
  }

  #info (state) {
    const { definition: d, snapshot } = state
    const age = snapshot ? this.now() - snapshot.refreshedAt : null
    return {
      name: d.name,
      description: d.description,
      source: d.query.source || (d.query.connection && d.query.connection.driver) || null,
      from: d.query.from,
      columns: snapshot ? snapshot.columns : null,
      rowCount: snapshot ? snapshot.rows.length : null,
      truncated: snapshot ? snapshot.truncated : null,
      refreshedAt: snapshot ? new Date(snapshot.refreshedAt).toISOString() : null,
      ageMs: age,
      ttlMs: d.ttlMs || null,
      everyMs: d.everyMs || null,
      stale: snapshot ? Boolean(d.ttlMs && age > d.ttlMs) : null,
      refreshing: Boolean(state.refreshing),
      lastDurationMs: snapshot ? snapshot.durationMs : null,
      error: state.lastError
    }
  }

  list () {
    return this.definitions.map((d) => this.#info(this.states.get(d.name.toLowerCase())))
  }

  /**
   * Run the view's query and keep its rows.  One refresh runs at a time per
   * view; a call while one is running waits for it.  A failure leaves the last
   * good rows in place.
   */
  refresh (name) {
    const state = this.#state(name)
    if (state.refreshing) return state.refreshing
    const { definition } = state
    const began = this.now()
    state.lastAttemptAt = began

    state.refreshing = (async () => {
      try {
        const query = resolveEnv(definition.query, this.env)
        // A refresh exists to read live data, so it skips the result cache.  The
        // query's own `limit` is the operator's to set: a source may send it
        // upstream as a page size, so none is added here.
        const result = await this.run({ ...query, fresh: true })
        const all = result.data || []
        const truncated = all.length > definition.maxRows
        const rows = truncated ? all.slice(0, definition.maxRows) : all
        const bytes = approximateBytes(rows)
        const others = [...this.states.values()].filter((s) => s !== state && s.snapshot).reduce((n, s) => n + s.snapshot.bytes, 0)
        if (bytes + others > this.maxBytes) {
          throw new Error(`the rows (${bytes} bytes) would take the stored views past MOZG_VIEWS_MAX_BYTES (${this.maxBytes}); lower maxRows or narrow the query`)
        }
        const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
        state.snapshot = { rows, columns, bytes, truncated, refreshedAt: this.now(), durationMs: this.now() - began }
        state.lastError = null
        this.telemetry.recordViewRefresh(definition.name, 'ok', (this.now() - began) / 1000)
        this.telemetry.logger.info('view refreshed', { view: definition.name, rows: rows.length, truncated, durationMs: this.now() - began })
        return this.#info(state)
      } catch (err) {
        state.lastError = err.message
        this.telemetry.recordViewRefresh(definition.name, 'error', (this.now() - began) / 1000)
        this.telemetry.logger.warn('view refresh failed', { view: definition.name, error: err.message, keptRows: state.snapshot ? state.snapshot.rows.length : 0 })
        throw err
      } finally {
        state.refreshing = null
      }
    })()
    // A background refresh nobody awaits must not raise an unhandled rejection.
    state.refreshing.catch(() => {})
    return state.refreshing
  }

  /** Milliseconds until a refresh may be attempted again (0 when it may be now). */
  #wait (state) {
    return Math.max(0, state.lastAttemptAt + state.definition.minIntervalMs - this.now())
  }

  /** A caller's request to refresh: single-flight, and not more often than the view allows. */
  async requestRefresh (name) {
    const state = this.#state(name)
    const wait = this.#wait(state)
    if (!state.refreshing && wait > 0) {
      throw new Error(`View "${state.definition.name}" was last refreshed ${Math.round((this.now() - state.lastAttemptAt) / 1000)} s ago and may be refreshed every ${Math.round(state.definition.minIntervalMs / 1000)} s; try again in ${Math.ceil(wait / 1000)} s`)
    }
    return this.refresh(name)
  }

  /**
   * Answer a read from the stored rows.
   * @param {object} input  QueryInput with `view`, and optionally where, select, orderBy, orderDirection, limit, offset, link
   */
  async query (input) {
    const { view, where, select, orderBy, orderDirection, limit, offset, link } = input
    for (const unsupported of ['relations', 'include', 'raw', 'apiKeys']) {
      if (input[unsupported] != null && !(Array.isArray(input[unsupported]) && input[unsupported].length === 0)) {
        throw new Error(`A view is read as stored: ${unsupported} cannot be used with view. Put it in the view's own query.`)
      }
    }
    if (input.connection || input.source) throw new Error('A query reads either a view or a source, not both')

    const state = this.#state(view)
    const { definition } = state
    let servedStale = false

    // A view whose source is down must not be retried on every read: after a
    // failed attempt it waits out minIntervalMs, whoever asks.
    const mayAttempt = !state.refreshing && this.#wait(state) === 0
    if (!state.snapshot) {
      if (!state.refreshing && !mayAttempt) {
        throw new Error(`View "${definition.name}" has no rows yet: its last refresh failed (${state.lastError}). It is tried again at most every ${Math.round(definition.minIntervalMs / 1000)} s.`)
      }
      await this.refresh(view)
    } else if (definition.ttlMs && this.now() - state.snapshot.refreshedAt > definition.ttlMs) {
      if (definition.staleWhileRevalidate) {
        servedStale = true
        if (mayAttempt) this.refresh(view).catch(() => {})
      } else {
        if (mayAttempt) await this.refresh(view).catch(() => {}) // on failure the old rows still answer, flagged stale
        servedStale = this.now() - state.snapshot.refreshedAt > definition.ttlMs
      }
    }

    const { snapshot } = state
    const columns = new Set(snapshot.columns)
    const known = () => snapshot.columns.join(', ')

    for (const column of Object.keys(where || {})) {
      if (!columns.has(column)) throw new Error(`View "${definition.name}" has no column "${column}". Columns: ${known()}`)
    }
    for (const column of select || []) {
      if (!columns.has(column)) throw new Error(`View "${definition.name}" has no column "${column}". Columns: ${known()}`)
    }
    if (orderBy && !columns.has(orderBy)) throw new Error(`View "${definition.name}" has no column "${orderBy}" to order by. Columns: ${known()}`)

    const conditions = Object.entries(where || {})
    let rows = conditions.length ? snapshot.rows.filter((row) => conditions.every(([column, condition]) => test(row[column], condition, column))) : snapshot.rows.slice()

    if (orderBy) {
      const sign = String(orderDirection || 'asc').toLowerCase() === 'desc' ? -1 : 1
      rows.sort((a, b) => {
        // Missing values go last whichever way the rows are sorted.
        if (a[orderBy] == null || b[orderBy] == null) return (a[orderBy] == null) - (b[orderBy] == null)
        return sign * compare(a[orderBy], b[orderBy])
      })
    }

    const total = rows.length
    const start = offset || 0
    const size = limit != null ? limit : this.defaultLimit
    rows = rows.slice(start, start + size)

    // A copy: link and callers write into rows, and the stored ones must stay as refreshed.
    rows = structuredClone(rows)
    if (select && select.length) rows = rows.map((row) => Object.fromEntries(select.map((column) => [column, row[column]])))
    if (link && link.length) await require('./ontology/links').applyLinks(rows, link)

    const info = this.#info(state)
    return {
      data: rows,
      count: rows.length,
      meta: {
        view: definition.name,
        refreshedAt: info.refreshedAt,
        ageMs: info.ageMs,
        ttlMs: info.ttlMs,
        stale: servedStale || Boolean(info.stale),
        refreshing: info.refreshing,
        total,
        truncated: start + rows.length < total,
        error: info.error
      }
    }
  }

  /** Start the timers and refresh at start those views that ask to; never delays the server. */
  start () {
    for (const state of this.states.values()) {
      const { definition: d } = state
      if (d.onStart) this.refresh(d.name).catch(() => {})
      if (d.everyMs > 0) {
        // A little jitter, so replicas started together do not refresh together.
        const every = Math.round(d.everyMs * (0.9 + Math.random() * 0.2))
        state.timer = setInterval(() => { this.refresh(d.name).catch(() => {}) }, every)
        state.timer.unref()
      }
    }
  }

  stop () {
    for (const state of this.states.values()) {
      if (state.timer) clearInterval(state.timer)
      state.timer = null
    }
  }
}

let current
/** The process-wide store, built from the environment on first use. */
function getViews () {
  if (!current) current = new ViewStore()
  return current
}

/** Forget the process-wide store (tests, reconfiguration). */
function resetViews () {
  if (current) current.stop()
  current = undefined
}

module.exports = { ViewStore, getViews, resetViews, parseDefinitions, resolveEnv, DEFAULT_LIMIT }
