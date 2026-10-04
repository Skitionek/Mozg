'use strict'

const registry = require('./registry')
const { resolveCrossCatalogRelation } = require('./relations')

async function executeQuery (input) {
  const driver = registry.getDriver(input.connection.driver)

  const relations = input.relations || []
  const sameSource = relations.filter((rel) => !rel.catalog)
  const crossCatalog = relations.filter((rel) => rel.catalog)

  const result = await driver.executeQuery({ ...input, relations: sameSource })

  for (const rel of crossCatalog) {
    await resolveCrossCatalogRelation(executeQuery, result.data, rel)
  }

  return result
}

module.exports = { executeQuery }
