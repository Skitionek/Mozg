'use strict'

const { Database } = require('arangojs')

/**
 * ArangoDB driver.
 *
 * Every name a caller supplies — collection, attribute, sort key — reaches
 * AQL as a bind parameter (`@@collection`, `doc[@attr]`), never as query
 * text.  Interpolating them let a caller append arbitrary AQL, including
 * REMOVE/UPDATE, which matters most when Mozg holds the credentials itself
 * (a self-hosted database behind a deployment).
 */

// Connection cache, keyed by everything the client is built from — the
// password included, so a wrong password never rides on a client another
// caller already authenticated.  The key stays in this process's memory,
// beside the client that holds the same password already.
const dbCache = new Map()

function getDatabase (config) {
  const scheme = config.scheme || 'http'
  const host = config.host || 'localhost'
  const port = config.port || 8529
  const key = JSON.stringify([scheme, host, port, config.database, config.user, config.password || ''])

  if (!dbCache.has(key)) {
    dbCache.set(
      key,
      new Database({
        url: `${scheme}://${host}:${port}`,
        databaseName: config.database,
        auth: { username: config.user || 'root', password: config.password || '' }
      })
    )
  }
  return dbCache.get(key)
}

/**
 * Accumulates bind parameters for one AQL query.  `attr(name)` and
 * `value(v)` return the placeholder to splice into the query text.
 */
function binder () {
  const vars = {}
  let n = 0
  return {
    vars,
    collection (name) {
      if (typeof name !== 'string' || name === '') throw new Error('A collection name is required')
      vars['@coll' + n] = name
      return `@@coll${n++}`
    },
    attr (name) {
      if (typeof name !== 'string' || name === '') throw new Error('An attribute name is required')
      vars['attr' + n] = name
      return `@attr${n++}`
    },
    value (v) {
      vars['val' + n] = v
      return `@val${n++}`
    }
  }
}

/** `{ a: doc[@x], b: doc[@y] }` for a select list, else the whole document. */
function projection (b, select) {
  if (!select || select.length === 0) return 'doc'
  return `{ ${select.map((field) => `[${b.value(field)}]: doc[${b.attr(field)}]`).join(', ')} }`
}

function filters (b, where) {
  return Object.entries(where || {}).map(([k, v]) => `doc[${b.attr(k)}] == ${b.value(v)}`)
}

async function executeQuery (input) {
  const { connection, from, select, where, relations, limit, offset, orderBy, orderDirection } = input
  const db = getDatabase(connection)
  const b = binder()

  let aql = `FOR doc IN ${b.collection(from)}`
  const conds = filters(b, where)
  if (conds.length) aql += ` FILTER ${conds.join(' AND ')}`
  if (orderBy) aql += ` SORT doc[${b.attr(orderBy)}] ${(orderDirection || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`
  if (limit != null || offset) {
    // AQL has no offset without a count; a count this large means "the rest".
    aql += ` LIMIT ${b.value(offset || 0)}, ${b.value(limit != null ? limit : Number.MAX_SAFE_INTEGER)}`
  }
  aql += ` RETURN ${projection(b, select)}`

  const cursor = await db.query(aql, b.vars)
  const rows = await cursor.all()

  if (relations && relations.length > 0) {
    await loadRelations(db, rows, relations)
  }

  return { data: rows, count: rows.length }
}

async function loadRelations (db, rows, relations) {
  if (!rows.length) return

  for (const rel of relations) {
    // A relation naming another catalog entry has no collection here to join
    // against; the connector resolves it against that entry's connection.
    if (rel.catalog) {
      const { resolveCrossCatalogRelation } = require('../relations')
      const connector = require('../connector')
      await resolveCrossCatalogRelation(connector.executeQuery, rows, rel)
      continue
    }

    const { entity, localKey = '_key', foreignKey, ownerKey = '_key', alias, type = 'hasMany', select, where, relations: nested } = rel
    const resultKey = alias || entity

    try {
      const isBelongsTo = type === 'belongsTo'
      const sourceKey = isBelongsTo ? foreignKey : localKey
      const targetKey = isBelongsTo ? ownerKey : foreignKey
      const ids = [...new Set(rows.map((r) => r[sourceKey]).filter((v) => v != null))]
      if (!ids.length) {
        rows.forEach((r) => { r[resultKey] = type === 'hasMany' ? [] : null })
        continue
      }

      const b = binder()
      const target = b.attr(targetKey)
      const conds = [`doc[${target}] IN ${b.value(ids)}`, ...filters(b, where)]
      // The join key must come back even when the caller's select leaves it out.
      const fields = select && select.length > 0 && !select.includes(targetKey) ? [targetKey, ...select] : select
      const aql = `FOR doc IN ${b.collection(entity)} FILTER ${conds.join(' AND ')} RETURN ${projection(b, fields)}`
      const relRows = await (await db.query(aql, b.vars)).all()
      if (nested && nested.length > 0) await loadRelations(db, relRows, nested)

      const grouped = new Map()
      for (const r of relRows) {
        const k = String(r[targetKey])
        if (!grouped.has(k)) grouped.set(k, [])
        grouped.get(k).push(r)
      }
      for (const row of rows) {
        const matches = grouped.get(String(row[sourceKey])) || []
        row[resultKey] = type === 'hasMany' ? matches : (matches[0] ?? null)
      }
    } catch (err) {
      // Partial result: keep the parent rows, report the failed relation in place.
      const errObj = { error: `relation fetch failed for ${entity}: ${err.message}` }
      rows.forEach((r) => { r[resultKey] = errObj })
    }
  }
}

async function introspect (connection) {
  const db = getDatabase(connection)
  const collections = await db.listCollections()

  const tables = await Promise.all(
    collections
      .filter((c) => c.type === 2) // 2 = document, 3 = edge
      .map(async (col) => {
        // Sample one document to infer properties
        const cursor = await db.query('FOR doc IN @@coll LIMIT 1 RETURN doc', { '@coll': col.name })
        const docs = await cursor.all()
        const sample = docs[0] || {}
        const columns = Object.entries(sample).map(([name, val]) => ({
          name,
          type: Array.isArray(val) ? 'Array' : typeof val,
          nullable: true,
          defaultValue: null,
          isPrimaryKey: name === '_key' || name === '_id'
        }))
        return { name: col.name, columns }
      })
  )

  return { tables }
}

/** Close every cached client's connections. */
async function destroyAll () {
  for (const db of dbCache.values()) {
    if (typeof db.close === 'function') db.close()
  }
  dbCache.clear()
}

module.exports = { executeQuery, introspect, destroyAll }
