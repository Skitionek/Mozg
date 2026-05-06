'use strict'

/**
 * Maps an OWL TBox (output of parseOntology/extractOntology) to a GraphQL schema
 * definition string (SDL) and an entityMap for use by resolver generators.
 *
 * Implements the OBG-gen formal TBox → GraphQL mapping algorithm:
 *   - owl:Class            → GraphQL type (or interface when abstract)
 *   - owl:DatatypeProperty → scalar field on the domain type
 *   - owl:ObjectProperty   → relation field on the domain type
 *   - rdfs:subClassOf      → interface/implements when parent is abstract
 */

const { shortName } = require('./extractor')

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** Convert an IRI local-name or rdfs:label to a PascalCase GraphQL type name. */
function toTypeName (iri, label) {
  const raw = label || shortName(iri)
  const parts = raw.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (parts.length === 0) return 'Unknown'
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

/** Convert an IRI local-name or rdfs:label to a camelCase GraphQL field name. */
function toFieldName (iri, label) {
  const raw = label || shortName(iri)
  const parts = raw.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (parts.length === 0) return 'field'
  const [first, ...rest] = parts
  return (
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  )
}

/** Convert a PascalCase type name to a snake_case database table name. */
function toTableName (typeName) {
  return typeName
    .replace(/([A-Z])/g, (match, _group, offset) => (offset > 0 ? '_' : '') + match.toLowerCase())
    .toLowerCase()
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map an OWL TBox to GraphQL SDL and an entityMap.
 *
 * @param {{ classes, objectProperties, dataProperties }} parsed
 * @returns {{ typeDefs: string, entityMap: Map<string, EntityDef> }}
 *
 * EntityDef: {
 *   iri: string,
 *   tableName: string,
 *   isAbstract: boolean,
 *   fields: Array<{ fieldName, iri, graphqlType, required }>,
 *   relations: Array<{ fieldName, iri, targetTypeName, targetTable,
 *                       relationType, foreignKey, localKey }>,
 *   implementsInterfaces: string[],
 * }
 */
function mapOntology ({ classes, objectProperties, dataProperties }) {
  // ── Build IRI → typeName lookup ─────────────────────────────────────────
  const iriToTypeName = new Map()
  for (const cls of classes) {
    iriToTypeName.set(cls.iri, toTypeName(cls.iri, cls.label))
  }

  const classIriSet = new Set(classes.map((c) => c.iri))

  // ── Identify abstract classes ────────────────────────────────────────────
  // A class is abstract when it is a parent of at least one other class AND
  // has no data properties in its own domain (i.e., it only acts as a grouping).
  const parentIris = new Set()
  for (const cls of classes) {
    for (const parent of cls.subClassOf) {
      if (classIriSet.has(parent)) parentIris.add(parent)
    }
  }

  const classesWithDataProps = new Set()
  for (const dp of dataProperties) {
    for (const d of dp.domain) classesWithDataProps.add(d)
  }

  const classesWithObjProps = new Set()
  for (const op of objectProperties) {
    for (const d of op.domain) classesWithObjProps.add(d)
  }

  const abstractIris = new Set(
    classes
      .filter(
        (c) =>
          parentIris.has(c.iri) &&
          !classesWithDataProps.has(c.iri) &&
          !classesWithObjProps.has(c.iri)
      )
      .map((c) => c.iri)
  )

  // ── Collect fields per class ─────────────────────────────────────────────
  const fieldsByClass = new Map()
  for (const cls of classes) fieldsByClass.set(cls.iri, [])

  for (const dp of dataProperties) {
    const fieldName = toFieldName(dp.iri, dp.label)
    for (const domainIri of dp.domain) {
      if (!fieldsByClass.has(domainIri)) continue
      fieldsByClass.get(domainIri).push({
        fieldName,
        iri: dp.iri,
        graphqlType: dp.graphqlType || 'String',
        required: dp.required || false
      })
    }
  }

  // ── Collect relations per class ──────────────────────────────────────────
  const relationsByClass = new Map()
  for (const cls of classes) relationsByClass.set(cls.iri, [])

  for (const op of objectProperties) {
    const fieldName = toFieldName(op.iri, op.label)
    for (const domainIri of op.domain) {
      if (!relationsByClass.has(domainIri)) continue
      for (const rangeIri of op.range) {
        const targetTypeName = iriToTypeName.get(rangeIri)
        if (!targetTypeName) continue

        const targetTable = toTableName(targetTypeName)
        const localTypeName = iriToTypeName.get(domainIri) || ''

        let foreignKey, localKey
        if (op.relationType === 'belongsTo') {
          foreignKey = 'id'
          localKey = targetTable + '_id'
        } else {
          foreignKey = toTableName(localTypeName) + '_id'
          localKey = 'id'
        }

        relationsByClass.get(domainIri).push({
          fieldName,
          iri: op.iri,
          targetTypeName,
          targetTable,
          relationType: op.relationType,
          foreignKey,
          localKey
        })
      }
    }
  }

  // ── Build entityMap ──────────────────────────────────────────────────────
  const entityMap = new Map()
  for (const cls of classes) {
    const typeName = iriToTypeName.get(cls.iri)
    entityMap.set(typeName, {
      iri: cls.iri,
      tableName: toTableName(typeName),
      isAbstract: abstractIris.has(cls.iri),
      fields: fieldsByClass.get(cls.iri) || [],
      relations: relationsByClass.get(cls.iri) || [],
      implementsInterfaces: cls.subClassOf
        .filter((p) => abstractIris.has(p))
        .map((p) => iriToTypeName.get(p))
        .filter(Boolean)
    })
  }

  // ── Generate SDL ─────────────────────────────────────────────────────────
  const lines = []

  const emitFields = (entity) => {
    lines.push('  id: ID!')
    for (const f of entity.fields) {
      const bang = f.required ? '!' : ''
      lines.push(`  ${f.fieldName}: ${f.graphqlType}${bang}`)
    }
    for (const r of entity.relations) {
      const fieldType =
        r.relationType === 'hasMany' ? `[${r.targetTypeName}!]!` : r.targetTypeName
      lines.push(`  ${r.fieldName}: ${fieldType}`)
    }
  }

  // Interfaces for abstract classes
  for (const cls of classes) {
    if (!abstractIris.has(cls.iri)) continue
    const typeName = iriToTypeName.get(cls.iri)
    lines.push(`interface ${typeName} {`)
    emitFields(entityMap.get(typeName))
    lines.push('}')
    lines.push('')
  }

  // Types for concrete classes
  for (const cls of classes) {
    if (abstractIris.has(cls.iri)) continue
    const typeName = iriToTypeName.get(cls.iri)
    const entity = entityMap.get(typeName)
    const implClause =
      entity.implementsInterfaces.length > 0
        ? ` implements ${entity.implementsInterfaces.join(' & ')}`
        : ''
    lines.push(`type ${typeName}${implClause} {`)
    emitFields(entity)
    lines.push('}')
    lines.push('')
  }

  return { typeDefs: lines.join('\n'), entityMap }
}

module.exports = { mapOntology, toTypeName, toFieldName, toTableName }
