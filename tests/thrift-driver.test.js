'use strict'

/**
 * Thrift, end to end: the IDL file, the graphql-mesh handler, the HTTP/binary
 * wire and a real server (tests/fixtures/thrift-server.js).
 *
 * This is what "verified only up to the transport" was missing, and it found a
 * bug in Mozg: arguments were sent as GraphQL variables, which the Thrift
 * executor drops, so every call reached the server with an empty argument
 * struct.  They are now written as literals.
 *
 * Two limits are upstream (@graphql-mesh/thrift and its transport) and are
 * marked `todo`: they assert what *should* happen, run, and are reported but
 * do not fail the suite.  When upstream fixes one, its todo starts passing.
 */

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { makeExecutableSchema } = require('@graphql-tools/schema')
const { parse } = require('graphql')

const mesh = require('../src/database/drivers/mesh-adapter')
const { startThriftServer, Type } = require('./fixtures/thrift-server')

const SCALARS = path.join(__dirname, 'fixtures', 'scalars.thrift')
const CALC = path.join(__dirname, 'fixtures', 'calc.thrift')

let server
before(async () => {
  server = await startThriftServer({
    add: (a) => ({ type: Type.I32, write: (o) => o.writeI32(a[1] + a[2]) }),
    isEven: (a) => ({ type: Type.BOOL, write: (o) => o.writeBool(a[1] % 2 === 0) }),
    greet: (a) => ({ type: Type.STRING, write: (o) => o.writeString(`hello ${a[1]}`) })
  })
})
after(async () => {
  await mesh.destroyAll()
  await server.close()
})

const connect = (idl) => ({ driver: 'thrift', database: idl, host: '127.0.0.1', port: server.port, path: '/thrift' })

describe('thrift: against a real server', () => {
  test('lists the service\'s methods', async () => {
    const { tables } = await mesh.introspect(connect(SCALARS))
    assert.deepEqual(tables.map((t) => t.name).sort(), ['add', 'greet', 'isEven'])
  })

  test('sends the arguments, and returns an i32', async () => {
    server.calls.length = 0
    const { data } = await mesh.executeQuery({ connection: connect(SCALARS), from: 'add', where: { a: 2, b: 40 } })
    assert.deepEqual(data, [{ value: 42 }])
    assert.deepEqual(server.calls.at(-1), { method: 'add', args: { 1: 2, 2: 40 } }, 'the server received both arguments')
  })

  test('returns a bool, true and false', async () => {
    const even = await mesh.executeQuery({ connection: connect(SCALARS), from: 'isEven', where: { n: 4 } })
    const odd = await mesh.executeQuery({ connection: connect(SCALARS), from: 'isEven', where: { n: 5 } })
    assert.deepEqual([even.data, odd.data], [[{ value: true }], [{ value: false }]])
  })

  test('a value that is not an integer cannot become query text', async () => {
    server.calls.length = 0
    await assert.rejects(
      mesh.executeQuery({ connection: connect(SCALARS), from: 'add', where: { a: '2) { evil } #', b: 1 } }),
      /not an integer|cannot pass/i
    )
    assert.equal(server.calls.length, 0, 'nothing reached the server')
  })

  // Upstream: the handler gives a string parameter no type (`{ id: 1 }`), so the
  // client throws "Expected number but found type undefined" before sending.
  test('sends a string argument', { todo: '@graphql-mesh/thrift omits the type of string parameters' }, async () => {
    const { data } = await mesh.executeQuery({ connection: connect(SCALARS), from: 'greet', where: { name: 'Mozg' } })
    assert.deepEqual(data, [{ value: 'hello Mozg' }])
  })

  // Upstream: the transport decodes a binary reply without field names, so every
  // field of a struct is called `success` and the selected fields come back null.
  test('reads the fields of a struct result', { todo: '@graphql-mesh/transport-thrift cannot name struct fields from a binary reply' }, async () => {
    const structServer = await startThriftServer({
      add: (a) => ({
        type: Type.STRUCT,
        write: (o) => {
          o.writeStructBegin('Sum')
          o.writeFieldBegin('a', Type.I32, 1); o.writeI32(a[1]); o.writeFieldEnd()
          o.writeFieldBegin('b', Type.I32, 2); o.writeI32(a[2]); o.writeFieldEnd()
          o.writeFieldBegin('total', Type.I32, 3); o.writeI32(a[1] + a[2]); o.writeFieldEnd()
          o.writeFieldStop(); o.writeStructEnd()
        }
      })
    })
    try {
      const { data } = await mesh.executeQuery({
        connection: { driver: 'thrift', database: CALC, host: '127.0.0.1', port: structServer.port, path: '/thrift' },
        from: 'add',
        where: { a: 2, b: 40 }
      })
      assert.deepEqual(data, [{ a: 2, b: 40, total: 42 }])
    } finally {
      await structServer.close()
    }
  })
})

describe('thrift: arguments are literals, safely', () => {
  // A string argument, whatever it holds, must come out as one string value
  // and not as query text.  Upstream cannot send strings (above), so this
  // checks the document the adapter builds, against a recording executor.
  test('a hostile string is escaped, not interpreted', async () => {
    const documents = []
    const connection = { driver: 'thrift', database: 'recorded.thrift', host: 'recorder', port: 1, path: '/' }
    const unregister = mesh.registerMeshSource(connection, {
      schema: makeExecutableSchema({
        typeDefs: 'type Query { greet(name: String): String }',
        resolvers: { Query: { greet: () => 'x' } }
      }),
      executor: ({ document, variables }) => {
        documents.push({ document, variables })
        return { data: { greet: 'x' } }
      }
    })
    try {
      const hostile = 'x") { __typename } query Evil { greet(name: "y'
      await mesh.executeQuery({ connection, from: 'greet', where: { name: hostile } })
      const { document, variables } = documents[0]
      assert.deepEqual(variables, {}, 'no variables: the value is in the document')
      assert.equal(document.definitions.length, 1, 'the hostile text did not add an operation')
      const field = document.definitions[0].selectionSet.selections[0]
      assert.equal(field.name.value, 'greet')
      assert.equal(field.arguments.length, 1)
      assert.equal(field.arguments[0].value.value, hostile, 'it arrives as one string value, unchanged')
      assert.doesNotThrow(() => parse(require('graphql').print(document)))
    } finally {
      unregister()
    }
  })

  test('other drivers still send variables', async () => {
    const documents = []
    const connection = { driver: 'openapi', database: 'recorded.json' }
    const unregister = mesh.registerMeshSource(connection, {
      schema: makeExecutableSchema({
        typeDefs: 'type Query { greet(name: String): String }',
        resolvers: { Query: { greet: () => 'x' } }
      }),
      executor: ({ document, variables }) => {
        documents.push({ document, variables })
        return { data: { greet: 'x' } }
      }
    })
    try {
      await mesh.executeQuery({ connection, from: 'greet', where: { name: 'Mozg' } })
      assert.deepEqual(documents[0].variables, { name: 'Mozg' })
    } finally {
      unregister()
    }
  })
})
