#!/usr/bin/env node
'use strict'

/**
 * Lint the catalog entries the chart renders for its self-hosted databases
 * with Mozg's own catalog lint: OBO keys, oboForm, relations and their
 * targets — the same checks every built-in source passes.
 *
 * Usage: node deploy/helm/mozg/ci/lint-sources.js <dir of *.json entries>
 */

const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..', '..', '..')
const { getCatalog, listCatalog } = require(path.join(root, 'src/catalog'))
const { lintEntry } = require(path.join(root, 'src/database/catalog-lint'))

const dir = process.argv[2]
const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
const byName = new Map(entries.map((e) => [e.name, e]))
const lookup = (name) => byName.get(name) || (listCatalog().includes(name) ? getCatalog(name)[0] : null)

let problems = 0
for (const entry of entries) {
  const found = lintEntry(entry, lookup)
  for (const p of found) console.error(`✗ ${p}`)
  if (found.length === 0) console.log(`✓ ${entry.name}: ${entry.entities.length} entities`)
  problems += found.length
}
process.exit(problems ? 1 : 0)
