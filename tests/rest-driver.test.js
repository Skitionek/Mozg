'use strict'

/**
 * Plain REST driver, against a stubbed fetch.  Checked live against
 * JSONPlaceholder (filters, paging, users → posts → comments) and SWAPI
 * (records linked by URL).
 */

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const http = require('../src/database/http')
const rest = require('../src/database/drivers/rest')

const USERS = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Barbara' }, { id: 3, name: 'Carl' }]
const POSTS = [
  { id: 10, userId: 1, title: 'Engines' },
  { id: 11, userId: 1, title: 'Notes' },
  { id: 12, userId: 3, title: 'Proteins' }
]

let requests
let original
let honoursPaging

function reply (body, status = 200) {
  return { ok: status < 300, status, statusText: '', headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }
}

beforeEach(() => {
  http.reset()
  requests = []
  honoursPaging = true
  original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    requests.push(u)
    const [, collection, id] = u.pathname.replace(/^\/api/, '').split('/')
    const table = { users: USERS, posts: POSTS }[collection]
    if (!table) return reply({ error: 'not found' }, 404)
    if (id) {
      const row = table.find((r) => String(r.id) === id)
      return row ? reply({ ...row, url: `https://api.test/api/${collection}/${id}` }) : reply({}, 404)
    }
    let rows = table.filter((r) => [...u.searchParams].every(([k, v]) => k.startsWith('_') || k === 'key' || String(r[k]) === v))
    if (honoursPaging && u.searchParams.has('_limit')) {
      const start = Number(u.searchParams.get('_start') || 0)
      rows = rows.slice(start, start + Number(u.searchParams.get('_limit')))
    }
    return reply(rows)
  }
})

afterEach(() => { globalThis.fetch = original })

const connection = { driver: 'rest', database: 'https://api.test/api' }

