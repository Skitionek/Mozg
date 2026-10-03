'use strict'

/**
 * REST-style sources expose no schema of their own, so there is nothing for a
 * driver to introspect.  When the connection points at a known catalog entry,
 * that entry's declared entities and columns are the only description of the
 * source we have — report those rather than an empty schema that looks like a
 * database with no tables.
 *
 * Several catalog entries can share one base URL (NCBI E-utilities backs
 * ncbi, genbank, pubmed and geo alike), so every matching entry's entities
 * are combined rather than guessing which one the caller meant; an entity
 * name declared by more than one of them is only listed once.
 *
 * @param {object} connection
 * @returns {{tables: Array<object>}}
 */
function introspectFromCatalog (connection) {
  const { findCatalogsByDatabase } = require('../catalog')
  const entries = findCatalogsByDatabase(connection && connection.database)

  const tablesByName = new Map()

  for (const entry of entries) {
    for (const entity of entry.entities) {
      if (tablesByName.has(entity.name)) continue

      tablesByName.set(entity.name, {
        name: entity.name,
        columns: entity.columns.map((column) => ({
          name: column,
          type: 'unknown',
          nullable: true,
          defaultValue: null,
          isPrimaryKey: column === 'id'
        }))
      })
    }
  }

  return { tables: [...tablesByName.values()] }
}

module.exports = { introspectFromCatalog }
