'use strict'

const registry = require('./registry')

async function introspectDatabase (connection) {
  const driver = registry.getDriver(connection.driver)
  return driver.introspect(connection)
}

module.exports = { introspectDatabase }
