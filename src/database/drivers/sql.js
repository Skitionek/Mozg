'use strict';

const knex = require('knex');

const connectionCache = new Map();

function getKnexInstance(config) {
  const { driver, host, port, database, user } = config;
  const cacheKey = JSON.stringify({ driver, host, port, database, user });

  if (!connectionCache.has(cacheKey)) {
    const instance = knex({
      client: driver,
      connection:
        driver === 'sqlite3'
          ? { filename: config.database }
          : {
              host: config.host || 'localhost',
              port: config.port || undefined,
              database: config.database,
              user: config.user,
              password: config.password,
            },
      useNullAsDefault: true,
      pool: { min: 0, max: 5 },
    });
    connectionCache.set(cacheKey, instance);
  }

  return connectionCache.get(cacheKey);
}

async function executeQuery(input) {
  const { connection, from, select, where, relations, limit, offset, orderBy, orderDirection } = input;
  const db = getKnexInstance(connection);

  let q = db(from);
  q = select && select.length > 0 ? q.select(select) : q.select('*');
  if (where && Object.keys(where).length > 0) q = q.where(where);
  if (limit != null) q = q.limit(limit);
  if (offset != null) q = q.offset(offset);
  if (orderBy) q = q.orderBy(orderBy, orderDirection || 'asc');

  const rows = await q;

  if (relations && relations.length > 0) {
    await loadRelations(db, rows, relations);
  }

  return { data: rows, count: rows.length };
}

async function loadRelations(db, rows, relations) {
  if (!rows.length) return;

  for (const rel of relations) {
    const { entity, localKey = 'id', foreignKey, alias, type = 'hasMany', select, where, relations: nested } = rel;
    const resultKey = alias || entity;

    if (type === 'hasMany' || type === 'hasOne') {
      const parentIds = [...new Set(rows.map((r) => r[localKey]).filter((v) => v != null))];
      if (!parentIds.length) { rows.forEach((r) => { r[resultKey] = type === 'hasMany' ? [] : null; }); continue; }

      let relQ = db(entity).whereIn(foreignKey, parentIds);
      relQ = select && select.length > 0 ? relQ.select(select) : relQ.select('*');
      if (where) relQ = relQ.where(where);
      const relRows = await relQ;

      if (nested && nested.length > 0) await loadRelations(db, relRows, nested);

      const grouped = {};
      for (const r of relRows) {
        const k = r[foreignKey];
        if (!grouped[k]) grouped[k] = [];
        grouped[k].push(r);
      }
      for (const row of rows) {
        row[resultKey] = type === 'hasMany' ? (grouped[row[localKey]] || []) : ((grouped[row[localKey]] || [])[0] ?? null);
      }
    } else if (type === 'belongsTo') {
      const foreignIds = [...new Set(rows.map((r) => r[foreignKey]).filter((v) => v != null))];
      if (!foreignIds.length) { rows.forEach((r) => { r[resultKey] = null; }); continue; }

      let relQ = db(entity).whereIn('id', foreignIds);
      relQ = select && select.length > 0 ? relQ.select(select) : relQ.select('*');
      if (where) relQ = relQ.where(where);
      const relRows = await relQ;

      if (nested && nested.length > 0) await loadRelations(db, relRows, nested);

      const byId = Object.fromEntries(relRows.map((r) => [r.id, r]));
      for (const row of rows) { row[resultKey] = byId[row[foreignKey]] ?? null; }
    }
  }
}

async function introspect(connection) {
  const db = getKnexInstance(connection);
  const { driver } = connection;
  let tables = [];

  if (driver === 'sqlite3') {
    const tableRows = await db.select('name').from('sqlite_master').where('type', 'table').whereRaw("name NOT LIKE 'sqlite_%'");
    for (const tableRow of tableRows) {
      const columns = await db.raw(`PRAGMA table_info("${tableRow.name}")`);
      tables.push({
        name: tableRow.name,
        columns: columns.map((col) => ({
          name: col.name, type: col.type || 'TEXT',
          nullable: col.notnull === 0,
          defaultValue: col.dflt_value != null ? String(col.dflt_value) : null,
          isPrimaryKey: col.pk > 0,
        })),
      });
    }
  } else if (driver === 'postgres') {
    const result = await db.raw(`
      SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
        CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
      FROM information_schema.columns c
      LEFT JOIN information_schema.key_column_usage kcu
        ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name
        AND kcu.constraint_name IN (
          SELECT constraint_name FROM information_schema.table_constraints
          WHERE constraint_type = 'PRIMARY KEY' AND table_schema = 'public'
        )
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position`);
    const map = {};
    for (const row of result.rows) {
      if (!map[row.table_name]) map[row.table_name] = { name: row.table_name, columns: [] };
      map[row.table_name].columns.push({
        name: row.column_name, type: row.data_type,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default != null ? String(row.column_default) : null,
        isPrimaryKey: row.is_primary_key === true,
      });
    }
    tables = Object.values(map);
  } else if (driver === 'mysql') {
    const [rows] = await db.raw(`
      SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type,
        c.IS_NULLABLE AS is_nullable, c.COLUMN_DEFAULT AS column_default,
        CASE WHEN c.COLUMN_KEY = 'PRI' THEN true ELSE false END AS is_primary_key
      FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = DATABASE()
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`);
    const map = {};
    for (const row of rows) {
      if (!map[row.table_name]) map[row.table_name] = { name: row.table_name, columns: [] };
      map[row.table_name].columns.push({
        name: row.column_name, type: row.data_type,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default != null ? String(row.column_default) : null,
        isPrimaryKey: Boolean(row.is_primary_key),
      });
    }
    tables = Object.values(map);
  }

  return { tables };
}

module.exports = { executeQuery, introspect };
