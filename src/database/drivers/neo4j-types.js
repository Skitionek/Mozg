'use strict'

/**
 * Neo4j property types, as `db.schema.nodeTypeProperties()` reports them.
 *
 * Neo4j 5 names them in the driver's terms (Long, Double, StringArray ...).
 * Neo4j 2025 and later use Cypher's type names instead (INTEGER NOT NULL,
 * FLOAT NOT NULL, LIST<STRING NOT NULL> NOT NULL ...), which the schema
 * introspector of the Neo4j handler (@neo4j/introspector 5) does not know:
 * it maps every unknown name to String, so a numeric property could no
 * longer be filtered by number.  `legacyNeo4jType` turns a Cypher type name
 * back into the older name, so both generations produce the same schema.
 */

const CYPHER_TO_LEGACY = {
  INTEGER: 'Long',
  FLOAT: 'Double',
  STRING: 'String',
  BOOLEAN: 'Boolean',
  DATE: 'Date',
  'ZONED DATETIME': 'DateTime',
  'LOCAL DATETIME': 'LocalDateTime',
  'ZONED TIME': 'Time',
  'LOCAL TIME': 'LocalTime',
  DURATION: 'Duration',
  POINT: 'Point'
}

function withoutNotNull (name) {
  return name.trim().replace(/\s+NOT\s+NULL$/i, '').trim()
}

/** A Neo4j property type name in the Neo4j 5 form; other names unchanged. */
function legacyNeo4jType (name) {
  if (typeof name !== 'string') return name
  const type = withoutNotNull(name).toUpperCase().replace(/\s+/g, ' ')
  if (Object.hasOwn(CYPHER_TO_LEGACY, type)) return CYPHER_TO_LEGACY[type]
  const list = /^LIST\s*<(.+)>$/.exec(type)
  if (list) {
    const element = CYPHER_TO_LEGACY[withoutNotNull(list[1]).replace(/\s+/g, ' ')]
    if (element) return `${element}Array`
  }
  return name
}

let introspectorPatched = false

/**
 * Teach the Neo4j handler's introspector the Cypher type names, by wrapping
 * the function it maps a property's types with.  Its callers read that
 * function off the module's exports on every call, so the wrapper takes
 * effect for every schema built afterwards.  Does nothing if the
 * introspector is laid out differently.
 */
function patchNeo4jIntrospectorTypes () {
  if (introspectorPatched) return
  introspectorPatched = true
  try {
    const path = require('node:path')
    const handler = path.dirname(require.resolve('@graphql-mesh/neo4j'))
    const introspector = path.dirname(require.resolve('@neo4j/introspector', { paths: [handler] }))
    const mapper = require(path.join(introspector, 'transforms', 'neo4j-graphql', 'utils', 'map-neo4j-to-graphql-type.js'))
    const map = mapper.default
    if (typeof map !== 'function') return
    mapper.default = (types, mandatory) => map(Array.isArray(types) ? types.map(legacyNeo4jType) : types, mandatory)
  } catch {
    // A different layout of the Neo4j handler: leave its introspector alone.
  }
}

module.exports = { legacyNeo4jType, patchNeo4jIntrospectorTypes }
