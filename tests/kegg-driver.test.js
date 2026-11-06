'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { parseTsv, parseFlatFile, parseResponse } = require('../src/database/drivers/kegg')

// ── parseTsv ──────────────────────────────────────────────────────────────────

describe('parseTsv', () => {
  test('parses standard list/find response into entry_id + name rows', () => {
    const text = 'path:map00010\tGlycolysis / Gluconeogenesis\npath:map00020\tCitrate cycle (TCA cycle)\n'
    const rows = parseTsv(text, ['entry_id', 'name'])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].entry_id, 'path:map00010')
    assert.equal(rows[0].name, 'Glycolysis / Gluconeogenesis')
    assert.equal(rows[1].entry_id, 'path:map00020')
    assert.equal(rows[1].name, 'Citrate cycle (TCA cycle)')
  })

  test('parses link response into source_id + target_id rows', () => {
    const text = 'hsa:7157\tpath:hsa04110\nhsa:7157\tpath:hsa04115\n'
    const rows = parseTsv(text, ['source_id', 'target_id'])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].source_id, 'hsa:7157')
    assert.equal(rows[0].target_id, 'path:hsa04110')
    assert.equal(rows[1].target_id, 'path:hsa04115')
  })

  test('ignores blank lines', () => {
    const text = '\npath:map00010\tGlycolysis\n\npath:map00020\tTCA cycle\n\n'
    const rows = parseTsv(text, ['entry_id', 'name'])
    assert.equal(rows.length, 2)
  })

  test('sets missing columns to null', () => {
    const text = 'entry_only\n'
    const rows = parseTsv(text, ['entry_id', 'name'])
    assert.equal(rows[0].entry_id, 'entry_only')
    assert.equal(rows[0].name, null)
  })

  test('returns empty array for empty text', () => {
    const rows = parseTsv('', ['entry_id', 'name'])
    assert.equal(rows.length, 0)
  })
})

// ── parseFlatFile ─────────────────────────────────────────────────────────────

describe('parseFlatFile', () => {
  const GLUCOSE_FLAT = [
    'ENTRY       C00031                      Compound',
    'NAME        D-Glucose;',
    '            Grape sugar',
    'FORMULA     C6H12O6',
    'MASS        180.0634',
    'PATHWAY     map00010  Glycolysis / Gluconeogenesis',
    'PATHWAY     map00030  Pentose phosphate pathway',
    '///'
  ].join('\n')

  test('returns a single-element array', () => {
    const rows = parseFlatFile(GLUCOSE_FLAT)
    assert.equal(rows.length, 1)
  })

  test('parses field key in lowercase', () => {
    const [row] = parseFlatFile(GLUCOSE_FLAT)
    assert.ok(Object.prototype.hasOwnProperty.call(row, 'entry'))
    assert.ok(Object.prototype.hasOwnProperty.call(row, 'name'))
    assert.ok(Object.prototype.hasOwnProperty.call(row, 'formula'))
    assert.ok(Object.prototype.hasOwnProperty.call(row, 'mass'))
  })

  test('parses single-value fields correctly', () => {
    const [row] = parseFlatFile(GLUCOSE_FLAT)
    assert.ok(row.entry.startsWith('C00031'))
    assert.equal(row.formula, 'C6H12O6')
    assert.equal(row.mass, '180.0634')
  })

  test('appends continuation lines to the current key', () => {
    const [row] = parseFlatFile(GLUCOSE_FLAT)
    // NAME has a continuation line "Grape sugar" appended
    assert.ok(row.name.includes('Grape sugar'), `name should include continuation: "${row.name}"`)
  })

  test('collects repeated keys into an array', () => {
    const [row] = parseFlatFile(GLUCOSE_FLAT)
    // PATHWAY appears twice
    assert.ok(Array.isArray(row.pathway), 'repeated PATHWAY key should produce an array')
    assert.equal(row.pathway.length, 2)
    assert.ok(row.pathway[0].includes('Glycolysis'))
    assert.ok(row.pathway[1].includes('Pentose phosphate'))
  })

  test('stops parsing at /// separator', () => {
    const text = 'ENTRY       X00001\nNAME        Test\n///\nNAME        ShouldNotAppear\n'
    const [row] = parseFlatFile(text)
    // Only one NAME key expected
    assert.equal(typeof row.name, 'string')
    assert.equal(row.name, 'Test')
  })

  test('returns empty object for empty text', () => {
    const [row] = parseFlatFile('')
    assert.deepEqual(row, {})
  })
})

