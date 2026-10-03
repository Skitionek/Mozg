'use strict'

const registry = require('./registry')
const { fetchRelation } = require('./relations')

/**
 * Look up the connection template a catalog entry publishes, so a relation can
 * point at a source other than the one the parent query ran against.
 */
function connectionForCatalog (catalogName) {
  const { getCatalog } = require('../catalog')
  const [entry] = getCatalog(catalogName)
  return { ...entry.connection, driver: entry.driver }
}

/**
 * Resolve the relations that target a *different* catalog entry.  Drivers only
 * know how to join within their own source, so these are resolved here, one
 * follow-up query per row, after the parent rows are in hand.
 *
 * A relation naming an unknown catalog, or one that otherwise fails to
 * resolve, is reported in place on the row rather than thrown — the same
 * partial-failure contract every driver's own relation loader already
 * honours, so one bad relation does not void the parent rows that already
 * fetched successfully.
 */
async function loadCrossCatalogRelations (rows, relations) {
  if (!rows || rows.length === 0) return

  for (const rel of relations) {
    const resultKey = rel.alias || rel.entity

    let connection
    try {
      connection = connectionForCatalog(rel.catalog)
    } catch (err) {
      const errObj = { error: `relation fetch failed for ${rel.catalog}/${rel.entity}: ${err.message}` }
      for (const row of rows) row[resultKey] = errObj
      continue
    }

    for (const row of rows) {
      try {
        row[resultKey] = await fetchRelation(executeQuery, connection, row, rel)
      } catch (err) {
        // Keep the parent rows: report the failed relation in place so the
        // client can see what went wrong without losing the whole result.
        row[resultKey] = {
          error: `relation fetch failed for ${rel.catalog}/${rel.entity}: ${err.message}`
        }
      }
    }
  }
}

async function executeQuery (input) {
  const driver = registry.getDriver(input.connection.driver)

  const relations = input.relations || []
  const sameSource = relations.filter((rel) => !rel.catalog)
  const crossCatalog = relations.filter((rel) => rel.catalog)

  const result = await driver.executeQuery({ ...input, relations: sameSource })

  if (crossCatalog.length > 0) {
    await loadCrossCatalogRelations(result.data, crossCatalog)
  }

  return result
}

module.exports = { executeQuery, connectionForCatalog }
