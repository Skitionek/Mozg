'use strict';

const { Database, aql } = require('arangojs');

// Connection cache
const dbCache = new Map();

function getDatabase(config) {
  const scheme = config.scheme || 'http';
  const host = config.host || 'localhost';
  const port = config.port || 8529;
  const key = `${scheme}://${host}:${port}|${config.database}|${config.user}`;

  if (!dbCache.has(key)) {
    dbCache.set(
      key,
      new Database({
        url: `${scheme}://${host}:${port}`,
        databaseName: config.database,
        auth: { username: config.user || 'root', password: config.password || '' },
      })
    );
  }
  return dbCache.get(key);
}

async function executeQuery(input) {
  const { connection, from, select, where, relations, limit, offset, orderBy, orderDirection } = input;
  const db = getDatabase(connection);

  const bindVars = {};
  let aqlStr = `FOR doc IN \`${from}\``;

  if (where && Object.keys(where).length > 0) {
    const filters = Object.entries(where).map(([k, v], i) => {
      bindVars[`val${i}`] = v;
      return `doc.${k} == @val${i}`;
    });
    aqlStr += ` FILTER ${filters.join(' AND ')}`;
  }

  if (orderBy) aqlStr += ` SORT doc.${orderBy} ${(orderDirection || 'asc').toUpperCase()}`;

  if (offset != null && limit != null) aqlStr += ` LIMIT ${offset}, ${limit}`;
  else if (offset != null) aqlStr += ` LIMIT ${offset}, 10000`;
  else if (limit != null) aqlStr += ` LIMIT ${limit}`;

  if (select && select.length > 0) {
    const fields = select.map((s) => `${s}: doc.${s}`).join(', ');
    aqlStr += ` RETURN { ${fields} }`;
  } else {
    aqlStr += ' RETURN doc';
  }

  const cursor = await db.query(aqlStr, bindVars);
  const rows = await cursor.all();

  // Load document-style relations (foreign key on the child side)
  if (relations && relations.length > 0) {
    await loadRelations(db, rows, relations);
  }

  return { data: rows, count: rows.length };
}

async function loadRelations(db, rows, relations) {
  if (!rows.length) return;

  for (const rel of relations) {
    const { entity, localKey = '_key', foreignKey, alias, type = 'hasMany', select, where, relations: nested } = rel;
    const resultKey = alias || entity;

    if (type === 'hasMany' || type === 'hasOne') {
      const parentIds = [...new Set(rows.map((r) => r[localKey]).filter((v) => v != null))];
      if (!parentIds.length) { rows.forEach((r) => { r[resultKey] = type === 'hasMany' ? [] : null; }); continue; }

      const bindVars = { parentIds };
      const filters = where ? Object.entries(where).map(([k, v], i) => { bindVars[`wv${i}`] = v; return `doc.${k} == @wv${i}`; }) : [];
      const selectClause = select && select.length > 0 ? `{ ${select.map((s) => `${s}: doc.${s}`).join(', ')} }` : 'doc';
      const aqlStr = `FOR doc IN \`${entity}\` FILTER doc.${foreignKey} IN @parentIds${filters.length ? ' AND ' + filters.join(' AND ') : ''} RETURN ${selectClause}`;

      const cursor = await db.query(aqlStr, bindVars);
      const relRows = await cursor.all();
      if (nested && nested.length > 0) await loadRelations(db, relRows, nested);

      const grouped = {};
      for (const r of relRows) { const k = r[foreignKey]; if (!grouped[k]) grouped[k] = []; grouped[k].push(r); }
      for (const row of rows) {
        row[resultKey] = type === 'hasMany' ? (grouped[row[localKey]] || []) : ((grouped[row[localKey]] || [])[0] ?? null);
      }
    } else if (type === 'belongsTo') {
      const foreignIds = [...new Set(rows.map((r) => r[foreignKey]).filter((v) => v != null))];
      if (!foreignIds.length) { rows.forEach((r) => { r[resultKey] = null; }); continue; }

      const aqlStr = `FOR doc IN \`${entity}\` FILTER doc._key IN @ids RETURN doc`;
      const cursor = await db.query(aqlStr, { ids: foreignIds });
      const relRows = await cursor.all();
      if (nested && nested.length > 0) await loadRelations(db, relRows, nested);

      const byKey = Object.fromEntries(relRows.map((r) => [r._key, r]));
      for (const row of rows) { row[resultKey] = byKey[row[foreignKey]] ?? null; }
    }
  }
}

async function introspect(connection) {
  const db = getDatabase(connection);
  const collections = await db.listCollections();

  const tables = await Promise.all(
    collections
      .filter((c) => c.type === 2) // 2 = document, 3 = edge
      .map(async (col) => {
        // Sample one document to infer properties
        const cursor = await db.query(`FOR doc IN \`${col.name}\` LIMIT 1 RETURN doc`);
        const docs = await cursor.all();
        const sample = docs[0] || {};
        const columns = Object.entries(sample).map(([name, val]) => ({
          name,
          type: Array.isArray(val) ? 'Array' : typeof val,
          nullable: true,
          defaultValue: null,
          isPrimaryKey: name === '_key' || name === '_id',
        }));
        return { name: col.name, columns };
      })
  );

  return { tables };
}

module.exports = { executeQuery, introspect };
