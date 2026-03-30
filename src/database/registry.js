'use strict';

const sql    = require('./drivers/sql');
const neo4j  = require('./drivers/neo4j');
const arango = require('./drivers/arango');
const biocyc = require('./drivers/biocyc');
const rest   = require('./drivers/rest');

/**
 * Resolve a driver module by its name.
 * Centralised here so connector.js and introspect.js stay in sync.
 */
function getDriver(driverName) {
  switch (driverName) {
    case 'postgres':
    case 'mysql':
    case 'sqlite3':
      return sql;
    case 'neo4j':
      return neo4j;
    case 'arango':
      return arango;
    case 'biocyc':
      return biocyc;
    case 'rest':
      return rest;
    default:
      throw new Error(`Unknown driver: ${driverName}`);
  }
}

module.exports = { getDriver };