describe('rest driver', () => {
  test('hasMany finds related records by their foreign key', async () => {
    const { data } = await rest.executeQuery({
      connection,
      from: '/users',
      relations: [{ entity: '/posts', foreignKey: 'userId', type: 'hasMany', alias: 'posts' }]
    })
    assert.deepEqual(data.map((u) => u.posts.length), [2, 0, 1])
    assert.ok(requests.some((u) => u.pathname === '/api/posts' && u.searchParams.get('userId') === '1'))
  })

  test('belongsTo fetches the record its foreign key names', async () => {
    const { data } = await rest.executeQuery({
      connection,
      from: '/posts',
      where: { id: 12 },
      relations: [{ entity: '/users', foreignKey: 'userId', type: 'belongsTo', alias: 'author' }]
    })
    assert.equal(data[0].author.name, 'Carl')
    assert.ok(requests.some((u) => u.pathname === '/api/users/3'))
  })

  test('a list of URLs on the parent is followed on the same origin', async () => {
    globalThis.fetch = (inner => async (url) => {
      if (String(url).endsWith('/films/1')) return reply({ id: 1, title: 'A New Hope', people: ['https://api.test/api/users/1', 'https://api.test/api/users/2'] })
      return inner(url)
    })(globalThis.fetch)
    const { data } = await rest.executeQuery({
      connection,
      from: '/films/1',
      relations: [{ entity: '/users', foreignKey: 'people', type: 'hasMany', alias: 'cast', select: ['name'] }]
    })
    assert.deepEqual(data[0].cast, [{ name: 'Ada' }, { name: 'Barbara' }])
  })

  test('a URL on another origin is refused, in place', async () => {
    globalThis.fetch = (inner => async (url) => {
      if (String(url).endsWith('/films/2')) return reply({ id: 2, director: 'http://169.254.169.254/latest/meta-data' })
      return inner(url)
    })(globalThis.fetch)
    const { data } = await rest.executeQuery({
      connection,
      from: '/films/2',
      relations: [{ entity: '/people', foreignKey: 'director', type: 'belongsTo', alias: 'director' }]
    })
    assert.match(data[0].director.error, /refusing to follow http:\/\/169\.254\.169\.254: not this connection's origin/)
    assert.ok(!requests.some((u) => u.host === '169.254.169.254'))
  })

  test('pages and sorts itself when the server ignores _limit/_sort', async () => {
    honoursPaging = false
    const { data } = await rest.executeQuery({ connection, from: '/users', orderBy: 'name', orderDirection: 'desc', limit: 1, offset: 1 })
    assert.deepEqual(data.map((u) => u.name), ['Barbara'])
  })

  test('relation lookups carry the API key parameter', async () => {
    await rest.executeQuery({
      connection: { ...connection, user: 'K', apiKeyParam: 'key' },
      from: '/users',
      relations: [{ entity: '/posts', foreignKey: 'userId', type: 'hasMany', alias: 'posts' }]
    })
    assert.ok(requests.filter((u) => u.pathname === '/api/posts').every((u) => u.searchParams.get('key') === 'K'))
  })

  test('a failing relation is reported in place, keeping the parent rows', async () => {
    const { data } = await rest.executeQuery({ connection, from: '/users', where: { id: 1 }, relations: [{ entity: '/nope', foreignKey: 'userId', alias: 'nope' }] })
    assert.equal(data[0].name, 'Ada')
    assert.match(data[0].nope.error, /relation fetch failed: REST fetch failed: .*404/)
  })
})

describe('rest driver: auth, envelopes, limits and cross-catalog relations', () => {
  test('a user alone is a Bearer token, user and password are Basic auth', async () => {
    const seen = []
    const inner = globalThis.fetch
    globalThis.fetch = async (url, init) => { seen.push(init.headers.Authorization); return inner(url, init) }
    await rest.executeQuery({ connection: { ...connection, user: 'tok' }, from: '/users' })
    http.reset()
    await rest.executeQuery({ connection: { ...connection, user: 'u', password: 'p' }, from: '/users' })
    assert.deepEqual(seen, ['Bearer tok', `Basic ${Buffer.from('u:p').toString('base64')}`])
  })

  test('envelopes are unwrapped and scalars wrapped', async () => {
    globalThis.fetch = async (url) => reply(String(url).includes('wrapped') ? { results: [{ id: 1 }, { id: 2 }] } : String(url).includes('scalar') ? 42 : { id: 7 })
    assert.deepEqual((await rest.executeQuery({ connection, from: '/wrapped' })).data, [{ id: 1 }, { id: 2 }])
    assert.deepEqual((await rest.executeQuery({ connection, from: '/scalar' })).data, [42])
    assert.deepEqual((await rest.executeQuery({ connection, from: '/single' })).data, [{ id: 7 }])
  })

  test('a relation limit caps related rows per parent', async () => {
    const { data } = await rest.executeQuery({
      connection,
      from: '/users',
      where: { id: 1 },
      relations: [{ entity: '/posts', foreignKey: 'userId', type: 'hasMany', alias: 'posts', limit: 1 }]
    })
    assert.equal(data[0].posts.length, 1)
  })

  test('a parent without the join value gets an empty result without a request', async () => {
    const { data } = await rest.executeQuery({
      connection,
      from: '/users',
      where: { id: 1 },
      relations: [
        { entity: '/posts', localKey: 'missing', foreignKey: 'userId', type: 'hasMany', alias: 'posts' },
        { entity: '/users', foreignKey: 'missing', type: 'belongsTo', alias: 'owner' }
      ]
    })
    assert.deepEqual(data[0].posts, [])
    assert.equal(data[0].owner, null)
  })

  test('a relation naming another catalog is resolved there, reporting failure in place', async () => {
    const { data } = await rest.executeQuery({
      connection,
      from: '/users',
      where: { id: 1 },
      relations: [{ catalog: 'no-such-catalog', entity: 'x', localKey: 'id', foreignKey: 'id', alias: 'elsewhere' }]
    })
    assert.match(data[0].elsewhere.error, /no-such-catalog/)
  })

  test('introspection describes the source from its catalog entry', async () => {
    const { tables } = await rest.introspect({ driver: 'rest', database: 'https://jsonplaceholder.typicode.com' })
    assert.ok(tables.some((t) => t.name === '/posts'))
  })
})

describe('rest driver: per-source paging, envelopes and relation paths', () => {
  const { registerCatalog } = require('../src/catalog')
  const PAGED = {
    name: 'rest-paged-test',
    label: 'Paged test API',
    driver: 'rest',
    connection: {
      database: 'https://paged.test/api',
      paging: { limit: 'limit', offset: null, sort: null, order: null },
      unwrap: ['people'],
      headers: { 'X-Source': 'catalog' }
    },
    entities: [{ name: '/people', columns: ['id', 'name'], relations: [] }]
  }
  const PEOPLE = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `p${i + 1}` }))
  let unregister
  let seenHeaders

  beforeEach(() => {
    unregister = registerCatalog(PAGED)
    seenHeaders = []
    globalThis.fetch = async (url, init) => {
      const u = new URL(url)
      requests.push(u)
      seenHeaders.push(init.headers)
      const n = u.searchParams.has('limit') ? Number(u.searchParams.get('limit')) : 4 // a server-side default page
      return reply({ count: PEOPLE.length, people: PEOPLE.slice(0, n) })
    }
  })
  afterEach(() => unregister())

  const paged = { driver: 'rest', database: 'https://paged.test/api' }

  test('a source names its own paging parameters, found by base URL', async () => {
    const { data } = await rest.executeQuery({ connection: paged, from: '/people', limit: 2 })
    assert.deepEqual(data.map((p) => p.id), [1, 2])
    assert.deepEqual([...requests[0].searchParams], [['limit', '2']])
    assert.equal(seenHeaders[0]['X-Source'], 'catalog')
  })

  test('without an offset parameter the page is asked for up to its end and cut here', async () => {
    const { data } = await rest.executeQuery({ connection: paged, from: '/people', limit: 2, offset: 3 })
    assert.deepEqual(data.map((p) => p.id), [4, 5])
    assert.equal(requests[0].searchParams.get('limit'), '5')
  })

  test('without a sort parameter nothing is paged server-side, and rows are sorted here', async () => {
    const { data } = await rest.executeQuery({ connection: paged, from: '/people', limit: 2, orderBy: 'id', orderDirection: 'desc' })
    assert.deepEqual(data.map((p) => p.id), [4, 3])
    assert.deepEqual([...requests[0].searchParams], [])
  })

  test('a connection naming the source gets the same settings, and the caller may override them', async () => {
    await rest.executeQuery({ connection: { ...paged, source: 'rest-paged-test' }, from: '/people', limit: 1 })
    await rest.executeQuery({ connection: { ...paged, paging: { limit: 'size' }, headers: { 'X-Source': 'caller' } }, from: '/people', limit: 1 })
    assert.equal(requests[0].searchParams.get('limit'), '1')
    assert.equal(requests[1].searchParams.get('size'), '1')
    assert.equal(seenHeaders[1]['X-Source'], 'caller')
  })

  test('a single record in an envelope is unwrapped; a record with such a field is not', async () => {
    globalThis.fetch = async (url) => reply(String(url).endsWith('/one') ? { data: { id: 5, name: 'x' }, info: {} } : { id: 6, data: { a: 1 } })
    assert.deepEqual((await rest.executeQuery({ connection, from: '/one' })).data, [{ id: 5, name: 'x' }])
    assert.deepEqual((await rest.executeQuery({ connection, from: '/own' })).data, [{ id: 6, data: { a: 1 } }])
  })
})

