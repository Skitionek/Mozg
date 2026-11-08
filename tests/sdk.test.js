'use strict'

/**
 * The SDK (sdk/src/index.js, an ES module) against a real Mozg server for what
 * it does, and a fake fetch for the failures that cannot be had on demand:
 * retries, timeouts, a stream cut in the middle of a line.
 */

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { createMozgServer } = require('../src/server')

const SAMPLE_DB = path.join(__dirname, '..', 'examples', 'sample.db')

let sdk
let server
let mozg

before(async () => {
  if (!fs.existsSync(SAMPLE_DB)) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'examples', 'seed.js')], { stdio: 'pipe' })
    if (result.status !== 0) throw new Error(`Seed failed: ${result.stderr.toString()}`)
  }
  sdk = await import('../sdk/src/index.js')
  server = createMozgServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  mozg = new sdk.Mozg({ url: `http://127.0.0.1:${server.address().port}` })
})
after(async () => {
  await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) })
})

const users = () => mozg.connect({ driver: 'sqlite3', database: SAMPLE_DB }).from('users')

describe('SDK: the server URL', () => {
  test('is reduced to the server root, whether or not it ends in /graphql or in slashes', () => {
    // Given URLs people actually write
    const written = ['http://h:4000', 'http://h:4000/', 'http://h:4000/graphql', 'http://h:4000/graphql///', 'http://h:4000///']

    // When a client is made from each
    const roots = written.map((url) => new sdk.Mozg({ url }).url)

    // Then every one names the same root
    assert.deepEqual(roots, Array(written.length).fill('http://h:4000'))
  })

  test('takes a long run of slashes in linear time', () => {
    // Given a URL that ends in a very long run of slashes, and one that has the run in the middle
    const trailing = `http://h:4000${'/'.repeat(200_000)}`
    const inside = `http://h:4000${'/'.repeat(200_000)}x`

    // When clients are made from them
    const started = Date.now()
    const client = new sdk.Mozg({ url: trailing })
    const other = new sdk.Mozg({ url: inside })
    const elapsedMs = Date.now() - started

    // Then it is quick (a quadratic pattern takes tens of seconds here), and the slashes are gone
    assert.equal(client.url, 'http://h:4000')
    assert.equal(other.url, inside, 'slashes inside a URL are left alone')
    assert.ok(elapsedMs < 1000, `took ${elapsedMs} ms`)
  })
})

describe('SDK: building queries', () => {
  test('a builder is immutable: deriving from it leaves it alone', () => {
    const base = mozg.source('uniprot').from('protein')
    const derived = base.where({ a: 1 }).limit(5)
    assert.deepEqual(base.toInput(), { source: 'uniprot', from: 'protein' })
    assert.deepEqual(derived.toInput(), { source: 'uniprot', from: 'protein', where: { a: 1 }, limit: 5 })
  })

  test('where merges; include, relation and link accumulate; select takes a list or several arguments', () => {
    const input = mozg.source('s').from('f')
      .where({ a: 1 }).where({ b: 2 })
      .include('x', 'y').include(['z'])
      .relation({ entity: 'e', foreignKey: 'k' }).relation({ entity: 'e2', foreignKey: 'k2' })
      .link({ field: 'f1', ontology: 'o' }).link([{ field: 'f2', ontology: 'o' }])
      .select('p', 'q').toInput()
    assert.deepEqual(input.where, { a: 1, b: 2 })
    assert.deepEqual(input.include, ['x', 'y', 'z'])
    assert.equal(input.relations.length, 2)
    assert.deepEqual(input.link.map((l) => l.field), ['f1', 'f2'])
    assert.deepEqual(input.select, ['p', 'q'])
  })

  test('is promise-like: then, catch and finally all run it', async () => {
    const builder = users().limit(1)
    assert.equal((await builder.then((r) => r.count)), 1)
    const caught = await mozg.connect({ driver: 'sqlite3', database: '/nonexistent/x.db' }).from('users').catch((err) => err.code)
    assert.equal(caught, 'DOWNSTREAM_ERROR')
    let finished = false
    await users().limit(1).finally(() => { finished = true })
    assert.equal(finished, true)
  })

  test('does not send what was left undefined', () => {
    assert.deepEqual(mozg.source('s').from('f').limit(undefined).toInput(), { source: 's', from: 'f' })
  })

  test('the URL may end in /graphql or a slash, as MOZG_URL often does', () => {
    for (const url of ['http://h:4000', 'http://h:4000/', 'http://h:4000/graphql', 'http://h:4000/graphql/']) {
      assert.equal(new sdk.Mozg({ url }).url, 'http://h:4000')
    }
  })

  test('needs a fetch', () => {
    assert.throws(() => new sdk.Mozg({ fetch: null }), /needs a fetch/)
  })
})

