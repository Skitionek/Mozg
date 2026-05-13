'use strict'

/**
 * Generates GraphQL resolver objects from an ontology entityMap.
 *
 * For each concrete entity type the following resolvers are produced:
 *   - Query.<entityName>s(connection, filter, limit, offset, orderBy, orderDirection)
 *     Returns an array of entity objects by querying the mapped table.
 *   - <TypeName>.<fieldName>(parent, { connection })
 *     For each relation field, fetches the related rows using the foreign key.
 *
 * @param {Map<string, import('./mapper').EntityDef>} entityMap
 * @returns {{ Query: object, [typeName: string]: object }}
 */

const { executeQuery } = require('../database/connector')

function generateResolvers (entityMap) {
  const Query = {}
  const typeResolvers = {}

  for (const [typeName, entity] of entityMap) {
    if (entity.isAbstract) continue

    // Root query field: <typeName>s(connection, filter, …): [TypeName!]!
    const queryField =
      typeName.charAt(0).toLowerCase() +
      typeName.slice(1) +
      (typeName.endsWith('s') ? 'es' : 's')

    Query[queryField] = async (
      _parent,
      { connection, filter, limit, offset, orderBy, orderDirection }
    ) => {
      const result = await executeQuery({
        connection,
        from: entity.tableName,
        where: filter ?? undefined,
        limit: limit ?? undefined,
        offset: offset ?? undefined,
        orderBy: orderBy ?? undefined,
        orderDirection: orderDirection ?? undefined
      })
      return result.data
    }

    // Relation field resolvers
    const fieldResolvers = {}
    for (const rel of entity.relations) {
      const { fieldName, targetTable, foreignKey, localKey, relationType } = rel

      fieldResolvers[fieldName] = async (parent, { connection }) => {
        const parentKey = parent[localKey] ?? parent.id
        const result = await executeQuery({
          connection,
          from: targetTable,
          where: { [foreignKey]: parentKey }
        })
        const rows = result.data || []
        if (relationType === 'hasMany') return rows
        return rows[0] ?? null
      }
    }

    if (Object.keys(fieldResolvers).length > 0) {
      typeResolvers[typeName] = fieldResolvers
    }
  }

  return { Query, ...typeResolvers }
}

module.exports = { generateResolvers }
