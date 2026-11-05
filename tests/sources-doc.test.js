'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { render, OUT } = require('../scripts/sources-doc')

test('docs/sources.md matches the catalog (run `npm run docs:sources` to regenerate)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), render())
})

test('--check exits 0 when the page is current', () => {
  const { spawnSync } = require('node:child_process')
  const path = require('node:path')
  const out = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sources-doc.js'), '--check'], { encoding: 'utf8' })
  assert.equal(out.status, 0, out.stdout + out.stderr)
  assert.match(out.stdout, /up to date/)
})
