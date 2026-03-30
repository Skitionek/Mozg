'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Kind } = require('graphql');

// Access the private parseLiteralJSON via the exported resolver map
const { resolvers } = require('../src/schema');

const parseLiteral = resolvers.JSON.parseLiteral;

describe('parseLiteralJSON', () => {
  test('parses STRING', () => {
    assert.equal(parseLiteral({ kind: Kind.STRING, value: 'hello' }), 'hello');
  });

  test('parses BOOLEAN true', () => {
    // In graphql-js AST, BooleanValueNode.value is an actual boolean
    assert.equal(parseLiteral({ kind: Kind.BOOLEAN, value: true }), true);
  });

  test('parses BOOLEAN false', () => {
    assert.equal(parseLiteral({ kind: Kind.BOOLEAN, value: false }), false);
  });

  test('parses INT', () => {
    assert.equal(parseLiteral({ kind: Kind.INT, value: '42' }), 42);
  });

  test('parses FLOAT', () => {
    assert.equal(parseLiteral({ kind: Kind.FLOAT, value: '3.14' }), 3.14);
  });

  test('parses NULL', () => {
    assert.equal(parseLiteral({ kind: Kind.NULL }), null);
  });

  test('parses ENUM (e.g. where: { status: ACTIVE })', () => {
    assert.equal(parseLiteral({ kind: Kind.ENUM, value: 'ACTIVE' }), 'ACTIVE');
  });

  test('parses LIST', () => {
    const ast = {
      kind: Kind.LIST,
      values: [
        { kind: Kind.INT, value: '1' },
        { kind: Kind.STRING, value: 'two' },
      ],
    };
    assert.deepEqual(parseLiteral(ast), [1, 'two']);
  });

  test('parses nested OBJECT', () => {
    const ast = {
      kind: Kind.OBJECT,
      fields: [
        { name: { value: 'status' }, value: { kind: Kind.ENUM, value: 'ACTIVE' } },
        { name: { value: 'count' }, value: { kind: Kind.INT, value: '5' } },
      ],
    };
    assert.deepEqual(parseLiteral(ast), { status: 'ACTIVE', count: 5 });
  });

  test('unknown kind returns null', () => {
    assert.equal(parseLiteral({ kind: 'UNKNOWN_KIND' }), null);
  });
});
