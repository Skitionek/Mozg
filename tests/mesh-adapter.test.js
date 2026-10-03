'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { isValidGraphQLName } = require('../src/database/drivers/mesh-adapter')

describe('isValidGraphQLName', () => {
  // ── Valid names ────────────────────────────────────────────────────────────

  test('returns true for a simple field name', () => {
    assert.equal(isValidGraphQLName('title'), true)
  })

  test('returns true for a camelCase field name', () => {
    assert.equal(isValidGraphQLName('firstName'), true)
  })

  test('returns true for a name with leading underscore', () => {
    assert.equal(isValidGraphQLName('_id'), true)
  })

  test('returns true for a name with digits after the first character', () => {
    assert.equal(isValidGraphQLName('field2'), true)
  })

  test('returns true for a name with mixed case and underscores', () => {
    assert.equal(isValidGraphQLName('My_Field_Name'), true)
  })

  test('returns true for a single letter', () => {
    assert.equal(isValidGraphQLName('x'), true)
  })

  // ── Invalid names (injection characters) ─────────────────────────────────

  test('returns false for a name containing a closing brace', () => {
    assert.equal(isValidGraphQLName('foo}bar'), false)
  })

  test('returns false for a name containing an opening brace', () => {
    assert.equal(isValidGraphQLName('foo{bar'), false)
  })

  test('returns false for a name containing a colon', () => {
    assert.equal(isValidGraphQLName('foo:bar'), false)
  })

  test('returns false for a name containing a dot', () => {
    assert.equal(isValidGraphQLName('foo.bar'), false)
  })

  test('returns false for a name containing a backtick', () => {
    assert.equal(isValidGraphQLName('foo`bar'), false)
  })

  test('returns false for a name containing a double-quote', () => {
    assert.equal(isValidGraphQLName('foo"bar'), false)
  })

  test('returns false for a name starting with a digit', () => {
    assert.equal(isValidGraphQLName('1foo'), false)
  })

  test('returns false for an empty string', () => {
    assert.equal(isValidGraphQLName(''), false)
  })

  test('returns false for null', () => {
    assert.equal(isValidGraphQLName(null), false)
  })

  test('returns false for undefined', () => {
    assert.equal(isValidGraphQLName(undefined), false)
  })

  test('returns false for a number', () => {
    assert.equal(isValidGraphQLName(42), false)
  })

  test('returns false for a name with a space', () => {
    assert.equal(isValidGraphQLName('foo bar'), false)
  })

  test('returns false for a Cypher injection pattern', () => {
    // This is the classic injection pattern from the original issue
    assert.equal(isValidGraphQLName('n.title'), false)
  })

  test('returns false for a GraphQL argument injection attempt', () => {
    assert.equal(isValidGraphQLName('foo: asc} limit: 0 {bar'), false)
  })
})

// ── buildHandlerDescriptor ─────────────────────────────────────────────────

describe('buildHandlerDescriptor', () => {
  const { buildHandlerDescriptor } = require('../src/database/drivers/mesh-adapter')

  test('soap: maps database to source, which is what the handler reads', () => {
    // Given a SOAP connection naming a WSDL
    const connection = { database: 'https://example.org/service.wsdl' }

    // When its handler config is built
    const { pkg, config } = buildHandlerDescriptor('soap', connection)

    // Then it uses the key @graphql-mesh/soap actually reads
    assert.equal(pkg, '@graphql-mesh/soap')
    assert.equal(config.source, connection.database)
    assert.equal(config.wsdl, undefined)
  })

  test('thrift: builds hostName/port/path from the connection, not endpoint', () => {
    // Given a thrift connection with host, port and an IDL path
    const connection = { database: 'service.thrift', host: 'svc.internal', port: 9191, path: '/v1' }

    // When its handler config is built
    const { pkg, config } = buildHandlerDescriptor('thrift', connection)

    // Then it supplies what @graphql-mesh/thrift's buildEndpointUrl() reads
    assert.equal(pkg, '@graphql-mesh/thrift')
    assert.equal(config.idl, connection.database)
    assert.equal(config.hostName, 'svc.internal')
    assert.equal(config.port, 9191)
    assert.equal(config.path, '/v1')
    assert.equal(config.endpoint, undefined)
  })

  test('thrift: defaults hostName, port and path when the connection omits them', () => {
    // Given a minimal thrift connection
    const connection = { database: 'service.thrift' }

    // When its handler config is built
    const { config } = buildHandlerDescriptor('thrift', connection)

    // Then it still builds a usable endpoint
    assert.equal(config.hostName, 'localhost')
    assert.equal(config.port, 9090)
    assert.equal(config.path, '')
  })

  test('mongodb is no longer a recognised driver', () => {
    // Given a connection for the removed mongodb driver
    // When its handler config is requested
    // Then it is rejected rather than silently misconfigured
    assert.throws(() => buildHandlerDescriptor('mongodb', {}), /No mesh handler available/)
  })
})
