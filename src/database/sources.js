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

/** True for a connection value supplied by the server's environment: `{ env: 'NAME' }`. */
function isEnvValue (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof value.env === 'string'
}

/**
 * Whether a catalog entry's connection is held by the server — any field
 * comes from the environment (a self-hosted database deployed alongside
 * Mozg).  Callers may use such a source but never redirect it: overriding
 * the host of a connection whose password the server supplies would hand
 * that password to whatever host the caller names.
 */
function isServerHeld (entry) {
  return Object.values((entry && entry.connection) || {}).some(isEnvValue)
}

/** Resolve `{ env: 'NAME', default }` connection values from process.env. */
function resolveEnvValues (connection) {
  const out = {}
  for (const [key, value] of Object.entries(connection || {})) {
    if (!isEnvValue(value)) {
      out[key] = value
      continue
    }
    const raw = process.env[value.env] != null && process.env[value.env] !== '' ? process.env[value.env] : value.default
    out[key] = key === 'port' && raw != null && raw !== '' ? Number(raw) : raw
  }
  return out
}

/**
 * Connection template for a catalog entry, tagged with the source name so
 * catalog-aware drivers can find the entity definitions again.
 * @param {string} name     catalog entry name
 * @param {object} [apiKeys]  per-source API keys supplied by the caller
 */
function connectionForSource (name, apiKeys) {
  const entry = loadEntry(name)
  const connection = { ...resolveEnvValues(entry.connection), driver: entry.driver, source: entry.name }
  if (apiKeys && typeof apiKeys === 'object') connection.apiKeys = apiKeys
  return connection
}

// ── OBO keys: declared relations by key, and implicit links ────────────────

/** Fields and filterable params of an entity that accept a given OBO key. */
function keyedParams (entity, key) {
  const { paramKeys, accepts } = require('./obo')
  const names = entityParams(entity).map((p) => p.name)
  // SQL and graph entities filter on any column; their keyed columns are their params.
  for (const column of Object.keys(entity.obo || {})) if (!names.includes(column)) names.push(column)
  return names.filter((name) => accepts(paramKeys(entity, name), key))
}

/** The field of an entity carrying a key, preferring its canonical name. */
function keyedField (entity, key) {
  const { fieldKey, CANONICAL_FIELD } = require('./obo')
  const fields = entityColumns(entity).filter((f) => fieldKey(entity, f) === key)
  if (fields.length === 1) return fields[0]
  if (fields.includes(CANONICAL_FIELD[key])) return CANONICAL_FIELD[key]
  return fields.length ? { ambiguous: fields } : null
}

/**
 * Fill in the join fields of a relation declared by OBO key
 * (`{ obo: 'uniprot', catalog: 'pdbe', entity: 'bestStructures' }`): the
 * parent field carrying that key and the target parameter accepting it.
 * Explicit localKey / foreignKey still win.
 * @returns {object} the relation with localKey and foreignKey set
 */
function resolveRelation (sourceEntry, entity, rel) {
  if (!rel.obo || (rel.localKey && rel.foreignKey)) return rel
  const targetEntry = rel.catalog ? loadEntry(rel.catalog) : sourceEntry
  const target = findEntity(targetEntry, rel.entity)
  const label = `${sourceEntry.name}/${entity.name} → ${rel.alias || rel.entity}`
  const out = { ...rel }

  if (!out.foreignKey) {
    const params = keyedParams(target, rel.obo)
    const required = params.filter((p) => entityParams(target).some((x) => x.name === p && x.required))
    const pick = required.length === 1 ? required[0] : params.length === 1 ? params[0] : null
    if (!pick) throw new Error(`${label}: ${targetEntry.name}/${target.name} has ${params.length ? `several parameters for OBO key "${rel.obo}" (${params.join(', ')}); set foreignKey` : `no parameter for OBO key "${rel.obo}"`}`)
    out.foreignKey = pick
  }
  if (!out.localKey) {
    const field = keyedField(entity, rel.obo)
    if (!field) throw new Error(`${label}: ${sourceEntry.name}/${entity.name} has no field with OBO key "${rel.obo}"`)
    if (field.ambiguous) throw new Error(`${label}: several fields carry OBO key "${rel.obo}" (${field.ambiguous.join(', ')}); set localKey`)
    out.localKey = field
  }
  return out
}

const LINK_PATTERN = /^([a-z0-9][a-z0-9-]*)\/([A-Za-z_][A-Za-z0-9_/]*?)(?:\(([A-Za-z0-9_]+)\))?$/

const linkCache = new Map()

/**
 * Relations nobody declared: every entity, in any source, whose one required
 * parameter accepts an OBO key that a field of this entity carries.  Two
 * fields with the same key and value name the same thing, so following the
 * value is always meaningful.  Named `source/entity`, or
 * `source/entity(field)` when the value comes from a non-canonical field.
 */
