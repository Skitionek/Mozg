'use strict'

/**
 * The mesh adapter's remaining paths: handler descriptors, Relay-connection
 * entities (PostGraphile-style), value coercion and its errors, executor
 * sources, relation edge cases, and building a real handler (Thrift, from a
 * local IDL — no server needed to build its schema).
 */

const { test, describe, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { makeExecutableSchema } = require('@graphql-tools/schema')
const { execute } = require('graphql')
const mesh = require('../src/database/drivers/mesh-adapter')

const cleanups = []
after(async () => {
  cleanups.forEach((fn) => fn())
  await mesh.destroyAll()
})

function register (connection, typeDefs, resolvers, { executor = false } = {}) {
  const schema = makeExecutableSchema({ typeDefs, resolvers })
  const source = { schema }
  if (executor) source.executor = ({ document, variables, context }) => execute({ schema, document, variableValues: variables, contextValue: context })
  cleanups.push(mesh.registerMeshSource(connection, source))
  return connection
}

describe('buildHandlerDescriptor', () => {
  test('describes each handler from a connection', () => {
    const d = (driver, conn) => mesh.buildHandlerDescriptor(driver, conn)
    assert.deepEqual(d('mysql', { database: 'db', user: 'u' }), { pkg: '@graphql-mesh/mysql', config: { host: 'localhost', port: 3306, database: 'db', user: 'u', password: '' } })
    assert.equal(d('neo4j', { host: 'h', scheme: 'neo4j+s', database: 'movies', user: 'u', password: 'p' }).config.endpoint, 'neo4j+s://h:7687')
    assert.deepEqual(d('openapi', { database: 'spec.json' }).config, { source: 'spec.json' })
    assert.deepEqual(d('openapi', { database: 'spec.json', host: 'https://api' }).config, { source: 'spec.json', endpoint: 'https://api' })
    assert.deepEqual(d('soap', { database: 'x?WSDL' }).config, { source: 'x?WSDL' })
    assert.deepEqual(d('odata', { database: 'https://svc/' }).config, { endpoint: 'https://svc/' })
    assert.deepEqual(d('thrift', { database: 'calc.thrift', host: 'h', port: 1, path: '/t', scheme: 'https' }).config, { idl: 'calc.thrift', hostName: 'h', port: 1, path: '/t', https: true })
    assert.throws(() => d('oracle', {}), /No mesh handler available for driver: oracle/)
  })
})

describe('Relay-connection entities (PostGraphile-style)', () => {
  const USERS = [{ id: 1, name: 'Ada', active: true, score: 1.5 }, { id: 2, name: 'Barbara', active: false, score: 2.5 }]
  const seen = []
  const PG = register({ driver: 'mysql', host: 'relay-test' }, /* GraphQL */ `
    enum UsersOrderBy { NAME_ASC NAME_DESC ID_ASC }
    input UserCondition { id: Int, name: String, active: Boolean, score: Float, uid: ID }
    type User { id: Int, name: String, active: Boolean, score: Float, uid: ID, friends(first: Int!): [User] }
    type UsersConnection { nodes: [User], totalCount: Int }
    type Empty { nested: User }
    type Query {
      allUsers(first: Int, offset: Int, condition: UserCondition, orderBy: [UsersOrderBy!]): UsersConnection
      empties: [Empty]
      broken: [User]
    }
  `, {
    Query: {
      allUsers: (_, args) => {
        seen.push(args)
        let nodes = USERS.filter((u) => Object.entries(args.condition || {}).every(([k, v]) => u[k] === v))
        if (args.orderBy && args.orderBy[0] === 'NAME_DESC') nodes = [...nodes].reverse()
        return { nodes: nodes.slice(args.offset || 0, args.first != null ? (args.offset || 0) + args.first : undefined), totalCount: nodes.length }
      },
      empties: () => [],
      broken: () => { throw new Error('upstream exploded') }
    }
  }, { executor: true })

  test('finds the all-prefixed field, filters by condition, orders by enum list, pages', async () => {
    seen.length = 0
    const { data } = await mesh.executeQuery({ connection: PG, from: 'users', where: { active: 'true', score: '1.5' }, orderBy: 'name', orderDirection: 'desc', limit: 1 })
    assert.deepEqual(data.map((u) => u.name), ['Ada'])
    assert.deepEqual({ ...seen[0].condition }, { active: true, score: 1.5 })
    assert.deepEqual(seen[0].orderBy, ['NAME_DESC'])
    assert.ok(!('friends' in data[0]), 'fields needing arguments are not selected')
  })

  test('coerces ids and strings, and rejects values of the wrong type', async () => {
    await mesh.executeQuery({ connection: PG, from: 'users', where: { uid: 7, name: { first: 'A' } } })
    await assert.rejects(mesh.executeQuery({ connection: PG, from: 'users', where: { id: 'one' } }), /where\.id: "one" is not an integer/)
    await assert.rejects(mesh.executeQuery({ connection: PG, from: 'users', where: { score: 'high' } }), /where\.score: "high" is not a number/)
  })

  test('reports unknown entities, unselectable ones, bad orderBy and bad where names', async () => {
    await assert.rejects(mesh.executeQuery({ connection: PG, from: 'nothing' }), /No query field found for entity "nothing". Available: allUsers, empties, broken/)
    await assert.rejects(mesh.executeQuery({ connection: PG, from: 'empties' }), /No selectable scalar fields for entity "empties"/)
    await assert.rejects(mesh.executeQuery({ connection: PG, from: 'users', orderBy: 'nope' }), /orderBy field "nope" is not a valid field/)
    await assert.rejects(mesh.executeQuery({ connection: PG, from: 'users', where: { 'a b': 1 } }), /Invalid where field name "a b"/)
  })

  test('an ordering the handler cannot express is done here', async () => {
    const { data } = await mesh.executeQuery({ connection: PG, from: 'users', orderBy: 'score', orderDirection: 'desc' })
    assert.deepEqual(data.map((u) => u.score), [2.5, 1.5])
  })

  test('upstream errors are raised with their message', async () => {
    await assert.rejects(mesh.executeQuery({ connection: PG, from: 'broken' }), /upstream exploded/)
  })

  test('relation edge cases: missing join values, limits, failures, other catalogs', async () => {
    const { data } = await mesh.executeQuery({
      connection: PG,
      from: 'users',
      orderBy: 'name',
      relations: [
        { entity: 'users', localKey: 'missing', foreignKey: 'id', type: 'hasMany', alias: 'none' },
        { entity: 'users', localKey: 'missing', foreignKey: 'id', type: 'hasOne', alias: 'noneOne' },
        { entity: 'users', localKey: 'id', foreignKey: 'id', type: 'hasMany', alias: 'self', limit: 1 },
        { entity: 'broken', localKey: 'id', foreignKey: 'id', type: 'hasMany', alias: 'fails' },
        { catalog: 'no-such-catalog', entity: 'x', localKey: 'id', foreignKey: 'id', alias: 'elsewhere' }
      ]
    })
    assert.deepEqual(data[0].none, [])
    assert.equal(data[0].noneOne, null)
    assert.equal(data[0].self.length, 1)
    assert.match(data[0].fails.error, /^relation fetch failed for broken: /)
    assert.match(data[0].elsewhere.error, /no-such-catalog/)
  })
})

describe('direct arguments', () => {
  const API = register({ driver: 'openapi', database: 'https://paths-test/openapi.json' }, /* GraphQL */ `
    type Pet { id: Int, tags: [String] }
    type Query { findPetsByTags(tags: [String]!): [Pet], count(limit: Int): Int, listed: [String] }
  `, {
    Query: {
      findPetsByTags: (_, { tags }) => [{ id: 1, tags }],
      count: () => 3,
      listed: () => ['a', 'b']
    }
  })

  test('a single value for a list argument becomes a list', async () => {
    const { data } = await mesh.executeQuery({ connection: API, from: 'findPetsByTags', where: { tags: 'cute' } })
    assert.deepEqual(data[0].tags, ['cute'])
  })

  test('a scalar argument of the wrong type is named', async () => {
    await assert.rejects(mesh.executeQuery({ connection: API, from: 'count', where: { limit: 'ten' } }), /limit: "ten" is not an integer/)
  })

  test('a list of scalars becomes rows of { value }', async () => {
    const { data } = await mesh.executeQuery({ connection: API, from: 'listed' })
    assert.deepEqual(data, [{ value: 'a' }, { value: 'b' }])
  })
})

describe('a real handler: Thrift from a local IDL', () => {
  const connection = { driver: 'thrift', database: path.join(__dirname, 'fixtures', 'calc.thrift'), host: '127.0.0.1', port: 1 }

  test('builds the schema from the IDL and lists the service methods', async () => {
    const { tables } = await mesh.introspect(connection)
    assert.deepEqual(tables, [{
      name: 'add',
      columns: ['a', 'b', 'total'].map((name) => ({ name, type: 'Int', nullable: true, defaultValue: null, isPrimaryKey: false }))
    }])
  })
})
