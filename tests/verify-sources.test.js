'use strict'

// Transient failures are retried by default; one attempt keeps these tests fast.
process.env.MOZG_HTTP_RETRIES = '0'

const { test, describe, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const http = require('../src/database/http')
const { registerCatalog } = require('../src/catalog')
const { verifySource } = require('../scripts/verify-sources')

const SOURCE = {
  name: 'verify-demo',
  label: 'Verify demo',
  driver: 'api',
  connection: { database: 'https://verify.example' },
  entities: [
    {
      name: 'good',
      description: 'answers',
      path: '/good/{id}',
      params: { id: {} },
      fields: { id: 'id', partnerId: 'partner', missing: 'nothing.here' },
      example: { id: '1' },
      relations: [
        { alias: 'partner', entity: 'good', localKey: 'partnerId', foreignKey: 'id', type: 'hasOne' },
        { alias: 'nothing', entity: 'empty', localKey: 'id', foreignKey: 'id', type: 'hasMany' },
        { alias: 'elsewhere', catalog: 'not-a-source', entity: 'x', localKey: 'id', foreignKey: 'id', type: 'hasMany' },
        { alias: 'unset', entity: 'good', localKey: 'missing', foreignKey: 'id', type: 'hasOne' },
        { alias: 'failing', entity: 'down', localKey: 'id', foreignKey: 'id', type: 'hasMany' }
      ]
    },
    { name: 'empty', description: 'no rows', path: '/empty/{id}', params: { id: {} }, fields: { id: 'id' }, example: { id: '1' } },
    { name: 'gone', description: '4xx', path: '/gone', params: {}, fields: { id: 'id' }, example: {} },
    { name: 'down', description: '5xx', path: '/down', params: { id: {} }, fields: { id: 'id' }, example: {} },
    { name: 'mismapped', description: 'fields match nothing', path: '/good/{id}', params: { id: {} }, fields: { a: 'x', b: 'y' }, example: { id: '1' } },
    { name: 'noExample', description: 'missing example', path: '/good/1', params: {}, fields: { id: 'id' } }
  ]
}

let unregister
let original
before(() => { unregister = registerCatalog(SOURCE) })
after(() => unregister())
beforeEach(() => {
  http.reset()
  original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    const reply = (status, body) => ({
      ok: status < 300,
      status,
      statusText: '',
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body)
    })
    if (u.pathname.startsWith('/good/')) return reply(200, { id: u.pathname.split('/')[2], partner: '2' })
    if (u.pathname.startsWith('/empty/')) return reply(200, [])
    if (u.pathname === '/gone') return reply(410, { error: 'gone' })
    return reply(503, 'busy')
  }
})
afterEach(() => { globalThis.fetch = original })

describe('verifySource', () => {
  test('classifies every entity and relation outcome', async () => {
    const results = await verifySource(SOURCE)
    const byEntity = Object.fromEntries(results.map((r) => [r.entity, r]))

    // An entity that answers is ok, and reports the declared fields that came back empty
    assert.equal(byEntity.good.status, 'ok')
    assert.deepEqual(byEntity.good.emptyFields, ['missing'])

    // No rows from the example means the catalog is wrong
    assert.equal(byEntity.empty.status, 'empty')
    // A 4xx is the catalog's fault; a 5xx is the upstream's
    assert.equal(byEntity.gone.status, 'broken')
    assert.equal(byEntity.down.status, 'unavailable')
    // A field mapping that matches nothing at all is broken even with rows
    assert.equal(byEntity.mismapped.status, 'broken')
    assert.match(byEntity.mismapped.error, /field mapping does not match/)
    assert.equal(byEntity.noExample.status, 'broken')

    const rel = Object.fromEntries(byEntity.good.relations.map((r) => [r.alias, r]))
    assert.equal(rel.partner.status, 'ok')
    assert.equal(rel.partner.count, 1)
    assert.equal(rel.nothing.status, 'ok')
    assert.match(rel.nothing.note, /resolved to nothing/)
    assert.equal(rel.elsewhere.status, 'pending', 'an unregistered target is someone else\'s work in progress')
    assert.match(rel.unset.note, /parent missing is empty/)
    assert.equal(rel.failing.status, 'unavailable')
  })

  test('can skip relations and restrict to named entities', async () => {
    const results = await verifySource(SOURCE, { relations: false, entities: ['good'] })
    assert.equal(results.length, 1)
    assert.deepEqual(results[0].relations, [])
  })
})

describe('verify-sources CLI', () => {
  test('reports, writes JSON, and fails when an entry is broken', async () => {
    const fs = require('node:fs')
    const os = require('node:os')
    const { main } = require('../scripts/verify-sources')
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-verify-')), 'report.json')
    const lines = []

    const code = await main(['verify-demo', '--json', file], (l) => lines.push(l))

    assert.equal(code, 1, 'broken and empty entities fail the run')
    const out = lines.join('\n')
    assert.match(out, /✓ good/)
    assert.match(out, /∅ empty/)
    assert.match(out, /Needs fixing in the catalog:/)
    assert.match(out, /lint: verify-demo: noExample: missing example where/)
    const report = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(report.results.length, SOURCE.entities.length)
    assert.ok(report.tally.broken >= 3)
  })

  test('without relations only the entities are followed', async () => {
    const { main } = require('../scripts/verify-sources')
    const lines = []
    await main(['verify-demo', '--no-relations'], (l) => lines.push(l))
    assert.doesNotMatch(lines.join('\n'), /→ partner/)
  })

  test('--static lints without touching the network and exits 0 for a sound source', () => {
    const script = path.join(__dirname, '..', 'scripts', 'verify-sources.js')
    const out = spawnSync(process.execPath, [script, 'uniprot', '--static'], { encoding: 'utf8' })
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.match(out.stdout, /0 broken/)
  })
})
