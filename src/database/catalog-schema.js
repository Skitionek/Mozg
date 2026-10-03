'use strict'

/**
 * REST-style sources expose no schema of their own, so there is nothing for a
 * driver to introspect.  When the connection points at a known catalog entry,
 * that entry's declared entities and columns are the only description of the
 * source we have — report those rather than an empty schema that looks like a
 * database with no tables.
 *
 * @param {object} connection
 * @returns {{tables: Array<object>}}
 */
function introspectFromCatalog (connection) {
  const { findCatalogByDatabase } = require('../catalog')
  const entry = findCatalogByDatabase(connection && connection.database)

  if (!entry) return { tables: [] }

  const tables = entry.entities.map((entity) => ({
    name: entity.name,
    columns: entity.columns.map((column) => ({
      name: column,
      type: 'unknown',
      nullable: true,
      defaultValue: null,
      isPrimaryKey: column === 'id'
    }))
  }))

  return { tables }
}

module.exports = { introspectFromCatalog }
