'use strict'

/**
 * MySQL / MariaDB driver.
 *
 * Both query execution and schema discovery go through knex and `mysql2`, the
 * same pattern the PostgreSQL and SQLite drivers use.  It replaces the
 * graphql-mesh MySQL handler, which was built on the abandoned `mysql` 2.x
 * client:
 *
 *   - that client cannot speak `caching_sha2_password`, MySQL 8's default
 *     login method, so every connection to a stock MySQL 8 failed with
 *     ER_NOT_SUPPORTED_AUTH_MODE, and MySQL 9 (which removed
 *     `mysql_native_password`) could not be reached at all;
 *   - it typed every `where` field as a string and rendered `LIMIT offset,count`
 *     the wrong way round, which the adapter had to work around;
 *   - relations were fetched one parent row at a time.
 *
 * `mysql2` speaks both login methods, and the shared knex code batches
 * relations with one query per relation and applies per-parent limits in SQL
 * (window functions: MySQL 8.0+, MariaDB 10.2+).
 */

const { executeKnexQuery, createConnectionCache } = require('./knex-query')

const pool = createConnectionCache('mysql')

/** How long to wait for a server to accept a connection (a refused or dropped one is a recognised cold start). */
const CONNECT_TIMEOUT_MS = 10_000

/** Schemes that ask for TLS on the connection. */
const TLS_SCHEMES = new Set(['mysqls', 'ssl', 'tls', 'https'])

/**
 * Rows arrive as driver-specific row objects; hand callers (and the relation
 * code that writes into rows) plain objects.  Only objects are copied: knex
 * also routes `raw` results, an array of [rows, fields], through here.
 */
function plainRows (result) {
  if (!Array.isArray(result)) return result
  return result.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? { ...row } : row))
}

function getKnexInstance (connection) {
  const { host, port, database, user, password, scheme } = connection
  // password is part of the key: two requests naming the same host/user but a
  // different password must not share a pool, or the second caller's wrong
  // password would silently ride on the first caller's authenticated connection.
  const cacheKey = JSON.stringify({ host, port, database, user, password, scheme })

  return pool.getOrCreate(cacheKey, () => ({
    client: 'mysql2',
    connection: {
      host: host || 'localhost',
      port: port || 3306,
      database,
      user,
      password: password || '',
      connectTimeout: CONNECT_TIMEOUT_MS,
      // BIGINT beyond 2^53 arrives as a string instead of silently losing digits.
      supportBigNumbers: true,
      bigNumberStrings: false,
      ...(TLS_SCHEMES.has(String(scheme || '').toLowerCase()) ? { ssl: {} } : {})
    },
    pool: { min: 0, max: 5 },
    postProcessResponse: plainRows
  }))
}

const INTROSPECT_SQL = `
  SELECT table_name                    AS table_name,
         column_name                   AS column_name,
         column_type                   AS data_type,
         (is_nullable = 'YES')         AS nullable,
         column_default                AS column_default,
         (column_key = 'PRI')          AS is_primary_key
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
   ORDER BY table_name, ordinal_position
`

/**
 * Group one row per column into the TableInfo shape the schema expects.
 * Rows must arrive ordered by table, then column position.
 */
function buildTables (rows) {
  const tablesByName = new Map()

  for (const row of rows) {
    if (!tablesByName.has(row.table_name)) tablesByName.set(row.table_name, { name: row.table_name, columns: [] })

    tablesByName.get(row.table_name).columns.push({
      name: row.column_name,
      type: row.data_type || 'unknown',
      nullable: Boolean(row.nullable),
      defaultValue: row.column_default != null ? String(row.column_default) : null,
      isPrimaryKey: Boolean(row.is_primary_key)
    })
  }

  return { tables: [...tablesByName.values()] }
}

async function introspect (connection) {
  const db = getKnexInstance(connection)
  const [rows] = await db.raw(INTROSPECT_SQL)
  return buildTables(rows)
}

async function executeQuery (input) {
  return executeKnexQuery(getKnexInstance, input)
}

async function destroyAll () {
  await pool.destroyAll()
}

module.exports = { executeQuery, introspect, buildTables, getKnexInstance, destroyAll }
