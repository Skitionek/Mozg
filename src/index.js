'use strict'

const { createServer } = require('node:http')
const { join } = require('node:path')
const { createYoga, createSchema } = require('graphql-yoga')
const { typeDefs, resolvers } = require('./schema')
const { handleStreamRequest } = require('./stream')
const { serveStatic } = require('./static')
const { maskError } = require('./errors')

const PORT = process.env.PORT || 4000

const schema = createSchema({ typeDefs, resolvers })

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  graphiql: {
    title: 'Mozg – Database Query Interface',
    defaultQuery: `# Welcome to Mozg – query any database from a single GraphQL endpoint.
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
  },
  landingPage: false,
  maskedErrors: { maskError }
})

// ── Static directories ──────────────────────────────────────────────────────
const STATIC_DIRS = {
  publicDir: join(__dirname, '..', 'public'),
  examplesDir: join(__dirname, '..', 'examples')
}

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname.startsWith('/graphql')) {
    return yoga(req, res)
  }

  if (url.pathname === '/stream') {
    return handleStreamRequest(req, res)
  }

  // Liveness for load balancers and container orchestrators.  Deliberately
  // touches no upstream: a slow third-party API must not get Mozg restarted.
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify({ status: 'ok', version: require('../package.json').version }))
  }

  serveStatic(url.pathname, res, STATIC_DIRS)
})

server.listen(PORT, () => {
  console.log('Mozg server is running')
  console.log(`  Web interface  →  http://localhost:${PORT}/`)
  console.log(`  GraphQL API    →  http://localhost:${PORT}/graphql`)
  console.log(`  Streaming API  →  http://localhost:${PORT}/stream`)
  console.log(`  Health check   →  http://localhost:${PORT}/healthz`)
})

// Finish in-flight queries before exiting when the platform asks us to stop;
// federated queries can legitimately take a while ("slow by design"), so give
// them a generous grace period before forcing the issue.
const SHUTDOWN_GRACE_MS = Number(process.env.MOZG_SHUTDOWN_GRACE_MS) || 30_000
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    console.log(`${signal} received — draining connections`)
    server.close(() => process.exit(0))
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref()
  })
}
