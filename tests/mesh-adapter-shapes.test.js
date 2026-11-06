'use strict'

/**
 * The mesh adapter against schemas shaped like each graphql-mesh handler's
 * output, so the documents and variables it sends are checked by real
 * GraphQL validation and coercion:
 *
 *   - Neo4j (@neo4j/graphql 7): operator-object filters `{ id: { eq } }`,
 *     `sort: [{ field: DESC }]`, BigInt ids
 *   - MySQL: every `where` field typed String, `orderBy: { field: asc }`
 *   - OpenAPI: operations with direct, typed (enum, required) arguments
 *   - OData: a `queryOptions` input carrying $top/$skip/$orderby/$filter
 *   - SOAP: operations as mutations taking one wrapper input
 *
 * The live counterparts run in tests/integration (MySQL, Neo4j) and were
 * checked by hand against public OpenAPI, OData and SOAP services.
 */

const { test, describe, after } = require('node:test')
const assert = require('node:assert/strict')
const { makeExecutableSchema } = require('@graphql-tools/schema')
const { GraphQLScalarType } = require('graphql')
const mesh = require('../src/database/drivers/mesh-adapter')

const USERS = [
  { id: 1, name: 'Ada', email: 'ada@example.org' },
  { id: 2, name: 'Barbara', email: 'barbara@example.org' },
  { id: 3, name: 'Carl', email: 'carl@example.org' }
]
const POSTS = [
  { id: 1, user_id: 1, title: 'Engines' },
  { id: 2, user_id: 1, title: 'Notes' },
  { id: 3, user_id: 3, title: 'Proteins' }
]

const cleanups = []
after(() => cleanups.forEach((fn) => fn()))

function register (connection, typeDefs, resolvers) {
  const schema = makeExecutableSchema({ typeDefs, resolvers })
  cleanups.push(mesh.registerMeshSource(connection, { schema }))
  return connection
}

// ── Neo4j (@neo4j/graphql 7) ────────────────────────────────────────────────

const BigInt_ = new GraphQLScalarType({
  name: 'BigInt',
  serialize: (v) => String(v),
  parseValue: (v) => {
    if (typeof v !== 'number' && typeof v !== 'string') throw new TypeError('BigInt needs a number or string')
    return Number(v)
  }
})

function neo4jFilter (rows, where) {
  return rows.filter((row) => Object.entries(where || {}).every(([field, ops]) => {
    assert.equal(typeof ops, 'object', `@neo4j/graphql 7 filters are operator objects, got ${JSON.stringify(ops)}`)
    if ('eq' in ops) return String(row[field]) === String(ops.eq)
    if ('in' in ops) return ops.in.map(String).includes(String(row[field]))
    throw new Error(`unsupported operator ${Object.keys(ops)}`)
  }))
}

function neo4jList (rows) {
  return (_, { where, sort, limit, offset }) => {
    let out = neo4jFilter(rows, where)
    for (const s of [...(sort || [])].reverse()) {
      const [[field, dir]] = Object.entries(s)
      out = [...out].sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (dir === 'DESC' ? -1 : 1))
    }
    return out.slice(offset || 0, limit != null ? (offset || 0) + limit : undefined)
  }
}

const NEO4J = register({ driver: 'neo4j', host: 'shape-test', database: 'neo4j', user: 'neo4j', password: 'pw' }, /* GraphQL */ `
  scalar BigInt
  enum SortDirection { ASC DESC }
  input BigIntScalarFilters { eq: BigInt, in: [BigInt!], gt: BigInt, lt: BigInt }
  input StringScalarFilters { eq: String, in: [String!], contains: String }
  type User { id: BigInt, name: String, email: String }
  type Post { id: BigInt, user_id: BigInt, title: String }
  input UserWhere { id: BigIntScalarFilters, id_EQ: BigInt, name: StringScalarFilters, email: StringScalarFilters, AND: [UserWhere!] }
  input PostWhere { id: BigIntScalarFilters, user_id: BigIntScalarFilters, title: StringScalarFilters }
  input UserSort { id: SortDirection, name: SortDirection, email: SortDirection }
  input PostSort { id: SortDirection, user_id: SortDirection, title: SortDirection }
  type UsersConnection { totalCount: Int! }
  type Query {
    users(where: UserWhere, limit: Int, offset: Int, sort: [UserSort!]): [User!]!
    usersConnection(where: UserWhere): UsersConnection!
    posts(where: PostWhere, limit: Int, offset: Int, sort: [PostSort!]): [Post!]!
  }
`, { BigInt: BigInt_, Query: { users: neo4jList(USERS), posts: neo4jList(POSTS), usersConnection: () => ({ totalCount: USERS.length }) } })

