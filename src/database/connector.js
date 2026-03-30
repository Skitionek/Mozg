'use strict';

const knex = require('knex');

// Cache open connections keyed by a stable connection fingerprint (excludes password).
const connectionCache = new Map();

/**
 * Build or reuse a knex instance for the given connection config.
 */
function getConnection(config) {
  const { driver, host, port, database, user } = config;
  // Key omits password intentionally – password is used during connect but not cached.
  const cacheKey = JSON.stringify({ driver, host, port, database, user });

  if (!connectionCache.has(cacheKey)) {
    const client = driver === 'sqlite3' ? 'sqlite3' : driver;
    const instance = knex({
      client,
      connection: buildConnectionSpec(config),
      useNullAsDefault: true,
      pool: { min: 0, max: 5 },
    });
    connectionCache.set(cacheKey, instance);
  }

  return connectionCache.get(cacheKey);
}

function buildConnectionSpec(config) {
  if (config.driver === 'sqlite3') {
    return { filename: config.database };
  }
  return {
    host: config.host || 'localhost',
    port: config.port || undefined,
    database: config.database,
    user: config.user,
    password: config.password,
  };
}

/**
 * Execute a query against a database, optionally loading related entities.
 *
 * @param {object} input - QueryInput from the GraphQL schema.
 * @returns {{ data: any[], count: number }}
 */
async function executeQuery(input) {
  const { connection, from, select, where, relations, limit, offset, orderBy, orderDirection } = input;
  const db = getConnection(connection);

  let q = db(from);

  if (select && select.length > 0) {
    q = q.select(select);
  } else {
    q = q.select('*');
  }

  if (where && Object.keys(where).length > 0) {
    q = q.where(where);
  }

  if (limit != null) {
    q = q.limit(limit);
  }

  if (offset != null) {
    q = q.offset(offset);
  }

  if (orderBy) {
    q = q.orderBy(orderBy, orderDirection || 'asc');
  }

  const rows = await q;

  if (relations && relations.length > 0) {
    await loadRelations(db, rows, relations);
  }

  return { data: rows, count: rows.length };
}

/**
 * Recursively load related entities and attach them to the parent rows.
 *
 * @param {import('knex').Knex} db
 * @param {any[]} rows   - Parent rows (mutated in-place with relation data).
 * @param {object[]} relations - RelationInput array.
 */
async function loadRelations(db, rows, relations) {
  if (!rows.length) return;

  for (const rel of relations) {
    const {
      entity,
      localKey = 'id',
      foreignKey,
      alias,
      type = 'hasMany',
      select,
      where,
      relations: nestedRelations,
    } = rel;

    const resultKey = alias || entity;

    if (type === 'hasMany' || type === 'hasOne') {
      // Collect distinct parent IDs
      const parentIds = [...new Set(rows.map((r) => r[localKey]).filter((v) => v != null))];
      if (parentIds.length === 0) {
        rows.forEach((r) => {
          r[resultKey] = type === 'hasMany' ? [] : null;
        });
        continue;
      }

      let relQ = db(entity).whereIn(foreignKey, parentIds);
      if (select && select.length > 0) relQ = relQ.select(select);
      else relQ = relQ.select('*');
      if (where) relQ = relQ.where(where);

      const relatedRows = await relQ;

      if (nestedRelations && nestedRelations.length > 0) {
        await loadRelations(db, relatedRows, nestedRelations);
      }

      // Group related rows by foreign key value
      const grouped = {};
      for (const row of relatedRows) {
        const fkVal = row[foreignKey];
        if (!grouped[fkVal]) grouped[fkVal] = [];
        grouped[fkVal].push(row);
      }

      for (const row of rows) {
        const parentId = row[localKey];
        if (type === 'hasMany') {
          row[resultKey] = grouped[parentId] || [];
        } else {
          row[resultKey] = (grouped[parentId] || [])[0] ?? null;
        }
      }
    } else if (type === 'belongsTo') {
      // foreignKey is on the parent row; related entity is joined by its 'id'
      const foreignIds = [
        ...new Set(rows.map((r) => r[foreignKey]).filter((v) => v != null)),
      ];
      if (foreignIds.length === 0) {
        rows.forEach((r) => { r[resultKey] = null; });
        continue;
      }

      let relQ = db(entity).whereIn('id', foreignIds);
      if (select && select.length > 0) relQ = relQ.select(select);
      else relQ = relQ.select('*');
      if (where) relQ = relQ.where(where);

      const relatedRows = await relQ;

      if (nestedRelations && nestedRelations.length > 0) {
        await loadRelations(db, relatedRows, nestedRelations);
      }

      const byId = {};
      for (const row of relatedRows) {
        byId[row.id] = row;
      }

      for (const row of rows) {
        row[resultKey] = byId[row[foreignKey]] ?? null;
      }
    }
  }
}

module.exports = { getConnection, executeQuery };
