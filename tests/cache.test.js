'use strict'

const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { LruCache } = require('../src/cache')
const { intOption, boolOption, enumOption } = require('../src/config')

/** A clock the test moves by hand. */
function clock (start = 1000) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms } }
  return c
}

describe('LruCache', () => {
  it('evicts the least recently used entry past max', () => {
    const cache = new LruCache({ max: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // a is now more recent than b
    cache.set('c', 3)
    assert.equal(cache.get('b'), undefined)
    assert.equal(cache.get('a'), 1)
    assert.equal(cache.get('c'), 3)
    assert.equal(cache.size, 2)
    assert.equal(cache.stats.evictions, 1)
  })

  it('tells onEvict why an entry left', () => {
    const seen = []
    const cache = new LruCache({ max: 1, onEvict: (v, k, reason) => seen.push([k, reason]) })
    cache.set('a', 1)
    cache.set('b', 2) // evicts a
    cache.delete('b')
    cache.set('c', 3)
    cache.clear()
    assert.deepEqual(seen, [['a', 'lru'], ['b', 'delete'], ['c', 'clear']])
  })

  it('expires entries after ttlMs', () => {
    const c = clock()
    const cache = new LruCache({ ttlMs: 100, now: c.now })
    cache.set('a', 1)
    c.advance(99)
    assert.equal(cache.get('a'), 1)
    c.advance(2)
    assert.equal(cache.get('a'), undefined)
    assert.equal(cache.stats.expirations, 1)
  })

  it('renews the lifetime on a read when sliding, and not otherwise', () => {
    const c = clock()
    const sliding = new LruCache({ ttlMs: 100, sliding: true, now: c.now })
    const fixed = new LruCache({ ttlMs: 100, now: c.now })
    sliding.set('a', 1)
    fixed.set('a', 1)
    c.advance(60)
    sliding.get('a')
    fixed.get('a')
    c.advance(60)
    assert.equal(sliding.get('a'), 1, 'idle for 60 ms since the read')
    assert.equal(fixed.get('a'), undefined, 'older than 100 ms in all')
  })

  it('lets one entry carry its own lifetime', () => {
    const c = clock()
    const cache = new LruCache({ ttlMs: 1000, now: c.now })
    cache.set('short', 1, { ttlMs: 10 })
    cache.set('long', 2)
    c.advance(50)
    assert.equal(cache.get('short'), undefined)
    assert.equal(cache.get('long'), 2)
  })

  it('prunes expired entries and reports how many', () => {
    const c = clock()
    const closed = []
    const cache = new LruCache({ ttlMs: 10, now: c.now, onEvict: (v, k, r) => closed.push([k, r]) })
    cache.set('a', 1)
    cache.set('b', 2)
    c.advance(20)
    cache.set('c', 3)
    assert.equal(cache.prune(), 2)
    assert.deepEqual(closed, [['a', 'expired'], ['b', 'expired']])
    assert.deepEqual(cache.keys(), ['c'])
  })

  it('does not let a throwing or rejecting onEvict break the caller', async () => {
    const throwing = new LruCache({ max: 1, onEvict: () => { throw new Error('boom') } })
    throwing.set('a', 1)
    assert.doesNotThrow(() => throwing.set('b', 2))
    const rejecting = new LruCache({ max: 1, onEvict: () => Promise.reject(new Error('boom')) })
    rejecting.set('a', 1)
    rejecting.set('b', 2)
    await new Promise((resolve) => setImmediate(resolve)) // an unhandled rejection would fail the run
  })

  it('drain hands back the values and skips onEvict', () => {
    let evicted = 0
    const cache = new LruCache({ onEvict: () => { evicted++ } })
    cache.set('a', 1)
    cache.set('b', 2)
    assert.deepEqual(cache.drain(), [1, 2])
    assert.equal(cache.size, 0)
    assert.equal(evicted, 0)
  })

  it('peek and has change neither recency nor the counters', () => {
    const cache = new LruCache({ max: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    assert.equal(cache.peek('a'), 1)
    assert.equal(cache.has('a'), true)
    cache.set('c', 3) // a is still the oldest
    assert.equal(cache.peek('a'), undefined)
    assert.equal(cache.stats.hits, 0)
  })

  it('replacing a key with another value closes the old one', () => {
    const closed = []
    const cache = new LruCache({ onEvict: (v) => closed.push(v) })
    cache.set('a', 1)
    cache.set('a', 1) // same value: nothing to close
    cache.set('a', 2)
    assert.deepEqual(closed, [1])
  })

  it('getOrSet builds once', () => {
    const cache = new LruCache()
    let built = 0
    const make = () => ++built
    assert.equal(cache.getOrSet('k', make), 1)
    assert.equal(cache.getOrSet('k', make), 1)
    assert.equal(built, 1)
  })

  it('counts hits and misses', () => {
    const cache = new LruCache()
    cache.set('a', 1)
    cache.get('a')
    cache.get('a')
    cache.get('zzz')
    assert.equal(cache.stats.hits, 2)
    assert.equal(cache.stats.misses, 1)
  })

  it('treats max 0 as unbounded', () => {
    const cache = new LruCache({ max: 0 })
    for (let i = 0; i < 500; i++) cache.set(String(i), i)
    assert.equal(cache.size, 500)
  })
})

describe('deployment options', () => {
  it('reads integers and falls back on anything else', () => {
    assert.equal(intOption('X', 7, { X: '30' }), 30)
    assert.equal(intOption('X', 7, { X: '' }), 7, 'an empty value is not 0')
    assert.equal(intOption('X', 7, {}), 7)
    assert.equal(intOption('X', 7, { X: 'abc' }), 7)
    assert.equal(intOption('X', 7, { X: '-5' }), 7)
    assert.equal(intOption('X', 7, { X: '0' }), 0, 'an explicit 0 is honoured')
    assert.equal(intOption('X', 7, { X: '2.9' }), 2)
  })

  it('reads booleans and enums', () => {
    assert.equal(boolOption('B', false, { B: 'YES' }), true)
    assert.equal(boolOption('B', true, { B: 'off' }), false)
    assert.equal(boolOption('B', true, { B: 'maybe' }), true)
    assert.equal(enumOption('E', ['json', 'text'], 'text', { E: 'JSON' }), 'json')
    assert.equal(enumOption('E', ['json', 'text'], 'text', { E: 'xml' }), 'text')
  })
})

describe('bounded caches in the drivers', () => {
  const saved = { ...process.env }
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  })

  it('destroys the least recently used knex instance past MOZG_CONNECTION_CACHE_MAX', async () => {
    process.env.MOZG_CONNECTION_CACHE_MAX = '2'
    const { createConnectionCache } = require('../src/database/drivers/knex-query')
    const pool = createConnectionCache('test-evict')
    const config = (name) => () => ({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, name })

    const a = pool.getOrCreate('a', config('a'))
    const b = pool.getOrCreate('b', config('b'))
    assert.ok(a.client.pool, 'a live instance has a connection pool')

    pool.getOrCreate('c', config('c')) // a is the least recently used
    // destroy() is asynchronous; a destroyed instance has let go of its pool.
    for (let i = 0; i < 50 && a.client.pool; i++) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(a.client.pool, undefined, 'the evicted instance was destroyed')
    assert.ok(b.client.pool, 'the others are untouched')
    assert.equal(pool.cache.size, 2)
    await pool.destroyAll()
    assert.equal(pool.cache.size, 0)
  })

  it('keeps the HTTP response cache within MOZG_HTTP_CACHE_MAX_ENTRIES', async () => {
    process.env.MOZG_HTTP_CACHE_TTL_MS = '60000'
    process.env.MOZG_HTTP_CACHE_MAX_ENTRIES = '3'
    delete require.cache[require.resolve('../src/database/http')]
    const http = require('../src/database/http')
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    try {
      for (let i = 0; i < 6; i++) await http.request(`http://cache-test.invalid/${i}`)
      assert.equal(http.cacheStats().size, 3)
      assert.equal(http.cacheStats().max, 3)
      await http.request('http://cache-test.invalid/5') // still cached
      assert.equal(calls, 6)
      await http.request('http://cache-test.invalid/0') // evicted: fetched again
      assert.equal(calls, 7)
    } finally {
      globalThis.fetch = realFetch
      http.reset()
      delete require.cache[require.resolve('../src/database/http')]
    }
  })
})
