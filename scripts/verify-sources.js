#!/usr/bin/env node
'use strict'

/**
 * Live verification of catalog `api` sources.
 *
 * For each entity: runs its declared `example` through the real query path
 * and checks that rows come back and which declared fields were populated.
 * Then, unless --no-relations, follows every relation from the first row and
 * checks that it resolves.
 *
 * Outcomes:
 *   ok           rows came back (relations: resolved, possibly to nothing)
 *   empty        the example returned no rows — the catalog is wrong
 *   broken       a 4xx or a mapping error — the catalog is wrong
 *   unavailable  5xx / 429 / timeout — the upstream is having a bad day
 *   pending      a relation points at a source that is not registered (yet)
 *
 * Before any of that, the entry is linted statically (src/database/catalog-lint.js);
 * lint problems count as broken.
 *
 * Usage:
 *   node scripts/verify-sources.js [source …] [--no-relations] [--static] [--json report.json]
 *
 *   --static        lint only, no network
 *
 * Exits 1 when anything is empty or broken; upstream downtime never fails it.
 */

const { getCatalog, listCatalog } = require('../src/catalog')
const { executeQuery } = require('../src/database/connector')
const { fetchRelation } = require('../src/database/relations')
const { connectionForSource, entityColumns } = require('../src/database/sources')
const { HttpError } = require('../src/database/http')
const { lintEntry } = require('../src/database/catalog-lint')

// Resolve another entry for the linter without failing when its file does not
// exist yet (sources are written in parallel; a missing one reads as unregistered).
function lookup (name) {
  try {
    return listCatalog().includes(name) ? getCatalog(name)[0] : null
  } catch {
    return null
  }
}

function classify (err) {
  // A source that is unregistered, or registered but not written yet, is
  // someone else's work in progress rather than a defect in this entry.
  if (/^Unknown catalog: |Cannot find module '\.\/[^']+'/.test(err.message)) return 'pending'
  if (err instanceof HttpError && err.transient) return 'unavailable'
  return 'broken'
}

