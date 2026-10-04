'use strict'

const { test, describe, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { buildTables } = require('../src/database/drivers/postgres')

describe('postgres driver: buildTables', () => {
  test('groups column rows into tables, preserving column order', () => {
    // Given one row per column, ordered by table then column position
    const rows = [
      { table_schema: 'public', table_name: 'customers', column_name: 'id', data_type: 'integer', nullable: false, column_default: "nextval('c_id_seq')", is_primary_key: true },
      { table_schema: 'public', table_name: 'customers', column_name: 'email', data_type: 'text', nullable: false, column_default: null, is_primary_key: false },
      { table_schema: 'public', table_name: 'orders', column_name: 'id', data_type: 'integer', nullable: false, column_default: null, is_primary_key: true }
    ]

    // When they are grouped
    const { tables } = buildTables(rows)

    // Then each table carries its own columns in order
    assert.deepEqual(tables.map((t) => t.name), ['customers', 'orders'])
    assert.deepEqual(tables[0].columns.map((c) => c.name), ['id', 'email'])
    assert.equal(tables[0].columns[0].isPrimaryKey, true)
    assert.equal(tables[0].columns[0].defaultValue, "nextval('c_id_seq')")
    assert.equal(tables[0].columns[1].defaultValue, null)
  })

  test('qualifies a table name with its schema unless it is public', () => {
    // Given columns from a non-public schema and from public
    const rows = [
      { table_schema: 'reporting', table_name: 'order_totals', column_name: 'cents', data_type: 'bigint', nullable: true, column_default: null, is_primary_key: false },
      { table_schema: 'public', table_name: 'orders', column_name: 'id', data_type: 'integer', nullable: false, column_default: null, is_primary_key: true }
    ]

    // When they are grouped
    const { tables } = buildTables(rows)

    // Then only the non-public one is schema-qualified
    assert.deepEqual(tables.map((t) => t.name), ['reporting.order_totals', 'orders'])
  })

  test('falls back to "unknown" when a column has no reported type', () => {
    // Given a row whose data_type is missing
    const rows = [
      { table_schema: 'public', table_name: 't', column_name: 'c', data_type: null, nullable: true, column_default: null, is_primary_key: false }
    ]

    // When it is grouped
    const { tables } = buildTables(rows)

    // Then the type is reported as unknown rather than null
    assert.equal(tables[0].columns[0].type, 'unknown')
  })
})

describe('postgres driver: connection pooling', () => {
  const { getKnexInstance, destroyAll } = require('../src/database/drivers/postgres')

  afterEach(async () => {
    await destroyAll()
  })

  test('reuses one pool for the same connection', () => {
    // Given the same connection requested twice
    const connection = { host: 'db.example', port: 5432, database: 'app', user: 'reader', password: 'secret' }

    // When a knex instance is requested both times
    const first = getKnexInstance(connection)
    const second = getKnexInstance(connection)

    // Then the same pooled instance is returned
    assert.equal(first, second)
  })

  test('does not reuse a pool across different passwords', () => {
    // Given two connections identical except for the password
    const correct = { host: 'db.example', port: 5432, database: 'app', user: 'reader', password: 'right' }
    const wrong = { host: 'db.example', port: 5432, database: 'app', user: 'reader', password: 'wrong' }

    // When a knex instance is requested for each
    const first = getKnexInstance(correct)
    const second = getKnexInstance(wrong)

    // Then they do not share a pool — a caller with the wrong password must
    // not ride on another caller's already-authenticated connection
    assert.notEqual(first, second)
  })
})
