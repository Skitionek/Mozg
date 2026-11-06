'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  PRODUCTS, bareVersion, compareVersions, lineOf, expectedLines, checkPresets, report, fetchReleases, main
} = require('../scripts/ci-presets')

const ROOT = path.join(__dirname, '..')
const PRESETS_FILE = path.join(ROOT, '.github', 'ci-presets.json')
const presets = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'))

// endoflife.date's shape (api/v1/products/<product>), trimmed.
const release = (name, releaseDate, eolFrom, latest, extra = {}) =>
  ({ name, releaseDate, eolFrom, isEol: false, isLts: false, latest: { name: latest }, ...extra })
const NODE = [
  release('26', '2026-05-05', '2029-04-30', '26.13.0', { isLts: true, ltsFrom: '2026-10-28' }),
  release('25', '2025-10-15', '2026-06-01', '25.9.0'),
  release('24', '2025-05-06', '2028-04-30', '24.22.2', { isLts: true, ltsFrom: '2025-10-28' }),
  release('22', '2024-04-24', '2027-04-30', '22.23.4', { isLts: true, ltsFrom: '2024-10-29' }),
  release('20', '2023-04-18', '2026-04-30', '20.20.0', { isLts: true, isEol: true })
]
const POSTGRES = [
  release('18', '2025-09-25', '2030-11-14', '18.6'),
  release('17', '2024-09-26', '2029-11-08', '17.11'),
  release('14', '2021-09-30', '2026-11-12', '14.24'),
  release('13', '2020-09-24', '2025-11-13', '13.23')
]
const MYSQL = [
  release('9.7', '2026-04-21', '2034-04-30', '9.7.4', { isLts: true }),
  release('8.4', '2024-04-30', '2032-04-30', '8.4.13', { isLts: true })
]
const ELASTICSEARCH = [
  release('9.5', '2026-08-04', null, '9.5.6'),
  release('8.19', '2025-07-29', '2027-07-15', '8.19.24')
]
const TODAY = '2026-11-06'

test('versions are read the way the presets write them', () => {
  assert.equal(bareVersion('v1.35.8'), '1.35.8')
  assert.equal(bareVersion('14-alpine'), '14')
  assert.equal(bareVersion('5.26-community'), '5.26')
  assert.equal(bareVersion('9.7.0-SNAPSHOT'), '9.7.0')
  assert.equal(compareVersions('19rc1-alpine', '18'), 1)
  assert.equal(compareVersions('28-nightly', '26'), 1)
  assert.equal(compareVersions('8.19.9', '8.19.24'), -1)
  assert.equal(compareVersions('2026.10.1-community', '2026.10'), 1)
  assert.equal(compareVersions('v1.37.0', '1.37'), 0)
  assert.equal(lineOf('8.19.9', ELASTICSEARCH).name, '8.19')
  assert.equal(lineOf('14-alpine', POSTGRES).name, '14')
  assert.equal(lineOf('15', POSTGRES), undefined)
})

test('expected lines: oldest supported, newest LTS (or newest), newest', () => {
  const node = expectedLines(NODE, TODAY)
  assert.deepEqual([node.oldest.name, node.lts.name, node.newest.name], ['22', '26', '26'])
  // Before 26 became LTS, the LTS line was 24.
  assert.equal(expectedLines(NODE, '2026-10-01').lts.name, '24')
  // No LTS releases: the newest supported one.
  const pg = expectedLines(POSTGRES, TODAY)
  assert.deepEqual([pg.oldest.name, pg.lts.name], ['14', '18'])
  // A line drops out on its end-of-life date.
  assert.equal(expectedLines(POSTGRES, '2026-11-12').oldest.name, '17')
})

test('presets on the right lines pass, with newer patches only reported', () => {
  const config = {
    pins: {},
    presets: {
      oldest: { node: '22', postgres: '14-alpine', elasticsearch: '8.19.9' },
      lts: { node: '26', postgres: '18-alpine', elasticsearch: '9.5.6' },
      newest: { node: '28-nightly', postgres: '19rc1-alpine', elasticsearch: '9.7.0-SNAPSHOT' }
    }
  }
  const result = checkPresets(config, { node: NODE, postgres: POSTGRES, elasticsearch: ELASTICSEARCH }, TODAY)
  assert.deepEqual(result.drift, [])
  assert.deepEqual(result.notices, ['elasticsearch 8.19.9 (oldest): 8.19.24 is out'])
  const text = report(result, ['oldest', 'lts', 'newest'], TODAY)
  assert.match(text, /\| node \| 22 \| 26 \| 28-nightly \|/)
  assert.match(text, /Every preset is on the release line it should be/)
})

