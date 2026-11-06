'use strict'

/**
 * ArangoDB driver: what reaches the server.  Every caller-supplied name must
 * travel as a bind parameter — interpolated into AQL it let a caller append
 * REMOVE/UPDATE statements.  The live behaviour runs in
 * tests/integration/arango.test.js against a real server.
 */

const { test, describe, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { Database } = require('arangojs')
const arango = require('../src/database/drivers/arango')

const originalQuery = Database.prototype.query
let calls
let answer

beforeEach(() => {
  calls = []
  answer = () => []
  Database.prototype.query = async function (aql, bindVars) {
    calls.push({ aql, bindVars, db: this })
    const rows = answer(aql, bindVars)
    return { all: async () => rows }
  }
})

after(async () => {
  Database.prototype.query = originalQuery
  await arango.destroyAll()
})

const connection = { driver: 'arango', host: 'arango.test', database: 'blog', user: 'root', password: 'pw' }
const HOSTILE = 'users REMOVE doc IN users //'

describe('arango driver: bind parameters', () => {
  test('collection, filters, sort, paging and projection are all bound', async () => {
    await arango.executeQuery({
      connection,
      from: HOSTILE,
      where: { [HOSTILE]: 1 },
      orderBy: HOSTILE,
      orderDirection: 'desc',
      limit: 2,
      offset: 3,
      select: [HOSTILE]
    })

    const { aql, bindVars } = calls[0]
    assert.ok(!aql.includes('REMOVE'), `caller text leaked into AQL: ${aql}`)
    assert.match(aql, /^FOR doc IN @@coll0 FILTER doc\[@attr\d+\] == @val\d+ SORT doc\[@attr\d+\] DESC LIMIT @val\d+, @val\d+ RETURN \{ \[@val\d+\]: doc\[@attr\d+\] \}$/)
    assert.equal(bindVars['@coll0'], HOSTILE)
    assert.ok(Object.values(bindVars).filter((v) => v === HOSTILE).length >= 4)
    assert.ok(Object.values(bindVars).includes(2) && Object.values(bindVars).includes(3))
  })

  test('an offset alone still pages', async () => {
    await arango.executeQuery({ connection, from: 'users', offset: 5 })
    const { aql, bindVars } = calls[0]
    assert.match(aql, /LIMIT @val\d+, @val\d+/)
    assert.ok(Object.values(bindVars).includes(5))
  })

  test('the sort direction is never taken from caller text', async () => {
    await arango.executeQuery({ connection, from: 'users', orderBy: 'name', orderDirection: 'asc; REMOVE' })
    assert.match(calls[0].aql, / SORT doc\[@attr\d+\] ASC /)
  })
})

describe('arango driver: relations', () => {
  test('hasMany joins on the foreign key and returns it even when select leaves it out', async () => {
    answer = (aql) => (aql.includes('@@coll0') && calls.length === 1
      ? [{ _key: 'u1', name: 'Ada' }]
      : [{ user_id: 'u1', title: 'Engines' }, { user_id: 'u1', title: 'Notes' }])

    const { data } = await arango.executeQuery({
      connection,
      from: 'users',
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', select: ['title'] }]
    })

    assert.equal(data[0].posts.length, 2)
    const rel = calls[1]
    assert.match(rel.aql, /FILTER doc\[@attr\d+\] IN @val\d+/)
    assert.deepEqual(Object.values(rel.bindVars).filter((v) => Array.isArray(v)), [['u1']])
    assert.ok(Object.values(rel.bindVars).includes('user_id'), 'the join key is projected')
  })

  test('belongsTo matches on ownerKey, not always _key', async () => {
    answer = () => (calls.length === 1 ? [{ id: 7, user_id: 3 }] : [{ id: 3, name: 'Carl' }])
    const { data } = await arango.executeQuery({
      connection,
      from: 'posts',
      relations: [{ entity: 'users', foreignKey: 'user_id', ownerKey: 'id', type: 'belongsTo', alias: 'author' }]
    })
    assert.equal(data[0].author.name, 'Carl')
    assert.ok(Object.values(calls[1].bindVars).includes('id'))
  })

  test('a failing relation is reported in place, keeping the parent rows', async () => {
    answer = () => {
      if (calls.length === 1) return [{ _key: 'u1' }]
      throw new Error('collection or view not found: nope')
    }
    const { data } = await arango.executeQuery({ connection, from: 'users', relations: [{ entity: 'nope', foreignKey: 'user_id', alias: 'nope' }] })
    assert.equal(data[0]._key, 'u1')
    assert.match(data[0].nope.error, /relation fetch failed for nope: collection or view not found/)
  })
})

describe('arango driver: connection cache', () => {
  test('a different password gets a different client', async () => {
    await arango.executeQuery({ connection: { ...connection, password: 'one' }, from: 'users' })
    await arango.executeQuery({ connection: { ...connection, password: 'two' }, from: 'users' })
    assert.notEqual(calls[0].db, calls[1].db)
  })
})

describe('arango driver: limits, empty parents, cross-catalog, introspection', () => {
  test('a relation limit becomes a LIMITed subquery per parent', async () => {
    answer = () => (calls.length === 1 ? [{ _key: 'u1' }, { _key: 'u2' }] : [{ user_id: 'u1', title: 'A' }])
    await arango.executeQuery({ connection, from: 'users', relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', limit: 2 }] })
    assert.match(calls[1].aql, /^FOR id IN @val\d+ FOR doc IN \(FOR doc IN @@coll\d+ FILTER doc\[@attr\d+\] == id LIMIT @val\d+ RETURN doc\) RETURN doc$/)
    assert.ok(Object.values(calls[1].bindVars).includes(2))
  })

  test('hasOne is a cap of one', async () => {
    answer = () => (calls.length === 1 ? [{ _key: 'u1' }] : [{ user_id: 'u1', title: 'A' }])
    const { data } = await arango.executeQuery({ connection, from: 'users', relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasOne', alias: 'post' }] })
    assert.equal(data[0].post.title, 'A')
    assert.ok(Object.values(calls[1].bindVars).includes(1))
  })

  test('parents without the join value get empty results without a query', async () => {
    answer = () => [{ _key: 'u1' }]
    const { data } = await arango.executeQuery({ connection, from: 'users', relations: [{ entity: 'posts', localKey: 'missing', foreignKey: 'user_id', alias: 'posts' }] })
    assert.deepEqual(data[0].posts, [])
    assert.equal(calls.length, 1)
  })

  test('a relation naming another catalog is resolved there, reporting failure in place', async () => {
    answer = () => [{ _key: 'u1' }]
    const { data } = await arango.executeQuery({ connection, from: 'users', relations: [{ catalog: 'no-such-catalog', entity: 'x', localKey: '_key', foreignKey: 'id', alias: 'elsewhere' }] })
    assert.match(data[0].elsewhere.error, /no-such-catalog/)
  })

  test('introspection samples one document per document collection', async () => {
    const originalList = Database.prototype.listCollections
    Database.prototype.listCollections = async () => [{ name: 'users', type: 2 }, { name: 'follows', type: 3 }]
    answer = () => [{ _key: 'u1', name: 'Ada', tags: ['x'] }]
    try {
      const { tables } = await arango.introspect(connection)
      assert.deepEqual(tables.map((t) => t.name), ['users'])
      assert.deepEqual(tables[0].columns.map((c) => [c.name, c.type, c.isPrimaryKey]), [['_key', 'string', true], ['name', 'string', false], ['tags', 'Array', false]])
      assert.deepEqual(calls[0].bindVars, { '@coll': 'users' })
    } finally {
      Database.prototype.listCollections = originalList
    }
  })

  test('an empty collection name is refused', async () => {
    await assert.rejects(arango.executeQuery({ connection, from: '' }), /collection name is required/)
  })
})
