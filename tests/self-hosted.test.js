'use strict'

/**
 * Self-hosted databases: demand tracking (what KEDA scales on) and waiting
 * out a cold start after the database has scaled to zero.
 */

const { test, describe, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { registerCatalog } = require('../src/catalog')
const selfHosted = require('../src/database/self-hosted')
const { normalizeQueryInput } = require('../src/database/sources')

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-sh-')), 'sh.db')

// A source shaped like the ones the Helm chart deploys: its connection comes
// from the server's environment, so it is server-held.
const ENTRY = {
  name: 'sh-test',
  label: 'Self-hosted test',
  driver: 'sqlite3',
  connection: { database: { env: 'MOZG_TEST_SH_DB', default: DB_FILE } },
  entities: [{ name: 'items', columns: ['id', 'accession'], obo: { accession: 'uniprot' }, relations: [] }]
}

const PUBLIC = { name: 'sh-public', label: 'Public', driver: 'sqlite3', connection: { database: ':memory:' }, entities: [] }

const refused = () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' })
const noSleep = async () => {}

let unregister
before(async () => {
  const knex = require('knex')({ client: 'sqlite3', connection: { filename: DB_FILE }, useNullAsDefault: true })
  await knex.schema.createTable('items', (t) => { t.integer('id'); t.string('accession') })
  await knex('items').insert([{ id: 1, accession: 'P04637' }, { id: 2, accession: 'P00533' }])
  await knex.destroy()
  const a = registerCatalog(ENTRY)
  const b = registerCatalog(PUBLIC)
  unregister = () => { a(); b() }
})
after(async () => {
  unregister()
  await require('../src/database/drivers/sqlite3').destroyAll()
})
beforeEach(() => selfHosted.reset())

const conn = { driver: 'sqlite3', source: 'sh-test' }

describe('withWake', () => {
  test('waits out a cold start: retries while nothing is listening, then answers', async () => {
    // Given a database that refuses connections twice while its pod starts
    let attempts = 0
    let inFlightSeen
    const run = async () => {
      attempts++
      inFlightSeen = selfHosted.demandFor('sh-test').inFlight
      if (attempts < 3) throw refused()
      return 'rows'
    }

    // When it is queried
    const result = await selfHosted.withWake(conn, run, { sleep: noSleep })

    // Then the query succeeds, and was counted as demand the whole time
    assert.equal(result, 'rows')
    assert.equal(attempts, 3)
    assert.equal(inFlightSeen, 1)
    assert.equal(selfHosted.demandFor('sh-test').inFlight, 0)
  })

  test('does not retry an error that is the query\'s fault', async () => {
    let attempts = 0
    const wrongPassword = Object.assign(new Error('password authentication failed for user "mozg"'), { code: '28P01' })
    await assert.rejects(
      selfHosted.withWake(conn, async () => { attempts++; throw wrongPassword }, { sleep: noSleep }),
      /password authentication failed/
    )
    assert.equal(attempts, 1)
  })

  test('gives up after the wake timeout with an explanation', async () => {
    await assert.rejects(
      selfHosted.withWake(conn, async () => { throw refused() }, { timeoutMs: 0, sleep: noSleep }),
      (err) => /sh-test did not come up within 0 s .*scaled to zero/.test(err.message) && err.cause.code === 'ECONNREFUSED'
    )
  })

  test('passes other sources straight through, without tracking them', async () => {
    let attempts = 0
    await assert.rejects(
      selfHosted.withWake({ driver: 'sqlite3', source: 'sh-public' }, async () => { attempts++; throw refused() }),
      /ECONNREFUSED/
    )
    assert.equal(attempts, 1)
    assert.equal(selfHosted.demandFor('sh-public').lastUsed, null)
    assert.equal(await selfHosted.withWake({ driver: 'sqlite3' }, async () => 'ok'), 'ok')
  })
})

describe('demand', () => {
  test('is 1 while in flight and within the window after use, then 0', async () => {
    assert.equal(selfHosted.demandFor('sh-test').demand, 0, 'unused')

    let during
    await selfHosted.withWake(conn, async () => { during = selfHosted.demandFor('sh-test') })
    assert.equal(during.demand, 1)
    assert.equal(during.inFlight, 1)

    const after = selfHosted.demandFor('sh-test')
    assert.equal(after.demand, 1, 'recently used')
    assert.ok(after.lastUsed)

    const later = Date.parse(after.lastUsed) + 60_001
    assert.equal(selfHosted.demandFor('sh-test', later).demand, 0, 'window elapsed')
  })

  test('lists every server-held source, used or not', () => {
    const all = selfHosted.allDemand()
    assert.ok(all.some((d) => d.source === 'sh-test' && d.demand === 0))
    assert.ok(!all.some((d) => d.source === 'sh-public'), 'public sources are not scaled')
  })
})

describe('isWakeError', () => {
  test('recognises not-up-yet failures from Node, Postgres and Neo4j', () => {
    assert.ok(selfHosted.isWakeError(refused()))
    assert.ok(selfHosted.isWakeError(Object.assign(new Error('getaddrinfo ENOTFOUND db'), { code: 'ENOTFOUND' })))
    assert.ok(selfHosted.isWakeError(Object.assign(new AggregateError([refused()]), { message: '' })))
    assert.ok(selfHosted.isWakeError(Object.assign(new Error('the database system is starting up'), { code: '57P03' })))
    assert.ok(selfHosted.isWakeError(Object.assign(new Error('Could not perform discovery. No routing servers available.'), { code: 'ServiceUnavailable' })))
    assert.ok(selfHosted.isWakeError(new Error('Connection terminated unexpectedly')))
    assert.ok(selfHosted.isWakeError(Object.assign(new Error('wrapped'), { cause: refused() })))
  })

  test('does not mistake real errors for a cold start', () => {
    assert.ok(!selfHosted.isWakeError(Object.assign(new Error('relation "nope" does not exist'), { code: '42P01' })))
    assert.ok(!selfHosted.isWakeError(new Error('Unknown entity "x"')))
    assert.ok(!selfHosted.isWakeError(null))
  })
})

describe('through the connector', () => {
  test('a query against a server-held source is answered and counted as demand', async () => {
    const { executeQuery } = require('../src/database/connector')
    const { data } = await executeQuery({ source: 'sh-test', from: 'items', orderBy: 'id' })
    assert.deepEqual(data.map((r) => r.accession), ['P04637', 'P00533'])
    assert.equal(selfHosted.demandFor('sh-test').demand, 1)
  })

  test('its connection cannot be redirected by the caller', () => {
    assert.throws(
      () => normalizeQueryInput({ source: 'sh-test', connection: { driver: 'sqlite3', database: '/etc/passwd' }, from: 'items' }),
      /hosted with this server and its connection cannot be overridden/
    )
  })
})

describe('demand across pods', () => {
  test('combines every peer: demand if any pod has it', async () => {
    process.env.MOZG_PEERS = 'mozg-peers.test.svc'
    try {
      const reports = {
        '10.0.0.1': { source: 'sh-test', demand: 0, inFlight: 0, lastUsed: null },
        '10.0.0.2': { source: 'sh-test', demand: 1, inFlight: 2, lastUsed: '2026-01-01T00:00:00.000Z' }
      }
      const lookup = async () => [{ address: '10.0.0.1' }, { address: '10.0.0.2' }, { address: '10.0.0.3' }]
      const fetch = async (url) => {
        const ip = new URL(url).hostname
        assert.match(url, /\/demand\/sh-test\?scope=local$/)
        if (!reports[ip]) throw new Error('peer gone')
        return { ok: true, json: async () => reports[ip] }
      }
      const out = await selfHosted.clusterDemand('sh-test', { lookup, fetch })
      assert.deepEqual(out, { source: 'sh-test', demand: 1, inFlight: 2, lastUsed: '2026-01-01T00:00:00.000Z' })
    } finally {
      delete process.env.MOZG_PEERS
    }
  })

  test('falls back to this pod when peers cannot be resolved', async () => {
    process.env.MOZG_PEERS = 'nowhere.invalid'
    try {
      const out = await selfHosted.clusterDemand('sh-test', { lookup: async () => { throw new Error('ENOTFOUND') } })
      assert.equal(out.source, 'sh-test')
      assert.equal(out.demand, 0)
    } finally {
      delete process.env.MOZG_PEERS
    }
  })
})

describe('GET /demand', () => {
  function fakeRes () {
    return {
      status: null,
      body: null,
      writeHead (status) { this.status = status },
      end (body) { this.body = JSON.parse(body) }
    }
  }

  test('reports one source in the shape KEDA reads', () => {
    const res = fakeRes()
    assert.equal(selfHosted.handleDemandRequest('/demand/sh-test', res, new URLSearchParams('scope=local')), true)
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body), ['source', 'demand', 'inFlight', 'lastUsed'])
  })

  test('without MOZG_PEERS the cluster view is this pod\'s view', async () => {
    const res = fakeRes()
    await new Promise((resolve) => {
      res.end = function (body) { this.body = JSON.parse(body); resolve() }
      selfHosted.handleDemandRequest('/demand/sh-test', res, new URLSearchParams())
    })
    assert.equal(res.body.source, 'sh-test')
  })

  test('lists all server-held sources', () => {
    const res = fakeRes()
    selfHosted.handleDemandRequest('/demand', res)
    assert.ok(res.body.sources.some((d) => d.source === 'sh-test'))
  })

  test('404s an unknown source and ignores other paths', () => {
    const res = fakeRes()
    selfHosted.handleDemandRequest('/demand/no-such-source', res)
    assert.equal(res.status, 404)
    assert.equal(selfHosted.handleDemandRequest('/demandx', fakeRes()), false)
  })
})
