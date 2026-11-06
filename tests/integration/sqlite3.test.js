'use strict'

/**
 * SQLite connector against a real database file.  Needs no server, so it
 * always runs in the integration suite.
 */

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { TABLES, COLUMNS } = require('./fixture')
const { runConnectorSuite } = require('./suite')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-it-sqlite-'))
const file = path.join(dir, 'fixture.db')
const SQL_TYPES = { int: 'INTEGER', text: 'TEXT' }

runConnectorSuite({
  name: 'sqlite3',
  connection: { driver: 'sqlite3', database: file },
  skip: { credentials: 'SQLite has no credentials' },
  async seed () {
    const knex = require('knex')({ client: 'sqlite3', connection: { filename: file }, useNullAsDefault: true })
    try {
      for (const [table, rows] of Object.entries(TABLES)) {
        await knex.schema.createTable(table, (t) => {
          for (const [column, type] of Object.entries(COLUMNS[table])) {
            const col = t.specificType(column, SQL_TYPES[type])
            if (column === 'id') col.primary()
          }
        })
        await knex(table).insert(rows)
      }
    } finally {
      await knex.destroy()
    }
  },
  async teardown () {
    await require('../../src/database/drivers/sqlite3').destroyAll()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
