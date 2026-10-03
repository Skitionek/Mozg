'use strict'

/**
 * Resolve one relation for one parent row by issuing a second query.
 *
 * Shared by the streaming endpoint and by the connector's cross-catalog
 * relation support so that both agree on what hasMany / hasOne / belongsTo
 * mean, and on which key each side is matched by.
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

  if (type === 'hasMany' || type === 'hasOne') {
    const parentId = row[localKey]
    if (parentId == null) return type === 'hasMany' ? [] : null

    const { data } = await executeQuery({
      connection,
      from: entity,
      select,
      where: { ...(where || {}), [foreignKey]: parentId },
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
      where: { ...(where || {}), [ownerKey]: foreignValue },
      relations: nested
    })
    return data[0] ?? null
  }

  return null
}

module.exports = { fetchRelation }
