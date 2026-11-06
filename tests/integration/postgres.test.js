'use strict'

/**
 * PostgreSQL connector against a real server.
 * Runs when MOZG_IT_POSTGRES_URL is set, e.g.
 *   postgres://postgres:secret@localhost:5432/mozg_it
 */

const { TABLES, COLUMNS, connectionFromUrl } = require('./fixture')
const { runConnectorSuite } = require('./suite')

const URL_ = process.env.MOZG_IT_POSTGRES_URL
const connection = URL_ ? connectionFromUrl('postgres', URL_) : null

const SQL_TYPES = { int: 'integer', text: 'text' }

runConnectorSuite({
  name: 'postgres',
  skipAll: !URL_ && 'set MOZG_IT_POSTGRES_URL to run',
  connection,
  badCredentials: connection && { ...connection, password: 'definitely-wrong-pw-123' },
  async seed () {
    const knex = require('knex')({ client: 'pg', connection: { ...connection, user: connection.user, password: connection.password } })
    try {
      for (const table of Object.keys(TABLES).reverse()) await knex.schema.dropTableIfExists(table)
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
    await require('../../src/database/drivers/postgres').destroyAll()
  }
})
