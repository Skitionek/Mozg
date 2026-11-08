'use strict'

/**
 * A cache of whole query results, in front of every driver.
 *
 * Mozg is "slow by design": by default every query reads live data and nothing
 * here is active.  An operator who would rather trade freshness for speed turns
 * it on per deployment:
 *
 *   MOZG_RESULT_CACHE_TTL_MS            how long a result is reused (0 = off, the default)
 *   MOZG_RESULT_CACHE_TTL_BY_SOURCE     JSON object of per-source overrides, in ms:
 *                                       {"uniprot":3600000,"my-postgres":0}
 *   MOZG_RESULT_CACHE_MAX_ENTRIES       results kept (default 500)
 *   MOZG_RESULT_CACHE_MAX_BYTES         total size kept, in bytes (default 64 MiB)
 *
 * (The Helm chart sets these from `mozg.resultCache`.)  A caller can always ask
 * for live data with `fresh: true`, which skips the read and refreshes the
 * entry.
 *
 * This is a different layer from MOZG_HTTP_CACHE_TTL_MS, which caches single
 * outbound GETs and so only helps the HTTP-backed sources.  This one caches
 * the answer to a whole query — relations included — for every driver, and so
 * also serves PostgreSQL, Neo4j and the rest.
 *
 * Rules that keep it from being surprising:
 *
 *   - The key covers the entire normalised query, credentials and API keys
 *     included, so two callers share a result only when they asked the same
 *     thing as the same principal.  The key is a hash held in memory.
 *   - Results are stored as JSON text and parsed on every hit.  Relation
 *     resolvers write into rows in place, so handing out a shared object would
 *     let one caller corrupt another's answer.
 *   - Errors are never cached.
 *   - SOAP and Thrift are never cached: naming an operation runs it, and an
 *     operation may have side effects.
 *   - Concurrent identical queries share one execution while caching is on.
 *   - `fresh` reaches nested relation fetches too, so one flag makes the
 *     whole tree live.
 */

const crypto = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const { LruCache } = require('../cache')
const { intOption } = require('../config')

const NEVER_CACHED_DRIVERS = new Set(['soap', 'thrift'])

const DEFAULT_MAX_ENTRIES = 500
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

const freshScope = new AsyncLocalStorage()

/** Parse the per-source TTL map; a malformed value is reported once and ignored. */
function parsePerSource (raw, warn = (message) => console.warn(message)) {
  if (raw == null || String(raw).trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    const out = {}
    for (const [name, ttl] of Object.entries(parsed)) {
      if (Number.isFinite(Number(ttl)) && Number(ttl) >= 0) out[name] = Math.floor(Number(ttl))
      else warn(`MOZG_RESULT_CACHE_TTL_BY_SOURCE: ignoring "${name}": ${JSON.stringify(ttl)} is not a duration in ms`)
    }
    return out
  } catch (err) {
    warn(`MOZG_RESULT_CACHE_TTL_BY_SOURCE is not a JSON object of milliseconds (${err.message}); ignoring it`)
    return {}
  }
}

