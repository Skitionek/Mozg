'use strict'

/**
 * Resolve one relation for one parent row by issuing a second query.
 *
 * Shared by the streaming endpoint, the connector's cross-catalog relation
 * support, and every driver's own same-source relation loader, so all of
 * them agree on what hasMany / hasOne / belongsTo mean, on which key each
 * side is matched by, and on how a relation targeting another catalog entry
 * is resolved — rather than each keeping its own copy that can drift.
 *
 * @param {Function} executeQuery  the query entry point to resolve through
 * @param {object} connection      connection for the *related* entity
 * @param {object} row             the parent row
 * @param {object} rel             the relation definition
 */
async function fetchRelation (executeQuery, connection, row, rel) {
  const {
    entity,
    localKey = 'id',
    foreignKey,
    // For belongsTo, the key on the related entity that foreignKey points at.
    ownerKey = 'id',
    type = 'hasMany',
    select,
    where,
    relations: nested
  } = rel

  // KEGG's REST interface has no where-filter semantics at all; every one of
  // its endpoints takes a single identifier as a path segment via
  // `where._pathSuffix` instead. This is the one place that distinction has
  // to be known, so every caller of fetchRelation gets it for free rather
  // than needing to know KEGG is different.
  const matchKey = connection.driver === 'kegg' ? '_pathSuffix' : null

  if (type === 'hasMany' || type === 'hasOne') {
    const parentId = row[localKey]
    if (parentId == null) return type === 'hasMany' ? [] : null

    const { data } = await executeQuery({
      connection,
      from: entity,
      select,
      where: { ...(where || {}), [matchKey || foreignKey]: parentId },
      relations: nested
    })
    return type === 'hasMany' ? data : (data[0] ?? null)
  }

  if (type === 'belongsTo') {
    const foreignValue = row[foreignKey]
    if (foreignValue == null) return null

    const { data } = await executeQuery({
      connection,
      from: entity,
      select,
      where: { ...(where || {}), [matchKey || ownerKey]: foreignValue },
      relations: nested
    })
    return data[0] ?? null
  }

  return null
}

/**
 * Look up the connection template a catalog entry publishes, so a relation
 * can point at a source other than the one the parent query ran against.
 */
function connectionForCatalog (catalogName) {
  const { getCatalog } = require('../catalog')
  const [entry] = getCatalog(catalogName)
  return { ...entry.connection, driver: entry.driver }
}

/**
 * Resolve one relation that targets a *different* catalog entry, across
 * every row that relation applies to.
 *
 * A driver's own relation loader can only join within its own source — it
 * has no connection but its own to query with. Any relation that names a
 * `catalog`, at any nesting depth, has to be handed to this instead of being
 * treated as a local join; `executeQuery` exists as a parameter precisely so
 * that caller can be the top-level connector (letting a cross-catalog
 * relation's own nested relations resolve correctly against whatever driver
 * its target uses) and not just the driver currently running.
 *
 * A relation naming an unknown catalog, or one that otherwise fails to
 * resolve, is reported in place on the row rather than thrown — the same
 * partial-failure contract every driver's own relation loader already
 * honours, so one bad relation does not void rows that already fetched
 * successfully.
 *
 * @param {Function} executeQuery
 * @param {object[]} rows
 * @param {object} rel  a relation definition with `rel.catalog` set
 */
async function resolveCrossCatalogRelation (executeQuery, rows, rel) {
  if (!rows || rows.length === 0) return

  const resultKey = rel.alias || rel.entity
  const describeFailure = (err) => ({
    error: `relation fetch failed for ${rel.catalog}/${rel.entity}: ${err.message}`
  })

  let connection
  try {
    connection = connectionForCatalog(rel.catalog)
  } catch (err) {
    const errObj = describeFailure(err)
    for (const row of rows) row[resultKey] = errObj
    return
  }

  for (const row of rows) {
    try {
      row[resultKey] = await fetchRelation(executeQuery, connection, row, rel)
    } catch (err) {
      row[resultKey] = describeFailure(err)
    }
  }
}

module.exports = { fetchRelation, connectionForCatalog, resolveCrossCatalogRelation }
