'use strict'

/**
 * SQLite3 driver.
 *
 * NOTE: This legacy driver remains because @graphql-mesh/tuql (the intended
 * mesh-based replacement) depends on a critically vulnerable version of
 * sequelize.  It will be removed once a secure mesh handler for SQLite3 is
 * available.  See the deferred issues table in .github/copilot-instructions.md.
 */

const { existsSync } = require('node:fs')
const { executeKnexQuery, createConnectionCache } = require('./knex-query')

// Connection cache keyed by file path.
// TODO: add LRU eviction to prevent unbounded growth in long-running processes
const pool = createConnectionCache()

// SQLite creates a database when asked to open a path that has none.  Here the
// path arrives as untrusted GraphQL input, so opening it unchecked lets any
// caller write an empty file anywhere this process can reach — and makes a typo
// look like an empty database rather than a mistake.
function assertDatabaseExists (filename) {
  if (filename === ':memory:') return

  if (!filename) {
    throw new Error('SQLite database not found: no database path was given')
  }

  if (!existsSync(filename)) {
    throw new Error(`SQLite database not found: ${filename}`)
  }
}

function getKnexInstance (config) {
  const cacheKey = config.database

  assertDatabaseExists(cacheKey)

  return pool.getOrCreate(cacheKey, () => ({
    client: 'sqlite3',
    connection: { filename: config.database },
    useNullAsDefault: true,
    pool: { min: 0, max: 5 }
  }))
}

async function executeQuery (input) {
  return executeKnexQuery(getKnexInstance, input)
}

async function introspect (connection) {
  const db = getKnexInstance(connection)
  const tables = []

  const tableRows = await db
    .select('name')
    .from('sqlite_master')
    .where('type', 'table')
    .whereRaw("name NOT LIKE 'sqlite_%'")

  for (const tableRow of tableRows) {
    // Escape double-quote chars in the identifier to prevent PRAGMA injection
    const safeName = tableRow.name.replace(/"/g, '""')
    const columns = await db.raw(`PRAGMA table_info("${safeName}")`)
    tables.push({
      name: tableRow.name,
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type || 'TEXT',
        nullable: col.notnull === 0,
        defaultValue: col.dflt_value != null ? String(col.dflt_value) : null,
        isPrimaryKey: col.pk > 0
      }))
    })
  }

  return { tables }
}

async function destroyAll () {
  await pool.destroyAll()
}

module.exports = { executeQuery, introspect, destroyAll }
