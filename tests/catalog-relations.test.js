'use strict'

/**
 * Every catalog entry is executable as described and every relation can
 * resolve: the target exists, its join key is a parameter the target accepts,
 * and the parent rows carry the field it is read from.  See
 * src/database/catalog-lint.js for why each rule exists.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { getCatalog } = require('../src/catalog')
const { lintEntry } = require('../src/database/catalog-lint')

const entries = getCatalog()
const byName = new Map(entries.map((e) => [e.name, e]))
const apiEntries = entries.filter((e) => e.driver === 'api')

describe('catalog lint', () => {
  test('many life-science sources are connected', () => {
    assert.ok(apiEntries.length >= 30, `expected at least 30 api sources, found ${apiEntries.length}`)
  })

  for (const entry of entries) {
    test(entry.name, () => {
      const problems = lintEntry(entry, (name) => byName.get(name) || null)
      assert.deepEqual(problems, [])
    })
  }
})
