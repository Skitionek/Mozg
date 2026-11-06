'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { legacyNeo4jType, patchNeo4jIntrospectorTypes } = require('../src/database/drivers/neo4j-types')

// Names as Neo4j 2026.10 reports them from db.schema.nodeTypeProperties().
test('Cypher type names map to the Neo4j 5 names', () => {
  const cases = {
    'INTEGER NOT NULL': 'Long',
    'FLOAT NOT NULL': 'Double',
    'STRING NOT NULL': 'String',
    'BOOLEAN NOT NULL': 'Boolean',
    'DATE NOT NULL': 'Date',
    'ZONED DATETIME NOT NULL': 'DateTime',
    'LOCAL DATETIME NOT NULL': 'LocalDateTime',
    'ZONED TIME NOT NULL': 'Time',
    'LOCAL TIME NOT NULL': 'LocalTime',
    'DURATION NOT NULL': 'Duration',
    'POINT NOT NULL': 'Point',
    INTEGER: 'Long',
    'LIST<INTEGER NOT NULL> NOT NULL': 'LongArray',
    'LIST<FLOAT NOT NULL> NOT NULL': 'DoubleArray',
    'LIST<STRING NOT NULL> NOT NULL': 'StringArray',
    'LIST<BOOLEAN NOT NULL> NOT NULL': 'BooleanArray',
    'LIST<DATE NOT NULL> NOT NULL': 'DateArray',
    'LIST<ZONED DATETIME NOT NULL>': 'DateTimeArray'
  }
  for (const [cypher, legacy] of Object.entries(cases)) assert.equal(legacyNeo4jType(cypher), legacy, cypher)
})

test('Neo4j 5 names and unknown names pass through unchanged', () => {
  for (const name of ['Long', 'Double', 'StringArray', 'VECTOR<FLOAT32>(3) NOT NULL', 'LIST<ANY>', 'ANY']) {
    assert.equal(legacyNeo4jType(name), name)
  }
  assert.equal(legacyNeo4jType(undefined), undefined)
})

test('the introspector maps Cypher type names once patched', () => {
  const handler = path.dirname(require.resolve('@graphql-mesh/neo4j'))
  const introspector = path.dirname(require.resolve('@neo4j/introspector', { paths: [handler] }))
  const mapper = require(path.join(introspector, 'transforms', 'neo4j-graphql', 'utils', 'map-neo4j-to-graphql-type.js'))
  assert.equal(mapper.default(['INTEGER NOT NULL'], true), 'String!', 'unpatched, Cypher names fall back to String')
  patchNeo4jIntrospectorTypes()
  patchNeo4jIntrospectorTypes()
  assert.equal(mapper.default(['INTEGER NOT NULL'], true), 'BigInt!')
  assert.equal(mapper.default(['FLOAT NOT NULL'], false), 'Float')
  assert.equal(mapper.default(['LIST<STRING NOT NULL> NOT NULL'], false), '[String!]')
  assert.equal(mapper.default(['Long'], false), 'BigInt')
})