function implicitLinks (sourceEntry, entity) {
  const cacheKey = `${sourceEntry.name}\u0000${entity.name}`
  if (linkCache.has(cacheKey)) return linkCache.get(cacheKey)

  const { fieldKey, fieldKeys, paramKeys, CANONICAL_FIELD } = require('./obo')
  const { getCatalog } = require('../catalog')
  const fields = entityColumns(entity)
    .map((f) => ({ field: f, key: fieldKey(entity, f), possible: fieldKeys(entity, f) }))
    .filter((x) => x.key && x.possible.length > 0)
  const links = []
  if (fields.length === 0) {
    linkCache.set(cacheKey, links)
    return links
  }

  for (const targetEntry of getCatalog()) {
    for (const target of targetEntry.entities) {
      if (targetEntry.name === sourceEntry.name && target.name === entity.name) continue
      // An api entity is reachable through its one required parameter; a SQL
      // table or graph label through any column annotated with an OBO key.
      let candidates
      if (targetEntry.driver === 'api') {
        const required = entityParams(target).filter((p) => p.required)
        if (required.length !== 1) continue
        candidates = [required[0].name]
      } else {
        candidates = Object.keys(target.obo || {})
        if (candidates.length === 0) continue
      }
      for (const { field, key, possible } of fields) {
        const param = candidates.find((c) => possible.some((k) => keyedParams(target, k).includes(c)))
        if (!param) continue
        const canonical = key === '*' ? field === 'diseaseId' : field === CANONICAL_FIELD[key]
        // A CURIE field feeding a one-space parameter joins by that space, so
        // values from any other space are skipped rather than mis-matched.
        const accepted = paramKeys(target, param)
        const joinKey = key === '*' && accepted.length === 1 ? accepted[0] : key
        links.push({
          name: `${targetEntry.name}/${target.name}${canonical ? '' : `(${field})`}`,
          catalog: targetEntry.name,
          entity: target.name,
          localKey: field,
          foreignKey: param,
          obo: joinKey,
          type: 'hasMany',
          description: target.description || null
        })
      }
    }
  }
  linkCache.set(cacheKey, links)
  return links
}

/** Forget computed links (tests register and unregister sources). */
function clearLinkCache () {
  linkCache.clear()
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
    let rel = (entity.relations || []).find((r) => (r.alias || r.entity) === alias)
    if (!rel && LINK_PATTERN.test(alias)) {
      // `source/entity` — follow a shared OBO key without a declared relation.
      rel = implicitLinks(sourceEntry, entity).find((l) => l.name === alias)
      if (rel) rel = { ...rel, alias }
    }
    if (!rel) {
      const known = (entity.relations || []).map((r) => r.alias || r.entity).join(', ') || '(none)'
      const hint = LINK_PATTERN.test(alias)
        ? ` No field of ${sourceEntry.name}/${entity.name} shares an OBO key with ${alias.replace(/\(.*\)$/, '')}'s required parameter.`
        : ' Or name any source/entity whose required parameter shares an OBO key with a field here (see the catalog query\'s links).'
      throw new Error(`Unknown include "${[...trail, alias].join('.')}" on ${sourceEntry.name}/${entity.name}. Available: ${known}.${hint}`)
    }
    rel = resolveRelation(sourceEntry, entity, rel)

    const relation = {
      entity: rel.entity,
      foreignKey: rel.foreignKey,
      alias,
      type: rel.type || 'hasMany'
    }
    for (const key of ['localKey', 'ownerKey', 'where', 'select', 'limit', 'obo']) {
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
    const overrides = stripEmpty(input.connection)
    delete overrides.driver
    if (isServerHeld(entry) && Object.keys(overrides).length > 0) {
      throw new Error(`Source "${entry.name}" is hosted with this server and its connection cannot be overridden`)
    }
    // An explicit connection still wins field by field, so a caller can point
    // a catalog source at a mirror or add credentials.
    out.connection = { ...connectionForSource(source, apiKeys), ...overrides }
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

  // Explicit relations may name an OBO key instead of their join fields.
  if (input.relations && input.relations.some(hasUnresolvedObo)) {
    if (!entry) throw new Error('a relation declared by OBO key needs a catalog source: pass `source`, or a connection that matches a catalog entry')
    out.relations = resolveObo(entry, findEntity(entry, input.from), input.relations)
  }

  if (include && include.length > 0) {
    if (!entry) throw new Error('include needs a catalog source: pass `source`, or a connection that matches a catalog entry')
    out.relations = [...(out.relations || input.relations || []), ...expandIncludes(entry, input.from, include)]
  }

  Object.defineProperty(out, '__normalized', { value: true })
  return out
}

function hasUnresolvedObo (rel) {
  return Boolean(rel) && ((rel.obo && !(rel.localKey && rel.foreignKey)) || (rel.relations || []).some(hasUnresolvedObo))
}

/** Resolve OBO-keyed relations (and their nested relations) against the catalog. */
function resolveObo (sourceEntry, entity, relations) {
  return relations.map((rel) => {
    const out = resolveRelation(sourceEntry, entity, rel)
    if (out.relations && out.relations.some(hasUnresolvedObo)) {
      const targetEntry = rel.catalog ? loadEntry(rel.catalog) : sourceEntry
      out.relations = resolveObo(targetEntry, findEntity(targetEntry, rel.entity), out.relations)
    }
    return out
  })
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
  normalizeQueryInput,
  resolveRelation,
  implicitLinks,
  clearLinkCache,
  keyedParams,
  isServerHeld,
  isEnvValue
}
