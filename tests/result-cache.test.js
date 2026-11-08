'use strict'

const { test, describe, mock, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const registry = require('../src/database/registry')
const { createResultCache, resetResultCache, withFresh, keyFor, parsePerSource } = require('../src/database/result-cache')
const { executeQuery } = require('../src/database/connector')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A query the cache can key on, with a counter standing in for the database. */
function counting (rows = [{ id: 1 }]) {
  const box = { calls: 0 }
  box.execute = async () => {
    box.calls++
    return { data: structuredClone(rows), count: rows.length, run: box.calls }
  }
  return box
}

const input = (extra = {}) => ({ connection: { driver: 'postgres', host: 'h', database: 'd', user: 'u', password: 'p' }, from: 'users', ...extra })

describe('result cache', () => {
  test('is off unless an operator turns it on, and then adds nothing to the result', async () => {
    const cache = createResultCache({})
    const db = counting()
    const first = await cache.run(input(), db.execute)
    await cache.run(input(), db.execute)
    assert.equal(db.calls, 2)
    assert.equal(first.meta, undefined, 'a deployment without a cache sees no new field')
    assert.equal(cache.stats().enabled, false)
  })

  test('answers a repeated query from the cache and says so', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000' })
    const db = counting()
    const miss = await cache.run(input(), db.execute)
    const hit = await cache.run(input(), db.execute)
    assert.equal(db.calls, 1)
    assert.equal(miss.meta.cache, 'miss')
    assert.equal(hit.meta.cache, 'hit')
    assert.equal(hit.meta.ttlMs, 60000)
    assert.ok(hit.meta.ageMs >= 0)
    assert.deepEqual(hit.data, [{ id: 1 }])
    assert.equal(cache.stats().hits, 1)
  })

  test('hands every caller its own copy', async () => {
    // Relation resolvers write into rows in place; a shared object would let
    // one caller's join leak into the next caller's answer.
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000' })
    const db = counting()
    const a = await cache.run(input(), db.execute)
    a.data[0].polluted = true
    const b = await cache.run(input(), db.execute)
    b.data[0].alsoPolluted = true
    const c = await cache.run(input(), db.execute)
    assert.deepEqual(c.data, [{ id: 1 }])
  })

  test('does not share a result between different credentials, or different queries', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000' })
    const db = counting()
    await cache.run(input(), db.execute)
    const other = input()
    other.connection = { ...other.connection, password: 'someone else' }
    await cache.run(other, db.execute)
    await cache.run(input({ limit: 5 }), db.execute)
    assert.equal(db.calls, 3)
  })

  test('keys ignore property order', () => {
    const a = { connection: { driver: 'x', host: 'h' }, from: 't', where: { a: 1, b: 2 } }
    const b = { where: { b: 2, a: 1 }, from: 't', connection: { host: 'h', driver: 'x' } }
    assert.equal(keyFor(a), keyFor(b))
    assert.notEqual(keyFor(a), keyFor({ ...a, where: { a: 1, b: 3 } }))
  })

  test('lets a source override the global TTL, in either direction', async () => {
    const cache = createResultCache({
      MOZG_RESULT_CACHE_TTL_MS: '60000',
      MOZG_RESULT_CACHE_TTL_BY_SOURCE: '{"live-db":0,"uniprot":3600000}'
    })
    const live = counting()
    const live1 = input(); live1.connection.source = 'live-db'
    await cache.run(live1, live.execute)
    await cache.run(live1, live.execute)
    assert.equal(live.calls, 2, 'a source set to 0 is never cached')

    const slow = counting()
    const uni = input(); uni.connection.source = 'uniprot'
    await cache.run(uni, slow.execute)
    const hit = await cache.run(uni, slow.execute)
    assert.equal(slow.calls, 1)
    assert.equal(hit.meta.ttlMs, 3600000)
  })

  test('can be switched on for one source alone', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_BY_SOURCE: '{"reactome":1000}' })
    const db = counting()
    const q = input(); q.connection.source = 'reactome'
    await cache.run(q, db.execute)
    await cache.run(q, db.execute)
    await cache.run(input(), db.execute)
    await cache.run(input(), db.execute)
    assert.equal(db.calls, 3, 'reactome once, the unnamed connection twice')
  })

  test('expires an entry after its TTL', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '30' })
    const db = counting()
    await cache.run(input(), db.execute)
    await sleep(60)
    await cache.run(input(), db.execute)
    assert.equal(db.calls, 2)
  })

  test('fresh reads live data and refreshes the entry for the next caller', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000' })
    let value = 'old'
    const execute = async () => ({ data: [{ value }], count: 1 })
    await cache.run(input(), execute)
    value = 'new'
    assert.equal((await cache.run(input(), execute)).data[0].value, 'old', 'cached')
    const fresh = await cache.run(input({ fresh: true }), execute)
    assert.equal(fresh.data[0].value, 'new')
    assert.equal(fresh.meta.cache, 'bypass')
    assert.equal((await cache.run(input(), execute)).data[0].value, 'new', 'the refresh reached the cache')
    assert.equal(cache.stats().bypasses, 1)
  })

  test('never caches an error', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000' })
    let calls = 0
    const flaky = async () => {
      if (++calls === 1) throw new Error('upstream down')
      return { data: [], count: 0 }
    }
    await assert.rejects(cache.run(input(), flaky), /upstream down/)
    await cache.run(input(), flaky)
    assert.equal(calls, 2)
  })

  test('never caches SOAP or Thrift, whose operations may have side effects', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000' })
    for (const driver of ['soap', 'thrift']) {
      const db = counting()
      const q = input(); q.connection.driver = driver
      await cache.run(q, db.execute)
      await cache.run(q, db.execute)
      assert.equal(db.calls, 2, `${driver} runs every time`)
    }
  })

  test('lets concurrent identical queries share one execution', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000' })
    let calls = 0
    const slow = async () => { calls++; await sleep(30); return { data: [{ id: 1 }], count: 1 } }
    const results = await Promise.all([1, 2, 3, 4].map(() => cache.run(input(), slow)))
    assert.equal(calls, 1)
    assert.equal(cache.stats().shared, 3)
    results[0].data[0].x = 1
    assert.deepEqual(results[1].data, [{ id: 1 }], 'sharing an execution does not share the object')
  })

  test('propagates a shared failure to every waiter', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000' })
    const failing = async () => { await sleep(20); throw new Error('nope') }
    const settled = await Promise.allSettled([cache.run(input(), failing), cache.run(input(), failing)])
    assert.deepEqual(settled.map((s) => s.status), ['rejected', 'rejected'])
  })

  test('refuses to store a result larger than its whole budget', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000', MOZG_RESULT_CACHE_MAX_BYTES: '200' })
    const big = counting(Array.from({ length: 100 }, (_, i) => ({ id: i, text: 'x'.repeat(20) })))
    await cache.run(input(), big.execute)
    await cache.run(input(), big.execute)
    assert.equal(big.calls, 2)
    assert.equal(cache.stats().entries, 0)
  })

  test('holds to its byte budget by dropping the least recently used', async () => {
    const cache = createResultCache({ MOZG_RESULT_CACHE_TTL_MS: '60000', MOZG_RESULT_CACHE_MAX_BYTES: '600' })
    const row = () => counting(Array.from({ length: 5 }, (_, i) => ({ id: i, t: 'x'.repeat(30) })))
    for (let i = 0; i < 6; i++) await cache.run(input({ limit: i + 1 }), row().execute)
    const stats = cache.stats()
    assert.ok(stats.bytes <= 600, `holds ${stats.bytes} bytes`)
    assert.ok(stats.evictions > 0)
  })
})

