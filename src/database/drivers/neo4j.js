'use strict';

const neo4j = require('neo4j-driver');

// Driver cache keyed by URI+user
const driverCache = new Map();

function getDriver(config) {
  const scheme = config.scheme || 'bolt';
  const host = config.host || 'localhost';
  const port = config.port || 7687;
  const uri = `${scheme}://${host}:${port}`;
  const key = `${uri}|${config.user}`;

  if (!driverCache.has(key)) {
    const auth =
      config.user
        ? neo4j.auth.basic(config.user, config.password || '')
        : neo4j.auth.none();
    driverCache.set(key, neo4j.driver(uri, auth));
  }

  return driverCache.get(key);
}

/** Convert a Neo4j record value to a plain JS value. */
function toJS(value) {
  if (value === null || value === undefined) return null;
  if (neo4j.isInt(value)) return value.toNumber();
  if (value instanceof neo4j.types.Node) return { _id: value.identity.toNumber(), _labels: value.labels, ...toJSObject(value.properties) };
  if (value instanceof neo4j.types.Relationship) return { _id: value.identity.toNumber(), _type: value.type, ...toJSObject(value.properties) };
  if (Array.isArray(value)) return value.map(toJS);
  if (typeof value === 'object') return toJSObject(value);
  return value;
}

function toJSObject(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) result[k] = toJS(v);
  return result;
}

async function executeQuery(input) {
  const { connection, from, select, where, relations, limit, offset, orderBy, orderDirection } = input;
  const driver = getDriver(connection);
  const session = driver.session({ database: connection.database || 'neo4j' });

  try {
    const params = {};
    const conditions = [];

    if (where) {
      Object.entries(where).forEach(([k, v], i) => {
        params[`p${i}`] = v;
        conditions.push(`n.${k} = $p${i}`);
      });
    }

    let cypher = `MATCH (n:\`${from}\`)`;
    if (conditions.length > 0) cypher += ` WHERE ${conditions.join(' AND ')}`;

    // Inline relation traversal
    const returnParts = ['n'];
    if (relations && relations.length > 0) {
      relations.forEach((rel, i) => {
        const alias = rel.alias || rel.entity;
        const relType = rel.foreignKey ? `:\`${rel.foreignKey}\`` : '';
        cypher += ` OPTIONAL MATCH (n)${relType ? `-[${relType}]` : '-[]'}->(rel${i}:\`${rel.entity}\`)`;
        returnParts.push(`collect(distinct rel${i}) AS ${alias}`);
      });
    }

    cypher += ` RETURN ${returnParts.join(', ')}`;
    if (orderBy) cypher += ` ORDER BY n.${orderBy} ${(orderDirection || 'asc').toUpperCase()}`;
    if (offset != null) cypher += ` SKIP ${offset}`;
    if (limit != null) cypher += ` LIMIT ${limit}`;

    const result = await session.run(cypher, params);

    const rows = result.records.map((record) => {
      const node = toJS(record.get('n'));
      if (select && select.length > 0) {
        const filtered = {};
        for (const col of select) filtered[col] = node[col];
        Object.assign(filtered, { _id: node._id, _labels: node._labels });
        return Object.assign(filtered, extractRelations(record, relations));
      }
      return Object.assign(node, extractRelations(record, relations));
    });

    return { data: rows, count: rows.length };
  } finally {
    await session.close();
  }
}

function extractRelations(record, relations) {
  if (!relations || !relations.length) return {};
  const extra = {};
  relations.forEach((rel) => {
    const key = rel.alias || rel.entity;
    try { extra[key] = toJS(record.get(key)); } catch { extra[key] = null; }
  });
  return extra;
}

async function introspect(connection) {
  const driver = getDriver(connection);
  const session = driver.session({ database: connection.database || 'neo4j' });

  try {
    const result = await session.run(
      'CALL db.schema.nodeTypeProperties() YIELD nodeType, propertyName, propertyTypes, mandatory'
    );

    const tableMap = {};
    for (const record of result.records) {
      // nodeType comes back as ":`LabelName`"
      const raw = record.get('nodeType');
      const label = raw.replace(/^:`?/, '').replace(/`?$/, '');
      if (!tableMap[label]) tableMap[label] = { name: label, columns: [] };
      const propName = record.get('propertyName');
      const propTypes = record.get('propertyTypes') || [];
      if (propName) {
        tableMap[label].columns.push({
          name: propName,
          type: propTypes.join('|') || 'Any',
          nullable: !record.get('mandatory'),
          defaultValue: null,
          isPrimaryKey: propName === 'id',
        });
      }
    }

    return { tables: Object.values(tableMap) };
  } finally {
    await session.close();
  }
}

module.exports = { executeQuery, introspect };
