'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getDriver } = require('../src/database/registry');

describe('registry.getDriver', () => {
  test('resolves sqlite3 to sql driver', () => {
    const d = getDriver('sqlite3');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves postgres to sql driver', () => {
    const d = getDriver('postgres');
    assert.equal(typeof d.executeQuery, 'function');
  });

  test('resolves mysql to sql driver', () => {
    const d = getDriver('mysql');
    assert.equal(typeof d.executeQuery, 'function');
  });

  test('resolves neo4j driver', () => {
    const d = getDriver('neo4j');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves arango driver', () => {
    const d = getDriver('arango');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves biocyc driver', () => {
    const d = getDriver('biocyc');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves rest driver', () => {
    const d = getDriver('rest');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('throws on unknown driver', () => {
    assert.throws(
      () => getDriver('unknowndb'),
      /Unknown driver: unknowndb/
    );
  });
});