describe('mesh adapter: Neo4j-shaped schema', () => {
  test('filters with operator objects, sorts with a list of sort inputs, pages', async () => {
    const { data } = await mesh.executeQuery({ connection: NEO4J, from: 'users', select: ['name'], orderBy: 'name', orderDirection: 'desc', limit: 1, offset: 1 })
    assert.deepEqual(data, [{ name: 'Barbara' }])
  })

  test('a plain where value means equality', async () => {
    const { data } = await mesh.executeQuery({ connection: NEO4J, from: 'posts', where: { user_id: 1 } })
    assert.deepEqual(data.map((p) => p.title), ['Engines', 'Notes'])
  })

  test('an explicit operator object is passed through', async () => {
    const { data } = await mesh.executeQuery({ connection: NEO4J, from: 'users', where: { id: { in: [1, 3] } } })
    assert.deepEqual(data.map((u) => u.name), ['Ada', 'Carl'])
  })

  test('resolves hasMany, hasOne and belongsTo', async () => {
    const { data } = await mesh.executeQuery({
      connection: NEO4J,
      from: 'users',
      where: { id: 1 },
      relations: [
        { entity: 'posts', foreignKey: 'user_id', type: 'hasMany', alias: 'posts' },
        { entity: 'posts', foreignKey: 'user_id', type: 'hasOne', alias: 'firstPost' }
      ]
    })
    assert.equal(data[0].posts.length, 2)
    assert.ok(data[0].firstPost.title)

    const { data: posts } = await mesh.executeQuery({
      connection: NEO4J,
      from: 'posts',
      where: { id: 3 },
      relations: [{ entity: 'users', foreignKey: 'user_id', type: 'belongsTo', alias: 'author' }]
    })
    assert.equal(posts[0].author.name, 'Carl')
  })

  test('names the filterable fields when one does not exist, leaving out deprecated forms', async () => {
    await assert.rejects(
      mesh.executeQuery({ connection: NEO4J, from: 'users', where: { age: 3 } }),
      /Cannot filter "users" by "age". Filterable fields: id, name, email$/
    )
  })

  test('rejects labels that are not plain identifiers before reaching the handler', async () => {
    await assert.rejects(mesh.executeQuery({ connection: NEO4J, from: 'User) DETACH DELETE n //' }), /identifier/i)
  })

  test('introspection lists each label once, not its Connection twin', async () => {
    const { tables } = await mesh.introspect(NEO4J)
    assert.deepEqual(tables.map((t) => t.name), ['users', 'posts'])
  })
})

// ── MySQL ───────────────────────────────────────────────────────────────────

const seenMysqlArgs = []
const MYSQL = register({ driver: 'mysql', host: 'shape-test', database: 'blog', user: 'u', password: 'pw' }, /* GraphQL */ `
  enum OrderBy { asc desc }
  type users { id: Int, name: String }
  input users_WhereInput { id: String, name: String }
  input users_OrderByInput { id: OrderBy, name: OrderBy }
  type Query { users(limit: Int, offset: Int, where: users_WhereInput, orderBy: users_OrderByInput): [users] }
`, {
  Query: {
    users: (_, args) => {
      seenMysqlArgs.push(args)
      let out = USERS.filter((u) => Object.entries(args.where || {}).every(([k, v]) => {
        assert.equal(typeof v, 'string', 'the MySQL handler types every where field as String')
        return String(u[k]) === v
      }))
      if (args.orderBy) {
        const [[field, dir]] = Object.entries(args.orderBy)
        out = [...out].sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (dir === 'desc' ? -1 : 1))
      }
      return out.slice(0, args.limit ?? undefined)
    }
  }
})

