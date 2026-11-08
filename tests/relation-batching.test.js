'use strict'

/**
 * Relations fetched per parent row used to cost one request each.  Now rows
 * that share a key fetch it once, and a connector that can take a list of keys
 * is asked for all of them at once.  These tests count the calls, so a saving
 * is proven and not merely assumed, and they check the answers stay right.
 */

const { test, describe, after, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { makeExecutableSchema } = require('@graphql-tools/schema')

const rest = require('../src/database/drivers/rest')
const mesh = require('../src/database/drivers/mesh-adapter')
const http = require('../src/database/http')

// ── REST ────────────────────────────────────────────────────────────────────

const USERS = [1, 2, 3].map((id) => ({ id, name: `user${id}` }))
const POSTS = [
  { id: 1, userId: 1, title: 'a' }, { id: 2, userId: 1, title: 'b' }, { id: 3, userId: 1, title: 'c' },
  { id: 4, userId: 2, title: 'd' }, { id: 5, userId: 3, title: 'e' }
]

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

/**
 * A json-server-like API: /users, /users/:id, /posts filtered by repeated or
 * single `userId`.  `requests` records every URL asked for.
 *
 * `singleValueOnly` models the common API that filters by one value and, given
 * the parameter repeated, ignores it and returns everything.
 */
function fakeApi ({ singleValueOnly = false } = {}) {
  const realFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    requests.push(url.pathname + url.search)
    const userMatch = url.pathname.match(/^\/users\/(\d+)$/)
    if (userMatch) return json(USERS.find((u) => u.id === Number(userMatch[1])) || {})
    if (url.pathname === '/users') return json(USERS)
    if (url.pathname === '/posts') {
      const wanted = url.searchParams.getAll('userId').map(Number)
      if (singleValueOnly && wanted.length > 1) return json(POSTS)
      return json(wanted.length ? POSTS.filter((p) => wanted.includes(p.userId)) : POSTS)
    }
    return new Response('not found', { status: 404 })
  }
  return { requests, restore: () => { globalThis.fetch = realFetch; http.reset() } }
}

const connection = { driver: 'rest', database: 'https://api.test' }

