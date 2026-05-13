'use strict'

const { getDriver } = require('./registry')

async function executeQuery (input) {
  const driver = getDriver(input.connection.driver)
  return driver.executeQuery(input)
}

module.exports = { executeQuery }
