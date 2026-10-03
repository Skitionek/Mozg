'use strict'

const { test, describe, mock } = require('node:test')
const assert = require('node:assert/strict')

const registry = require('../src/database/registry')
const { introspectDatabase } = require('../src/database/introspect')

describe('introspectDatabase', () => {
  test('dispatches to the driver named by the connection', async () => {
    // Given a driver that reports one table
    let seen = null
    mock.method(registry, 'getDriver', (name) => {
      seen = name
      return { introspect: async () => ({ tables: [{ name: 'users', columns: [] }] }) }
    })

    // When a connection is introspected
    const result = await introspectDatabase({ driver: 'sqlite3', database: ':memory:' })
    mock.restoreAll()

    // Then the driver for that name produced the schema
    assert.equal(seen, 'sqlite3')
    assert.equal(result.tables[0].name, 'users')
  })

  test('propagates an unknown driver as an error', async () => {
    // Given a connection naming a driver that does not exist
    const connection = { driver: 'nosuchdb' }

    // When it is introspected
    const attempt = introspectDatabase(connection)

    // Then the registry's error surfaces
    await assert.rejects(attempt, /Unknown driver/)
  })
})
