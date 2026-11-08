'use strict'

/**
 * Outbound HTTP for every source Mozg reaches over the network.
 *
 * Public life-science APIs are shared infrastructure run on research budgets.
 * A query that fans out across relations can easily issue hundreds of
 * requests, so the client is deliberately polite and deliberately patient:
 *
 *   - every request has a timeout, so one hung upstream cannot hang a query;
 *   - transient failures (429, 502–504, timeouts, resets) are retried with
 *     exponential backoff, honouring `Retry-After` when the server sends it;
 *   - requests to one host are throttled to that host's published rate limit
 *     and to a bounded number in flight at once;
 *   - identical GETs that are already in flight share one round-trip, which
 *     matters when many parent rows point at the same related record;
 *   - every request identifies Mozg with a User-Agent, as NCBI, Ensembl,
 *     UniProt and others ask clients to do.
 *
 * Responses are not cached by default — Mozg is "slow by design" and every
 * query reads live data.  Set MOZG_HTTP_CACHE_TTL_MS to opt in to a short
 * in-process cache when latency matters more than freshness; it holds at most
 * MOZG_HTTP_CACHE_MAX_ENTRIES responses and drops the least recently used first.
 * (The Helm chart sets both from `cache.httpTtlMs` / `cache.httpMaxEntries`.)
 */

const { version } = require('../../package.json')
const { LruCache } = require('../cache')
const { intOption, OPTIONS } = require('../config')
const telemetry = require('../telemetry')

const USER_AGENT = `mozg/${version} (+https://github.com/Skitionek/Mozg)`

const DEFAULTS = {
  timeoutMs: Number(process.env.MOZG_HTTP_TIMEOUT_MS) || 30_000,
  retries: process.env.MOZG_HTTP_RETRIES != null ? Number(process.env.MOZG_HTTP_RETRIES) : 2,
  backoffMs: 500,
  maxRetryAfterMs: 15_000,
  maxConcurrent: 4,
  cacheTtlMs: intOption('MOZG_HTTP_CACHE_TTL_MS', OPTIONS.MOZG_HTTP_CACHE_TTL_MS),
  // 0 would mean "unbounded" to the cache; an operator who sets it means "default".
  cacheMaxEntries: intOption('MOZG_HTTP_CACHE_MAX_ENTRIES', OPTIONS.MOZG_HTTP_CACHE_MAX_ENTRIES) || OPTIONS.MOZG_HTTP_CACHE_MAX_ENTRIES
}

const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504])

// Query-string parameters that conventionally carry a credential.  Their
// values are masked in every URL that leaves this module in an error message.
const SECRET_PARAMS = new Set(['api_key', 'apikey', 'api-key', 'key', 'token', 'access_token', 'auth', 'password'])

class HttpError extends Error {
  constructor (message, { status, url, body, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'HttpError'
    this.status = status
    this.url = url
    this.body = body
  }

  /** True when the failure says nothing about whether the request was right. */
  get transient () {
    return this.status == null || this.status >= 500 || this.status === 429 || this.status === 408
  }
}

/**
 * Mask credential-bearing query parameters in a URL.
 * @param {string} url
 * @param {Iterable<string>} [extra]  additional parameter names to mask
 */
function redactUrl (url, extra = []) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  const secret = new Set([...SECRET_PARAMS, ...[...extra].map((p) => String(p).toLowerCase())])
  for (const key of [...parsed.searchParams.keys()]) {
    if (secret.has(key.toLowerCase())) parsed.searchParams.set(key, '***')
  }
  if (parsed.password) parsed.password = '***'
  return parsed.toString()
}

// ── Per-host throttling ─────────────────────────────────────────────────────

class HostLimiter {
  constructor () {
    this.maxConcurrent = DEFAULTS.maxConcurrent
    this.minIntervalMs = 0
    this.active = 0
    this.nextStartAt = 0
    this.queue = []
  }

  /** Tighten (never loosen) this host's limits to the given policy. */
  configure ({ requestsPerSecond, maxConcurrent } = {}) {
    if (requestsPerSecond > 0) {
      this.minIntervalMs = Math.max(this.minIntervalMs, Math.ceil(1000 / requestsPerSecond))
    }
    if (maxConcurrent > 0) {
      this.maxConcurrent = Math.min(this.maxConcurrent, maxConcurrent)
    }
  }

  async run (task) {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  acquire () {
    return new Promise((resolve) => {
      this.queue.push(resolve)
      this.pump()
    })
  }

  release () {
    this.active--
    this.pump()
  }

  pump () {
    if (this.timer || this.queue.length === 0 || this.active >= this.maxConcurrent) return
    const wait = this.nextStartAt - Date.now()
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.pump()
      }, wait)
      return
    }
    this.active++
    this.nextStartAt = Date.now() + this.minIntervalMs
    this.queue.shift()()
    this.pump()
  }
}

// One limiter per host a query has named.  The host comes from caller input
// (a REST base URL), so the map is bounded; a limiter in use was touched by
// its own request and is the last one an LRU would drop.
const limiters = new LruCache({ max: 1000 })

function limiterFor (host) {
  let limiter = limiters.get(host)
  if (!limiter) {
    limiter = new HostLimiter()
    limiters.set(host, limiter)
  }
  return limiter
}

// ── In-flight de-duplication and optional cache ─────────────────────────────

const inFlight = new Map()
const cache = new LruCache({ max: DEFAULTS.cacheMaxEntries })

function cacheGet (key) {
  return cache.get(key)
}

function cacheSet (key, value, ttlMs) {
  if (!(ttlMs > 0)) return
  cache.set(key, value, { ttlMs })
}

