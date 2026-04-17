'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getDriver } = require('../src/database/registry');

// Optional-dependency availability checks — used to skip tests when a package
// is not installed in the current environment.
function available(pkg) {
  try { require(pkg); return true; } catch { return false; }
}
const hasMesh    = available('graphql');
const hasKnex    = available('knex');
const hasArango  = available('arangojs');
const SKIP_MESH  = !hasMesh   ? 'graphql / graphql-mesh not installed' : false;
const SKIP_KNEX  = !hasKnex   ? 'knex not installed' : false;
const SKIP_ARANGO = !hasArango ? 'arangojs not installed' : false;

describe('registry.getDriver', () => {
  // ── Mesh-backed drivers ──────────────────────────────────────────────────

  test('resolves postgres to mesh adapter', { skip: SKIP_MESH }, () => {
    const d = getDriver('postgres');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves mysql to mesh adapter', { skip: SKIP_MESH }, () => {
    const d = getDriver('mysql');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves neo4j to mesh adapter', { skip: SKIP_MESH }, () => {
    const d = getDriver('neo4j');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves openapi to mesh adapter', { skip: SKIP_MESH }, () => {
    const d = getDriver('openapi');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves soap to mesh adapter', { skip: SKIP_MESH }, () => {
    const d = getDriver('soap');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves odata to mesh adapter', { skip: SKIP_MESH }, () => {
    const d = getDriver('odata');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves thrift to mesh adapter', { skip: SKIP_MESH }, () => {
    const d = getDriver('thrift');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves mongodb to mesh adapter', { skip: SKIP_MESH }, () => {
    const d = getDriver('mongodb');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  // ── Legacy custom drivers ────────────────────────────────────────────────

  test('resolves sqlite3 to legacy sql driver', { skip: SKIP_KNEX }, () => {
    const d = getDriver('sqlite3');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves arango driver', { skip: SKIP_ARANGO }, () => {
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

  test('resolves kegg driver', () => {
    const d = getDriver('kegg');
    assert.equal(typeof d.executeQuery, 'function');
    assert.equal(typeof d.introspect, 'function');
  });

  test('resolves elasticsearch driver', () => {
    const d = getDriver('elasticsearch');
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

