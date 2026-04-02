'use strict';

/**
 * SQLite3 driver.
 *
 * NOTE: This legacy driver remains because @graphql-mesh/tuql (the intended
 * mesh-based replacement) depends on a critically vulnerable version of
 * sequelize.  It will be removed once a secure mesh handler for SQLite3 is
 * available.  See the deferred issues table in .github/copilot-instructions.md.
 */

const knex = require('knex');

// Connection cache keyed by file path
// TODO: add LRU eviction to prevent unbounded growth in long-running processes
const connectionCache = new Map();

function getKnexInstance(config) {
  const cacheKey = config.database;

  if (!connectionCache.has(cacheKey)) {
    const instance = knex({
      client: 'sqlite3',
      connection: { filename: config.database },
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
      if (!parentIds.length) {
        rows.forEach((r) => { r[resultKey] = type === 'hasMany' ? [] : null; });
        continue;
      }

      let relQ = db(entity).whereIn(foreignKey, parentIds);
      if (select && select.length > 0) {
        const cols = select.includes(foreignKey) ? select : [foreignKey, ...select];
        relQ = relQ.select(cols);
      } else {
        relQ = relQ.select('*');
      }
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
        row[resultKey] = type === 'hasMany'
          ? (grouped[row[localKey]] || [])
          : ((grouped[row[localKey]] || [])[0] ?? null);
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
  const tables = [];

  const tableRows = await db
    .select('name')
    .from('sqlite_master')
    .where('type', 'table')
    .whereRaw("name NOT LIKE 'sqlite_%'");

  for (const tableRow of tableRows) {
    // Escape double-quote chars in the identifier to prevent PRAGMA injection
    const safeName = tableRow.name.replace(/"/g, '""');
    const columns = await db.raw(`PRAGMA table_info("${safeName}")`);
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

  return { tables };
}

module.exports = { executeQuery, introspect };
