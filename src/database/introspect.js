'use strict';

const { getConnection } = require('./connector');

/**
 * Introspect the schema of a connected database.
 * Returns table and column metadata for each supported driver.
 */
async function introspectDatabase(connection) {
  const db = getConnection(connection);
  const { driver } = connection;
  let tables = [];

  if (driver === 'sqlite3') {
    const tableRows = await db
      .select('name')
      .from('sqlite_master')
      .where('type', 'table')
      .whereRaw("name NOT LIKE 'sqlite_%'");

    for (const tableRow of tableRows) {
      const columns = await db.raw(`PRAGMA table_info("${tableRow.name}")`);
      tables.push({
        name: tableRow.name,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type || 'TEXT',
          nullable: col.notnull === 0,
          defaultValue: col.dflt_value != null ? String(col.dflt_value) : null,
          isPrimaryKey: col.pk > 0,
        })),
      });
    }
  } else if (driver === 'postgres') {
    const result = await db.raw(`
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
      FROM information_schema.columns c
      LEFT JOIN information_schema.key_column_usage kcu
        ON c.table_name = kcu.table_name
        AND c.column_name = kcu.column_name
        AND kcu.constraint_name IN (
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE constraint_type = 'PRIMARY KEY'
            AND table_schema = 'public'
        )
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position
    `);

    const tableMap = {};
    for (const row of result.rows) {
      if (!tableMap[row.table_name]) {
        tableMap[row.table_name] = { name: row.table_name, columns: [] };
      }
      tableMap[row.table_name].columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default != null ? String(row.column_default) : null,
        isPrimaryKey: row.is_primary_key === true,
      });
    }
    tables = Object.values(tableMap);
  } else if (driver === 'mysql') {
    const result = await db.raw(`
      SELECT
        c.TABLE_NAME   AS table_name,
        c.COLUMN_NAME  AS column_name,
        c.DATA_TYPE    AS data_type,
        c.IS_NULLABLE  AS is_nullable,
        c.COLUMN_DEFAULT AS column_default,
        CASE WHEN c.COLUMN_KEY = 'PRI' THEN true ELSE false END AS is_primary_key
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE()
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
    `);

    const rows = result[0];
    const tableMap = {};
    for (const row of rows) {
      if (!tableMap[row.table_name]) {
        tableMap[row.table_name] = { name: row.table_name, columns: [] };
      }
      tableMap[row.table_name].columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default != null ? String(row.column_default) : null,
        isPrimaryKey: Boolean(row.is_primary_key),
      });
    }
    tables = Object.values(tableMap);
  }

  return { tables };
}

module.exports = { introspectDatabase };
