'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { fetchRelation, resolveCrossCatalogRelation } = require('../src/database/relations')

/** Record the queries a relation issues and answer them from a fixed table. */
function recordingExecutor (rowsByEntity) {
  const calls = []
  const executeQuery = async (input) => {
    calls.push(input)
    return { data: rowsByEntity[input.from] || [], count: 0 }
  }
  return { executeQuery, calls }
}

describe('fetchRelation: belongsTo', () => {
  test('matches the related entity on id by default', async () => {
    // Given a row whose foreign key points at a related record
    const { executeQuery, calls } = recordingExecutor({ users: [{ id: 7, name: 'Alice' }] })
    const row = { id: 1, user_id: 7 }

    // When resolving a belongsTo relation with no ownerKey
    const related = await fetchRelation(executeQuery, { driver: 'sqlite3' }, row,
      { entity: 'users', foreignKey: 'user_id', type: 'belongsTo' })

    // Then the related entity is matched on its id
    assert.deepEqual(calls[0].where, { id: 7 })
    assert.equal(related.name, 'Alice')
  })

  test('matches on ownerKey when the related entity keys on something else', async () => {
    // Given a related entity whose primary key is not called id
    const { executeQuery, calls } = recordingExecutor({ users: [{ uuid: 'abc', name: 'Bob' }] })
    const row = { id: 1, user_uuid: 'abc' }

    // When resolving a belongsTo relation that names the owner key
    const related = await fetchRelation(executeQuery, { driver: 'sqlite3' }, row,
      { entity: 'users', foreignKey: 'user_uuid', ownerKey: 'uuid', type: 'belongsTo' })

    // Then the related entity is matched on that key instead of id
    assert.deepEqual(calls[0].where, { uuid: 'abc' })
    assert.equal(related.name, 'Bob')
  })

  test('returns null when the foreign key is not set', async () => {
    // Given a row with no foreign key value
    const { executeQuery, calls } = recordingExecutor({})
    const row = { id: 1, user_id: null }

    // When resolving the relation
    const related = await fetchRelation(executeQuery, {}, row,
      { entity: 'users', foreignKey: 'user_id', type: 'belongsTo' })

    // Then nothing is fetched and the result is null
    assert.equal(related, null)
    assert.equal(calls.length, 0)
  })
})

describe('fetchRelation: hasMany and hasOne', () => {
  test('hasMany matches the related entity on the foreign key', async () => {
    // Given a parent row with two children
    const { executeQuery, calls } = recordingExecutor({ posts: [{ id: 10 }, { id: 11 }] })
    const row = { id: 3 }

    // When resolving a hasMany relation
    const related = await fetchRelation(executeQuery, {}, row,
      { entity: 'posts', foreignKey: 'user_id', type: 'hasMany' })

    // Then every child is returned
    assert.deepEqual(calls[0].where, { user_id: 3 })
    assert.equal(related.length, 2)
  })

  test('hasOne returns only the first match', async () => {
    // Given a parent row with more than one candidate child
    const { executeQuery } = recordingExecutor({ profiles: [{ id: 10 }, { id: 11 }] })
    const row = { id: 3 }

    // When resolving a hasOne relation
    const related = await fetchRelation(executeQuery, {}, row,
      { entity: 'profiles', foreignKey: 'user_id', type: 'hasOne' })

    // Then a single record is returned
    assert.equal(related.id, 10)
  })
})

describe('fetchRelation: targeting kegg', () => {
  test('uses _pathSuffix instead of the generic foreign-key filter', async () => {
    // Given a connection whose driver is kegg, which has no where-filter
    // semantics of its own
    const { executeQuery, calls } = recordingExecutor({ '/get': [{ entry: 'map01100' }] })
    const row = { entry_id: 'map01100' }

    // When resolving a belongsTo relation against it
    await fetchRelation(executeQuery, { driver: 'kegg' }, row,
      { entity: '/get', foreignKey: 'entry_id', type: 'belongsTo' })

    // Then the query uses _pathSuffix, not the generic ownerKey filter
    assert.deepEqual(calls[0].where, { _pathSuffix: 'map01100' })
  })

  test('uses _pathSuffix for hasMany too', async () => {
    // Given the same kegg connection
    const { executeQuery, calls } = recordingExecutor({ '/link/pathway': [{ target_id: 'x' }] })
    const row = { id: 'C00031' }

    // When resolving a hasMany relation against it
    await fetchRelation(executeQuery, { driver: 'kegg' }, row,
      { entity: '/link/pathway', localKey: 'id', foreignKey: 'entry_id', type: 'hasMany' })

    // Then it is still _pathSuffix, never the declared foreignKey name
    assert.deepEqual(calls[0].where, { _pathSuffix: 'C00031' })
  })
})

describe('resolveCrossCatalogRelation', () => {
  test('resolves across every row and writes the result under the alias', async () => {
    // Given two parent rows and a relation targeting the jsonplaceholder catalog
    const calls = []
    const executeQuery = async (input) => {
      calls.push(input)
      return { data: [{ name: `user-${input.where.id}` }], count: 1 }
    }
    const rows = [{ userId: 1 }, { userId: 2 }]

    // When the relation is resolved
    await resolveCrossCatalogRelation(executeQuery, rows,
      { entity: '/users', foreignKey: 'userId', ownerKey: 'id', type: 'belongsTo', alias: 'author', catalog: 'jsonplaceholder' })

    // Then each row got its own lookup, resolved against jsonplaceholder's connection
    assert.equal(rows[0].author.name, 'user-1')
    assert.equal(rows[1].author.name, 'user-2')
    assert.equal(calls[0].connection.driver, 'rest')
  })

  test('reports every row with the same error when the catalog name is unknown', async () => {
    // Given a relation naming a catalog that does not exist
    const rows = [{ id: 1 }, { id: 2 }]

    // When it is resolved
    await resolveCrossCatalogRelation(async () => ({ data: [] }), rows,
      { entity: '/x', foreignKey: 'id', alias: 'c', catalog: 'nosuchcatalog' })

    // Then both rows carry the same explanatory error, rather than one
    // silently resolving and the other crashing the whole query
    assert.match(rows[0].c.error, /Unknown catalog/)
    assert.match(rows[1].c.error, /Unknown catalog/)
  })
})
