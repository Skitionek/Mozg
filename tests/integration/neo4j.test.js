'use strict'

/**
 * Neo4j connector (graphql-mesh Neo4j handler, @neo4j/graphql) against a
 * real server.  Runs when MOZG_IT_NEO4J_URL is set, e.g.
 *   bolt://neo4j@localhost:7687/neo4j
 * (password, if the server needs one, in MOZG_IT_NEO4J_PASSWORD)
 *
 * Fixture rows become nodes labelled User, Post, Comment and Protein, which
 * the handler exposes as the `users`, `posts`, `comments` and `proteins`
 * query fields.
 */

const { TABLES, connectionFromUrl } = require('./fixture')
const { runConnectorSuite, badCredentialsFor } = require('./suite')

const URL_ = process.env.MOZG_IT_NEO4J_URL
const connection = URL_ ? { ...connectionFromUrl('neo4j', URL_), scheme: new URL(URL_).protocol.replace(':', '') } : null

const LABELS = { users: 'User', posts: 'Post', comments: 'Comment', proteins: 'Protein' }

runConnectorSuite({
  name: 'neo4j',
  skipAll: !URL_ && 'set MOZG_IT_NEO4J_URL to run',
  connection,
  badCredentials: badCredentialsFor(connection),
  async seed () {
    const neo4j = require('neo4j-driver')
    const auth = connection.password ? neo4j.auth.basic(connection.user, connection.password) : undefined
    const driver = neo4j.driver(`${connection.scheme}://${connection.host}:${connection.port || 7687}`, auth)
    const session = driver.session({ database: connection.database })
    try {
      await session.run('MATCH (n) WHERE n:User OR n:Post OR n:Comment OR n:Protein DETACH DELETE n')
      for (const [table, rows] of Object.entries(TABLES)) {
        // Labels come from the fixture's fixed map, never from input.
        await session.run(`UNWIND $rows AS row CREATE (n:${LABELS[table]}) SET n = row`, { rows })
      }
    } finally {
      await session.close()
      await driver.close()
    }
  },
  async teardown () {
    await require('../../src/database/drivers/mesh-adapter').destroyAll()
  }
})