/** Size and hit/miss counters of the response cache, for the metrics. */
function cacheStats () {
  return { size: cache.size, max: DEFAULTS.cacheMaxEntries, ttlMs: DEFAULTS.cacheTtlMs, ...cache.stats }
}

// ── Request ─────────────────────────────────────────────────────────────────

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelay (attempt, response, backoffMs = DEFAULTS.backoffMs) {
  const header = response && response.headers && response.headers.get && response.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
    if (ms > 0) return Math.min(ms, DEFAULTS.maxRetryAfterMs)
  }
  const base = backoffMs * 2 ** attempt
  return base + Math.floor(Math.random() * base * 0.25)
}

async function readBody (response, format) {
  const text = await response.text()
  if (format === 'text' || format === 'tsv' || format === 'xml') return text
  if (text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch {
    const contentType = (response.headers && response.headers.get && response.headers.get('content-type')) || 'unknown content type'
    throw new HttpError(`expected JSON but received ${contentType}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`, {
      status: response.status
    })
  }
}

/**
 * Perform one HTTP request with timeout, retries, throttling and de-duplication.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method]          default GET
 * @param {object} [options.headers]
 * @param {string|object} [options.body]     objects are sent as JSON
 * @param {'json'|'text'|'tsv'|'xml'} [options.format]  how to read the body (default json)
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]
 * @param {number} [options.backoffMs]       base delay before the first retry (doubles each time)
 * @param {object} [options.rateLimit]       { requestsPerSecond, maxConcurrent } for this host
 * @param {string[]} [options.secretParams]  extra query params to mask in errors
 * @param {number[]} [options.allowStatus]   non-2xx statuses to return as a null body instead of throwing (e.g. 404 for "no such record")
 * @returns {Promise<{status: number, body: any, headers: Headers}>}
 */
async function request (url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const format = options.format || 'json'
  const timeoutMs = options.timeoutMs || DEFAULTS.timeoutMs
  const retries = options.retries != null ? options.retries : DEFAULTS.retries
  const secretParams = options.secretParams || []
  const backoffMs = options.backoffMs != null ? options.backoffMs : DEFAULTS.backoffMs

  let body = options.body
  const headers = { 'User-Agent': USER_AGENT, ...(options.headers || {}) }
  if (body != null && typeof body === 'object') {
    body = JSON.stringify(body)
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
  }
  if (!Object.keys(headers).some((h) => h.toLowerCase() === 'accept')) {
    headers.Accept = format === 'json' ? 'application/json' : '*/*'
  }

  const displayUrl = redactUrl(url, secretParams)
  const host = new URL(url).host
  const limiter = limiterFor(host)
  if (options.rateLimit) limiter.configure(options.rateLimit)

  const dedupeKey = `${method} ${url} ${format} ${body || ''} ${headers.Accept}`
  const cached = cacheGet(dedupeKey)
  if (cached) return cached
  if (inFlight.has(dedupeKey)) return inFlight.get(dedupeKey)

  const attempt = async () => {
    let lastError
    for (let i = 0; i <= retries; i++) {
      let response
      try {
        response = await limiter.run(async () => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          const began = process.hrtime.bigint()
          const elapsed = () => Number(process.hrtime.bigint() - began) / 1e9
          try {
            const answer = await globalThis.fetch(url, { method, headers, body, signal: controller.signal })
            telemetry.recordUpstream(host, answer.status, elapsed())
            return answer
          } catch (err) {
            telemetry.recordUpstream(host, 'error', elapsed())
            throw err
          } finally {
            clearTimeout(timer)
          }
        })
      } catch (err) {
        const reason = err && err.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : (err && err.message) || String(err)
        // The network error stays attached: its code (ECONNREFUSED, …) is how
        // a caller tells a server that is not up yet from a wrong request.
        lastError = new HttpError(`${method} ${displayUrl} failed: ${reason}`, { url: displayUrl, cause: err })
        if (i < retries) {
          telemetry.recordUpstreamRetry(host)
          await sleep(retryDelay(i, null, backoffMs))
          continue
        }
        throw lastError
      }

      if (response.ok) {
        const parsed = await readBody(response, format).catch((err) => {
          throw new HttpError(`${method} ${displayUrl}: ${err.message}`, { status: response.status, url: displayUrl })
        })
        return { status: response.status, body: parsed, headers: response.headers }
      }

      if ((options.allowStatus || []).includes(response.status)) {
        return { status: response.status, body: null, headers: response.headers }
      }

      let detail = ''
      try {
        detail = String(await response.text()).trim().slice(0, 300).replace(/\s+/g, ' ')
      } catch { /* the explanation is a courtesy; the status is what matters */ }
      lastError = new HttpError(
        `${method} ${displayUrl} → ${response.status} ${response.statusText || ''}`.trim() + (detail ? ` — ${detail}` : ''),
        { status: response.status, url: displayUrl, body: detail }
      )
      if (RETRYABLE_STATUS.has(response.status) && i < retries) {
        telemetry.recordUpstreamRetry(host)
        await sleep(retryDelay(i, response, backoffMs))
        continue
      }
      throw lastError
    }
    throw lastError
  }

  const ttl = options.cacheTtlMs != null ? options.cacheTtlMs : DEFAULTS.cacheTtlMs
  const promise = attempt()
    .then((result) => {
      cacheSet(dedupeKey, result, ttl)
      return result
    })
    .finally(() => inFlight.delete(dedupeKey))
  inFlight.set(dedupeKey, promise)
  return promise
}

/** Forget all throttling state and cached responses (tests). */
function reset () {
  limiters.clear()
  inFlight.clear()
  cache.clear()
}

module.exports = { request, redactUrl, reset, cacheStats, HttpError, USER_AGENT, RETRYABLE_STATUS }
