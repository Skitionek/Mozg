'use strict'

/**
 * The connector suite for servers speaking the MySQL protocol, through the
 * knex/mysql2 driver (`mysql`): Oracle MySQL and MariaDB.
 */

const { TABLES, COLUMNS, connectionFromUrl } = require('./fixture')
const { runConnectorSuite, badCredentialsFor } = require('./suite')

const SQL_TYPES = { int: 'INT', text: 'VARCHAR(255)' }

function query (conn, sql, params) {
  return new Promise((resolve, reject) => conn.query(sql, params, (err, res) => (err ? reject(err) : resolve(res))))
}

/**
 * @param {string} name     suite name, and the MOZG_IT_<NAME>_URL / _PASSWORD variables
 */
function runMysqlProtocolSuite (name) {
  const env = name.toUpperCase()
  const url = process.env[`MOZG_IT_${env}_URL`]
  let connection = null
  if (url) {
    connection = connectionFromUrl('mysql', url)
    if (process.env[`MOZG_IT_${env}_PASSWORD`]) connection.password = process.env[`MOZG_IT_${env}_PASSWORD`]
  }

  runConnectorSuite({
    name,
    skipAll: !url && `set MOZG_IT_${env}_URL to run`,
    connection,
    badCredentials: badCredentialsFor(connection, { refusesUnknownUsers: true }),
    async seed () {
      const mysql = require('mysql2')
      const conn = mysql.createConnection({
        host: connection.host,
        port: connection.port,
        user: connection.user,
        password: connection.password,
        database: connection.database
      })
      try {
        for (const table of Object.keys(TABLES).reverse()) await query(conn, `DROP TABLE IF EXISTS \`${table}\``)
        for (const [table, rows] of Object.entries(TABLES)) {
          const cols = Object.entries(COLUMNS[table]).map(([c, t]) => `\`${c}\` ${SQL_TYPES[t]}${c === 'id' ? ' PRIMARY KEY' : ''}`)
          await query(conn, `CREATE TABLE \`${table}\` (${cols.join(', ')})`)
          for (const row of rows) await query(conn, `INSERT INTO \`${table}\` SET ?`, row)
        }
      } finally {
        conn.end()
      }
    },
    async teardown () {
      await require('../../src/database/drivers/mysql').destroyAll()
    }
  })
}

module.exports = { runMysqlProtocolSuite }
