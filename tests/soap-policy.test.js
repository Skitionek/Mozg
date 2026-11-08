'use strict'

const { test, describe, after } = require('node:test')
const assert = require('node:assert/strict')
const { makeExecutableSchema } = require('@graphql-tools/schema')

const { isAllowed, assertSoapOperationAllowed, firstWord } = require('../src/database/drivers/soap-policy')
const mesh = require('../src/database/drivers/mesh-adapter')

describe('SOAP policy: which operations may run', () => {
  test('allows operations named like reads', () => {
    for (const name of ['GetUser', 'getUser', 'ListOrders', 'list_orders', 'SearchGenes', 'FindByName', 'IsAvailable', 'HasAccess', 'CountRows', 'LookupZip']) {
      assert.equal(isAllowed(name, {}), true, name)
    }
  })

  test('refuses operations named like writes, and ones that say nothing either way', () => {
    for (const name of ['DeleteUser', 'CreateOrder', 'UpdateStock', 'SendEmail', 'Execute', 'Process', 'NumberToWords']) {
      assert.equal(isAllowed(name, {}), false, name)
    }
  })

  test('judges the first word, so a name that merely starts like a verb is not a read', () => {
    assert.equal(firstWord('GetUser'), 'Get')
    assert.equal(firstWord('Getaway'), 'Getaway')
    assert.equal(isAllowed('Getaway', {}), false)
    assert.equal(isAllowed('Isolate', {}), false, 'Is + olate')
    assert.equal(isAllowed('Hash', {}), false, 'Has + h')
    assert.equal(isAllowed('getuser', {}), false, 'an unbroken lower-case name has no word boundary to judge by')
  })

  test('lets the operator allow a name, a prefix, or everything', () => {
    assert.equal(isAllowed('NumberToWords', { MOZG_SOAP_OPERATIONS: 'NumberToWords' }), true)
    assert.equal(isAllowed('numbertowords', { MOZG_SOAP_OPERATIONS: 'NumberToWords' }), true, 'case-insensitive')
    assert.equal(isAllowed('NumberToDollars', { MOZG_SOAP_OPERATIONS: 'NumberToWords' }), false)
    assert.equal(isAllowed('CalcAdd', { MOZG_SOAP_OPERATIONS: 'Calc*, Other' }), true)
    assert.equal(isAllowed('Other', { MOZG_SOAP_OPERATIONS: 'Calc*, Other' }), true)
    assert.equal(isAllowed('DeleteUser', { MOZG_SOAP_OPERATIONS: '*' }), true, '* restores running anything')
  })

  test('treats regex characters in an allowed name literally', () => {
    assert.equal(isAllowed('AddXY', { MOZG_SOAP_OPERATIONS: 'Add.Y' }), false, '. is not a wildcard')
    assert.equal(isAllowed('Add.Y', { MOZG_SOAP_OPERATIONS: 'Add.Y' }), true)
  })

  test('the refusal says how to allow the operation', () => {
    assert.throws(() => assertSoapOperationAllowed('DeleteUser', {}), (err) => {
      assert.match(err.message, /"DeleteUser" was not run/)
      assert.match(err.message, /MOZG_SOAP_OPERATIONS=DeleteUser/)
      assert.match(err.message, /mozg\.soapOperations/)
      return true
    })
  })
})

describe('SOAP policy: enforced by the mesh adapter', () => {
  const cleanups = []
  after(() => cleanups.forEach((fn) => fn()))

  const calls = []
  const connection = { driver: 'soap', database: 'https://policy-test/service?WSDL' }
  cleanups.push(mesh.registerMeshSource(connection, {
    schema: makeExecutableSchema({
      typeDefs: /* GraphQL */ `
        scalar Void
        type Result { value: String }
        type Query { placeholder: Void }
        type Mutation {
          Svc_Port_GetThing: Result
          Svc_Port_DeleteThing: Result
        }
      `,
      resolvers: {
        Query: { placeholder: () => null },
        Mutation: {
          Svc_Port_GetThing: () => { calls.push('GetThing'); return { value: 'read' } },
          Svc_Port_DeleteThing: () => { calls.push('DeleteThing'); return { value: 'deleted' } }
        }
      }
    })
  }))

  test('runs a read-named operation', async () => {
    const { data } = await mesh.executeQuery({ connection, from: 'GetThing' })
    assert.deepEqual(data, [{ value: 'read' }])
  })

  test('refuses a write-named operation before it reaches the service', async () => {
    const saved = process.env.MOZG_SOAP_OPERATIONS
    delete process.env.MOZG_SOAP_OPERATIONS
    try {
      await assert.rejects(mesh.executeQuery({ connection, from: 'DeleteThing' }), /"DeleteThing" was not run/)
      assert.ok(!calls.includes('DeleteThing'), 'the operation never ran')
    } finally {
      if (saved !== undefined) process.env.MOZG_SOAP_OPERATIONS = saved
    }
  })

  test('runs it once the operator allows it', async () => {
    const saved = process.env.MOZG_SOAP_OPERATIONS
    process.env.MOZG_SOAP_OPERATIONS = 'DeleteThing'
    try {
      const { data } = await mesh.executeQuery({ connection, from: 'DeleteThing' })
      assert.deepEqual(data, [{ value: 'deleted' }])
    } finally {
      if (saved === undefined) delete process.env.MOZG_SOAP_OPERATIONS
      else process.env.MOZG_SOAP_OPERATIONS = saved
    }
  })

  test('does not touch introspection, which only lists operations', async () => {
    const { tables } = await mesh.introspect(connection)
    assert.deepEqual(tables.map((t) => t.name).sort(), ['DeleteThing', 'GetThing'])
  })
})
