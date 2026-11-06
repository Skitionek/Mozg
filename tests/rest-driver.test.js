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
