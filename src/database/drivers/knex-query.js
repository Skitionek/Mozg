'use strict'

/**
 * Generic knex-backed query execution and relation loading.
 *
 * Shared by every driver that talks to a SQL database through knex (sqlite3,
 * postgres) — only connection acquisition and introspection differ between
 * them, so that part lives once here instead of twice.
 */

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
    const { entity, localKey = 'id', foreignKey, ownerKey = 'id', alias, type = 'hasMany', select, where, relations: nested } = rel
    const resultKey = alias || entity

    try {
      if (type === 'hasMany' || type === 'hasOne') {
        const parentIds = [...new Set(rows.map((r) => r[localKey]).filter((v) => v != null))]
        if (!parentIds.length) {
          rows.forEach((r) => { r[resultKey] = type === 'hasMany' ? [] : null })
          continue
        }

        let relQ = db(entity).whereIn(foreignKey, parentIds)
        if (select && select.length > 0) {
          const cols = select.includes(foreignKey) ? select : [foreignKey, ...select]
          relQ = relQ.select(cols)
        } else {
          relQ = relQ.select('*')
        }
        if (where) relQ = relQ.where(where)
        const relRows = await relQ

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

module.exports = { executeKnexQuery, loadKnexRelations }
