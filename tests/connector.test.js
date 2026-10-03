'use strict'

const { test, describe, mock } = require('node:test')
const assert = require('node:assert/strict')

const registry = require('../src/database/registry')
const { executeQuery } = require('../src/database/connector')

describe('connector: relation routing', () => {
  test('passes same-source relations straight to the driver', async () => {
    // Given a driver that records the input it is handed
    let seen = null
    mock.method(registry, 'getDriver', () => ({
      executeQuery: async (input) => {
        seen = input
        return { data: [{ id: 1 }], count: 1 }
      }
    }))
    const relation = { entity: 'posts', foreignKey: 'user_id', type: 'hasMany' }

    // When a query with only same-source relations runs
    await executeQuery({ connection: { driver: 'sqlite3' }, from: 'users', relations: [relation] })
    mock.restoreAll()

    // Then the driver receives the relation to join itself
    assert.deepEqual(seen.relations, [relation])
  })

  test('withholds cross-catalog relations from the driver and resolves them itself', async () => {
    // Given a driver that cannot join across sources, and a relation naming
    // another catalog entry
    const calls = []
    mock.method(registry, 'getDriver', () => ({
      executeQuery: async (input) => {
        calls.push(input)
        return input.from === 'users'
          ? { data: [{ id: 1, kegg_id: 'C00031' }], count: 1 }
          : { data: [{ entry_id: 'C00031', name: 'Glucose' }], count: 1 }
      }
    }))
    const relation = {
      entity: '/find/compound',
      foreignKey: 'kegg_id',
      ownerKey: 'entry_id',
      type: 'belongsTo',
      alias: 'keggCompound',
      catalog: 'kegg'
    }

    // When the query runs
    const result = await executeQuery({
      connection: { driver: 'sqlite3' },
      from: 'users',
      relations: [relation]
    })
    mock.restoreAll()

    // Then the driver was never asked to join it...
    assert.deepEqual(calls[0].relations, [])
    // ...and the connector resolved it against the other catalog's connection
    assert.equal(result.data[0].keggCompound.name, 'Glucose')
  })

  test('reports a failing cross-catalog relation in place, keeping the parent rows', async () => {
    // Given a related source that fails
    mock.method(registry, 'getDriver', () => ({
      executeQuery: async (input) => {
        if (input.from === 'users') return { data: [{ id: 1, kegg_id: 'C1' }], count: 1 }
        throw new Error('upstream exploded')
      }
    }))

    // When a cross-catalog relation is requested
    const result = await executeQuery({
      connection: { driver: 'sqlite3' },
      from: 'users',
      relations: [{ entity: '/find/compound', foreignKey: 'kegg_id', type: 'belongsTo', alias: 'c', catalog: 'kegg' }]
    })
    mock.restoreAll()

    // Then the parent row survives and carries the relation's error
    assert.equal(result.data[0].id, 1)
    assert.match(result.data[0].c.error, /upstream exploded/)
  })
})
