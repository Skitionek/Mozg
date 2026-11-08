'use strict'

/**
 * The HTTP servers: the main one (GraphQL, streaming, the query builder, health
 * and demand) and, optionally, a separate one for /metrics.
 *
 * Built by functions, not at require time, so a test or an embedding program
 * can start a server on any port and stop it again.  `src/index.js` is the
 * process entry point that does exactly that.
 */

const { createServer } = require('node:http')
const { join } = require('node:path')
const { createYoga, createSchema } = require('graphql-yoga')
const { typeDefs, resolvers } = require('./schema')
const { handleStreamRequest } = require('./stream')
const { serveStatic } = require('./static')
const { maskError } = require('./errors')
const { handleDemandRequest } = require('./database/self-hosted')
const { trackRequest, serveMetrics } = require('./telemetry')
const { boolOption, intOption } = require('./config')
const { version } = require('../package.json')

const GRAPHIQL_QUERY = `# Welcome to Mozg – query any database from a single GraphQL endpoint.
#
# Example: list tables in a local SQLite file
#
# {
#   introspect(connection: { driver: sqlite3, database: "path/to/file.db" }) {
#     tables { name columns { name type nullable isPrimaryKey } }
#   }
# }
#
# Example: query entities with a relation
#
# {
#   query(input: {
#     connection: { driver: sqlite3, database: "path/to/file.db" }
#     from: "users"
#     limit: 10
#     relations: [
#       { entity: "posts", foreignKey: "user_id", type: hasMany }
#     ]
#   }) {
#     count
#     data
#   }
# }
`

// ── Static directories ──────────────────────────────────────────────────────
const STATIC_DIRS = {
  publicDir: join(__dirname, '..', 'public'),
  examplesDir: join(__dirname, '..', 'examples')
}

/** Is /metrics on, and if so where?  `port` is null when it shares the main port. */
function metricsSettings (env = process.env) {
  const enabled = boolOption('MOZG_METRICS', true, env)
  const port = intOption('MOZG_METRICS_PORT', 0, env)
  return { enabled, port: enabled && port > 0 ? port : null }
}

/**
 * The main server.  Not listening yet.
 * @param {{ env?: object }} [options]
 */
function createMozgServer ({ env = process.env } = {}) {
  const schema = createSchema({ typeDefs, resolvers })
  const yoga = createYoga({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: { title: 'Mozg – Database Query Interface', defaultQuery: GRAPHIQL_QUERY },
    landingPage: false,
    // Mozg writes its own access log (telemetry.trackRequest); yoga keeps only its warnings and errors.
    logging: 'warn',
    maskedErrors: { maskError }
  })
  const metrics = metricsSettings(env)

  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    trackRequest(req, res, url.pathname, () => {
      if (url.pathname.startsWith('/graphql')) return yoga(req, res)

      if (url.pathname === '/stream') return handleStreamRequest(req, res)

      // Demand for self-hosted databases, polled by KEDA to scale them to and
      // from zero (see deploy/helm/mozg and src/database/self-hosted.js).
      if (url.pathname.startsWith('/demand') && handleDemandRequest(url.pathname, res, url.searchParams)) return

      // Only when it shares the main port; otherwise the metrics server has it.
      if (url.pathname === '/metrics' && metrics.enabled && metrics.port == null) return serveMetrics(res)

      // Liveness for load balancers and container orchestrators.  Deliberately
      // touches no upstream: a slow third-party API must not get Mozg restarted.
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        return res.end(JSON.stringify({ status: 'ok', version }))
      }

      return serveStatic(url.pathname, res, STATIC_DIRS)
    })
  })
}

/**
 * The /metrics server, or null when metrics are off or share the main port.
 * Serves nothing else, so exposing it exposes nothing else.
 */
function createMetricsServer ({ env = process.env } = {}) {
  const { port } = metricsSettings(env)
  if (!port) return null
  return createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && pathname === '/metrics') return serveMetrics(res)
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found – this port serves /metrics only\n')
  })
}

module.exports = { createMozgServer, createMetricsServer, metricsSettings }
