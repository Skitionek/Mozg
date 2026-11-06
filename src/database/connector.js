'use strict'

const registry = require('./registry')
const { resolveCrossCatalogRelation } = require('./relations')
const { normalizeQueryInput } = require('./sources')
const { withWake } = require('./self-hosted')

async function executeQuery (rawInput) {
  // `source` / `include` are shorthand for a catalog connection and catalog
  // relations; expand them first so every driver sees the explicit form.
  const input = normalizeQueryInput(rawInput)
  const driver = registry.getDriver(input.connection.driver)

  const relations = input.relations || []
  const sameSource = relations.filter((rel) => !rel.catalog)
  const crossCatalog = relations.filter((rel) => rel.catalog)

  // A database hosted with this server may be scaled to zero: count the query
  // as demand (which wakes it) and wait out its cold start.
  const result = await withWake(input.connection, () => driver.executeQuery({ ...input, relations: sameSource }))

  const options = { apiKeys: input.connection.apiKeys }
  await Promise.all(crossCatalog.map((rel) => resolveCrossCatalogRelation(executeQuery, result.data, rel, options)))

  return result
}

module.exports = { executeQuery }
