#!/usr/bin/env node
'use strict'

/**
 * Catalog health check script.
 *
 * Iterates over every catalog entry reachable without credentials and issues a
 * lightweight probe to verify the endpoint is still answering.  SQL / Graph /
 * BioCyc entries need credentials and are skipped.
 *
 * A probe asserts only what the catalog actually claims: that the endpoint
 * responds successfully with a non-empty body.  It does not demand JSON —
 * several catalogued APIs return XML (NCBI E-utilities) or TSV (KEGG) by
 * design, and insisting on JSON reported those as broken when they were fine.
 * Entries whose list endpoint needs query parameters or extra headers declare
 * them in a `probe` block on the catalog entry.
 *
 * Results are written to --output <file> (default: catalog-health.json).
 * The script exits 0 even when some checks fail so CI records the report
 * as an artifact without blocking the workflow.
 *
 * Usage: node scripts/catalog-health.js [--output catalog-health.json]
 */

const { getCatalog } = require('../src/catalog')

const PROBE_TIMEOUT_MS = 20_000
const RETRY_DELAY_MS = 2_000
const SKIP_DRIVERS = new Set(['sqlite3', 'postgres', 'mysql', 'neo4j', 'arango', 'biocyc',
  'openapi', 'soap', 'odata', 'thrift'])

// Several public APIs reject requests that arrive without a User-Agent.
const PROBE_USER_AGENT = 'mozg-catalog-health/1.0 (+https://github.com/Skitionek/Mozg)'

// Parse --output flag
const outputArg = process.argv.indexOf('--output')
const outputFile = outputArg !== -1 ? process.argv[outputArg + 1] : 'catalog-health.json'

async function probe (entry) {
  if (SKIP_DRIVERS.has(entry.driver)) {
    return { status: 'skipped', reason: `driver=${entry.driver} requires credentials` }
  }

  const hint = entry.probe || {}

  if (hint.skip) {
    return { status: 'skipped', reason: hint.skip }
  }

  const entityName = hint.entity || (entry.entities && entry.entities[0] && entry.entities[0].name)
  if (!entityName) {
    return { status: 'skipped', reason: 'no entities defined' }
  }

  const base = (entry.connection.database || '').replace(/\/$/, '')
  const path = entityName.startsWith('/') ? entityName : `/${entityName}`
  const url = new URL(`${base}${path}`)

  // Many list endpoints are only valid with a query, a key, or a coordinate.
  for (const [key, value] of Object.entries(hint.params || {})) {
    url.searchParams.set(key, String(value))
  }

  const headers = {
    Accept: hint.accept || 'application/json, text/plain, application/xml;q=0.9, */*;q=0.8',
    'User-Agent': PROBE_USER_AGENT,
    ...(entry.connection.headers || {}),
    ...(hint.headers || {})
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

    const res = await fetch(url, { headers, signal: controller.signal })
      .finally(() => clearTimeout(timer))

    if (!res.ok) {
      // A 4xx means the catalog is wrong about this endpoint; a 5xx means
      // their server is having a bad day.  Only the first is our problem.
      const status = res.status >= 500 ? 'unavailable' : 'broken'
      return { status, httpStatus: res.status, url: url.toString() }
    }

    // The catalog only claims the endpoint answers; an empty body means it did
    // not really answer, whatever status it reported.
    const body = await res.text()
    if (body.trim() === '') {
      return { status: 'broken', error: 'empty response body', httpStatus: res.status, url: url.toString() }
    }

    return {
      status: 'ok',
      httpStatus: res.status,
      contentType: (res.headers.get('content-type') || '').split(';')[0] || null,
      url: url.toString()
    }
  } catch (err) {
    // Timeouts and DNS/connection failures are availability problems, not
    // evidence that the catalog entry is wrong.
    return { status: 'unavailable', error: err.message, url: url.toString() }
  }
}

/**
 * Probe an entry, retrying once on an availability failure so a single slow
 * response or blip does not get reported as an outage.
 */
async function probeWithRetry (entry) {
  const first = await probe(entry)
  if (first.status !== 'unavailable') return first

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  return probe(entry)
}

async function main () {
  const all = getCatalog()
  const report = {
    timestamp: new Date().toISOString(),
    total: all.length,
    results: []
  }

  const counts = { ok: 0, broken: 0, unavailable: 0, skipped: 0 }

  for (const entry of all) {
    process.stdout.write(`  ${entry.name} ... `)
    const result = await probeWithRetry(entry)
    report.results.push({ name: entry.name, driver: entry.driver, ...result })
    counts[result.status]++

    if (result.status === 'ok') {
      process.stdout.write('OK\n')
    } else if (result.status === 'skipped') {
      process.stdout.write(`SKIPPED (${result.reason})\n`)
    } else if (result.status === 'unavailable') {
      process.stdout.write(`UNAVAILABLE (${result.error || result.httpStatus})\n`)
    } else {
      process.stdout.write(`BROKEN (${result.error || result.httpStatus})\n`)
    }
  }

  report.summary = counts

  const fs = require('node:fs')
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2))

  console.log(
    `\nHealth check complete: ${counts.ok} ok, ${counts.broken} broken, ` +
    `${counts.unavailable} unavailable, ${counts.skipped} skipped`
  )
  console.log(`Report written to ${outputFile}`)

  const broken = report.results.filter((r) => r.status === 'broken')
  if (broken.length > 0) {
    console.error('\nThese entries describe an endpoint that answered 4xx — the catalog is wrong about them:')
    for (const r of broken) console.error(`  ${r.name}: ${r.httpStatus || r.error} ${r.url}`)
  }

  // A 4xx means the catalog itself is wrong, which is actionable here, so it
  // fails the job.  Third-party downtime is recorded but never fails it.
  process.exit(broken.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('catalog-health: fatal error:', err.message)
  process.exit(1)
})
