'use strict'

const registry = require('./registry')
const { resolveCrossCatalogRelation } = require('./relations')
const { normalizeQueryInput, normalizeKeyedRows, sourceForConnection } = require('./sources')
const { withWake } = require('./self-hosted')
const { getResultCache } = require('./result-cache')
const telemetry = require('../telemetry')

async function executeQuery (rawInput) {
  // `source` / `include` are shorthand for a catalog connection and catalog
  // relations; expand them first so every driver sees the explicit form (and
  // so the result cache keys on what actually runs).
  const normalized = normalizeQueryInput(rawInput)
  // Timed and counted around the cache, so a cached answer shows up as the
  // fast query it was.
  return telemetry.trackQuery(normalized, () => getResultCache().run(normalized, () => runQuery(normalized)))
}

async function runQuery (normalized) {
  // `fresh` is the caller's wish about the result cache, and `link` is applied
  // here to the finished rows: neither is a driver option.
  const { fresh: _fresh, link, ...input } = normalized
  const driver = registry.getDriver(input.connection.driver)

  const relations = input.relations || []
  const sameSource = relations.filter((rel) => !rel.catalog)
  const crossCatalog = relations.filter((rel) => rel.catalog)

  // A database hosted with this server may be scaled to zero: count the query
  // as demand (which wakes it) and wait out its cold start.
  const result = await withWake(input.connection, () => driver.executeQuery({ ...input, relations: sameSource }))

  // Rows from a catalog SQL table or graph label get their identifier columns
  // in canonical OBO form, as api rows already have them.
  const entry = input.connection.driver !== 'api' && !input.raw ? sourceForConnection(input.connection) : null
  if (entry) normalizeKeyedRows(entry, input.from, result.data, sameSource)

  const options = { apiKeys: input.connection.apiKeys }
  await Promise.all(crossCatalog.map((rel) => resolveCrossCatalogRelation(executeQuery, result.data, rel, options)))

  // After the relations, so a link can follow a field of a related row
  // (`field: "target.diseaseId"`).  Required lazily: most queries link nothing.
  if (link && link.length) await require('../ontology/links').applyLinks(result.data, link)

  return result
}

module.exports = { executeQuery }
