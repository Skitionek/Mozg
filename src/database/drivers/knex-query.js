'use strict'

const knex = require('knex')
const { LruCache } = require('../../cache')
const { intOption, OPTIONS } = require('../../config')

/**
 * Generic knex-backed query execution, relation loading, and connection
 * pooling.
 *
 * Shared by every driver that talks to a SQL database through knex (sqlite3,
 * postgres, mysql) — only the knex config each one builds, and how it
 * introspects, differ between them, so everything else lives once here instead
 * of once per driver.
 */

/** Every connection cache made here, so the metrics can report them. */
const connectionCaches = new Map()

/**
 * A bounded cache of lazily-created knex instances, keyed however the caller
 * likes (a file path for sqlite3, a JSON-encoded connection for postgres).
 *
 * The key is caller input, so an unbounded cache is a leak a caller can drive
 * by varying a port or a database name: each entry holds a connection pool.
 * Past MOZG_CONNECTION_CACHE_MAX entries the least recently used instance is
 * destroyed, and an instance idle for MOZG_CONNECTION_IDLE_MS is destroyed too.
 *
 * @param {string} [name]  label for the metrics (the driver's name)
 */
function createConnectionCache (name = 'knex') {
  const cache = new LruCache({
    max: intOption('MOZG_CONNECTION_CACHE_MAX', OPTIONS.MOZG_CONNECTION_CACHE_MAX) || 0,
    ttlMs: intOption('MOZG_CONNECTION_IDLE_MS', OPTIONS.MOZG_CONNECTION_IDLE_MS),
    sliding: true,
    // destroy() waits for connections that are checked out, so a query still
    // running on an evicted instance finishes before its pool closes.
    onEvict: (instance) => instance.destroy()
  })
  connectionCaches.set(name, cache)

  /** Return the cached instance for `cacheKey`, building one on first use. */
  function getOrCreate (cacheKey, buildKnexConfig) {
    cache.prune()
    let instance = cache.get(cacheKey)
    if (!instance) {
      instance = knex(buildKnexConfig())
      cache.set(cacheKey, instance)
    }
    return instance
  }

  async function destroyAll () {
    // drain() skips onEvict: each instance is destroyed, and awaited, once.
    for (const instance of cache.drain()) await instance.destroy()
  }

  return { getOrCreate, destroyAll, cache }
}

// Column name for the per-parent row number; never returned to callers.
const ROW_NUMBER = '__mozg_rn'

async function executeKnexQuery (getKnexInstance, input) {
  const { connection, from, select, where, relations, limit, offset, orderBy, orderDirection } = input
  const db = getKnexInstance(connection)

  let q = db(from)
  q = select && select.length > 0 ? q.select(select) : q.select('*')
  if (where && Object.keys(where).length > 0) q = q.where(where)
  if (limit != null) q = q.limit(limit)
  if (offset != null) q = q.offset(offset)
  if (orderBy) q = q.orderBy(orderBy, orderDirection || 'asc')

  const rows = await q

  if (relations && relations.length > 0) {
    await loadKnexRelations(db, rows, relations)
  }

  return { data: rows, count: rows.length }
}

async function loadKnexRelations (db, rows, relations) {
  if (!rows.length) return

  for (const rel of relations) {
    // A relation naming another catalog entry — at any nesting depth — has no
    // local table to join against; hand it to the connector, which knows how
    // to resolve it against the connection that catalog entry actually names.
    // Required lazily: this file is loaded by the drivers connector.js itself
    // dispatches to, and the cost is only paid when such a relation appears.
    if (rel.catalog) {
      const { resolveCrossCatalogRelation } = require('../relations')
      const connector = require('../connector')
      await resolveCrossCatalogRelation(connector.executeQuery, rows, rel)
      continue
    }

    const { entity, localKey = 'id', foreignKey, ownerKey = 'id', alias, type = 'hasMany', select, where, limit, relations: nested } = rel
    const resultKey = alias || entity

    try {
      if (type === 'hasMany' || type === 'hasOne') {
        const parentIds = [...new Set(rows.map((r) => r[localKey]).filter((v) => v != null))]
        if (!parentIds.length) {
          rows.forEach((r) => { r[resultKey] = type === 'hasMany' ? [] : null })
          continue
        }

        let relQ = db(entity).whereIn(foreignKey, parentIds)
        if (where) relQ = relQ.where(where)
        const cols = select && select.length > 0 ? (select.includes(foreignKey) ? select : [foreignKey, ...select]) : ['*']

        // A per-parent cap (hasOne is a cap of one) is applied inside the
        // database, numbering each parent's rows with a window function, so
        // a parent with thousands of related rows never ships them all.
        const perParent = type === 'hasOne' ? 1 : limit
        let relRows
        if (perParent != null) {
          const numbered = relQ.select([...cols, db.raw('row_number() over (partition by ?? order by ??) as ??', [foreignKey, foreignKey, ROW_NUMBER])])
          relRows = (await db.select('*').from(numbered.as('mozg_numbered')).where(ROW_NUMBER, '<=', perParent))
            .map(({ [ROW_NUMBER]: _n, ...row }) => row)
        } else {
          relRows = await relQ.select(cols)
        }

        if (nested && nested.length > 0) await loadKnexRelations(db, relRows, nested)

        const grouped = {}
        for (const r of relRows) {
          const k = r[foreignKey]
          if (!grouped[k]) grouped[k] = []
          grouped[k].push(r)
        }
        for (const row of rows) {
          row[resultKey] = type === 'hasMany'
            ? (grouped[row[localKey]] || [])
            : ((grouped[row[localKey]] || [])[0] ?? null)
        }
      } else if (type === 'belongsTo') {
        const foreignIds = [...new Set(rows.map((r) => r[foreignKey]).filter((v) => v != null))]
        if (!foreignIds.length) { rows.forEach((r) => { r[resultKey] = null }); continue }

        let relQ = db(entity).whereIn(ownerKey, foreignIds)
        relQ = select && select.length > 0 ? relQ.select(select) : relQ.select('*')
        if (where) relQ = relQ.where(where)
        const relRows = await relQ

        if (nested && nested.length > 0) await loadKnexRelations(db, relRows, nested)

        const byOwnerKey = Object.fromEntries(relRows.map((r) => [r[ownerKey], r]))
        for (const row of rows) { row[resultKey] = byOwnerKey[row[foreignKey]] ?? null }
      }
    } catch (err) {
      // Return a partial result: primary rows are preserved; the failed relation
      // is represented as an error object so the client can see what went wrong
      // without losing the rest of the query result.
      const errObj = { error: `relation fetch failed for ${entity}: ${err.message}` }
      rows.forEach((r) => { r[resultKey] = errObj })
    }
  }
}

module.exports = { executeKnexQuery, loadKnexRelations, createConnectionCache, connectionCaches }