describe('REST relations', () => {
  let api
  afterEach(() => api && api.restore())

  test('rows that name the same record fetch it once', async () => {
    api = fakeApi()
    const { data } = await rest.executeQuery({
      connection,
      from: '/posts',
      relations: [{ entity: '/users', foreignKey: 'userId', localKey: 'userId', type: 'belongsTo', alias: 'author' }]
    })
    const userRequests = api.requests.filter((r) => r.startsWith('/users/'))
    assert.equal(userRequests.length, 3, 'three distinct authors, five posts')
    assert.deepEqual(data.map((p) => p.author.name), ['user1', 'user1', 'user1', 'user2', 'user3'])
  })

  test('gives each row its own copy of a shared record', async () => {
    api = fakeApi()
    const { data } = await rest.executeQuery({
      connection,
      from: '/posts',
      relations: [{ entity: '/users', foreignKey: 'userId', localKey: 'userId', type: 'belongsTo', alias: 'author' }]
    })
    data[0].author.name = 'changed'
    assert.equal(data[1].author.name, 'user1', 'rows 0 and 1 share an author record, not an object')
  })

  test('batch: one request for all parents, answers grouped, limit and select applied per parent', async () => {
    api = fakeApi()
    const { data } = await rest.executeQuery({
      connection,
      from: '/users',
      relations: [{ entity: '/posts', foreignKey: 'userId', type: 'hasMany', alias: 'posts', batch: true, select: ['id'], limit: 2 }]
    })
    const postRequests = api.requests.filter((r) => r.startsWith('/posts'))
    assert.deepEqual(postRequests, ['/posts?userId=1&userId=2&userId=3'])
    assert.deepEqual(data.map((u) => u.posts), [[{ id: 1 }, { id: 2 }], [{ id: 4 }], [{ id: 5 }]])
  })

  test('batch: matches the unbatched answer exactly', async () => {
    api = fakeApi()
    const relation = { entity: '/posts', foreignKey: 'userId', type: 'hasMany', alias: 'posts' }
    const plain = await rest.executeQuery({ connection, from: '/users', relations: [relation] })
    http.reset()
    const batched = await rest.executeQuery({ connection, from: '/users', relations: [{ ...relation, batch: true }] })
    assert.deepEqual(batched.data, plain.data)
  })

  test('batch: an API that ignores a repeated filter is caught, and the answer stays right', async () => {
    api = fakeApi({ singleValueOnly: true })
    const { data } = await rest.executeQuery({
      connection,
      from: '/users',
      limit: 2,
      relations: [{ entity: '/posts', foreignKey: 'userId', type: 'hasMany', alias: 'posts', batch: true }]
    })
    // Asked for users 1 and 2, the API returned every post — including user 3's.
    const postRequests = api.requests.filter((r) => r.startsWith('/posts'))
    assert.equal(postRequests[0], '/posts?userId=1&userId=2', 'it tried the batch first')
    assert.deepEqual(postRequests.slice(1).sort(), ['/posts?userId=1', '/posts?userId=2'], 'then fell back to one request per user')
    assert.deepEqual(data.map((u) => u.posts.map((p) => p.id)), [[1, 2, 3], [4]])
    assert.ok(data.every((u) => u.posts.every((p) => p.userId === u.id)), 'no user got a neighbour\'s posts')
  })

  test('batch is skipped when there is only one key to fetch', async () => {
    api = fakeApi()
    await rest.executeQuery({
      connection,
      from: '/users',
      limit: 1,
      relations: [{ entity: '/posts', foreignKey: 'userId', type: 'hasMany', alias: 'posts', batch: true }]
    })
    assert.deepEqual(api.requests.filter((r) => r.startsWith('/posts')), ['/posts?userId=1'])
  })
})

// ── Mesh ────────────────────────────────────────────────────────────────────

const cleanups = []
after(() => cleanups.forEach((fn) => fn()))

const MESH_USERS = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Barbara' }, { id: 3, name: 'Carl' }]
const MESH_POSTS = [
  { id: 1, user_id: 1, title: 'Engines' }, { id: 2, user_id: 1, title: 'Notes' },
  { id: 3, user_id: 3, title: 'Proteins' }, { id: 4, user_id: 2, title: 'Compilers' }
]

/** A schema whose filters take `in` (Neo4j) or only equality (MySQL-style), counting resolver calls. */
function meshSource (name, { supportsIn, failOnIn = false }) {
  const calls = []
  const filter = supportsIn
    ? 'input IntFilter { eq: Int, in: [Int!] }'
    : 'input IntFilter { eq: Int }'
  const schema = makeExecutableSchema({
    typeDefs: /* GraphQL */ `
      ${filter}
      type User { id: Int, name: String }
      type Post { id: Int, user_id: Int, title: String }
      input UserWhere { id: IntFilter, name: String }
      input PostWhere { id: IntFilter, user_id: IntFilter }
      type Query {
        users(where: UserWhere, limit: Int): [User]
        posts(where: PostWhere, limit: Int): [Post]
      }
    `,
    resolvers: {
      Query: {
        users: (_, args) => { calls.push(['users', args.where]); return pick(MESH_USERS, args) },
        posts: (_, args) => {
          calls.push(['posts', args.where])
          if (failOnIn && args.where && args.where.user_id && args.where.user_id.in) throw new Error('in is broken')
          return pick(MESH_POSTS, args)
        }
      }
    }
  })
  const conn = { driver: 'neo4j', host: name, database: 'blog', user: 'u' }
  cleanups.push(mesh.registerMeshSource(conn, { schema }))
  return { conn, calls }
}

