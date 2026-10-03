'use strict'

const { test, describe, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { executeQuery, introspect, destroyAll } = require('../src/database/drivers/sqlite3')

/** A path inside the OS temp dir that is guaranteed not to exist yet. */
function missingDatabasePath () {
  return path.join(os.tmpdir(), `mozg-missing-${process.pid}-${Math.random().toString(36).slice(2)}.db`)
}

afterEach(async () => {
  await destroyAll()
})

describe('sqlite3 driver: a database file that does not exist', () => {
  test('introspect rejects instead of reporting an empty schema', async () => {
    // Given a path with no SQLite database at it
    const missing = missingDatabasePath()
    assert.equal(fs.existsSync(missing), false)

    // When introspecting that path
    const attempt = introspect({ database: missing })

    // Then it reports the missing database rather than succeeding
    await assert.rejects(attempt, /SQLite database not found/)
  })

  test('introspect does not create the file as a side effect', async () => {
    // Given a path with no SQLite database at it
    const missing = missingDatabasePath()

    // When introspecting that path
    await introspect({ database: missing }).catch(() => {})

    // Then nothing was written to disk
    assert.equal(fs.existsSync(missing), false)
  })

  test('executeQuery rejects and creates nothing', async () => {
    // Given a path with no SQLite database at it
    const missing = missingDatabasePath()

    // When querying through that path
    const attempt = executeQuery({ connection: { database: missing }, from: 'users' })

    // Then it reports the missing database and leaves the filesystem untouched
    await assert.rejects(attempt, /SQLite database not found/)
    assert.equal(fs.existsSync(missing), false)
  })
})

describe('sqlite3 driver: a database file that exists', () => {
  test('introspect still reads the seeded sample database', async () => {
    // Given the seeded example database
    const sample = path.join(__dirname, '..', 'examples', 'sample.db')
    assert.equal(fs.existsSync(sample), true, 'run `node examples/seed.js` first')

    // When introspecting it
    const result = await introspect({ database: sample })

    // Then its tables are reported
    const tableNames = result.tables.map((t) => t.name)
    assert.ok(tableNames.includes('users'), `expected a users table, got ${tableNames}`)
  })
})
