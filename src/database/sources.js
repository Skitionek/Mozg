'use strict'

/**
 * Catalog-backed sources: turning `{ source, from, include }` into a query
 * the drivers understand.
 *
 * A catalog entry already knows how to connect to its source and how its
 * entities relate to entities in other sources.  Callers should be able to
 * lean on that knowledge instead of restating it in every query, so a
 * QueryInput may name a `source` instead of spelling out a `connection`, and
 * may list catalog-declared relations by name in `include` instead of
 * describing each join by hand.  This module expands both into the explicit
 * form every driver already accepts, which keeps the drivers, the streaming
 * endpoint and the GraphQL resolver agreeing on one meaning.
 */

function loadEntry (name) {
  const { getCatalog } = require('../catalog')
  const [entry] = getCatalog(name)
  return entry
}

/**
 * The entity named `name` in a catalog entry, or a descriptive error.
 * @param {object} entry
 * @param {string} name
 */
function findEntity (entry, name) {
  const entity = (entry.entities || []).find((e) => e.name === name)
  if (!entity) {
    const known = (entry.entities || []).map((e) => e.name).join(', ')
    throw new Error(`Unknown entity "${name}" in source "${entry.name}". Available: ${known}`)
  }
  return entity
}

/** Placeholders in a path template, e.g. "/lookup/{species}/{symbol}" → ["species", "symbol"]. */
function pathParams (template) {
  return [...String(template || '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
}

/**
 * Every `where` key an entity accepts, with path placeholders folded in so a
 * catalog author cannot forget to declare one.
 * @returns {Array<{name: string, in: string, required: boolean, description: string|null, example: any}>}
 */
function entityParams (entity) {
  const declared = entity.params || {}
  const inPath = new Set(pathParams(entity.path))
  const names = [...new Set([...inPath, ...Object.keys(declared)])]
  return names.map((name) => {
    const spec = declared[name] || {}
    const location = inPath.has(name) ? 'path' : (spec.in || 'query')
    return {
      name,
      in: location,
      required: location === 'path' ? !(spec.default != null) : Boolean(spec.required),
      description: spec.description || null,
      example: entity.example && Object.hasOwn(entity.example, name) ? entity.example[name] : null
    }
  })
}

/** Field names an entity's rows carry. */
function entityColumns (entity) {
  if (Array.isArray(entity.columns)) return entity.columns
  if (entity.fields && typeof entity.fields === 'object') return Object.keys(entity.fields)
  return []
}

/**
 * Connection template for a catalog entry, tagged with the source name so
 * catalog-aware drivers can find the entity definitions again.
 * @param {string} name     catalog entry name
 * @param {object} [apiKeys]  per-source API keys supplied by the caller
 */
function connectionForSource (name, apiKeys) {
  const entry = loadEntry(name)
  const connection = { ...entry.connection, driver: entry.driver, source: entry.name }
  if (apiKeys && typeof apiKeys === 'object') connection.apiKeys = apiKeys
  return connection
}

/**
 * The catalog entry a connection belongs to, when one can be identified:
 * explicitly via `connection.source`, or for the `api` driver by matching the
 * base URL (or a catalog name passed as `database`).
 */
function sourceForConnection (connection) {
  if (!connection) return null
  if (connection.source) return loadEntry(connection.source)
  if (connection.driver !== 'api') return null

  const { listCatalog, findCatalogsByDatabase } = require('../catalog')
  if (listCatalog().includes(connection.database)) return loadEntry(connection.database)
  const matches = findCatalogsByDatabase(connection.database).filter((e) => e.driver === 'api')
  return matches.length === 1 ? matches[0] : null
}

/**
 * Turn `include: ["structures", "pathways.events"]` into explicit relation
 * inputs, following each name through the catalog — across sources where the
 * relation points at another catalog entry.
 */
function expandIncludes (entry, entityName, include) {
  const tree = {}
  for (const path of include || []) {
    let node = tree
    for (const part of String(path).split('.')) {
      node[part] = node[part] || {}
      node = node[part]
    }
  }

  const build = (sourceEntry, entity, subtree, trail) => Object.entries(subtree).map(([alias, children]) => {
    const rel = (entity.relations || []).find((r) => (r.alias || r.entity) === alias)
    if (!rel) {
      const known = (entity.relations || []).map((r) => r.alias || r.entity).join(', ') || '(none)'
      throw new Error(`Unknown include "${[...trail, alias].join('.')}" on ${sourceEntry.name}/${entity.name}. Available: ${known}`)
    }

    const relation = {
      entity: rel.entity,
      foreignKey: rel.foreignKey,
      alias,
      type: rel.type || 'hasMany'
    }
    for (const key of ['localKey', 'ownerKey', 'where', 'select', 'limit']) {
      if (rel[key] != null) relation[key] = rel[key]
    }
    if (rel.catalog && rel.catalog !== sourceEntry.name) relation.catalog = rel.catalog

    if (Object.keys(children).length > 0) {
      const targetEntry = rel.catalog ? loadEntry(rel.catalog) : sourceEntry
      const targetEntity = findEntity(targetEntry, rel.entity)
      relation.relations = build(targetEntry, targetEntity, children, [...trail, alias])
    }
    return relation
  })

  return build(entry, findEntity(entry, entityName), tree, [])
}

/**
 * Expand a QueryInput that uses `source` / `include` into the explicit form.
 * Idempotent: an already-normalized input passes through unchanged.
 */
function normalizeQueryInput (input) {
  if (!input || input.__normalized) return input

  const { source, include, apiKeys, ...rest } = input
  const out = { ...rest }

  let entry
  if (source) {
    entry = loadEntry(source)
    // An explicit connection still wins field by field, so a caller can point
    // a catalog source at a mirror or add credentials.
    out.connection = { ...connectionForSource(source, apiKeys), ...stripEmpty(input.connection) }
    out.connection.source = entry.name
    out.connection.driver = entry.driver
  } else if (input.connection) {
    out.connection = { ...input.connection }
    if (apiKeys) out.connection.apiKeys = apiKeys
    entry = sourceForConnection(out.connection)
    if (entry && out.connection.driver === 'api') {
      out.connection.source = entry.name
      // `database` may name the source rather than give its base URL.
      if (!/^https?:\/\//.test(out.connection.database || '')) out.connection.database = entry.connection.database
    }
  } else {
    throw new Error('A query needs either a source (catalog entry name) or a connection')
  }

  if (include && include.length > 0) {
    if (!entry) throw new Error('include needs a catalog source: pass `source`, or a connection that matches a catalog entry')
    out.relations = [...(input.relations || []), ...expandIncludes(entry, input.from, include)]
  }

  Object.defineProperty(out, '__normalized', { value: true })
  return out
}

function stripEmpty (obj) {
  if (!obj || typeof obj !== 'object') return {}
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== ''))
}

module.exports = {
  findEntity,
  pathParams,
  entityParams,
  entityColumns,
  connectionForSource,
  sourceForConnection,
  expandIncludes,
  normalizeQueryInput
}