// ── parseResponse ─────────────────────────────────────────────────────────────

describe('parseResponse', () => {
  test('routes /list/* to TSV parser with entry_id+name columns', () => {
    const rows = parseResponse('path:map00010\tGlycolysis\n', '/list/pathway')
    assert.equal(rows.length, 1)
    assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'entry_id'))
    assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'name'))
  })

  test('routes /find/* to TSV parser with entry_id+name columns', () => {
    const rows = parseResponse('cpd:C00031\tD-Glucose\n', '/find/compound/glucose')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].entry_id, 'cpd:C00031')
  })

  test('routes /link/* to TSV parser with source_id+target_id columns', () => {
    const rows = parseResponse('hsa:7157\tpath:hsa04110\n', '/link/pathway/hsa:7157')
    assert.equal(rows.length, 1)
    assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'source_id'))
    assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'target_id'))
  })

  test('routes /get/* to flat-file parser', () => {
    const text = 'ENTRY       C00031\nFORMULA     C6H12O6\n///\n'
    const rows = parseResponse(text, '/get/C00031')
    assert.equal(rows.length, 1)
    assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'entry'))
    assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'formula'))
  })

  test('routes /info/* to TSV parser (same as list)', () => {
    const rows = parseResponse('pathway\tReference pathway\n', '/info/pathway')
    assert.equal(rows.length, 1)
    assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'entry_id'))
  })
})

// ── executeQuery ─────────────────────────────────────────────────────────────

describe('executeQuery', () => {
  const { executeQuery } = require('../src/database/drivers/kegg')

  /** Answer any KEGG fetch with a fixed TSV payload. */
  function stubFetch (text) {
    const original = globalThis.fetch
    globalThis.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => text })
    return () => { globalThis.fetch = original }
  }

  test('count reports the rows returned, not the whole unpaginated list', async () => {
    // Given a KEGG list response with four entries
    const restore = stubFetch('path:map1\tOne\npath:map2\tTwo\npath:map3\tThree\npath:map4\tFour\n')

    // When querying with a limit of two
    const result = await executeQuery({
      connection: { database: 'https://rest.kegg.jp' },
      from: 'list/pathway',
      limit: 2
    })
    restore()

    // Then count matches the page that was actually returned
    assert.equal(result.data.length, 2)
    assert.equal(result.count, 2)
  })

  test('resolves a same-source relation via _pathSuffix instead of dropping it', async () => {
    // Given a list response and a stub that answers the relation lookup with
    // the full KEGG entry flat-file format
    let requestedUrl = null
    const original = globalThis.fetch
    globalThis.fetch = async (url) => {
      requestedUrl = String(url)
      if (requestedUrl.endsWith('/list/pathway')) {
        return { ok: true, status: 200, statusText: 'OK', text: async () => 'path:map00010\tGlycolysis\n' }
      }
      return { ok: true, status: 200, statusText: 'OK', text: async () => 'ENTRY       map00010  Pathway\nNAME        Glycolysis\n///\n' }
    }

    // When querying with a same-source relation, as the kegg catalog declares
    const result = await executeQuery({
      connection: { database: 'https://rest.kegg.jp' },
      from: 'list/pathway',
      relations: [{ entity: '/get', foreignKey: 'entry_id', type: 'belongsTo', alias: 'entry' }]
    })
    globalThis.fetch = original

    // Then the relation is resolved as a path-suffix lookup, not dropped
    assert.ok(requestedUrl.includes('/get/path%3Amap00010'), requestedUrl)
    assert.ok(result.data[0].entry, JSON.stringify(result.data[0]))
  })

  test('reports a failing same-source relation in place, keeping the parent rows', async () => {
    // Given a relation lookup that fails
    const original = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/list/pathway')) {
        return { ok: true, status: 200, statusText: 'OK', text: async () => 'path:map00010\tGlycolysis\n' }
      }
      return { ok: false, status: 500, statusText: 'Error' }
    }

    // When the relation is resolved
    const result = await executeQuery({
      connection: { database: 'https://rest.kegg.jp' },
      from: 'list/pathway',
      relations: [{ entity: '/get', foreignKey: 'entry_id', type: 'belongsTo', alias: 'entry' }]
    })
    globalThis.fetch = original

    // Then the parent row survives and carries the relation's error
    assert.equal(result.data[0].entry_id, 'path:map00010')
    assert.match(result.data[0].entry.error, /relation fetch failed/)
  })
})

