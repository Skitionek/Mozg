'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { GraphQLError } = require('graphql')
const { maskError, redactCredentials } = require('../src/errors')

describe('redactCredentials', () => {
  test('removes the password from a connection string', () => {
    // Given a message containing a URI with inline credentials
    const message = 'failed to connect to mongodb://admin:hunter2@db.example.com:27017'

    // When redacting it
    const redacted = redactCredentials(message)

    // Then the password is gone and the rest survives
    assert.equal(redacted, 'failed to connect to mongodb://admin:***@db.example.com:27017')
  })

  test('leaves a message with no credentials untouched', () => {
    // Given a driver message with no URI in it
    const message = 'permission denied for table pg_extension'

    // When redacting it
    const redacted = redactCredentials(message)

    // Then it is unchanged
    assert.equal(redacted, 'permission denied for table pg_extension')
  })
})

describe('maskError', () => {
  test('surfaces the underlying driver message instead of "Unexpected error."', () => {
    // Given a GraphQL error wrapping a driver failure
    const driverFailure = new Error('permission denied for table pg_extension')
    const wrapped = new GraphQLError('wrapper', { originalError: driverFailure })

    // When masking it
    const masked = maskError(wrapped, 'Unexpected error.')

    // Then the driver's own message reaches the client
    assert.equal(masked.message, 'permission denied for table pg_extension')
    assert.equal(masked.extensions.code, 'DOWNSTREAM_ERROR')
  })

  test('redacts credentials carried in the driver message', () => {
    // Given a driver failure that echoes a connection string
    const driverFailure = new Error('auth failed for mongodb://root:s3cret@localhost:27017')

    // When masking it
    const masked = maskError(driverFailure, 'Unexpected error.')

    // Then the password does not reach the client
    assert.ok(!masked.message.includes('s3cret'), masked.message)
    assert.ok(masked.message.includes('root:***@'), masked.message)
  })

  test('falls back to the generic message when there is no error object', () => {
    // Given no usable error
    const notAnError = undefined

    // When masking it
    const masked = maskError(notAnError, 'Unexpected error.')

    // Then the generic message is used
    assert.equal(masked.message, 'Unexpected error.')
  })
})
