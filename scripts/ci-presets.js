#!/usr/bin/env node
'use strict'

/**
 * Checks the CI version presets (.github/ci-presets.json) against
 * endoflife.date, so they do not silently fall behind.
 *
 * For every component endoflife.date tracks, it expects
 *   - oldest: the release line that is the oldest one still supported,
 *   - lts:    the newest supported long-term-support line, or the newest
 *             supported line for a project without LTS releases,
 *   - newest: a version no older than the newest release line,
 * and that every pinned version (`pins`) is still supported.  A preset on
 * the wrong release line is drift and fails the check; a newer patch within
 * the right line is only reported.  Helm and kind are not tracked by
 * endoflife.date; their versions are checked by hand.
 *
 * Usage: node scripts/ci-presets.js [--presets .github/ci-presets.json]
 * Writes a Markdown report to stdout (and to $GITHUB_STEP_SUMMARY when set)
 * and exits 1 on drift.
 */

const fs = require('node:fs')
const path = require('node:path')

/** Preset key -> endoflife.date product. */
const PRODUCTS = {
  node: 'nodejs',
  postgres: 'postgresql',
  mysql: 'mysql',
  mariadb: 'mariadb',
  neo4j: 'neo4j',
  arangodb: 'arangodb',
  elasticsearch: 'elasticsearch',
  kubernetes: 'kubernetes',
  keda: 'keda'
}

const API = 'https://endoflife.date/api/v1/products/'

/** "v1.35.8" -> "1.35.8", "14-alpine" -> "14", "19rc1-alpine" -> "19rc1" */
function bareVersion (version) {
  return String(version).replace(/^v/, '').split('-')[0]
}

/** Numeric parts of a version: "19rc1" -> [19], "2026.10.1" -> [2026, 10, 1] */
function versionParts (version) {
  return bareVersion(version).split('.').map(part => parseInt(part, 10)).filter(Number.isFinite)
}

/** Compares two versions part by part; missing parts count as 0. */
function compareVersions (a, b) {
  const x = versionParts(a)
  const y = versionParts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return Math.sign(d)
  }
  return 0
}

/** The release line a version belongs to: the longest line name it starts with. */
function lineOf (version, releases) {
  const bare = bareVersion(version)
  return releases
    .filter(r => bare === r.name || bare.startsWith(`${r.name}.`))
    .sort((a, b) => b.name.length - a.name.length)[0]
}

function isSupported (release, today) {
  if (release.isEol === true && !release.eolFrom) return false
  return !release.eolFrom || release.eolFrom > today
}

function isLts (release, today) {
  return release.isLts === true && (!release.ltsFrom || release.ltsFrom <= today)
}

const byReleaseDate = (a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate))

/**
 * What each preset should hold for one product, from its releases.
 * Returns { oldest, lts, newest }: release objects (or undefined).
 */
function expectedLines (releases, today) {
  const supported = releases.filter(r => isSupported(r, today)).sort(byReleaseDate)
  const lts = supported.filter(r => isLts(r, today))
  return {
    oldest: supported[0],
    lts: lts.length ? lts[lts.length - 1] : supported[supported.length - 1],
    newest: supported[supported.length - 1]
  }
}

/**
 * Compares the presets with endoflife.date's releases.
 * `releasesByKey` maps a preset key (node, postgres ...) to its releases.
 * Returns { drift: [...], notices: [...], rows: [...] }, messages as strings.
 */
function checkPresets (config, releasesByKey, today) {
  const drift = []
  const notices = []
  const rows = []
  const pins = config.pins || {}
  for (const [key, releases] of Object.entries(releasesByKey)) {
    const expected = expectedLines(releases, today)
    const row = { key, product: PRODUCTS[key] || key, cells: {} }
    rows.push(row)
    for (const [name, preset] of Object.entries(config.presets)) {
      const version = preset[key]
      if (version === undefined) continue
      const line = lineOf(version, releases)
      row.cells[name] = version
      if (pins[key]) {
        if (line && !isSupported(line, today)) drift.push(`${key} ${version} (${name}, pinned) is no longer supported: its line ${line.name} reached end of life on ${line.eolFrom}`)
        continue
      }
      if (name === 'newest') {
        if (expected.newest && compareVersions(version, expected.newest.name) < 0) {
          drift.push(`${key} ${version} (newest) is older than the newest release line, ${expected.newest.name}`)
        } else if (expected.newest && line === expected.newest && compareVersions(version, expected.newest.latest?.name) < 0) {
          notices.push(`${key} ${version} (newest): ${expected.newest.latest.name} is out`)
        }
        continue
      }
      const want = expected[name]
      if (!want) continue
      if (!line || line.name !== want.name) {
        drift.push(`${key} ${version} (${name}) should be on the ${want.name} line${line ? `, not ${line.name}` : ''}`)
      } else if (versionParts(version).length > versionParts(line.name).length && want.latest?.name && compareVersions(version, want.latest.name) < 0) {
        notices.push(`${key} ${version} (${name}): ${want.latest.name} is out`)
      }
    }
  }
  return { drift, notices, rows }
}

function report ({ drift, notices, rows }, presetNames, today) {
  const lines = [`## CI presets against endoflife.date (${today})`, '']
  lines.push(`| component | ${presetNames.join(' | ')} |`, `|---|${presetNames.map(() => '---').join('|')}|`)
  for (const row of rows) lines.push(`| ${row.key} | ${presetNames.map(n => row.cells[n] ?? '').join(' | ')} |`)
  lines.push('')
  if (drift.length) lines.push('### Drift', '', ...drift.map(d => `- ${d}`), '')
  if (notices.length) lines.push('### Newer patch releases', '', ...notices.map(n => `- ${n}`), '')
  if (!drift.length) lines.push('Every preset is on the release line it should be.', '')
  return lines.join('\n')
}

async function fetchReleases (product, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}${encodeURIComponent(product)}`, {
    headers: { 'User-Agent': 'mozg-ci-presets/1.0 (+https://github.com/Skitionek/Mozg)' },
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) throw new Error(`endoflife.date ${product}: HTTP ${res.status}`)
  const body = await res.json()
  return body.result.releases
}

async function main (argv = process.argv.slice(2), { fetchImpl = fetch, today = new Date().toISOString().slice(0, 10), out = process.stdout } = {}) {
  const at = argv.indexOf('--presets')
  const file = at >= 0 ? argv[at + 1] : path.join(__dirname, '..', '.github', 'ci-presets.json')
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  const releasesByKey = {}
  for (const [key, product] of Object.entries(PRODUCTS)) {
    releasesByKey[key] = await fetchReleases(product, fetchImpl)
  }
  const result = checkPresets(config, releasesByKey, today)
  const text = report(result, Object.keys(config.presets), today)
  out.write(`${text}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  return result.drift.length ? 1 : 0
}

module.exports = { PRODUCTS, bareVersion, compareVersions, lineOf, expectedLines, checkPresets, report, fetchReleases, main }

if (require.main === module) {
  main().then(code => { process.exitCode = code }, err => {
    console.error(err.message)
    process.exitCode = 2
  })
}
