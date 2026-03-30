'use strict';

const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createYoga, createSchema } = require('graphql-yoga');
const { typeDefs, resolvers } = require('./schema');

const PORT = process.env.PORT || 4000;

const schema = createSchema({ typeDefs, resolvers });

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
`,
  },
  landingPage: false,
});

// ── Static directories ──────────────────────────────────────────────────────
const PUBLIC_DIR   = join(__dirname, '..', 'public');
const EXAMPLES_DIR = join(__dirname, '..', 'examples');

const MIME_MAP = {
  html: 'text/html',
  js:   'text/javascript',
  css:  'text/css',
  json: 'application/json',
  ttl:  'text/turtle',
  owl:  'application/rdf+xml',
  rdf:  'application/rdf+xml',
  txt:  'text/plain',
};

function serveFile(filePath, res) {
  try {
    const content = readFileSync(filePath);
    const ext = filePath.split('.').pop().toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function serveStatic(pathname, res) {
  const safe = pathname.replace(/\.\./g, '').replace(/\/+/g, '/');

  // Serve examples/ directory (queries.json, .ttl, .owl, …)
  if (safe.startsWith('/examples/')) {
    const relPath = safe.slice('/examples/'.length);
    return serveFile(join(EXAMPLES_DIR, relPath), res);
  }

  serveFile(join(PUBLIC_DIR, safe === '/' ? 'index.html' : safe), res);
}

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);

  if (url.pathname.startsWith('/graphql')) {
    return yoga(req, res);
  }

  serveStatic(url.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Mozg server is running`);
  console.log(`  Web interface  →  http://localhost:${PORT}/`);
  console.log(`  GraphQL API    →  http://localhost:${PORT}/graphql`);
});