describe('per-source TTL setting', () => {
  test('parses a JSON object and reports what it ignores', () => {
    const warnings = []
    const parsed = parsePerSource('{"a":1000,"b":"soon","c":-5}', (w) => warnings.push(w))
    assert.deepEqual(parsed, { a: 1000 })
    assert.equal(warnings.length, 2)
  })

  test('survives garbage', () => {
    const warnings = []
    assert.deepEqual(parsePerSource('not json', (w) => warnings.push(w)), {})
    assert.deepEqual(parsePerSource('[1,2]', (w) => warnings.push(w)), {})
    assert.deepEqual(parsePerSource('', (w) => warnings.push(w)), {})
    assert.equal(warnings.length, 2)
  })
})

describe('result cache in the connector', () => {
  const saved = process.env.MOZG_RESULT_CACHE_TTL_MS
  afterEach(() => {
    mock.restoreAll()
    if (saved === undefined) delete process.env.MOZG_RESULT_CACHE_TTL_MS
    else process.env.MOZG_RESULT_CACHE_TTL_MS = saved
    resetResultCache()
  })

  test('serves a repeated query without calling the driver, and fresh calls it again', async () => {
    process.env.MOZG_RESULT_CACHE_TTL_MS = '60000'
    resetResultCache()
    let calls = 0
    mock.method(registry, 'getDriver', () => ({
      executeQuery: async (driverInput) => {
        calls++
        assert.equal(driverInput.fresh, undefined, 'fresh is the cache\'s business, not the driver\'s')
        return { data: [{ id: 1 }], count: 1 }
      }
    }))
    const query = { connection: { driver: 'sqlite3', database: 'x.db' }, from: 'users' }
    await executeQuery(query)
    const hit = await executeQuery(query)
    assert.equal(calls, 1)
    assert.equal(hit.meta.cache, 'hit')
    await executeQuery({ ...query, fresh: true })
    assert.equal(calls, 2)
  })

  test('one fresh flag makes the nested relation fetches live too', async () => {
    process.env.MOZG_RESULT_CACHE_TTL_MS = '60000'
    resetResultCache()
    let relationCalls = 0
    mock.method(registry, 'getDriver', () => ({
      executeQuery: async (driverInput) => {
        if (driverInput.from === 'users') return { data: [{ id: 1, kegg_id: 'C1' }], count: 1 }
        relationCalls++
        return { data: [{ entry_id: 'C1' }], count: 1 }
      }
    }))
    const relation = { entity: '/find/compound', foreignKey: 'kegg_id', ownerKey: 'entry_id', type: 'belongsTo', alias: 'compound', catalog: 'kegg' }
    const query = { connection: { driver: 'sqlite3', database: 'y.db' }, from: 'users', relations: [relation] }
    await executeQuery(query)
    await executeQuery({ ...query, fresh: true })
    assert.equal(relationCalls, 2, 'the relation was fetched again, not served from its own entry')
    await withFresh(() => executeQuery(query))
    assert.equal(relationCalls, 3, 'withFresh reaches nested fetches as well')
  })
})
