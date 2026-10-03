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

  serveStatic(url.pathname, res, STATIC_DIRS)
})

server.listen(PORT, () => {
  console.log('Mozg server is running')
  console.log(`  Web interface  →  http://localhost:${PORT}/`)
  console.log(`  GraphQL API    →  http://localhost:${PORT}/graphql`)
  console.log(`  Streaming API  →  http://localhost:${PORT}/stream`)
})
