'use strict'

/**
 * Elasticsearch/OpenSearch driver against a small in-memory stand-in that
 * understands the subset of the search API the driver uses (term/terms
 * filters, query_string, sort, size/from, _source, _mget, _mapping).  The
 * live behaviour runs in tests/integration/elasticsearch.test.js.
 */

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const http = require('../src/database/http')
const es = require('../src/database/drivers/elasticsearch')

const INDICES = {
  users: {
    mapping: { id: { type: 'long' }, name: { type: 'text', fields: { keyword: { type: 'keyword' } } }, email: { type: 'keyword' } },
    docs: [
      { _id: 'u1', id: 1, name: 'Ada', email: 'ada@example.org' },
      { _id: 'u2', id: 2, name: 'Barbara', email: 'barbara@example.org' },
      { _id: 'u3', id: 3, name: 'Carl', email: 'carl@example.org' }
    ]
  },
  posts: {
    mapping: { id: { type: 'long' }, user_id: { type: 'long' }, title: { type: 'text', fields: { keyword: { type: 'keyword' } } } },
    docs: [
      { _id: 'p1', id: 1, user_id: 1, title: 'Engines' },
      { _id: 'p2', id: 2, user_id: 1, title: 'Notes' },
      { _id: 'p3', id: 3, user_id: 3, title: 'Proteins' }
    ]
  }
}

let requests
let original

function value (doc, field) {
  return doc[field.replace(/\.keyword$/, '')]
}

function matches (doc, clause) {
  if (clause.term) {
    const [[f, v]] = Object.entries(clause.term)
    assert.ok(!(INDICES.users.mapping[f] || INDICES.posts.mapping[f] || {}).type?.startsWith('text'), `term on analysed text field ${f}`)
    return String(value(doc, f)) === String(v)
  }
  if (clause.terms) {
    const [[f, vs]] = Object.entries(clause.terms)
    return vs.map(String).includes(String(value(doc, f)))
  }
  if (clause.query_string) return JSON.stringify(doc).includes(clause.query_string.query)
  throw new Error(`unsupported clause ${JSON.stringify(clause)}`)
}

function reply (status, body) {
  return { ok: status < 300, status, statusText: '', headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }
}

beforeEach(() => {
  http.reset()
  requests = []
  original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(init.body) : null
    requests.push({ method: init.method || 'GET', path: u.pathname, search: u.search, body, headers: init.headers })
    const [, index, op] = u.pathname.split('/')
    if (index === '_cat') return reply(200, [{ index: 'users' }, { index: 'posts' }, { index: '.kibana' }])
    const idx = INDICES[index]
    if (!idx) return reply(404, { error: 'index_not_found_exception' })
    if (op === '_mapping') return reply(200, { [index]: { mappings: { properties: idx.mapping } } })
    if (op === '_mget') return reply(200, { docs: body.ids.map((id) => { const d = idx.docs.find((x) => x._id === id); return d ? { _id: id, found: true, _source: d } : { _id: id, found: false } }) })
    if (op === '_search') {
      const q = body.query
      let docs = idx.docs.filter((d) => (q.match_all ? true : [...q.bool.filter, ...q.bool.must].every((c) => matches(d, c))))
      for (const s of body.sort || []) {
        const [[f, { order }]] = Object.entries(s)
        assert.ok(idx.mapping[f]?.type !== 'text', `sort on analysed text field ${f}`)
        docs = [...docs].sort((a, b) => String(value(a, f)).localeCompare(String(value(b, f))) * (order === 'desc' ? -1 : 1))
      }
      docs = docs.slice(body.from || 0, (body.from || 0) + body.size)
      return reply(200, { hits: { hits: docs.map(({ _id, ...src }) => ({ _id, _score: 1, _source: body._source ? Object.fromEntries(body._source.filter((f) => f in src).map((f) => [f, src[f]])) : src })) } })
    }
    return reply(200, { _index: index, found: true, _id: op, _source: {} })
  }
})

afterEach(() => { globalThis.fetch = original })

const connection = { driver: 'elasticsearch', database: 'http://es.test:9200', user: 'elastic', password: 'pw' }

