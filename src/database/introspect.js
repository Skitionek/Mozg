'use strict'

const registry = require('./registry')
const { withWake } = require('./self-hosted')

/**
 * Describe a database's tables and columns.  Like a query, introspecting a
 * database hosted with this server counts as demand for it and waits out a
 * cold start when it has scaled to zero.
 */
async function introspectDatabase (connection) {
  const driver = registry.getDriver(connection.driver)
  return withWake(connection, () => driver.introspect(connection))
}

module.exports = { introspectDatabase }
