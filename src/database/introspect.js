'use strict'

const { getDriver } = require('./registry')

async function introspectDatabase (connection) {
  const driver = getDriver(connection.driver)
  return driver.introspect(connection)
}

module.exports = { introspectDatabase }
