'use strict'

/**
 * ArangoDB connector against a real server.  Runs when MOZG_IT_ARANGO_URL
 * is set, e.g. http://root@localhost:8529/mozg_it (password, if the server
 * needs one, in MOZG_IT_ARANGO_PASSWORD) — the database is created when missing.  Documents keep the fixture's numeric `id` beside
 * their `_key`.
 */

const { TABLES, connectionFromUrl } = require('./fixture')
const { runConnectorSuite, badCredentialsFor } = require('./suite')

const URL_ = process.env.MOZG_IT_ARANGO_URL
const connection = URL_ ? { ...connectionFromUrl('arango', URL_), scheme: new URL(URL_).protocol.replace(':', '') } : null

runConnectorSuite({
  name: 'arango',
  skipAll: !URL_ && 'set MOZG_IT_ARANGO_URL to run',
  connection,
  badCredentials: badCredentialsFor(connection),
  async seed () {
    const { Database } = require('arangojs')
    const url = `${connection.scheme}://${connection.host}:${connection.port || 8529}`
    const auth = { username: connection.user || 'root', password: connection.password || '' }
    const system = new Database({ url, auth })
    if (!(await system.listDatabases()).includes(connection.database)) await system.createDatabase(connection.database)
    const db = new Database({ url, auth, databaseName: connection.database })
    for (const [table, rows] of Object.entries(TABLES)) {
      const col = db.collection(table)
      if (await col.exists()) await col.drop()
      await col.create()
      await col.saveAll(rows.map((r) => ({ _key: String(r.id), ...r })))
    }
    system.close()
    db.close()
  },
  async teardown () {
    await require('../../src/database/drivers/arango').destroyAll()
  }
})