/** JSON with object keys in a fixed order, so equal queries make equal keys. */
function canonical (value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** The cache key for a normalised query: a hash of everything that shapes the answer. */
function keyFor (input) {
  const { fresh: _fresh, ...rest } = input
  return crypto.createHash('sha256').update(canonical(rest)).digest('hex')
}

/**
 * @param {object} [env]  environment to read, process.env by default
 */
function createResultCache (env = process.env) {
  const defaultTtl = intOption('MOZG_RESULT_CACHE_TTL_MS', 0, env)
  const perSource = parsePerSource(env.MOZG_RESULT_CACHE_TTL_BY_SOURCE)
  const maxEntries = intOption('MOZG_RESULT_CACHE_MAX_ENTRIES', DEFAULT_MAX_ENTRIES, env) || DEFAULT_MAX_ENTRIES
  const maxBytes = intOption('MOZG_RESULT_CACHE_MAX_BYTES', DEFAULT_MAX_BYTES, env) || DEFAULT_MAX_BYTES

  // Values are { json, storedAt, ttlMs }; the weight is the JSON's length, a
  // close enough stand-in for bytes.
  const cache = new LruCache({ max: maxEntries, maxWeight: maxBytes, weigh: (entry) => entry.json.length })
  const inFlight = new Map()
  const counters = { hits: 0, misses: 0, bypasses: 0, shared: 0, skipped: 0 }

  /** The TTL that applies to a query: its source's override, else the global one. */
  function ttlFor (input) {
    const connection = input.connection || {}
    if (NEVER_CACHED_DRIVERS.has(connection.driver)) return 0
    const source = connection.source
    if (source && Object.prototype.hasOwnProperty.call(perSource, source)) return perSource[source]
    return defaultTtl
  }

  const enabled = () => defaultTtl > 0 || Object.values(perSource).some((ttl) => ttl > 0)

  /**
   * Answer from the cache or run `execute`.
   * @param {object} input     the normalised query
   * @param {() => Promise<object>} execute
   */
  async function run (input, execute) {
    if (!enabled()) return execute()

    // A query that is not cached itself can still have relations that are, and
    // `fresh` promises that the whole tree is read live.
    const fresh = Boolean(input.fresh) || freshScope.getStore() === true
    const live = () => (fresh ? freshScope.run(true, execute) : execute())

    const ttlMs = ttlFor(input)
    if (!(ttlMs > 0)) return live()

    let key
    try {
      key = keyFor(input)
    } catch {
      counters.skipped++
      return live()
    }

    if (!fresh) {
      const hit = cache.get(key)
      if (hit) {
        counters.hits++
        const result = JSON.parse(hit.json)
        result.meta = { ...(result.meta || {}), cache: 'hit', ageMs: Date.now() - hit.storedAt, ttlMs: hit.ttlMs }
        return result
      }
      const running = inFlight.get(key)
      if (running) {
        counters.shared++
        const json = await running
        // null: the leader's result could not be serialised, so run our own.
        if (json == null) return execute()
        const result = JSON.parse(json)
        result.meta = { ...(result.meta || {}), cache: 'shared', ttlMs }
        return result
      }
    }

    counters.misses += fresh ? 0 : 1
    counters.bypasses += fresh ? 1 : 0

    // Followers wait on the JSON text, never on the leader's live object.  A
    // fresh query neither joins nor leads a shared execution: it was asked to
    // look again.
    let release
    if (!fresh) {
      const shared = new Promise((resolve, reject) => { release = { resolve, reject } })
      shared.catch(() => {}) // a leader with no followers must not raise an unhandled rejection
      inFlight.set(key, shared)
    }

    try {
      const result = await (fresh ? freshScope.run(true, execute) : execute())
      let json = null
      try {
        json = JSON.stringify(result)
      } catch {
        counters.skipped++
      }
      if (json != null) cache.set(key, { json, storedAt: Date.now(), ttlMs }, { ttlMs })
      if (release) release.resolve(json)
      if (result && typeof result === 'object') {
        result.meta = { ...(result.meta || {}), cache: fresh ? 'bypass' : 'miss', ttlMs }
      }
      return result
    } catch (err) {
      if (release) release.reject(err)
      throw err
    } finally {
      // Synchronously, before the caller resumes: sharing is for queries
      // that are still running, not for ones that just finished.
      if (release) inFlight.delete(key)
    }
  }

  function stats () {
    return {
      enabled: enabled(),
      ttlMs: defaultTtl,
      perSource: { ...perSource },
      entries: cache.size,
      maxEntries,
      bytes: cache.weight,
      maxBytes,
      evictions: cache.stats.evictions,
      ...counters
    }
  }

  return { run, stats, clear: () => cache.clear(), ttlFor, keyFor }
}

let current
/** The process-wide cache, built from the environment on first use. */
function getResultCache () {
  if (!current) current = createResultCache()
  return current
}

/** Rebuild the process-wide cache from the environment (tests, reconfiguration). */
function resetResultCache () {
  current = undefined
}

/** Run `fn` with every query it makes (nested ones included) bypassing the result cache. */
function withFresh (fn) {
  return freshScope.run(true, fn)
}

module.exports = { createResultCache, getResultCache, resetResultCache, withFresh, keyFor, parsePerSource, canonical }
