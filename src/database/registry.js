'use strict';

const mesh          = require('./drivers/mesh-adapter');
const sqlite3       = require('./drivers/sqlite3');
const arango        = require('./drivers/arango');
const biocyc        = require('./drivers/biocyc');
const rest          = require('./drivers/rest');
const kegg          = require('./drivers/kegg');
const elasticsearch = require('./drivers/elasticsearch');

/**
 * Resolve a driver module by its name.
 * Centralised here so connector.js and introspect.js stay in sync.
 *
 * SQL databases (postgres, mysql), Neo4j, and all new source types are
 * accessed through graphql-mesh handlers in mesh-adapter.js.
 *
 * SQLite3 uses a legacy knex-based driver because @graphql-mesh/tuql depends
 * on a critically vulnerable version of sequelize and cannot be used until a
 * secure mesh handler is available.
 *
 * ArangoDB and BioCyc retain their custom drivers because no graphql-mesh
 * handler exists for these sources.
 *
 * The legacy `rest` driver remains available for plain HTTP endpoints that
 * do not have an OpenAPI specification; use `openapi` for spec-backed REST.
 */
function getDriver(driverName) {
  switch (driverName) {
    // ── Mesh-backed drivers ────────────────────────────────────────────────
    case 'postgres':
    case 'mysql':
    case 'neo4j':
    case 'openapi':
    case 'soap':
    case 'odata':
    case 'thrift':
    case 'mongodb':
      return mesh;

    // ── SQLite3 (legacy knex driver – tuql has critical vulnerability) ─────
    case 'sqlite3':
      return sqlite3;

    // ── Legacy custom drivers ──────────────────────────────────────────────
    // ArangoDB: no graphql-mesh handler available
    case 'arango':
      return arango;

    // BioCyc: no graphql-mesh handler available
    case 'biocyc':
      return biocyc;

    // Plain REST without an OpenAPI spec (use `openapi` for spec-backed REST)
    case 'rest':
      return rest;

    // KEGG (rest.kegg.jp) – text/plain adapter with TSV + flat-file parsing
    case 'kegg':
      return kegg;

    // Elasticsearch – REST adapter supporting GET and POST /_search queries
    case 'elasticsearch':
      return elasticsearch;

    default:
      throw new Error(`Unknown driver: ${driverName}`);
  }
}

module.exports = { getDriver };
