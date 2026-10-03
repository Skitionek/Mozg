'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { fetchRelation } = require('../src/database/relations')

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
