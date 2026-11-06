'use strict'

/**
 * Static checks that a catalog entry is executable as described and that its
 * relations can resolve — no network needed.
 *
 * A relation is resolved by querying its target entity with
 * `where: { [foreignKey]: row[localKey] }`.  For an `api` target that only
 * works when foreignKey is a parameter the target declares, and localKey is a
 * field the parent rows carry.  The catalog once described dozens of
 * relations that failed this on every row, and nothing noticed; these checks
 * are what notice now.
 *
 * Used by tests/catalog-relations.test.js and scripts/verify-sources.js.
 */

const { entityParams, entityColumns, pathParams, resolveRelation } = require('./sources')
const obo = require('./obo')

const validKey = (k) => k === '*' || Object.hasOwn(obo.KEYS, k)

const CATEGORIES = [
  'Genes & genomes',
  'Proteins & structures',
  'Interactions & pathways',
  'Function & ontologies',
  'Chemistry & drugs',
  'Disease & variants',
  'Clinical',
  'Literature',
  'Expression & samples'
]

/**
 * @param {object} entry          the catalog entry to check
 * @param {(name: string) => object|null} lookup  resolves another entry by name (null when unregistered)
 * @returns {string[]} problems, empty when the entry is sound
 */
function lintEntry (entry, lookup) {
  const problems = []
  const fail = (msg) => problems.push(`${entry.name}: ${msg}`)

  if (entry.driver === 'api') {
    for (const key of ['label', 'description', 'homepage']) {
      if (!entry[key]) fail(`missing ${key}`)
    }
    if (!CATEGORIES.includes(entry.category)) fail(`category "${entry.category}" is not one of: ${CATEGORIES.join(', ')}`)
    if (entry.homepage && !/^https:\/\//.test(entry.homepage)) fail('homepage must be an https URL')
    if (!/^https:\/\//.test((entry.connection && entry.connection.database) || '')) fail('connection.database must be an https base URL')
    if (!entry.entities || entry.entities.length === 0) fail('has no entities')
  }

  const entityNames = new Set()
  for (const entity of entry.entities || []) {
    const where = `${entity.name}`
    if (entityNames.has(entity.name)) fail(`duplicate entity "${entity.name}"`)
    entityNames.add(entity.name)

    if (entry.driver === 'api') {
      if (!/^[a-z][A-Za-z0-9]*$/.test(entity.name)) fail(`${where}: entity names are camelCase nouns`)
      if (!entity.description) fail(`${where}: missing description`)
      if (entity.path == null && !entity.resolve) fail(`${where}: needs a path or a resolve function`)
      if (entityColumns(entity).length === 0) fail(`${where}: declares no output fields`)

      const params = entityParams(entity)
      const accepted = new Set(params.map((p) => p.name))
      for (const name of pathParams(entity.path)) {
        if (!accepted.has(name)) fail(`${where}: path placeholder {${name}} is not a parameter`)
      }
      if (!entity.example || typeof entity.example !== 'object') {
        fail(`${where}: missing example where`)
      } else {
        for (const key of Object.keys(entity.example)) {
          if (!accepted.has(key)) fail(`${where}: example key "${key}" is not a declared parameter`)
        }
        for (const p of params) {
          if (p.required && entity.example[p.name] == null) fail(`${where}: example lacks required parameter "${p.name}"`)
        }
      }
    }

    // OBO key annotations must name keys Mozg knows.
    for (const [name, key] of Object.entries(entity.obo || {})) {
      for (const k of [].concat(key == null ? [] : key)) {
        if (!validKey(k)) fail(`${where}: obo.${name} names unknown OBO key "${k}"`)
      }
    }
    for (const [name, form] of Object.entries(entity.oboForm || {})) {
      if (!['local', 'curie'].includes(form)) fail(`${where}: oboForm.${name} must be "local" or "curie"`)
      if (!obo.fieldKey(entity, name)) fail(`${where}: oboForm.${name} is set but "${name}" carries no OBO key`)
    }
    for (const [name, spec] of Object.entries(entity.params || {})) {
      if (spec && spec.obo != null) {
        for (const k of [].concat(spec.obo)) if (!validKey(k)) fail(`${where}: params.${name}.obo names unknown OBO key "${k}"`)
      }
    }

    const aliases = new Set()
    for (let rel of entity.relations || []) {
      const label = `${where} → ${rel.alias || rel.entity}`
      if (entry.driver === 'api') {
        if (!rel.alias) fail(`${label}: api relations need an alias (the include name)`)
        else if (aliases.has(rel.alias)) fail(`${label}: duplicate alias`)
        aliases.add(rel.alias)
      }
      if (!['hasMany', 'hasOne', 'belongsTo'].includes(rel.type)) fail(`${label}: type must be hasMany, hasOne or belongsTo`)

      const targetName = rel.catalog || entry.name
      const target = targetName === entry.name ? entry : lookup(targetName)
      if (!target) {
        fail(`${label}: target source "${targetName}" is not registered`)
        continue
      }

      // A relation declared by OBO key must resolve to one field and one parameter.
      if (rel.obo != null) {
        if (!validKey(rel.obo)) {
          fail(`${label}: obo names unknown OBO key "${rel.obo}"`)
          continue
        }
        try {
          rel = resolveRelation(entry, entity, rel)
        } catch (err) {
          fail(err.message.replace(`${entry.name}/`, ''))
          continue
        }
      }
      if (target.driver !== 'api') continue

      const targetEntity = (target.entities || []).find((e) => e.name === rel.entity)
      if (!targetEntity) {
        fail(`${label}: "${rel.entity}" is not an entity of ${targetName} (has: ${(target.entities || []).map((e) => e.name).join(', ')})`)
        continue
      }
      const targetParams = entityParams(targetEntity).map((p) => p.name)
      const key = rel.type === 'belongsTo' ? (rel.ownerKey || 'id') : rel.foreignKey
      if (!targetParams.includes(key)) {
        fail(`${label}: "${key}" is not a parameter of ${targetName}/${rel.entity} (accepts: ${targetParams.join(', ')})`)
      }
      for (const extra of Object.keys(rel.where || {})) {
        if (!targetParams.includes(extra)) fail(`${label}: where key "${extra}" is not a parameter of ${targetName}/${rel.entity}`)
      }

      if (entry.driver === 'api') {
        const local = rel.type === 'belongsTo' ? rel.foreignKey : (rel.localKey || 'id')
        if (!entityColumns(entity).includes(local)) fail(`${label}: "${local}" is not a field of ${entry.name}/${entity.name}`)

        // Joining identifiers from different spaces can only ever match by accident.
        const fieldKey = obo.fieldKey(entity, local)
        const possible = obo.fieldKeys(entity, local)
        const accepted = obo.paramKeys(targetEntity, key)
        const fits = obo.accepts(accepted, fieldKey) || possible.some((k) => obo.accepts(accepted, k))
        if (fieldKey && accepted.length > 0 && !fits) {
          fail(`${label}: joins "${local}" (OBO key ${fieldKey}) to "${key}", which takes ${accepted.join(' or ')}`)
        }
      }
    }
  }

  return problems
}

module.exports = { lintEntry, CATEGORIES }
