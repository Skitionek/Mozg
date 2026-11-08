'use strict'

/**
 * What Mozg reports about itself: metrics for /metrics and log lines.
 *
 * Instruments are declared once here and incremented from the places that do
 * the work (connector, http, self-hosted, the server).  Caches report their
 * own counters at scrape time through collectors, so they stay the single
 * source of truth and cost nothing between scrapes.
 *
 *   MOZG_METRICS        on | off                 (default on)
 *   MOZG_METRICS_PORT   serve /metrics on a separate port instead of the main
 *                       one, so a public Service or Ingress never exposes it
 *
 * There is no tracing: no OpenTelemetry SDK is bundled.  Every request carries
 * an id (X-Request-Id, accepted from the caller or generated) that appears in
 * each log line it causes, which is enough to follow one request.
 */

const { AsyncLocalStorage } = require('node:async_hooks')
const { Registry, bounded } = require('./metrics')
const { createLogger, withContext, sanitizeRequestId, newRequestId } = require('./log')
const { intOption } = require('./config')
const { version } = require('../package.json')

const logger = createLogger()

// A collector that throws must not take the whole scrape down, but it must not
// vanish silently either: say so once per metric.
const reportedCollectors = new Set()
const registry = new Registry({
  onCollectError: (name, err) => {
    if (reportedCollectors.has(name)) return
    reportedCollectors.add(name)
    logger.warn('metric collector failed', { metric: name, error: err.message })
  }
})

// Caller-influenced labels are bounded: see metrics.bounded.
const sourceLabel = bounded(100)
const hostLabel = bounded(100)

// ── Instruments ─────────────────────────────────────────────────────────────

const httpRequests = registry.counter('mozg_http_requests_total', 'Inbound HTTP requests.', ['method', 'route', 'status'])
const httpDuration = registry.histogram('mozg_http_request_duration_seconds', 'Inbound HTTP request duration.', ['route'])

const queries = registry.counter('mozg_queries_total', 'Queries executed, including the per-parent fetches of relations (nested="true").', ['driver', 'source', 'outcome', 'nested'])
const queryDuration = registry.histogram('mozg_query_duration_seconds', 'Query duration, relations included.', ['driver', 'source', 'nested'])
const queryRows = registry.counter('mozg_query_rows_total', 'Rows returned by queries.', ['driver', 'source'])
const queriesInFlight = registry.gauge('mozg_queries_in_flight', 'Queries running now.', [])

const upstreamRequests = registry.counter('mozg_upstream_requests_total', 'Outbound HTTP requests to data sources, by outcome ("error" is a network failure or timeout).', ['host', 'status'])
const upstreamDuration = registry.histogram('mozg_upstream_request_duration_seconds', 'Outbound HTTP request duration, one attempt each.', ['host'])
const upstreamRetries = registry.counter('mozg_upstream_retries_total', 'Outbound HTTP requests retried after a transient failure.', ['host'])

const wakes = registry.counter('mozg_self_hosted_wakes_total', 'Queries that found a self-hosted database scaled to zero and waited for it.', ['source'])
const wakeDuration = registry.histogram('mozg_self_hosted_wake_seconds', 'Time a query waited for a self-hosted database to come up.', ['source'], [1, 2.5, 5, 10, 20, 30, 60, 120, 180])

registry.gauge('mozg_build_info', 'Mozg version, as a label.', ['version'], () => [[{ version }, 1]])
registry.gauge('process_resident_memory_bytes', 'Resident memory size.', [], () => process.memoryUsage().rss)
registry.gauge('process_start_time_seconds', 'Start time of the process, in unix seconds.', [], () => Math.floor(Date.now() / 1000 - process.uptime()))
registry.collectedCounter('process_cpu_seconds_total', 'User and system CPU time spent.', [], () => {
  const { user, system } = process.cpuUsage()
  return (user + system) / 1e6
})

// Caches and the result cache report their own tallies.  Required lazily so
// that loading telemetry never loads a driver.
registry.gauge('mozg_result_cache_entries', 'Results held by the result cache.', [], () => require('./database/result-cache').getResultCache().stats().entries)
registry.gauge('mozg_result_cache_bytes', 'Bytes held by the result cache.', [], () => require('./database/result-cache').getResultCache().stats().bytes)
registry.collectedCounter('mozg_result_cache_requests_total', 'Result cache lookups by outcome (shared = joined a running identical query).', ['outcome'], () => {
  const s = require('./database/result-cache').getResultCache().stats()
  return [[['hit'], s.hits], [['miss'], s.misses], [['bypass'], s.bypasses], [['shared'], s.shared]]
})
registry.collectedCounter('mozg_result_cache_evictions_total', 'Results evicted to stay within the cache bounds.', [], () => require('./database/result-cache').getResultCache().stats().evictions)

registry.gauge('mozg_http_cache_entries', 'Responses held by the outbound HTTP cache.', [], () => require('./database/http').cacheStats().size)
registry.collectedCounter('mozg_http_cache_requests_total', 'Outbound HTTP cache lookups by outcome.', ['outcome'], () => {
  const s = require('./database/http').cacheStats()
  return [[['hit'], s.hits], [['miss'], s.misses]]
})