describe('mesh adapter: MySQL-shaped schema', () => {
  test('coerces where values to the String the handler declares', async () => {
    const { data } = await mesh.executeQuery({ connection: MYSQL, from: 'users', where: { id: 2 } })
    assert.deepEqual(data.map((u) => u.name), ['Barbara'])
  })

  test('applies offset itself, because the handler swaps LIMIT and OFFSET', async () => {
    seenMysqlArgs.length = 0
    const { data } = await mesh.executeQuery({ connection: MYSQL, from: 'users', orderBy: 'name', limit: 1, offset: 1 })
    assert.deepEqual(data.map((u) => u.name), ['Barbara'])
    assert.equal(seenMysqlArgs[0].limit, 2, 'asks for offset + limit rows')
    assert.equal(seenMysqlArgs[0].offset, undefined, 'never sends offset')
  })
})

// ── OpenAPI ─────────────────────────────────────────────────────────────────

const OPENAPI = register({ driver: 'openapi', database: 'https://shape-test/openapi.json' }, /* GraphQL */ `
  enum Status { available pending sold }
  type Pet { id: Int, name: String, status: Status }
  type Query {
    findPetsByStatus(status: Status!): [Pet]
    getPetById(petId: Int!): Pet
    getInventory: String
  }
`, {
  Query: {
    findPetsByStatus: (_, { status }) => [
      { id: 3, name: 'Cat', status },
      { id: 1, name: 'Ant', status },
      { id: 2, name: 'Bee', status }
    ],
    getPetById: (_, { petId }) => ({ id: petId, name: 'Rex', status: 'sold' }),
    getInventory: () => '{"available":3}'
  }
})

describe('mesh adapter: OpenAPI-shaped schema', () => {
  test('maps where onto direct arguments, coercing enums, and pages and sorts itself', async () => {
    const { data } = await mesh.executeQuery({ connection: OPENAPI, from: 'findPetsByStatus', where: { status: 'AVAILABLE' }, orderBy: 'name', limit: 2 })
    assert.deepEqual(data.map((p) => p.name), ['Ant', 'Bee'])
    assert.equal(data[0].status, 'available')
  })

  test('names missing required arguments and invalid enum values', async () => {
    await assert.rejects(mesh.executeQuery({ connection: OPENAPI, from: 'getPetById' }), /"getPetById" requires where\.petId/)
    await assert.rejects(mesh.executeQuery({ connection: OPENAPI, from: 'findPetsByStatus', where: { status: 'flying' } }), /status must be one of: available, pending, sold/)
    await assert.rejects(mesh.executeQuery({ connection: OPENAPI, from: 'getPetById', where: { petId: 1, colour: 'red' } }), /does not accept "colour". Accepted: petId/)
  })

  test('a scalar result becomes a row of { value }', async () => {
    const { data } = await mesh.executeQuery({ connection: OPENAPI, from: 'getInventory' })
    assert.deepEqual(data, [{ value: '{"available":3}' }])
  })
})

// ── OData ───────────────────────────────────────────────────────────────────

const seenODataOptions = []
const ODATA = register({ driver: 'odata', database: 'https://shape-test/odata/' }, /* GraphQL */ `
  input QueryOptions { orderby: String, top: Int, skip: Int, filter: String }
  type Person { UserName: String, FirstName: String, ShareTrip(person: String!): Boolean }
  type Query { People(queryOptions: QueryOptions): [Person], Me: Person }
`, {
  Query: {
    People: (_, { queryOptions }) => {
      seenODataOptions.push(queryOptions)
      return [{ UserName: 'clydeguess', FirstName: 'Clyde' }]
    },
    Me: () => ({ UserName: 'aprilcline', FirstName: 'April' })
  }
})

