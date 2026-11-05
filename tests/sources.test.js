'use strict'

/**
 * `source` / `include` / `apiKeys` shorthand: expansion into explicit
 * connections and relations, and end-to-end through the streaming endpoint.
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const http = require('../src/database/http')
const { registerCatalog } = require('../src/catalog')
const { normalizeQueryInput, expandIncludes, entityParams } = require('../src/database/sources')
const { streamQuery } = require('../src/stream')

const GENES = {
  name: 'src-genes',
  label: 'Genes',
  driver: 'api',
  connection: { database: 'https://genes.example' },
  entities: [
    {
      name: 'gene',
      description: 'a gene',
      path: '/gene/{geneId}',
      params: { geneId: { description: 'gene id' }, expand: { default: false } },
      fields: { geneId: 'id', symbol: 'symbol', proteinId: 'protein' },
      example: { geneId: 'G1' },
      relations: [
        { alias: 'protein', catalog: 'src-proteins', entity: 'protein', localKey: 'proteinId', foreignKey: 'proteinId', type: 'hasOne' }
      ]
    }
  ]
}

const PROTEINS = {
  name: 'src-proteins',
  label: 'Proteins',
  driver: 'api',
  connection: { database: 'https://proteins.example' },
  entities: [
    {
      name: 'protein',
      description: 'a protein',
      path: '/protein/{proteinId}',
      params: { proteinId: {} },
      fields: { proteinId: 'id', length: 'len' },
      relations: [
        { alias: 'structures', entity: 'structures', localKey: 'proteinId', foreignKey: 'proteinId', type: 'hasMany' }
      ]
    },
    {
      name: 'structures',
      description: 'structures of a protein',
      path: '/protein/{proteinId}/structures',
      params: { proteinId: {} },
      fields: { structureId: 'id' }
    }
  ]
}

let unregister
before(() => {
  const a = registerCatalog(GENES)
  const b = registerCatalog(PROTEINS)
  unregister = () => { a(); b() }
})
after(() => unregister())

describe('normalizeQueryInput', () => {
  test('a source supplies the connection', () => {
    const out = normalizeQueryInput({ source: 'src-genes', from: 'gene' })
    assert.equal(out.connection.driver, 'api')
    assert.equal(out.connection.source, 'src-genes')
    assert.equal(out.connection.database, 'https://genes.example')
    assert.equal(out.source, undefined)
  })

  test('include expands dotted paths across sources into nested relations', () => {
    const out = normalizeQueryInput({ source: 'src-genes', from: 'gene', include: ['protein.structures'] })
    assert.deepEqual(out.relations, [{
      entity: 'protein',
      foreignKey: 'proteinId',
      localKey: 'proteinId',
      alias: 'protein',
      type: 'hasOne',
      catalog: 'src-proteins',
      relations: [{ entity: 'structures', foreignKey: 'proteinId', localKey: 'proteinId', alias: 'structures', type: 'hasMany' }]
    }])
  })

  test('include is added to explicit relations, not instead of them', () => {
    const explicit = { entity: 'protein', foreignKey: 'proteinId', catalog: 'src-proteins', alias: 'mine' }
    const out = normalizeQueryInput({ source: 'src-genes', from: 'gene', relations: [explicit], include: ['protein'] })
    assert.deepEqual(out.relations.map((r) => r.alias), ['mine', 'protein'])
  })

  test('include without a catalog source is refused', () => {
    assert.throws(
      () => normalizeQueryInput({ connection: { driver: 'sqlite3', database: ':memory:' }, from: 't', include: ['x'] }),
      /include needs a catalog source/
    )
  })

  test('a query with neither source nor connection is refused', () => {
    assert.throws(() => normalizeQueryInput({ from: 'x' }), /needs either a source/)
  })

  test('is idempotent', () => {
    const once = normalizeQueryInput({ source: 'src-genes', from: 'gene', include: ['protein'] })
    assert.equal(normalizeQueryInput(once), once)
  })

  test('apiKeys travel on the connection', () => {
    const out = normalizeQueryInput({ source: 'src-genes', from: 'gene', apiKeys: { 'src-proteins': 'k' } })
    assert.deepEqual(out.connection.apiKeys, { 'src-proteins': 'k' })
  })
})

describe('entityParams', () => {
  test('path placeholders are required parameters; defaults make them optional', () => {
    const params = entityParams(GENES.entities[0])
    assert.deepEqual(params.map((p) => [p.name, p.in, p.required, p.example]), [
      ['geneId', 'path', true, 'G1'],
      ['expand', 'query', false, null]
    ])
  })
})

describe('expandIncludes', () => {
  test('names the relations that do exist when one does not', () => {
    assert.throws(() => expandIncludes(PROTEINS, 'protein', ['structures.nope']), /Unknown include "structures.nope" on src-proteins\/structures. Available: \(none\)/)
  })
})

describe('streaming a catalog source', () => {
  let originalFetch
  beforeEach(() => {
    http.reset()
    originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      const body = {
        'https://genes.example/gene/G1?expand=false': { id: 'G1', symbol: 'ABC1', protein: 'P1' },
        'https://proteins.example/protein/P1': { id: 'P1', len: 393 }
      }[url]
      return {
        ok: body != null,
        status: body != null ? 200 : 404,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(body ?? {})
      }
    }
  })
  afterEach(() => { globalThis.fetch = originalFetch })

  test('expands source and include before fanning out relations', async () => {
    const chunks = []
    const res = {
      headersSent: false,
      writeHead () { this.headersSent = true },
      write (c) { chunks.push(String(c)) },
      end (c) { if (c) chunks.push(String(c)) }
    }

    await streamQuery({ source: 'src-genes', from: 'gene', where: { geneId: 'G1' }, include: ['protein'] }, res)

    const lines = chunks.join('').trim().split('\n')
    assert.deepEqual(JSON.parse(lines[0]), { count: 1, data: '$1' })
    assert.deepEqual(JSON.parse(lines[1].replace(/^\/\* \$1 \*\/ /, '')), [{ geneId: 'G1', symbol: 'ABC1', proteinId: 'P1', protein: '$2' }])
    assert.deepEqual(JSON.parse(lines[2].replace(/^\/\* \$2 \*\/ /, '')), { proteinId: 'P1', length: 393 })
  })
})