registry.gauge('mozg_connection_cache_entries', 'Database clients (connection pools) held, by driver.', ['driver'], () => {
  const { connectionCaches } = require('./database/drivers/knex-query')
  return [...connectionCaches].map(([driver, cache]) => [{ driver }, cache.size])
})
registry.collectedCounter('mozg_connection_cache_evictions_total', 'Database clients closed to stay within the cache bounds, by driver.', ['driver'], () => {
  const { connectionCaches } = require('./database/drivers/knex-query')
  return [...connectionCaches].map(([driver, cache]) => [{ driver }, cache.stats.evictions])
})

// ── Requests ────────────────────────────────────────────────────────────────

/** A fixed vocabulary for the route label; an arbitrary path would be unbounded. */
function routeOf (pathname) {
  if (pathname.startsWith('/graphql')) return 'graphql'
  if (pathname === '/stream') return 'stream'
  if (pathname.startsWith('/demand')) return 'demand'
  if (pathname === '/healthz') return 'healthz'
  if (pathname === '/metrics') return 'metrics'
  return 'static'
}

/**
 * Give a request an id, time it and log it when it finishes.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @param {() => void} handle  serves the request
 */
function trackRequest (req, res, pathname, handle) {
  const route = routeOf(pathname)
  const requestId = sanitizeRequestId(req.headers['x-request-id']) || newRequestId()
  res.setHeader('X-Request-Id', requestId)
  const stop = httpDuration.startTimer([route])

  res.once('close', () => {
    const seconds = stop([route])
    // 499 is the convention for "the client went away first".
    const status = res.writableFinished ? res.statusCode : 499
    httpRequests.inc([req.method, route, status])
    // Probes and scrapes arrive every few seconds; they are noise at info.
    const quiet = route === 'healthz' || route === 'metrics' || route === 'demand'
    logger[quiet ? 'debug' : 'info']('request', {
      method: req.method,
      route,
      status,
      durationMs: Math.round(seconds * 1000)
    })
  })

  return withContext({ requestId }, handle)
}

// ── Queries ─────────────────────────────────────────────────────────────────

const depthScope = new AsyncLocalStorage()

/**
 * Count, time and log one query.  `input` is the normalised query; `run`
 * executes it.  Queries made on behalf of another (the per-parent fetches of a
 * relation) are counted too, as nested="true", and logged at debug.
 */
async function trackQuery (input, run) {
  const connection = input.connection || {}
  const driver = connection.driver || 'unknown'
  const source = connection.source ? sourceLabel(connection.source) : 'custom'
  const depth = depthScope.getStore() || 0
  const nested = String(depth > 0)

  queriesInFlight.inc([])
  const stop = queryDuration.startTimer([driver, source, nested])
  let outcome = 'ok'
  let rows = 0
  let cache
  try {
    const result = await depthScope.run(depth + 1, run)
    rows = result && Number.isFinite(result.count) ? result.count : 0
    cache = result && result.meta ? result.meta.cache : undefined
    return result
  } catch (err) {
    outcome = 'error'
    throw err
  } finally {
    queriesInFlight.dec([])
    const seconds = stop([driver, source, nested])
    queries.inc([driver, source, outcome, nested])
    if (rows) queryRows.inc([driver, source], rows)

    const durationMs = Math.round(seconds * 1000)
    const slowMs = intOption('MOZG_SLOW_QUERY_MS', 10_000)
    const slow = depth === 0 && slowMs > 0 && durationMs >= slowMs
    const level = slow || outcome === 'error' ? 'warn' : depth === 0 ? 'info' : 'debug'
    if (logger.enabled(level)) {
      logger[level](slow ? 'slow query' : 'query', {
        driver,
        source: connection.source || undefined,
        from: input.from,
        // Names, never values: a where value can be personal data.
        whereKeys: input.where ? Object.keys(input.where) : undefined,
        relations: input.relations && input.relations.length ? input.relations.length : undefined,
        rows,
        durationMs,
        cache,
        outcome
      })
    }
  }
}

// ── Outbound HTTP and cold starts ───────────────────────────────────────────

/** Record one outbound attempt: its host, its HTTP status (or "error"), and how long it took. */
function recordUpstream (host, status, seconds) {
  const label = hostLabel(host)
  upstreamRequests.inc([label, status])
  upstreamDuration.observe([label], seconds)
}

function recordUpstreamRetry (host) {
  upstreamRetries.inc([hostLabel(host)])
}

function recordWake (source, seconds) {
  const label = sourceLabel(source)
  wakes.inc([label])
  wakeDuration.observe([label], seconds)
}

// ── Exposure ────────────────────────────────────────────────────────────────

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

/** Write the metrics to a response. */
function serveMetrics (res) {
  res.writeHead(200, { 'Content-Type': CONTENT_TYPE, 'Cache-Control': 'no-store' })
  res.end(registry.render())
}

module.exports = {
  registry,
  logger,
  routeOf,
  trackRequest,
  trackQuery,
  recordUpstream,
  recordUpstreamRetry,
  recordWake,
  serveMetrics,
  CONTENT_TYPE
}
