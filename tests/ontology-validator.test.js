'use strict'

const { test, describe, mock } = require('node:test')
const assert = require('node:assert/strict')

const registry = require('../src/database/registry')
const { validateOntologyAgainstDb } = require('../src/ontology/validator')

/** Stand in for a live database with the given tables. */
function stubDatabase (tables) {
  mock.method(registry, 'getDriver', () => ({
    introspect: async () => ({ tables })
  }))
}

const USERS_TABLE = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, defaultValue: null, isPrimaryKey: true },
    { name: 'name', type: 'text', nullable: true, defaultValue: null, isPrimaryKey: false },
    { name: 'age', type: 'integer', nullable: true, defaultValue: null, isPrimaryKey: false }
  ]
}

function entityMap (entries) {
  return new Map(entries)
}

describe('validateOntologyAgainstDb', () => {
  test('reports a clean ontology as valid', async () => {
    // Given an ontology whose class and fields all exist in the database
    stubDatabase([USERS_TABLE])
    const map = entityMap([['User', {
      tableName: 'users',
      isAbstract: false,
      fields: [
        { fieldName: 'name', graphqlType: 'String' },
        { fieldName: 'age', graphqlType: 'Int' }
      ]
    }]])

    // When it is validated
    const report = await validateOntologyAgainstDb(map, { driver: 'sqlite3' })
    mock.restoreAll()

    // Then no warnings are raised
    assert.equal(report.valid, true)
    assert.deepEqual(report.warnings, [])
    assert.deepEqual(report.matchedTables, [{ typeName: 'User', tableName: 'users' }])
  })

  test('matches table and column names case-insensitively', async () => {
    // Given an ontology that differs only in casing
    stubDatabase([USERS_TABLE])
    const map = entityMap([['User', {
      tableName: 'USERS',
      isAbstract: false,
      fields: [{ fieldName: 'Name', graphqlType: 'String' }]
    }]])

    // When it is validated
    const report = await validateOntologyAgainstDb(map, { driver: 'sqlite3' })
    mock.restoreAll()

    // Then the casing difference is not treated as a mismatch
    assert.equal(report.valid, true)
  })

  test('reports a missing table', async () => {
    // Given an ontology class with no corresponding table
    stubDatabase([USERS_TABLE])
    const map = entityMap([['Post', { tableName: 'posts', isAbstract: false, fields: [] }]])

    // When it is validated
    const report = await validateOntologyAgainstDb(map, { driver: 'sqlite3' })
    mock.restoreAll()

    // Then the missing table is reported
    assert.equal(report.valid, false)
    assert.equal(report.warnings[0].type, 'MISSING_TABLE')
    assert.deepEqual(report.missingTables, [{ typeName: 'Post', tableName: 'posts' }])
  })

  test('reports a missing column', async () => {
    // Given a field with no matching column
    stubDatabase([USERS_TABLE])
    const map = entityMap([['User', {
      tableName: 'users',
      isAbstract: false,
      fields: [{ fieldName: 'nickname', graphqlType: 'String' }]
    }]])

    // When it is validated
    const report = await validateOntologyAgainstDb(map, { driver: 'sqlite3' })
    mock.restoreAll()

    // Then the missing column is reported
    assert.equal(report.warnings[0].type, 'MISSING_COLUMN')
    assert.equal(report.warnings[0].fieldName, 'nickname')
  })

  test('reports a type mismatch when an Int field maps to a text column', async () => {
    // Given a field the ontology types as Int over a text column
    stubDatabase([USERS_TABLE])
    const map = entityMap([['User', {
      tableName: 'users',
      isAbstract: false,
      fields: [{ fieldName: 'name', graphqlType: 'Int' }]
    }]])

    // When it is validated
    const report = await validateOntologyAgainstDb(map, { driver: 'sqlite3' })
    mock.restoreAll()

    // Then the incompatibility is reported
    assert.equal(report.warnings[0].type, 'TYPE_MISMATCH')
    assert.match(report.warnings[0].message, /text.*but OWL specifies 'Int'/)
  })

  test('skips abstract classes', async () => {
    // Given an abstract class with no table behind it
    stubDatabase([USERS_TABLE])
    const map = entityMap([['Thing', { tableName: 'things', isAbstract: true, fields: [] }]])

    // When it is validated
    const report = await validateOntologyAgainstDb(map, { driver: 'sqlite3' })
    mock.restoreAll()

    // Then it is neither matched nor reported as missing
    assert.equal(report.valid, true)
    assert.deepEqual(report.matchedTables, [])
    assert.deepEqual(report.missingTables, [])
  })
})
