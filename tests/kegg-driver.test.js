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
