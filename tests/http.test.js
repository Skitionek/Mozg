'use strict'

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const http = require('../src/database/http')

/** A minimal stand-in for a fetch Response. */
function response (status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: { 200: 'OK', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' }[status] || '',
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => text
  }
}

let original
let calls

/** Replace fetch with a function answering each call from `answers` in turn. */
function stubFetch (...answers) {
  calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    const next = answers.length > 1 ? answers.shift() : answers[0]
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next(url, init) : next
  }
}

beforeEach(() => {
  original = globalThis.fetch
  http.reset()
})

afterEach(() => {
  globalThis.fetch = original
})

describe('http.request', () => {
  test('parses a JSON body and identifies itself with a User-Agent', async () => {
    // Given an upstream that answers with JSON
    stubFetch(response(200, { hello: 'world' }))

    // When it is requested
    const { status, body } = await http.request('https://api.example.org/thing')

    // Then the body is parsed and the request carried Mozg's User-Agent
    assert.equal(status, 200)
    assert.deepEqual(body, { hello: 'world' })
    assert.match(calls[0].init.headers['User-Agent'], /^mozg\//)
  })

  test('retries a 503 and succeeds on the next attempt', async () => {
    // Given an upstream that fails once with a transient error
    stubFetch(response(503, 'busy'), response(200, { ok: true }))

    // When it is requested with retries
    const { body } = await http.request('https://api.example.org/flaky', { retries: 2, backoffMs: 1 })

    // Then the second attempt's answer is returned
    assert.deepEqual(body, { ok: true })
    assert.equal(calls.length, 2)
  })

  test('honours Retry-After on a 429', async () => {
    // Given an upstream that throttles once and says to wait a moment
    stubFetch(response(429, 'slow down', { 'Retry-After': '0.05' }), response(200, [1]))

    // When it is requested
    const started = Date.now()
    await http.request('https://api.example.org/throttled', { retries: 1, backoffMs: 1 })

    // Then the client waited roughly as long as asked before retrying
    assert.ok(Date.now() - started >= 40, 'waited for Retry-After')
    assert.equal(calls.length, 2)
  })

  test('does not retry a 400 — the request itself is wrong', async () => {
    // Given an upstream that rejects the request
    stubFetch(response(400, { error: 'bad accession' }))

    // When it is requested
    // Then it fails at once, with the upstream's explanation in the message
    await assert.rejects(
      http.request('https://api.example.org/bad', { retries: 3, backoffMs: 1 }),
      (err) => err instanceof http.HttpError && err.status === 400 && /bad accession/.test(err.message) && !err.transient
    )
    assert.equal(calls.length, 1)
  })

  test('returns an empty body for an allowed "no such record" status', async () => {
    // Given an upstream that has no record for the id
    stubFetch(response(404, 'not found'))

    // When 404 is declared to mean "nothing here"
    const { status, body } = await http.request('https://api.example.org/missing', { allowStatus: [404] })

    // Then it resolves to no data rather than throwing
    assert.equal(status, 404)
    assert.equal(body, null)
  })

  test('times out a hung request and reports it as transient', async () => {
    // Given an upstream that never answers until aborted
    globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })

    // When it is requested with a short timeout and no retries
    // Then it fails with a timeout that is classified as transient
    await assert.rejects(
      http.request('https://api.example.org/hang', { timeoutMs: 20, retries: 0 }),
      (err) => /timed out after 20 ms/.test(err.message) && err.transient
    )
  })

  test('shares one round-trip between identical concurrent GETs', async () => {
    // Given an upstream that answers slowly
    stubFetch(() => new Promise((resolve) => setTimeout(() => resolve(response(200, { n: 1 })), 20)))

    // When the same URL is requested three times at once
    const results = await Promise.all([1, 2, 3].map(() => http.request('https://api.example.org/same')))

    // Then only one request went out and everyone got the answer
    assert.equal(calls.length, 1)
    for (const r of results) assert.deepEqual(r.body, { n: 1 })
  })

  test('throttles a host to its rate limit', async () => {
    // Given a host limited to 20 requests per second
    stubFetch(response(200, {}))

    // When four distinct requests are made at once
    const started = Date.now()
    await Promise.all([1, 2, 3, 4].map((i) =>
      http.request(`https://slow.example.org/item/${i}`, { rateLimit: { requestsPerSecond: 20 } })))

    // Then they were spaced ~50 ms apart (three gaps)
    assert.ok(Date.now() - started >= 140, `took ${Date.now() - started} ms`)
  })

  test('masks credentials in URLs it reports', async () => {
    // Given a request carrying an API key that fails
    stubFetch(response(400, 'nope'))

    // When it fails
    // Then the key does not appear in the error
    await assert.rejects(
      http.request('https://api.example.org/x?api_key=SECRET123&q=1', { retries: 0 }),
      (err) => !err.message.includes('SECRET123') && err.message.includes('api_key=***')
    )
  })

  test('reports a non-JSON body clearly instead of a parse error', async () => {
    // Given an upstream that serves an HTML page where JSON was expected
    stubFetch(response(200, '<!doctype html><title>Maintenance</title>', { 'Content-Type': 'text/html' }))

    // When it is requested as JSON
    // Then the error names what actually arrived
    await assert.rejects(http.request('https://api.example.org/html'), /expected JSON but received text\/html/)
  })
})

describe('http.redactUrl', () => {
  test('masks conventional and extra credential parameters', () => {
    const out = http.redactUrl('https://x.org/a?token=t&apikey=k&my_secret=s&keep=1', ['my_secret'])
    assert.equal(out, 'https://x.org/a?token=***&apikey=***&my_secret=***&keep=1')
  })
})
