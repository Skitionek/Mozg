'use strict'

const { test, describe, before, after, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { Registry, bounded } = require('../src/metrics')
const { createLogger, withContext, sanitizeRequestId } = require('../src/log')
const telemetry = require('../src/telemetry')
const http = require('../src/database/http')
const { createMozgServer, createMetricsServer, metricsSettings } = require('../src/server')

const SAMPLE_DB = path.join(__dirname, '..', 'examples', 'sample.db')

before(() => {
  if (fs.existsSync(SAMPLE_DB)) return
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'examples', 'seed.js')], { stdio: 'pipe' })
  if (result.status !== 0) throw new Error(`Seed failed: ${result.stderr.toString()}`)
})

/** Listen on a free port and say where. */
function listen (server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
}

const close = (server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) })

/** The value of one sample in a scrape, or undefined. */
function sample (text, series) {
  const line = text.split('\n').find((l) => l.startsWith(series + ' '))
  return line ? Number(line.slice(series.length + 1)) : undefined
}

describe('metrics registry', () => {
  test('renders counters, gauges and histograms in the Prometheus text format', () => {
    const r = new Registry()
    const c = r.counter('jobs_total', 'Jobs done.', ['kind'])
    c.inc(['a']); c.inc(['a'], 2); c.inc({ kind: 'b' })
    const g = r.gauge('depth', 'Queue depth.', [])
    g.set([], 7); g.dec([], 2)
    const h = r.histogram('wait_seconds', 'Wait.', ['q'], [0.1, 1])
    h.observe(['x'], 0.05); h.observe(['x'], 0.5); h.observe(['x'], 5)
    const text = r.render()

    assert.match(text, /# HELP jobs_total Jobs done\.\n# TYPE jobs_total counter\n/)
    assert.equal(sample(text, 'jobs_total{kind="a"}'), 3)
    assert.equal(sample(text, 'jobs_total{kind="b"}'), 1)
    assert.equal(sample(text, 'depth'), 5)
    assert.equal(sample(text, 'wait_seconds_bucket{q="x",le="0.1"}'), 1)
    assert.equal(sample(text, 'wait_seconds_bucket{q="x",le="1"}'), 2)
    assert.equal(sample(text, 'wait_seconds_bucket{q="x",le="+Inf"}'), 3)
    assert.equal(sample(text, 'wait_seconds_count{q="x"}'), 3)
    assert.equal(sample(text, 'wait_seconds_sum{q="x"}'), 5.55)
  })

  test('escapes label values so a hostile one cannot forge a sample', () => {
    const r = new Registry()
    r.counter('c_total', 'c', ['host']).inc(['evil"}\nfake_metric 1\n'])
    const text = r.render()
    assert.ok(!text.split('\n').some((l) => l.startsWith('fake_metric')), 'the injected line is not a line')
    assert.match(text, /host="evil\\"}\\nfake_metric 1\\n"/)
  })

  test('refuses bad names and a counter that goes down', () => {
    const r = new Registry()
    assert.throws(() => r.counter('bad name', 'x'), /invalid metric name/)
    assert.throws(() => r.counter('ok_total', 'x', ['__reserved']), /invalid label name/)
    assert.throws(() => r.histogram('h', 'x', ['le']), /reserved/)
    assert.throws(() => r.counter('ok_total', 'x').inc([], -1), /only goes up/)
    r.counter('dup_total', 'x')
    assert.throws(() => r.counter('dup_total', 'x'), /already registered/)
  })

  test('a failing collector does not take the scrape down, and is reported', () => {
    const reported = []
    const r = new Registry({ onCollectError: (name, err) => reported.push([name, err.message]) })
    r.gauge('broken', 'x', [], () => { throw new Error('nope') })
    r.collectedCounter('broken_total', 'x', [], () => { throw new Error('also nope') })
    r.counter('fine_total', 'x', []).inc([])
    assert.equal(sample(r.render(), 'fine_total'), 1)
    assert.deepEqual(reported, [['broken', 'nope'], ['broken_total', 'also nope']])
  })

  test('bounded() folds caller-chosen label values past its limit into "other"', () => {
    const label = bounded(3)
    assert.deepEqual(['a', 'b', 'c', 'd', 'a', 'e'].map(label), ['a', 'b', 'c', 'other', 'a', 'other'])
  })
})

describe('logger', () => {
  /** A logger writing to arrays. */
  function capture (env) {
    const out = []
    const err = []
    const logger = createLogger({ env, stdout: { write: (s) => out.push(s), isTTY: false }, stderr: { write: (s) => err.push(s) }, now: () => new Date('2026-11-08T00:00:00Z') })
    return { logger, out, err }
  }

  test('writes one JSON object per line, errors and warnings to stderr', () => {
    const { logger, out, err } = capture({})
    logger.info('hello', { a: 1 })
    logger.warn('careful')
    logger.debug('hidden')
    assert.deepEqual(JSON.parse(out[0]), { ts: '2026-11-08T00:00:00.000Z', level: 'info', msg: 'hello', a: 1 })
    assert.equal(JSON.parse(err[0]).level, 'warn')
    assert.equal(out.length + err.length, 2, 'debug is below the default level')
  })

  test('honours MOZG_LOG_LEVEL', () => {
    const { logger, out } = capture({ MOZG_LOG_LEVEL: 'debug' })
    logger.debug('shown')
    assert.equal(out.length, 1)
    const quiet = capture({ MOZG_LOG_LEVEL: 'error' })
    quiet.logger.warn('x'); quiet.logger.info('y')
    assert.equal(quiet.out.length + quiet.err.length, 0)
  })

  test('attaches the request id to everything logged inside a request', () => {
    const { logger, out } = capture({})
    withContext({ requestId: 'r-1' }, () => logger.info('inside'))
    logger.info('outside')
    assert.equal(JSON.parse(out[0]).requestId, 'r-1')
    assert.equal(JSON.parse(out[1]).requestId, undefined)
  })

  test('never writes a password from a connection string', () => {
    const { logger, out } = capture({})
    logger.info('connect postgres://alice:hunter2@db:5432/x failed', { detail: 'tried mysql://bob:s3cret@h/db' })
    const line = out[0]
    assert.ok(!line.includes('hunter2') && !line.includes('s3cret'), line)
    assert.match(line, /alice:\*\*\*@/)
  })

  test('reads as plain text when asked', () => {
    const { logger, out } = capture({ MOZG_LOG_FORMAT: 'text' })
    logger.info('hello', { a: 1, b: 'two' })
    assert.match(out[0], /^2026-11-08T00:00:00\.000Z INFO\s+hello a=1 b=two\n$/)
  })

  test('accepts only a plain, short request id from a caller', () => {
    assert.equal(sanitizeRequestId('abc-123_x.y:z'), 'abc-123_x.y:z')
    assert.equal(sanitizeRequestId('has space'), null)
    assert.equal(sanitizeRequestId('a'.repeat(65)), null)
    assert.equal(sanitizeRequestId('line\nbreak'), null)
    assert.equal(sanitizeRequestId(undefined), null)
  })
})

describe('server telemetry', () => {
  let server
  let base
  before(async () => {
    server = createMozgServer()
    base = await listen(server)
  })
  after(() => close(server))

  const graphql = (query, headers = {}) => fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query })
  }).then((r) => r.json())

  test('gives every response a request id, and keeps a sane one the caller sent', async () => {
    const generated = await fetch(`${base}/healthz`)
    assert.match(generated.headers.get('x-request-id'), /^[0-9a-f]{16}$/)
    const kept = await fetch(`${base}/healthz`, { headers: { 'x-request-id': 'trace-me-42' } })
    assert.equal(kept.headers.get('x-request-id'), 'trace-me-42')
    const replaced = await fetch(`${base}/healthz`, { headers: { 'x-request-id': 'not ok!' } })
    assert.notEqual(replaced.headers.get('x-request-id'), 'not ok!')
  })

  test('counts and times a real query, labelled by driver', async () => {
    const before = await (await fetch(`${base}/metrics`)).text()
    const series = 'mozg_queries_total{driver="sqlite3",source="custom",outcome="ok",nested="false"}'
    const rowSeries = 'mozg_query_rows_total{driver="sqlite3",source="custom"}'

    const result = await graphql(`{ query(input: { connection: { driver: sqlite3, database: ${JSON.stringify(SAMPLE_DB)} }, from: "users", limit: 2 }) { count } }`)
    assert.equal(result.data.query.count, 2)

    const after = await (await fetch(`${base}/metrics`)).text()
    assert.equal(sample(after, series) - (sample(before, series) || 0), 1)
    assert.equal(sample(after, rowSeries) - (sample(before, rowSeries) || 0), 2)
    assert.ok(sample(after, 'mozg_query_duration_seconds_count{driver="sqlite3",source="custom",nested="false"}') >= 1)
    assert.equal(sample(after, 'mozg_queries_in_flight'), 0, 'nothing left running')
  })

  test('counts a failed query as an error', async () => {
    const series = 'mozg_queries_total{driver="sqlite3",source="custom",outcome="error",nested="false"}'
    const before = sample(await (await fetch(`${base}/metrics`)).text(), series) || 0
    await graphql('{ query(input: { connection: { driver: sqlite3, database: "/nonexistent/x.db" }, from: "users" }) { count } }')
    const after = sample(await (await fetch(`${base}/metrics`)).text(), series)
    assert.equal(after - before, 1)
  })

  test('counts requests by route and status, without ever using the raw path as a label', async () => {
    await fetch(`${base}/no/such/file-${Math.random()}`)
    const text = await (await fetch(`${base}/metrics`)).text()
    assert.ok(sample(text, 'mozg_http_requests_total{method="GET",route="static",status="404"}') >= 1)
    assert.ok(!text.includes('no/such'), 'the path is not a label')
  })

  test('reports cache and process gauges', async () => {
    // Drivers load on first use, so the connection cache has no series until one has run.
    await graphql(`{ query(input: { connection: { driver: sqlite3, database: ${JSON.stringify(SAMPLE_DB)} }, from: "users", limit: 1 }) { count } }`)
    const text = await (await fetch(`${base}/metrics`)).text()
    for (const name of ['mozg_result_cache_entries', 'mozg_http_cache_entries', 'process_resident_memory_bytes', 'process_cpu_seconds_total']) {
      assert.ok(sample(text, name) >= 0, `${name} is reported`)
    }
    assert.match(text, /mozg_build_info\{version="[^"]+"\} 1/)
    assert.ok(sample(text, 'mozg_connection_cache_entries{driver="sqlite3"}') >= 0)
  })

  test('logs the query at info with the caller\'s request id, and never the where values', async () => {
    const lines = []
    mock.method(process.stdout, 'write', (s) => { lines.push(String(s)); return true })
    try {
      await graphql(`{ query(input: { connection: { driver: sqlite3, database: ${JSON.stringify(SAMPLE_DB)} }, from: "users", where: { name: "Secret Person" } }) { count } }`, { 'x-request-id': 'log-check-1' })
      await new Promise((resolve) => setTimeout(resolve, 20)) // the access line is written when the response closes
    } finally {
      mock.restoreAll()
    }
    const records = lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))
    const query = records.find((r) => r.msg === 'query' && r.requestId === 'log-check-1')
    assert.ok(query, 'a query line carries the request id')
    assert.deepEqual(query.whereKeys, ['name'])
    assert.equal(query.driver, 'sqlite3')
    assert.ok(!lines.join('').includes('Secret Person'), 'a where value never reaches the log')
    assert.ok(records.some((r) => r.msg === 'request' && r.requestId === 'log-check-1' && r.route === 'graphql'))
  })
})