test('drift: an end-of-life oldest, a stale LTS, a newest behind the newest line', () => {
  const config = {
    pins: {},
    presets: {
      oldest: { node: '20', postgres: '13-alpine' },
      lts: { node: '24', postgres: '17-alpine' },
      newest: { node: '24', postgres: '18-alpine' }
    }
  }
  const { drift } = checkPresets(config, { node: NODE, postgres: POSTGRES }, TODAY)
  assert.deepEqual(drift, [
    'node 20 (oldest) should be on the 22 line, not 20',
    'node 24 (lts) should be on the 26 line, not 24',
    'node 24 (newest) is older than the newest release line, 26',
    'postgres 13-alpine (oldest) should be on the 14 line, not 13',
    'postgres 17-alpine (lts) should be on the 18 line, not 17'
  ])
  assert.match(report({ drift, notices: [], rows: [] }, ['oldest'], TODAY), /### Drift/)
})

test('pinned components only need to stay supported', () => {
  const config = { pins: { mysql: 'reason' }, presets: { oldest: { mysql: '8.4' }, lts: { mysql: '8.4' }, newest: { mysql: '8.4' } } }
  assert.deepEqual(checkPresets(config, { mysql: MYSQL }, TODAY).drift, [])
  const { drift } = checkPresets(config, { mysql: MYSQL }, '2032-05-01')
  assert.equal(drift.length, 3)
  assert.match(drift[0], /mysql 8.4 \(oldest, pinned\) is no longer supported: its line 8.4 reached end of life on 2032-04-30/)
})

test('main fetches every product and exits 1 only on drift', async () => {
  const requested = []
  const fakeFetch = async (url) => {
    requested.push(url)
    const product = decodeURIComponent(url.split('/').pop())
    const releases = { nodejs: NODE, postgresql: POSTGRES, mysql: MYSQL, elasticsearch: ELASTICSEARCH }[product] || []
    return { ok: true, json: async () => ({ result: { releases } }) }
  }
  const chunks = []
  const out = { write: (s) => chunks.push(s) }
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'presets-'))
  const file = path.join(dir, 'presets.json')
  fs.writeFileSync(file, JSON.stringify({ pins: {}, presets: { oldest: { node: '22' }, lts: { node: '26' }, newest: { node: '28-nightly' } } }))
  assert.equal(await main(['--presets', file], { fetchImpl: fakeFetch, today: TODAY, out }), 0)
  assert.equal(requested.length, Object.keys(PRODUCTS).length)
  assert.match(chunks.join(''), /\| node \| 22 \| 26 \| 28-nightly \|/)

  fs.writeFileSync(file, JSON.stringify({ pins: {}, presets: { oldest: { node: '20' }, lts: { node: '26' }, newest: { node: '28-nightly' } } }))
  assert.equal(await main(['--presets', file], { fetchImpl: fakeFetch, today: TODAY, out }), 1)
  fs.rmSync(dir, { recursive: true })
})

test('fetchReleases reports HTTP failures', async () => {
  await assert.rejects(fetchReleases('nodejs', async () => ({ ok: false, status: 503 })), /endoflife.date nodejs: HTTP 503/)
})

// The presets file itself, as the workflows read it.
test('.github/ci-presets.json: three presets with the same components', () => {
  assert.deepEqual(Object.keys(presets.presets), ['oldest', 'lts', 'newest'])
  const keys = Object.keys(presets.presets.lts).sort()
  for (const [name, preset] of Object.entries(presets.presets)) {
    assert.deepEqual(Object.keys(preset).sort(), keys, `${name} has every component`)
    for (const [key, value] of Object.entries(preset)) {
      if (key !== 'experimental') assert.equal(typeof value, 'string', `${name}.${key} is a string, so YAML and Helm keep it verbatim`)
    }
  }
  assert.equal(presets.presets.oldest.experimental, false)
  assert.equal(presets.presets.lts.experimental, false)
  assert.equal(presets.presets.newest.experimental, true, 'only the pre-release preset may fail')
  for (const key of Object.keys(presets.pins)) assert.ok(keys.includes(key), `pin ${key} names a component`)
  for (const key of Object.keys(PRODUCTS)) assert.ok(keys.includes(key), `${key} is checked against endoflife.date`)
})

test('workflows use only components the presets define', () => {
  const keys = new Set([...Object.keys(presets.presets.lts), 'name'])
  const dir = path.join(ROOT, '.github', 'workflows')
  let uses = 0
  for (const file of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const [, key] of text.matchAll(/matrix\.preset\.([A-Za-z0-9_]+)/g)) {
      uses++
      assert.ok(keys.has(key), `${file}: matrix.preset.${key} is not in .github/ci-presets.json`)
    }
  }
  assert.ok(uses > 0)
})
