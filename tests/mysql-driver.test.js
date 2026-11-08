'use strict'

const { test, describe, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const mysql = require('../src/database/drivers/mysql')
const { connectionCaches } = require('../src/database/drivers/knex-query')

afterEach(async () => {
  await mysql.destroyAll()
})

describe('mysql driver: connection', () => {
  test('is a knex driver on mysql2, which speaks MySQL 8 and 9 login methods', () => {
    const db = mysql.getKnexInstance({ host: 'h', database: 'd', user: 'u', password: 'p' })
    assert.equal(db.client.config.client, 'mysql2')
    assert.equal(db.client.config.connection.host, 'h')
    assert.equal(db.client.config.connection.port, 3306, 'the MySQL default port')
    assert.equal(db.client.config.connection.connectTimeout, 10_000, 'a dropped connection fails as a recognised cold start')
  })

  test('keeps BIGINT beyond 2^53 exact by returning it as a string', () => {
    const { connection } = mysql.getKnexInstance({ host: 'h', database: 'd', user: 'u' }).client.config
    assert.equal(connection.supportBigNumbers, true)
    assert.equal(connection.bigNumberStrings, false)
  })

  test('does not share a pool between different passwords', () => {
    const base = { host: 'h', database: 'd', user: 'u' }
    const a = mysql.getKnexInstance({ ...base, password: 'right' })
    const b = mysql.getKnexInstance({ ...base, password: 'wrong' })
    assert.notEqual(a, b, 'a wrong password must not ride on an authenticated pool')
    assert.equal(mysql.getKnexInstance({ ...base, password: 'right' }), a)
  })

  test('asks for TLS only when the scheme says so', () => {
    const plain = mysql.getKnexInstance({ host: 'h', database: 'd', user: 'u' })
    const secure = mysql.getKnexInstance({ host: 'h', database: 'd', user: 'u', scheme: 'mysqls' })
    assert.equal(plain.client.config.connection.ssl, undefined)
    assert.deepEqual(secure.client.config.connection.ssl, {})
  })

  test('its pool is bounded and reported like the other knex drivers', () => {
    mysql.getKnexInstance({ host: 'h', database: 'd', user: 'u' })
    assert.ok(connectionCaches.has('mysql'))
    assert.equal(connectionCaches.get('mysql').size, 1)
  })

  test('hands back plain row objects, leaving raw [rows, fields] results alone', () => {
    const { postProcessResponse } = mysql.getKnexInstance({ host: 'h', database: 'd', user: 'u' }).client.config
    class Row { constructor (o) { Object.assign(this, o) } }
    const rows = postProcessResponse([new Row({ id: 1 })])
    assert.deepEqual(Object.getPrototypeOf(rows[0]), Object.prototype)
    const raw = [[new Row({ id: 1 })], [{ name: 'id' }]]
    assert.equal(postProcessResponse(raw)[0], raw[0], 'a nested array is not spread into an object')
  })
})

describe('mysql driver: introspection', () => {
  test('groups one row per column into tables, in column order', () => {
    const { tables } = mysql.buildTables([
      { table_name: 'users', column_name: 'id', data_type: 'int', nullable: 0, column_default: null, is_primary_key: 1 },
      { table_name: 'users', column_name: 'name', data_type: 'varchar(255)', nullable: 1, column_default: 'anon', is_primary_key: 0 },
      { table_name: 'posts', column_name: 'id', data_type: 'int', nullable: 0, column_default: null, is_primary_key: 1 }
    ])
    assert.deepEqual(tables.map((t) => t.name), ['users', 'posts'])
    assert.deepEqual(tables[0].columns[0], { name: 'id', type: 'int', nullable: false, defaultValue: null, isPrimaryKey: true })
    assert.deepEqual(tables[0].columns[1], { name: 'name', type: 'varchar(255)', nullable: true, defaultValue: 'anon', isPrimaryKey: false })
  })
})