describe('rest driver: relations through paths, templates and lists', () => {
  const REPOS = [
    { id: 1, owner: { login: 'ada' }, contributors: [{ user: { url: 'https://api.test/api/users/2' } }, { user: { url: 'https://api.test/api/users/3' } }] },
    { id: 2, owner: null, contributors: [] }
  ]

  beforeEach(() => {
    globalThis.fetch = async (url) => {
      const u = new URL(url)
      requests.push(u)
      if (u.pathname === '/api/repos') return reply(REPOS)
      if (u.pathname === '/api/users/ada') return reply({ id: 1, login: 'ada' })
      const user = u.pathname.match(/^\/api\/users\/(\d+)$/)
      if (user) return reply(USERS.find((x) => String(x.id) === user[1]))
      const byUser = u.pathname.match(/^\/api\/posts\/by-user\/(\d+)$/)
      if (byUser) return reply(POSTS.filter((p) => String(p.userId) === byUser[1]))
      if (u.pathname === '/api/users/') return reply(USERS)
      return reply({}, 404)
    }
  })

  test('a foreign key may be a path into the parent', async () => {
    const { data } = await rest.executeQuery({
      connection,
      from: '/repos',
      relations: [
        { entity: '/users', foreignKey: 'owner.login', type: 'belongsTo', alias: 'owner' },
        { entity: '/users', foreignKey: 'contributors[].user.url', type: 'hasMany', alias: 'contributors' }
      ]
    })
    assert.deepEqual(data.map((r) => r.owner && r.owner.login), ['ada', null])
    assert.deepEqual(data[0].contributors.map((u) => u.name), ['Barbara', 'Carl'])
    assert.deepEqual(data[1].contributors, [])
    assert.ok(!requests.some((u) => u.pathname === '/api/users' && u.search), 'a path is never used as a filter')
  })

  test('an entity path with placeholders is filled from the parent', async () => {
    const { data } = await rest.executeQuery({
      connection,
      from: '/repos',
      relations: [{ entity: '/posts/by-user/{owner.login}', foreignKey: 'userId', type: 'hasMany', alias: 'byLogin' },
        { entity: '/posts/by-user/{id}', foreignKey: 'userId', type: 'hasMany', alias: 'posts', where: { full: true } }]
    })
    assert.deepEqual(data.map((r) => r.posts.map((p) => p.id)), [[10, 11], []])
    assert.deepEqual(data[1].byLogin, [])
    assert.ok(requests.some((u) => u.pathname === '/api/posts/by-user/1' && u.searchParams.get('full') === 'true'))
    assert.equal(requests.filter((u) => u.pathname.startsWith('/api/posts/by-user/ada')).length, 1)
  })

  test('belongsTo over a list follows the first; a collection URL names no record', async () => {
    globalThis.fetch = (inner => async (url) => {
      if (String(url).endsWith('/films/9')) return reply({ id: 9, people: ['https://api.test/api/users/', 'https://api.test/api/users/2'], lead: 'https://api.test/api/users/' })
      return inner(url)
    })(globalThis.fetch)
    const { data } = await rest.executeQuery({
      connection,
      from: '/films/9',
      relations: [
        { entity: '/users', foreignKey: 'people', type: 'hasMany', alias: 'cast' },
        { entity: '/users', foreignKey: 'people', type: 'belongsTo', alias: 'first' },
        { entity: '/users', foreignKey: 'lead', type: 'belongsTo', alias: 'lead' }
      ]
    })
    assert.deepEqual(data[0].cast.map((u) => u.name), ['Barbara'])
    assert.equal(data[0].lead, null)
    assert.ok(!requests.some((u) => u.pathname === '/api/users/'), 'the collection itself is never fetched')
    // The first entry is the collection URL, so the first record is the next one.
    assert.equal(data[0].first.name, 'Barbara')
  })

  test('a relation limit caps a list of references before they are fetched', async () => {
    await rest.executeQuery({
      connection,
      from: '/repos',
      where: { id: 1 },
      relations: [{ entity: '/users', foreignKey: 'contributors[].user.url', type: 'hasMany', alias: 'contributors', limit: 1 }]
    })
    assert.equal(requests.filter((u) => /^\/api\/users\/\d+$/.test(u.pathname)).length, 1)
  })
})
