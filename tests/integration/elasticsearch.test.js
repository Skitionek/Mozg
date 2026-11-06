'use strict'

/**
 * Elasticsearch / OpenSearch connector against a real cluster.  Runs when
 * MOZG_IT_ELASTICSEARCH_URL is set, e.g. http://localhost:9200 — with
 * security on, add the user to the URL (http://elastic@localhost:9200) and
 * the password in MOZG_IT_ELASTICSEARCH_PASSWORD.  Each fixture table becomes an index, with dynamic
 * mappings — strings as text with a keyword subfield, as clusters do by default.
 */

const { TABLES } = require('./fixture')
const { runConnectorSuite, badCredentialsFor } = require('./suite')

const URL_ = process.env.MOZG_IT_ELASTICSEARCH_URL
let connection = null
if (URL_) {
  const u = new URL(URL_)
  connection = { driver: 'elasticsearch', database: `${u.protocol}//${u.host}` }
  if (u.username) connection.user = decodeURIComponent(u.username)
  if (process.env.MOZG_IT_ELASTICSEARCH_PASSWORD) connection.password = process.env.MOZG_IT_ELASTICSEARCH_PASSWORD
}

async function es (method, path, body, ndjson) {
  const headers = { 'Content-Type': ndjson ? 'application/x-ndjson' : 'application/json' }
  if (connection.user) headers.Authorization = `Basic ${Buffer.from(`${connection.user}:${connection.password}`).toString('base64')}`
  const res = await fetch(`${connection.database}${path}`, { method, headers, body: ndjson ? body : (body && JSON.stringify(body)) })
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
}

runConnectorSuite({
  name: 'elasticsearch',
  skipAll: !URL_ && 'set MOZG_IT_ELASTICSEARCH_URL to run',
  connection,
  badCredentials: badCredentialsFor(connection),
  async seed () {
    for (const [table, rows] of Object.entries(TABLES)) {
      await es('DELETE', `/${table}`)
      const bulk = rows.flatMap((r) => [JSON.stringify({ index: { _index: table, _id: String(r.id) } }), JSON.stringify(r)]).join('\n') + '\n'
      await es('POST', '/_bulk?refresh=true', bulk, true)
    }
  }
})