describe('metrics port', () => {
  test('metricsSettings: on by default, shared port unless one is given, off when asked', () => {
    assert.deepEqual(metricsSettings({}), { enabled: true, port: null })
    assert.deepEqual(metricsSettings({ MOZG_METRICS_PORT: '9464' }), { enabled: true, port: 9464 })
    assert.deepEqual(metricsSettings({ MOZG_METRICS: 'off', MOZG_METRICS_PORT: '9464' }), { enabled: false, port: null })
  })

  test('a separate port serves /metrics and nothing else, and the main port stops serving it', async () => {
    const env = { MOZG_METRICS_PORT: '1' } // only its truthiness matters here: the test listens on its own port
    const main = createMozgServer({ env })
    const metrics = createMetricsServer({ env })
    const mainBase = await listen(main)
    const metricsBase = await listen(metrics)
    try {
      assert.equal((await fetch(`${metricsBase}/metrics`)).status, 200)
      assert.equal((await fetch(`${metricsBase}/healthz`)).status, 404, 'the metrics port serves nothing else')
      const onMain = await fetch(`${mainBase}/metrics`)
      assert.notEqual(await onMain.text().then((t) => t.includes('# TYPE mozg_')), true, 'the main port does not expose metrics')
    } finally {
      await close(main)
      await close(metrics)
    }
  })

  test('with metrics off nothing is served anywhere', async () => {
    const env = { MOZG_METRICS: 'off' }
    assert.equal(createMetricsServer({ env }), null)
    const main = createMozgServer({ env })
    const mainBase = await listen(main)
    try {
      const response = await fetch(`${mainBase}/metrics`)
      assert.ok(!(await response.text()).includes('# TYPE mozg_'))
    } finally {
      await close(main)
    }
  })
})

