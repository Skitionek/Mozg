'use strict'

/**
 * MySQL connector (graphql-mesh MySQL handler) against a real server.
 * Runs when MOZG_IT_MYSQL_URL is set, e.g.
 *   mysql://root@127.0.0.1:3306/mozg_it
 * (password, if the server needs one, in MOZG_IT_MYSQL_PASSWORD)
 */

const { TABLES, COLUMNS, connectionFromUrl } = require('./fixture')
const { runConnectorSuite, badCredentialsFor } = require('./suite')

const URL_ = process.env.MOZG_IT_MYSQL_URL
const connection = URL_ ? connectionFromUrl('mysql', URL_) : null

const SQL_TYPES = { int: 'INT', text: 'VARCHAR(255)' }

function query (conn, sql, params) {
  return new Promise((resolve, reject) => conn.query(sql, params, (err, res) => (err ? reject(err) : resolve(res))))
}

runConnectorSuite({
  name: 'mysql',
  skipAll: !URL_ && 'set MOZG_IT_MYSQL_URL to run',
  connection,
  badCredentials: badCredentialsFor(connection, { refusesUnknownUsers: true }),
  async seed () {
    const mysql = require('mysql')
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
    await require('../../src/database/drivers/mesh-adapter').destroyAll()
  }
})
