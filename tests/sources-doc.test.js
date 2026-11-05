'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { render, OUT } = require('../scripts/sources-doc')

test('docs/sources.md matches the catalog (run `npm run docs:sources` to regenerate)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), render())
})
