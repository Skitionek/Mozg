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

describe('introspectDatabase: databases hosted with this server', () => {
  const registry = require('../src/database/registry')
  const { registerCatalog } = require('../src/catalog')
  const selfHosted = require('../src/database/self-hosted')
  const { introspectDatabase } = require('../src/database/introspect')

  test('waits for a database scaled to zero, counting the wait as demand', async () => {
    // Given a server-held source whose database refuses connections once (still starting)
    const unregister = registerCatalog({
      name: 'introspect-wake',
      label: 'Wake test',
      driver: 'postgres',
      connection: { host: { env: 'MOZG_TEST_INTROSPECT_HOST', default: 'db.test' }, database: 'x' },
      entities: []
    })
    const original = registry.getDriver
    let attempts = 0
    let demandDuring = null
    registry.getDriver = () => ({
      introspect: async () => {
        attempts++
        demandDuring = selfHosted.demandFor('introspect-wake').demand
        if (attempts === 1) throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:5432'), { code: 'ECONNREFUSED' })
        return { tables: [{ name: 'molecule_dictionary', columns: [] }] }
      }
    })

    try {
      // When it is introspected
      const schema = await introspectDatabase({ driver: 'postgres', source: 'introspect-wake' })

      // Then the call retried until the database answered, and was seen as demand meanwhile
      assert.deepEqual(schema.tables.map((t) => t.name), ['molecule_dictionary'])
      assert.equal(attempts, 2)
      assert.equal(demandDuring, 1)
    } finally {
      registry.getDriver = original
      unregister()
    }
  })

  test('does not retry a database that is not hosted with this server', async () => {
    const original = registry.getDriver
    let attempts = 0
    registry.getDriver = () => ({ introspect: async () => { attempts++; throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) } })
    try {
      await assert.rejects(introspectDatabase({ driver: 'postgres', host: 'elsewhere' }), /ECONNREFUSED/)
      assert.equal(attempts, 1)
    } finally {
      registry.getDriver = original
    }
  })
})
