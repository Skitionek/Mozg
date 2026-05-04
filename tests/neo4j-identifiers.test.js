'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// This repo uses @graphql-mesh/neo4j for actual Neo4j access, but the issue is
// about Cypher identifiers being interpolated without escaping/validation.
// The affected code lives in the neo4j driver (pulled in by Mesh), so this test
// focuses on the local helper we use to enforce safe identifiers.

const { assertSafeCypherIdentifier, escapeCypherLabel } = require('../src/database/drivers/neo4j-identifiers');

test('neo4j identifiers: assertSafeCypherIdentifier accepts normal identifiers', () => {
  assert.equal(assertSafeCypherIdentifier('Movie'), 'Movie');
  assert.equal(assertSafeCypherIdentifier('_movie_123'), '_movie_123');
  assert.equal(assertSafeCypherIdentifier('rel_alias'), 'rel_alias');
});

test('neo4j identifiers: assertSafeCypherIdentifier rejects injection-y input', () => {
  assert.throws(() => assertSafeCypherIdentifier('n) RETURN 1 //'), /Invalid Cypher identifier/);
  assert.throws(() => assertSafeCypherIdentifier('`bad`'), /Invalid Cypher identifier/);
  assert.throws(() => assertSafeCypherIdentifier('has-dash'), /Invalid Cypher identifier/);
  assert.throws(() => assertSafeCypherIdentifier(''), /Invalid Cypher identifier/);
});

test('neo4j identifiers: escapeCypherLabel backtick-quotes and escapes backticks', () => {
  assert.equal(escapeCypherLabel('Movie'), '`Movie`');
  assert.equal(escapeCypherLabel('A`B'), '`A``B`');
});