function pick (rows, args) {
  const where = args.where || {}
  const out = rows.filter((row) => Object.entries(where).every(([field, ops]) => {
    if (ops && typeof ops === 'object') {
      if (ops.in) return ops.in.includes(row[field])
      if (ops.eq != null) return row[field] === ops.eq
    }
    return true
  }))
  return out.slice(0, args.limit ?? undefined)
}

const relationCalls = (calls, entity) => calls.filter(([name]) => name === entity)

describe('mesh relations', () => {
  test('a handler that takes an `in` list is asked once for all parents', async () => {
    const { conn, calls } = meshSource('batch-in', { supportsIn: true })
    const { data } = await mesh.executeQuery({
      connection: conn,
      from: 'users',
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', alias: 'posts' }]
    })
    assert.equal(relationCalls(calls, 'posts').length, 1, 'one query for three users')
    // (GraphQL hands resolvers null-prototype objects; compare as plain JSON.)
    assert.deepEqual(JSON.parse(JSON.stringify(relationCalls(calls, 'posts')[0][1])), { user_id: { in: [1, 2, 3] } })
    assert.deepEqual(data.map((u) => u.posts.map((p) => p.title)), [['Engines', 'Notes'], ['Compilers'], ['Proteins']])
  })

  test('applies a per-parent limit after grouping', async () => {
    const { conn } = meshSource('batch-limit', { supportsIn: true })
    const { data } = await mesh.executeQuery({
      connection: conn,
      from: 'users',
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', alias: 'posts', limit: 1 }]
    })
    assert.deepEqual(data.map((u) => u.posts.length), [1, 1, 1])
  })

  test('belongsTo batches on the owner key, and hasOne takes the first', async () => {
    const { conn, calls } = meshSource('batch-belongs', { supportsIn: true })
    const { data } = await mesh.executeQuery({
      connection: conn,
      from: 'posts',
      relations: [{ entity: 'users', foreignKey: 'user_id', type: 'belongsTo', alias: 'author' }]
    })
    assert.equal(relationCalls(calls, 'users').length, 1)
    assert.deepEqual(data.map((p) => p.author.name), ['Ada', 'Ada', 'Carl', 'Barbara'])

    const hasOne = await mesh.executeQuery({
      connection: conn,
      from: 'users',
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasOne', alias: 'first' }]
    })
    assert.deepEqual(hasOne.data.map((u) => u.first.title), ['Engines', 'Compilers', 'Proteins'])
  })

  test('a user with no related rows gets an empty list, not a neighbour\'s', async () => {
    const { conn } = meshSource('batch-empty', { supportsIn: true })
    const { data } = await mesh.executeQuery({
      connection: conn,
      from: 'users',
      where: undefined,
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', alias: 'posts', where: { id: { in: [3] } } }]
    })
    assert.deepEqual(data.map((u) => u.posts.length), [0, 0, 1])
  })

  test('falls back to one query per key when the batched one fails, with the right answer', async () => {
    const { conn, calls } = meshSource('batch-broken', { supportsIn: true, failOnIn: true })
    const { data } = await mesh.executeQuery({
      connection: conn,
      from: 'users',
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', alias: 'posts' }]
    })
    assert.equal(relationCalls(calls, 'posts').length, 4, 'the failed batch, then one per user')
    assert.deepEqual(data.map((u) => u.posts.map((p) => p.title)), [['Engines', 'Notes'], ['Compilers'], ['Proteins']])
  })

  test('a handler with equality-only filters still fetches each distinct key once', async () => {
    const { conn, calls } = meshSource('equality-only', { supportsIn: false })
    const { data } = await mesh.executeQuery({
      connection: conn,
      from: 'posts',
      relations: [{ entity: 'users', foreignKey: 'user_id', type: 'belongsTo', alias: 'author' }]
    })
    assert.equal(relationCalls(calls, 'users').length, 3, 'three distinct authors across four posts')
    assert.deepEqual(data.map((p) => p.author.name), ['Ada', 'Ada', 'Carl', 'Barbara'])
  })
})
