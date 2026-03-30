'use strict';

const sql    = require('./drivers/sql');
const neo4j  = require('./drivers/neo4j');
const arango = require('./drivers/arango');
const biocyc = require('./drivers/biocyc');
const rest   = require('./drivers/rest');

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

async function introspectDatabase(connection) {
  const driver = getDriver(connection.driver);
  return driver.introspect(connection);
}

module.exports = { introspectDatabase };
