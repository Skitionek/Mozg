'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { probe } = require('../scripts/catalog-health')

/** Stand in for global.fetch, answering every call the same way. */
function stubFetch (response) {
  const original = globalThis.fetch
  globalThis.fetch = async () => response
  return () => { globalThis.fetch = original }
}

const ENTRY = {
  driver: 'rest',
  connection: { database: 'https://example.org/api' },
  entities: [{ name: '/things' }]
}

describe('probe: classifying a failure', () => {
  test('a 404 is broken — the catalog is wrong about the endpoint', async () => {
    // Given an endpoint that answers 404
    const restore = stubFetch({ ok: false, status: 404, headers: { get: () => null } })

    // When it is probed
    const result = await probe(ENTRY)
    restore()

    // Then it is classified as our problem
    assert.equal(result.status, 'broken')
  })

  test('a 429 is unavailable, not broken — the server is throttling, not wrong', async () => {
    // Given an endpoint that is rate-limiting the probe
    const restore = stubFetch({ ok: false, status: 429, headers: { get: () => null } })

    // When it is probed
    const result = await probe(ENTRY)
    restore()

    // Then it is not reported as a catalog defect
    assert.equal(result.status, 'unavailable')
  })

  test('a 500 is unavailable — their server, not our catalog entry', async () => {
    // Given an endpoint having an outage
    const restore = stubFetch({ ok: false, status: 500, headers: { get: () => null } })

    // When it is probed
    const result = await probe(ENTRY)
    restore()

    // Then it does not count against the catalog
    assert.equal(result.status, 'unavailable')
  })

  test('a successful response with a body is ok', async () => {
    // Given an endpoint that answers successfully
    const headers = { get: (name) => (name === 'content-type' ? 'application/json' : null) }
    const restore = stubFetch({ ok: true, status: 200, headers, text: async () => '{"a":1}' })

    // When it is probed
    const result = await probe(ENTRY)
    restore()

    // Then it is reported ok
    assert.equal(result.status, 'ok')
  })

  test('an empty body is broken even with a 200 status', async () => {
    // Given an endpoint that answers 200 with nothing in the body
    const restore = stubFetch({ ok: true, status: 200, headers: { get: () => null }, text: async () => '' })

    // When it is probed
    const result = await probe(ENTRY)
    restore()

    // Then it is reported as the catalog's problem, not skipped as ok
    assert.equal(result.status, 'broken')
  })

  test('a 200 serving an HTML page is broken, not ok', async () => {
    // Given an endpoint that has moved to a maintenance or error page but
    // still answers 200 (a common failure mode for these public APIs)
    const headers = { get: (name) => (name === 'content-type' ? 'text/html; charset=utf-8' : null) }
    const restore = stubFetch({ ok: true, status: 200, headers, text: async () => '<html>Service moved</html>' })

    // When it is probed
    const result = await probe(ENTRY)
    restore()

    // Then it is reported as broken rather than ok — none of the catalog's
    // entries legitimately serve HTML as their data
    assert.equal(result.status, 'broken')
  })
})

describe('probe: api sources', () => {
  const { registerCatalog } = require('../src/catalog')
  const http = require('../src/database/http')

  const API_ENTRY = {
    name: 'health-api',
    label: 'Health api',
    driver: 'api',
    connection: { database: 'https://health.example' },
    entities: [
      { name: 'good', description: 'ok', path: '/good/{id}', params: { id: {} }, fields: { id: 'id' }, example: { id: '1' } },
      { name: 'gone', description: 'moved', path: '/gone/{id}', params: { id: {} }, fields: { id: 'id' }, example: { id: '1' } }
    ]
  }

  test('runs every entity example and reports the entry broken when one returns nothing', async () => {
    // Given an api source where one entity's endpoint has moved (404 → no rows)
    const unregister = registerCatalog(API_ENTRY)
    http.reset()
    const restore = stubFetch(null)
    globalThis.fetch = async (url) => {
      const found = url.startsWith('https://health.example/good/')
      return { ok: found, status: found ? 200 : 404, headers: { get: () => 'application/json' }, text: async () => (found ? '{"id":"1"}' : '') }
    }

    // When it is probed
    const result = await probe(API_ENTRY)
    restore()
    unregister()

    // Then the entry is broken and the report names the entity at fault
    assert.equal(result.status, 'broken')
    assert.match(result.error, /^gone: example .* returned no rows/)
    assert.equal(result.entities.good, 'ok')
  })

  test('is unavailable when an upstream is down and nothing is broken, ok when all answer', async () => {
    const unregister = registerCatalog({ ...API_ENTRY, name: 'health-api-2', entities: [API_ENTRY.entities[0]] })
    http.reset()
    const restore = stubFetch(null)
    let down = true
    globalThis.fetch = async () => (down
      ? { ok: false, status: 503, statusText: 'Unavailable', headers: { get: () => null }, text: async () => 'busy' }
      : { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"id":"1"}' })

    const entry = { ...API_ENTRY, name: 'health-api-2', entities: [API_ENTRY.entities[0]] }
    const unavailable = await probe(entry)
    down = false
    http.reset()
    const ok = await probe(entry)
    restore()
    unregister()

    assert.equal(unavailable.status, 'unavailable')
    assert.equal(ok.status, 'ok')
  })
})