describe('SDK: against a real server', () => {
  test('runs a built query, awaiting the builder', async () => {
    const { count, data } = await users().select('id', 'name').orderBy('name').limit(2)
    assert.equal(count, 2)
    assert.deepEqual(Object.keys(data[0]), ['id', 'name'])
    assert.ok(data[0].name.localeCompare(data[1].name) <= 0)
  })

  test('sends the input as a variable and never in the query text', async () => {
    const seen = []
    const spy = new sdk.Mozg({ url: mozg.url, fetch: async (url, init) => { seen.push(JSON.parse(init.body)); return fetch(url, init) } })
    await spy.connect({ driver: 'sqlite3', database: SAMPLE_DB }).from('users').where({ name: '"; DROP TABLE users; --' }).limit(1)
    assert.equal(seen.length, 1)
    assert.ok(!seen[0].query.includes('DROP TABLE'), 'the query text is a constant')
    assert.equal(seen[0].variables.input.where.name, '"; DROP TABLE users; --')
  })

  test('links a column to an ontology', async () => {
    const obo = '[Term]\nid: PEOPLE:1\nname: Alice Müller\n'
    const { data } = await users().limit(5).link({ field: 'name', content: obo, format: 'obo', as: 'person' })
    assert.equal(data.find((r) => r.name === 'Alice Müller').person.id, 'PEOPLE:1')
  })

  test('discovers sources, entities, identifier spaces and tables', async () => {
    const summary = await mozg.catalog()
    assert.ok(summary.length > 40)
    assert.ok(summary.find((e) => e.name === 'uniprot'))
    assert.equal(summary[0].entities[0].params, undefined, 'a summary leaves the detail out')

    const [uniprot] = await mozg.catalog({ name: 'uniprot' })
    const protein = uniprot.entities.find((e) => e.name === 'protein')
    assert.ok(protein.params.find((p) => p.name === 'uniprotAccession' && p.required))
    assert.ok(protein.relations.length > 0)

    assert.ok((await mozg.oboKeys()).find((k) => k.key === 'uniprot'))
    const schema = await mozg.introspect({ connection: { driver: 'sqlite3', database: SAMPLE_DB } })
    assert.ok(schema.tables.find((t) => t.name === 'users').columns.find((c) => c.name === 'id' && c.isPrimaryKey))
  })

  test('lists no ontologies when none is configured, and searches one it is given', async () => {
    assert.deepEqual(await mozg.ontologies(), [])
    const terms = await mozg.ontologyTerms({ search: 'ally', content: '[Term]\nid: P:1\nname: Alice\nsynonym: "Ally" EXACT []\n', format: 'obo' })
    assert.deepEqual(terms.map((t) => [t.id, t.label]), [['P:1', 'Alice']])
  })

  test('health and metrics', async () => {
    assert.equal((await mozg.health()).status, 'ok')
    assert.match(await mozg.metrics(), /# TYPE mozg_http_requests_total counter/)
  })
})

describe('SDK: errors', () => {
  test('a database that says no is a MozgError with its code and a request id found in the server\'s response', async () => {
    let sent
    const spy = new sdk.Mozg({ url: mozg.url, fetch: async (url, init) => { sent = init.headers['X-Request-Id']; return fetch(url, init) } })
    const err = await spy.connect({ driver: 'sqlite3', database: '/nonexistent/x.db' }).from('users').then(() => null, (e) => e)
    assert.ok(err instanceof sdk.MozgError)
    assert.equal(err.name, 'MozgError')
    assert.equal(err.code, 'DOWNSTREAM_ERROR')
    assert.match(err.message, /SQLite database not found/)
    assert.equal(err.requestId, sent, 'the id the SDK sent is the id the server logged and returned')
    assert.match(sent, /^[0-9a-f]{16}$/)
    assert.equal(err.errors.length, 1)
  })

  test('a typo in the query surfaces the server\'s explanation', async () => {
    await assert.rejects(mozg.source('uniprot').from('protein').where({ nope: 1 }).run(), /nope|does not accept/i)
  })

  test('an unreachable server says where it tried', async () => {
    const down = new sdk.Mozg({ url: 'http://127.0.0.1:1', retries: 0 })
    await assert.rejects(down.health(), (err) => err instanceof sdk.MozgError && /Cannot reach Mozg at http:\/\/127\.0\.0\.1:1/.test(err.message))
  })
})

describe('SDK: retries, timeouts and cancelling', () => {
  const ok = () => new Response(JSON.stringify({ data: { query: { count: 0, data: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } })

  test('retries a read after 503s and network failures, then succeeds', async () => {
    let calls = 0
    const flaky = new sdk.Mozg({
      url: 'http://x',
      retries: 3,
      fetch: async () => {
        calls++
        if (calls === 1) throw new TypeError('fetch failed')
        if (calls === 2) return new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
        return ok()
      }
    })
    assert.deepEqual(await flaky.query({ source: 's', from: 'f' }), { count: 0, data: [] })
    assert.equal(calls, 3)
  })

  test('gives up after the retries it was allowed', async () => {
    let calls = 0
    const down = new sdk.Mozg({ url: 'http://x', retries: 2, fetch: async () => { calls++; return new Response('busy', { status: 503 }) } })
    await assert.rejects(down.query({ source: 's', from: 'f' }))
    assert.equal(calls, 3, 'one attempt and two retries')
  })

  test('never retries a mutation, which may have taken effect', async () => {
    let calls = 0
    const down = new sdk.Mozg({ url: 'http://x', retries: 5, fetch: async () => { calls++; throw new TypeError('fetch failed') } })
    await assert.rejects(down.ingestOntology({ content: 'x' }), /Cannot reach Mozg/)
    assert.equal(calls, 1, 'one attempt, however many retries a read would get')
  })

  test('does not retry an answer that says no', async () => {
    let calls = 0
    const no = new sdk.Mozg({
      url: 'http://x',
      retries: 3,
      fetch: async () => { calls++; return new Response(JSON.stringify({ errors: [{ message: 'bad column', extensions: { code: 'DOWNSTREAM_ERROR' } }] }), { status: 200 }) }
    })
    await assert.rejects(no.query({ source: 's', from: 'f' }), /bad column/)
    assert.equal(calls, 1)
  })

  test('a request that outlasts timeoutMs fails saying so, and is not retried', async () => {
    let calls = 0
    const slow = new sdk.Mozg({
      url: 'http://x',
      timeoutMs: 30,
      retries: 3,
      fetch: (url, { signal }) => { calls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) }
    })
    await assert.rejects(slow.query({ source: 's', from: 'f' }), /did not answer within 30 ms/)
    assert.equal(calls, 1)
  })

  test('can be cancelled by the caller', async () => {
    const controller = new AbortController()
    const waiting = new sdk.Mozg({
      url: 'http://x',
      fetch: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    const pending = waiting.query({ source: 's', from: 'f' }, { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, /cancelled/)
  })

  test('sends the configured headers with every request', async () => {
    let headers
    const withHeaders = new sdk.Mozg({ url: 'http://x', headers: { 'X-Team': 'genomics' }, fetch: async (url, init) => { headers = init.headers; return ok() } })
    await withHeaders.query({ source: 's', from: 'f' })
    assert.equal(headers['X-Team'], 'genomics')
    assert.ok(headers['X-Request-Id'])
  })
})

describe('SDK: streaming', () => {
  test('streamAll assembles the same answer a /graphql query gives, relations and all', async () => {
    const input = {
      connection: { driver: 'sqlite3', database: SAMPLE_DB },
      from: 'users',
      limit: 3,
      orderBy: 'id',
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', alias: 'posts' }]
    }
    const viaGraphql = await mozg.query(input)
    const viaStream = await mozg.streamAll(input)
    assert.equal(viaStream.count, viaGraphql.count)
    assert.deepEqual(viaStream.errors, [])
    assert.deepEqual(viaStream.data, viaGraphql.data)
    assert.ok(viaStream.data.some((u) => u.posts.length > 0), 'the relation was resolved, not left as a placeholder')
  })

  test('yields the envelope first, then a chunk per resolved placeholder', async () => {
    const events = []
    for await (const event of mozg.stream({
      connection: { driver: 'sqlite3', database: SAMPLE_DB },
      from: 'users',
      limit: 2,
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany' }]
    })) events.push(event)
    assert.equal(events[0].type, 'envelope')
    assert.match(events[0].data, /^\$\d+$/)
    assert.ok(events.slice(1).every((e) => e.type === 'chunk' && /^\$\d+$/.test(e.ref)))
    assert.ok(events.length >= 3)
  })

  test('a query with no relations arrives whole in the envelope', async () => {
    const result = await mozg.streamAll({ connection: { driver: 'sqlite3', database: SAMPLE_DB }, from: 'users', limit: 2 })
    assert.equal(result.data.length, 2)
  })

  test('a refused query is a MozgError with the server\'s reason, before any stream', async () => {
    await assert.rejects(
      mozg.streamAll({ connection: { driver: 'sqlite3', database: SAMPLE_DB } }),
      (err) => err instanceof sdk.MozgError && err.status === 400 && /from/.test(err.message)
    )
  })

  test('reads lines that arrive cut in the middle', async () => {
    const body = '{"count":2,"data":"$1"}\n/* $1 */ [{"id":1,"posts":"$2"},{"id":2,"posts":"$3"}]\n/* $2 */ [{"t":"a"}]\n/* $3 */ {"error":"relation failed"}\n'
    const pieces = [body.slice(0, 7), body.slice(7, 40), body.slice(40, 95), body.slice(95)]
    const encoder = new TextEncoder()
    const cut = new sdk.Mozg({
      url: 'http://x',
      fetch: async () => new Response(new ReadableStream({
        start (controller) { for (const piece of pieces) controller.enqueue(encoder.encode(piece)); controller.close() }
      }), { status: 200 })
    })
    const result = await cut.streamAll({ source: 's', from: 'f' })
    assert.deepEqual(result, {
      count: 2,
      data: [{ id: 1, posts: [{ t: 'a' }] }, { id: 2, posts: { error: 'relation failed' } }],
      errors: []
    })
  })
})

describe('SDK: assembling a stream', () => {
  test('a "$N" string the stream sent no chunk for is data, and is kept', () => {
    const result = sdk.assembleStream([
      { type: 'envelope', count: 1, data: '$1' },
      { type: 'chunk', ref: '$1', value: [{ price: '$5', posts: '$2' }] },
      { type: 'chunk', ref: '$2', value: [{ t: 'a' }] }
    ])
    assert.deepEqual(result.data, [{ price: '$5', posts: [{ t: 'a' }] }], '"$5" is a price; "$2" was resolved')
    assert.deepEqual(result.errors, [])
  })

  test('an error after the envelope is reported alongside the data', () => {
    const result = sdk.assembleStream([
      { type: 'envelope', count: 1, data: [{ id: 1 }] },
      { type: 'error', error: 'late failure' }
    ])
    assert.deepEqual(result.data, [{ id: 1 }])
    assert.deepEqual(result.errors, ['late failure'])
  })

  test('an error with no envelope at all is thrown', () => {
    assert.throws(() => sdk.assembleStream([{ type: 'error', error: 'it failed' }]), /it failed/)
    assert.throws(() => sdk.assembleStream([]), /ended before Mozg said anything/)
  })

  test('a placeholder cannot resolve into itself', () => {
    const result = sdk.assembleStream([
      { type: 'envelope', count: 1, data: '$1' },
      { type: 'chunk', ref: '$1', value: { again: '$1' } }
    ])
    assert.deepEqual(result.data, { again: null })
  })

  test('strings that only resemble a placeholder are left alone', () => {
    const result = sdk.assembleStream([{ type: 'envelope', count: 1, data: [{ note: '$ 1', ref: '$1x', cost: 'US$5' }] }])
    assert.deepEqual(result.data, [{ note: '$ 1', ref: '$1x', cost: 'US$5' }])
  })
})