describe('outbound HTTP metrics', () => {
  test('counts each attempt by host and status, and each retry', async () => {
    const host = `upstream-metrics-${Math.random().toString(36).slice(2)}.invalid`
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return calls === 1
        ? new Response('busy', { status: 503 })
        : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    try {
      await http.request(`http://${host}/x`, { retries: 1, backoffMs: 1 })
    } finally {
      globalThis.fetch = realFetch
      http.reset()
    }
    const text = telemetry.registry.render()
    assert.equal(sample(text, `mozg_upstream_requests_total{host="${host}",status="503"}`), 1)
    assert.equal(sample(text, `mozg_upstream_requests_total{host="${host}",status="200"}`), 1)
    assert.equal(sample(text, `mozg_upstream_retries_total{host="${host}"}`), 1)
    assert.equal(sample(text, `mozg_upstream_request_duration_seconds_count{host="${host}"}`), 2)
  })

  test('counts a network failure as status "error"', async () => {
    const host = `upstream-down-${Math.random().toString(36).slice(2)}.invalid`
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED') }
    try {
      await assert.rejects(http.request(`http://${host}/x`, { retries: 0 }), /ECONNREFUSED/)
    } finally {
      globalThis.fetch = realFetch
      http.reset()
    }
    assert.equal(sample(telemetry.registry.render(), `mozg_upstream_requests_total{host="${host}",status="error"}`), 1)
  })
})
