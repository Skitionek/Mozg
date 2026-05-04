'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { isValidGraphQLName } = require('../src/database/drivers/mesh-adapter');

describe('isValidGraphQLName', () => {
  // ── Valid names ────────────────────────────────────────────────────────────

  test('accepts a simple field name', () => {
    assert.equal(isValidGraphQLName('title'), true);
  });

  test('accepts a camelCase field name', () => {
    assert.equal(isValidGraphQLName('firstName'), true);
  });

  test('accepts a name with leading underscore', () => {
    assert.equal(isValidGraphQLName('_id'), true);
  });

  test('accepts a name with digits after the first character', () => {
    assert.equal(isValidGraphQLName('field2'), true);
  });

  test('accepts a name with mixed case and underscores', () => {
    assert.equal(isValidGraphQLName('My_Field_Name'), true);
  });

  test('accepts a single letter', () => {
    assert.equal(isValidGraphQLName('x'), true);
  });

  // ── Invalid names (injection characters) ─────────────────────────────────

  test('rejects a name containing a closing brace', () => {
    assert.equal(isValidGraphQLName('foo}bar'), false);
  });

  test('rejects a name containing an opening brace', () => {
    assert.equal(isValidGraphQLName('foo{bar'), false);
  });

  test('rejects a name containing a colon', () => {
    assert.equal(isValidGraphQLName('foo:bar'), false);
  });

  test('rejects a name containing a dot', () => {
    assert.equal(isValidGraphQLName('foo.bar'), false);
  });

  test('rejects a name containing a backtick', () => {
    assert.equal(isValidGraphQLName('foo`bar'), false);
  });

  test('rejects a name containing a double-quote', () => {
    assert.equal(isValidGraphQLName('foo"bar'), false);
  });

  test('rejects a name starting with a digit', () => {
    assert.equal(isValidGraphQLName('1foo'), false);
  });

  test('rejects an empty string', () => {
    assert.equal(isValidGraphQLName(''), false);
  });

  test('rejects null', () => {
    assert.equal(isValidGraphQLName(null), false);
  });

  test('rejects undefined', () => {
    assert.equal(isValidGraphQLName(undefined), false);
  });

  test('rejects a number', () => {
    assert.equal(isValidGraphQLName(42), false);
  });

  test('rejects a name with a space', () => {
    assert.equal(isValidGraphQLName('foo bar'), false);
  });

  test('rejects a Cypher injection pattern', () => {
    // This is the classic injection pattern from the original issue
    assert.equal(isValidGraphQLName('n.title'), false);
  });

  test('rejects a GraphQL argument injection attempt', () => {
    assert.equal(isValidGraphQLName('foo: asc} limit: 0 {bar'), false);
  });
});