function isEmptyValue (v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

/**
 * Verify one catalog entry.
 * @param {object} entry
 * @param {{relations?: boolean, entities?: string[]}} [options]
 * @returns {Promise<Array<object>>} one result per entity (with nested relation results)
 */
async function verifySource (entry, options = {}) {
  const followRelations = options.relations !== false
  const results = []

  for (const entity of entry.entities) {
    if (options.entities && !options.entities.includes(entity.name)) continue
    const started = Date.now()
    const result = { source: entry.name, entity: entity.name, relations: [] }
    results.push(result)

    if (!entity.example) {
      result.status = 'broken'
      result.error = 'no example declared'
      continue
    }

    let rows
    try {
      const { data } = await executeQuery({ source: entry.name, from: entity.name, where: entity.example, limit: 3 })
      rows = data
    } catch (err) {
      result.status = classify(err)
      result.error = err.message
      result.ms = Date.now() - started
      continue
    }
    result.ms = Date.now() - started
    result.count = rows.length

    if (rows.length === 0) {
      result.status = 'empty'
      result.error = `example ${JSON.stringify(entity.example)} returned no rows`
      continue
    }

    const columns = entityColumns(entity)
    result.emptyFields = columns.filter((c) => rows.every((row) => isEmptyValue(row[c])))
    result.status = result.emptyFields.length === columns.length && columns.length > 0 ? 'broken' : 'ok'
    if (result.status === 'broken') result.error = 'every declared field came back empty — the field mapping does not match the response'

    if (!followRelations) continue

    const row = rows[0]
    for (const rel of entity.relations || []) {
      const alias = rel.alias || rel.entity
      const relStarted = Date.now()
      const relResult = { alias, target: `${rel.catalog || entry.name}/${rel.entity}` }
      result.relations.push(relResult)
      try {
        const connection = connectionForSource(rel.catalog || entry.name)
        const value = await fetchRelation(executeQuery, connection, row, rel)
        relResult.ms = Date.now() - relStarted
        if (row[rel.localKey || 'id'] == null) {
          relResult.status = 'ok'
          relResult.note = `parent ${rel.localKey || 'id'} is empty in the example row`
        } else if (value == null || (Array.isArray(value) && value.length === 0)) {
          relResult.status = 'ok'
          relResult.note = 'resolved to nothing for the example row'
        } else {
          relResult.status = 'ok'
          relResult.count = Array.isArray(value) ? value.length : 1
        }
      } catch (err) {
        relResult.ms = Date.now() - relStarted
        relResult.status = classify(err)
        relResult.error = err.message
      }
    }
  }

  return results
}

function symbol (status) {
  return { ok: '✓', empty: '∅', broken: '✗', unavailable: '…', pending: '○' }[status] || '?'
}

async function main () {
  const args = process.argv.slice(2)
  const followRelations = !args.includes('--no-relations')
  const staticOnly = args.includes('--static')
  const jsonIdx = args.indexOf('--json')
  const jsonFile = jsonIdx !== -1 ? args[jsonIdx + 1] : null
  const names = args.filter((a, i) => !a.startsWith('--') && (jsonIdx === -1 || i !== jsonIdx + 1))

  const entries = (names.length ? names : listCatalog())
    .map((n) => (names.length ? getCatalog(n)[0] : lookup(n)))
    .filter((e) => e && e.driver === 'api')

  const all = []
  const tally = { ok: 0, empty: 0, broken: 0, unavailable: 0, pending: 0 }
  const failures = []

  for (const entry of entries) {
    console.log(`\n${entry.name} — ${entry.label}`)
    for (const problem of lintEntry(entry, lookup)) {
      // An unregistered target is someone else's work in progress, not this entry's fault.
      if (/is not registered/.test(problem)) {
        tally.pending++
        console.log(`  ○ lint: ${problem}`)
      } else {
        tally.broken++
        failures.push(`lint: ${problem}`)
        console.log(`  ✗ lint: ${problem}`)
      }
    }
    if (staticOnly) continue
    const results = await verifySource(entry, { relations: followRelations })
    for (const r of results) {
      all.push(r)
      tally[r.status]++
      const extra = r.status === 'ok'
        ? `${r.count} row(s), ${r.ms} ms${r.emptyFields.length ? `; empty: ${r.emptyFields.join(', ')}` : ''}`
        : r.error
      console.log(`  ${symbol(r.status)} ${r.entity}  ${extra}`)
      if (r.status === 'empty' || r.status === 'broken') failures.push(`${r.source}/${r.entity}: ${r.error}`)
      for (const rel of r.relations) {
        tally[rel.status]++
        const detail = rel.status === 'ok' ? (rel.note || `${rel.count} row(s)`) + `, ${rel.ms} ms` : rel.error
        console.log(`      ${symbol(rel.status)} → ${rel.alias} (${rel.target})  ${detail}`)
        if (rel.status === 'broken') failures.push(`${r.source}/${r.entity} → ${rel.alias}: ${rel.error}`)
      }
    }
  }

  console.log(`\n${tally.ok} ok, ${tally.empty} empty, ${tally.broken} broken, ${tally.unavailable} unavailable, ${tally.pending} pending`)
  if (failures.length) {
    console.log('\nNeeds fixing in the catalog:')
    for (const f of failures) console.log(`  ${f}`)
  }

  if (jsonFile) {
    require('node:fs').writeFileSync(jsonFile, JSON.stringify({ timestamp: new Date().toISOString(), tally, results: all }, null, 2))
  }

  process.exit(failures.length ? 1 : 0)
}

if (require.main === module) {
  main().catch((err) => {
    console.error('verify-sources: fatal error:', err.stack || err.message)
    process.exit(1)
  })
}

module.exports = { verifySource }