describe('loadRelations: concurrency', () => {
  const { executeQuery } = require('../src/database/drivers/kegg')
  test('resolves relations for more rows than the concurrency limit, each exactly once', async () => {
    // Given 7 rows (more than the concurrency limit) and a stub that counts
    // how many fetches are in flight at once
    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    const original = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/list/pathway')) {
        const lines = Array.from({ length: 7 }, (_, i) => `path:map0000${i}\tP${i}`).join('\n')
        return { ok: true, status: 200, statusText: 'OK', text: async () => lines + '\n' }
      }
      inFlight++
      calls++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return { ok: true, status: 200, statusText: 'OK', text: async () => 'ENTRY content\n///\n' }
    }

    // When querying with a same-source relation
    const result = await executeQuery({
      connection: { database: 'https://rest.kegg.jp' },
      from: 'list/pathway',
      relations: [{ entity: '/get', foreignKey: 'entry_id', type: 'belongsTo', alias: 'entry' }]
    })
    globalThis.fetch = original

    // Then every row got exactly one lookup, never more than 3 at once
    assert.equal(calls, 7)
    assert.ok(maxInFlight <= 3, `expected at most 3 concurrent, got ${maxInFlight}`)
    assert.ok(result.data.every((row) => row.entry && row.entry.entry))
  })
})

describe('kegg: flat-file details, select, limits and other catalogs', () => {
  const kegg = require('../src/database/drivers/kegg')
  const http = require('../src/database/http')

  function serve (routes) {
    const original = globalThis.fetch
    globalThis.fetch = async (url) => {
      const hit = Object.entries(routes).find(([suffix]) => String(url).endsWith(suffix))
      if (!hit) return { ok: false, status: 404, statusText: 'Not Found', headers: { get: () => null }, text: async () => '' }
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => 'text/plain' }, text: async () => hit[1] }
    }
    return () => { globalThis.fetch = original }
  }

  test('repeated keys with continuation lines extend the last value', () => {
    const [entry] = kegg.parseFlatFile('ENTRY       C00031\nDBLINKS     CAS: 50-99-7\n            PubChem: 3333\nDBLINKS     ChEBI: 4167\n            LIPIDMAPS: LMSL\n///\n')
    assert.deepEqual(entry.dblinks, ['CAS: 50-99-7; PubChem: 3333', 'ChEBI: 4167; LIPIDMAPS: LMSL'])
  })

  test('select narrows rows; a 404 is no rows', async () => {
    http.reset()
    const restore = serve({ '/list/pathway': 'path:map00010\tGlycolysis\npath:map00020\tCitrate cycle\n' })
    try {
      const { data } = await kegg.executeQuery({ connection: { database: 'https://rest.kegg.jp' }, from: '/list/pathway', select: ['name'] })
      assert.deepEqual(data, [{ name: 'Glycolysis' }, { name: 'Citrate cycle' }])
      assert.deepEqual((await kegg.executeQuery({ connection: { database: 'https://rest.kegg.jp' }, from: '/get', where: { _pathSuffix: 'C99999' } })).data, [])
    } finally {
      restore()
    }
  })

  test('relation limit, missing join values and other catalogs', async () => {
    http.reset()
    const restore = serve({
      '/list/pathway': 'path:map00010\tGlycolysis\n',
      '/link/compound/path%3Amap00010': 'path:map00010\tcpd:C00031\npath:map00010\tcpd:C00022\n'
    })
    try {
      const { data } = await kegg.executeQuery({
        connection: { database: 'https://rest.kegg.jp' },
        from: '/list/pathway',
        relations: [
          { entity: '/link/compound', foreignKey: 'entry_id', type: 'hasMany', alias: 'compounds', limit: 1 },
          { entity: '/get', foreignKey: 'missing', type: 'belongsTo', alias: 'none' },
          { catalog: 'no-such-catalog', entity: 'x', localKey: 'entry_id', foreignKey: 'id', alias: 'elsewhere' }
        ]
      })
      assert.deepEqual(data[0].compounds, [{ source_id: 'path:map00010', target_id: 'cpd:C00031' }])
      assert.equal(data[0].none, null)
      assert.match(data[0].elsewhere.error, /no-such-catalog/)
    } finally {
      restore()
    }
  })

  test('introspection describes KEGG from its catalog entry', async () => {
    const { tables } = await kegg.introspect({ driver: 'kegg', database: 'https://rest.kegg.jp' })
    assert.ok(tables.some((t) => t.name === '/list/pathway'))
  })
})
