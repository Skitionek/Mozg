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
})
