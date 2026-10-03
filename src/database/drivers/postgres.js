'use strict'

/**
 * PostgreSQL driver.
 *
 * Both query execution and schema discovery go through knex directly, the
 * same pattern sqlite3.js uses, rather than through the Postgraphile mesh
 * handler. Postgraphile introspects via pg_extension, which read-only roles
 * on public databases are not granted — RNAcentral's documented `reader`
 * account fails with "permission denied for table pg_extension" — and its
 * GraphQL field names (pluralised, camelCased) do not round-trip back into
 * the plain table names a `query` call needs for `from`, so introspecting
 * through one path and querying through another left the two disagreeing
 * about what a table was called.
 *
 * Discovery reads pg_catalog rather than information_schema.  The
 * information_schema views are filtered to objects the role holds a recorded
 * privilege on, which on RNAcentral hides all 353 tables of the `rnacen`
 * schema; pg_catalog is readable by any role that can connect, and
 * has_table_privilege narrows the result to tables the caller can actually
 * select from.
 */

const knex = require('knex')
const { executeKnexQuery } = require('./knex-query')

const connectionCache = new Map()

function getKnexInstance (connection) {
  const { host, port, database, user, password } = connection
  const cacheKey = JSON.stringify({ host, port, database, user })

  if (!connectionCache.has(cacheKey)) {
    const instance = knex({
      client: 'pg',
      connection: {
        host: host || 'localhost',
        port: port || 5432,
        database,
        user,
        password: password || ''
      },
      pool: { min: 0, max: 5 }
    })
    connectionCache.set(cacheKey, instance)
  }

  return connectionCache.get(cacheKey)
}

/** Qualify a table name with its schema unless it lives in `public`. */
function qualify (schemaName, tableName) {
  return schemaName === 'public' ? tableName : `${schemaName}.${tableName}`
}

const INTROSPECT_SQL = `
  SELECT n.nspname                                AS table_schema,
         c.relname                                AS table_name,
         a.attname                                AS column_name,
         format_type(a.atttypid, a.atttypmod)     AS data_type,
         NOT a.attnotnull                         AS nullable,
         pg_get_expr(d.adbin, d.adrelid)          AS column_default,
         COALESCE(i.indisprimary, false)          AS is_primary_key
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
                        AND a.attnum = ANY (i.indkey)
   WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
     AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     AND has_table_privilege(c.oid, 'SELECT')
   ORDER BY n.nspname, c.relname, a.attnum
`

/**
 * Group one row per column into the TableInfo shape the schema expects.
 * Rows must arrive ordered by schema, table, then column position.
 */
function buildTables (rows) {
  const tablesByName = new Map()

  for (const row of rows) {
    const name = qualify(row.table_schema, row.table_name)
    if (!tablesByName.has(name)) tablesByName.set(name, { name, columns: [] })

    tablesByName.get(name).columns.push({
      name: row.column_name,
      type: row.data_type || 'unknown',
      nullable: row.nullable,
      defaultValue: row.column_default != null ? String(row.column_default) : null,
      isPrimaryKey: row.is_primary_key
    })
  }

  return { tables: [...tablesByName.values()] }
}

async function introspect (connection) {
  const db = getKnexInstance(connection)
  const result = await db.raw(INTROSPECT_SQL)

  return buildTables(result.rows)
}

async function destroyAll () {
  for (const instance of connectionCache.values()) {
    await instance.destroy()
  }
  connectionCache.clear()
}

async function executeQuery (input) {
  return executeKnexQuery(getKnexInstance, input)
}

module.exports = {
  executeQuery,
  introspect,
  buildTables,
  destroyAll
}