describe('elasticsearch driver', () => {
  test('a bare index name searches it, with filters, keyword sort and paging', async () => {
    const { data } = await es.executeQuery({ connection, from: 'users', orderBy: 'name', orderDirection: 'desc', limit: 1, offset: 1, select: ['name'] })
    assert.deepEqual(data.map((r) => r.name), ['Barbara'])
    const search = requests.find((r) => r.path === '/users/_search')
    assert.equal(search.method, 'POST')
    assert.deepEqual(search.body.sort, [{ 'name.keyword': { order: 'desc', unmapped_type: 'keyword' } }])
    assert.equal(search.body.size, 1)
    assert.equal(search.body.from, 1)
    assert.match(search.headers.Authorization, /^Basic /)
  })

  test('where filters match whole values, using the keyword form of text fields', async () => {
    const { data } = await es.executeQuery({ connection, from: 'users', where: { name: 'Carl' } })
    assert.deepEqual(data.map((r) => r.id), [3])
    assert.deepEqual(requests.find((r) => r.path === '/users/_search').body.query.bool.filter, [{ term: { 'name.keyword': 'Carl' } }])
  })

  test('relations: hasMany and hasOne batch one terms query, belongsTo too', async () => {
    const { data } = await es.executeQuery({
      connection,
      from: 'users',
      orderBy: 'id',
      relations: [
        { entity: 'posts', localKey: 'id', foreignKey: 'user_id', type: 'hasMany', alias: 'posts' },
        { entity: 'posts', localKey: 'id', foreignKey: 'user_id', type: 'hasOne', alias: 'firstPost' }
      ]
    })
    assert.deepEqual(data.map((u) => u.posts.length), [2, 0, 1])
    assert.equal(data[2].firstPost.title, 'Proteins')
    assert.equal(requests.filter((r) => r.path === '/posts/_search').length, 2, 'one query per relation, not per row')

    const { data: posts } = await es.executeQuery({
      connection,
      from: 'posts',
      where: { id: 3 },
      relations: [{ entity: 'users', foreignKey: 'user_id', ownerKey: 'id', type: 'belongsTo', alias: 'author' }]
    })
    assert.equal(posts[0].author.name, 'Carl')
  })

  test('relations by document id use _mget', async () => {
    const { data } = await es.executeQuery({
      connection,
      from: 'posts',
      where: { id: 1 },
      relations: [{ entity: 'users', foreignKey: 'author_doc', type: 'belongsTo', alias: 'author' }]
    })
    assert.equal(data[0].author, null, 'no author_doc field: no lookup')
  })

  test('the raw _body and query-string escapes still work', async () => {
    const { data } = await es.executeQuery({ connection, from: 'users', where: { _body: '{"query":{"match_all":{}}}' }, limit: 2 })
    assert.equal(data.length, 2)
    const { data: q } = await es.executeQuery({ connection, from: 'users', where: { q: 'barbara@' } })
    assert.deepEqual(q.map((r) => r.id), [2])
  })

  test('an API endpoint path is fetched with GET and URL parameters', async () => {
    await es.executeQuery({ connection, from: '_cat/indices', where: { format: 'json' } })
    assert.equal(requests[0].method, 'GET')
    assert.equal(requests[0].search, '?format=json')
  })

  test('introspection lists user indices with their mapped fields', async () => {
    const { tables } = await es.introspect(connection)
    assert.deepEqual(tables.map((t) => t.name), ['posts', 'users'])
    assert.deepEqual(tables[1].columns.map((c) => c.name), ['_id', 'id', 'name', 'email'])
  })

  test('a missing index is a readable error without credentials', async () => {
    await assert.rejects(es.executeQuery({ connection, from: 'nope' }), (err) => /404/.test(err.message) && !err.message.includes('pw'))
  })

  test('flattenProperties walks nested objects and finds keyword subfields', () => {
    assert.deepEqual(es.flattenProperties({ a: { properties: { b: { type: 'text', fields: { raw: { type: 'keyword' } } } } } }), {
      'a.b': { type: 'text', keyword: 'a.b.raw' },
      a: { type: 'object', keyword: null }
    })
  })
})