describe('mesh adapter: OData-shaped schema', () => {
  test('sends paging, ordering and equality filters as system query options, escaping literals', async () => {
    seenODataOptions.length = 0
    await mesh.executeQuery({ connection: ODATA, from: 'People', where: { FirstName: "O'Brien" }, orderBy: 'UserName', orderDirection: 'desc', limit: 2, offset: 4 })
    assert.deepEqual({ ...seenODataOptions[0] }, { top: 2, skip: 4, orderby: 'UserName desc', filter: "FirstName eq 'O''Brien'" })
  })

  test('does not select fields that need arguments (OData actions)', async () => {
    const { data } = await mesh.executeQuery({ connection: ODATA, from: 'Me' })
    assert.deepEqual(data, [{ UserName: 'aprilcline', FirstName: 'April' }])
  })

  test('refuses to filter on a field the entity does not have', async () => {
    // A key smuggling an expression is refused by the field allowlist, never spliced into $filter
    await assert.rejects(mesh.executeQuery({ connection: ODATA, from: 'People', where: { 'x) or (1': 1 } }), /Cannot filter "People" by "x\) or \(1"/)
    await assert.rejects(mesh.executeQuery({ connection: ODATA, from: 'People', where: { Age: 1 } }), /Cannot filter "People" by "Age"/)
  })

  test('introspection lists every entry point, even two returning one type', async () => {
    const { tables } = await mesh.introspect(ODATA)
    assert.deepEqual(tables.map((t) => t.name), ['People', 'Me'])
    assert.deepEqual(tables[0].columns.map((c) => c.name), ['UserName', 'FirstName'])
  })
})

// ── SOAP ────────────────────────────────────────────────────────────────────

const SOAP = register({ driver: 'soap', database: 'https://shape-test/service?WSDL' }, /* GraphQL */ `
  scalar Void
  input NumberToWords_Input { ubiNum: Int }
  type NumberToWordsResponse { NumberToWordsResult: String }
  type Query { placeholder: Void }
  type Mutation {
    Svc_Svc_SvcSoap_NumberToWords(NumberToWords: NumberToWords_Input): NumberToWordsResponse
    Svc_Svc_SvcSoap12_NumberToWords(NumberToWords: NumberToWords_Input): NumberToWordsResponse
  }
`, {
  Query: { placeholder: () => null },
  Mutation: {
    Svc_Svc_SvcSoap_NumberToWords: (_, { NumberToWords }) => ({ NumberToWordsResult: `words for ${NumberToWords.ubiNum}` }),
    Svc_Svc_SvcSoap12_NumberToWords: () => ({ NumberToWordsResult: 'soap12' })
  }
})

describe('mesh adapter: SOAP-shaped schema', () => {
  test('runs an operation by its short name, wrapping where in its input', async () => {
    const { data } = await mesh.executeQuery({ connection: SOAP, from: 'NumberToWords', where: { ubiNum: '42' } })
    assert.deepEqual(data, [{ NumberToWordsResult: 'words for 42' }])
  })

  test('introspection lists operations once, by short name', async () => {
    const { tables } = await mesh.introspect(SOAP)
    assert.deepEqual(tables.map((t) => t.name), ['NumberToWords'])
  })
})

// ── Source cache ────────────────────────────────────────────────────────────

describe('mesh adapter: source cache', () => {
  test('a different password never reuses another caller\'s source', async () => {
    const base = { driver: 'mysql', host: 'cache-test', database: 'db', user: 'u' }
    const typeDefs = 'type users { name: String } type Query { users: [users] }'
    register({ ...base, password: 'right' }, typeDefs, { Query: { users: () => [{ name: 'secret row' }] } })
    register({ ...base, password: 'other' }, typeDefs, { Query: { users: () => [{ name: 'other row' }] } })
    const { data } = await mesh.executeQuery({ connection: { ...base, password: 'other' }, from: 'users' })
    assert.deepEqual(data, [{ name: 'other row' }])
  })

  test('destroyAll disposes of every cached source', async () => {
    let disposed = 0
    const executor = Object.assign(() => ({ data: {} }), { [Symbol.asyncDispose]: async () => { disposed++ } })
    mesh.registerMeshSource({ driver: 'mysql', host: 'dispose-test' }, { schema: makeExecutableSchema({ typeDefs: 'type Query { x: Int }' }), executor })
    await mesh.destroyAll()
    assert.equal(disposed, 1)
  })
})
