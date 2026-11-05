'use strict'

/**
 * The catalog lint must catch each way a source description can be
 * unexecutable — above all, a relation whose join key the target does not
 * accept, which is the defect that left every cross-source relation broken
 * before the api driver existed.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { lintEntry } = require('../src/database/catalog-lint')

function source (overrides = {}) {
  return {
    name: 'genes',
    label: 'Genes',
    description: 'test genes',
    category: 'Genes & genomes',
    homepage: 'https://genes.example',
    driver: 'api',
    connection: { database: 'https://genes.example/api' },
    entities: [
      {
        name: 'gene',
        description: 'a gene',
        path: '/gene/{geneId}',
        params: { geneId: {} },
        fields: { geneId: 'id', proteinId: 'protein' },
        example: { geneId: 'G1' },
        relations: [
          { alias: 'protein', catalog: 'proteins', entity: 'protein', localKey: 'proteinId', foreignKey: 'proteinId', type: 'hasOne' }
        ]
      }
    ],
    ...overrides
  }
}

const PROTEINS = {
  name: 'proteins',
  driver: 'api',
  connection: { database: 'https://proteins.example' },
  entities: [{ name: 'protein', path: '/p/{proteinId}', params: { proteinId: {} }, fields: { proteinId: 'id' } }]
}

const lookup = (name) => (name === 'proteins' ? PROTEINS : null)

/** Lint a variant of the sound source with one entity or relation changed. */
function lintWith ({ entry = {}, entity = {}, relation } = {}) {
  const base = source(entry)
  const e = { ...base.entities[0], ...entity }
  if (relation !== undefined) e.relations = relation === null ? [] : [{ ...base.entities[0].relations[0], ...relation }]
  return lintEntry({ ...base, entities: [e] }, lookup)
}

describe('lintEntry', () => {
  test('a sound source has no problems', () => {
    assert.deepEqual(lintEntry(source(), lookup), [])
  })

  test('a join key the target does not accept', () => {
    const problems = lintWith({ relation: { foreignKey: 'accession' } })
    assert.match(problems.join('\n'), /"accession" is not a parameter of proteins\/protein \(accepts: proteinId\)/)
  })

  test('a parent field that does not exist', () => {
    assert.match(lintWith({ relation: { localKey: 'uniprot' } }).join('\n'), /"uniprot" is not a field of genes\/gene/)
  })

  test('a target entity that does not exist', () => {
    assert.match(lintWith({ relation: { entity: 'structure' } }).join('\n'), /"structure" is not an entity of proteins \(has: protein\)/)
  })

  test('a target source that is not registered', () => {
    assert.match(lintWith({ relation: { catalog: 'nowhere' } }).join('\n'), /target source "nowhere" is not registered/)
  })

  test('a relation where-key the target does not accept', () => {
    assert.match(lintWith({ relation: { where: { reviewed: true } } }).join('\n'), /where key "reviewed" is not a parameter/)
  })

  test('a belongsTo checks ownerKey on the target and foreignKey on the parent', () => {
    const problems = lintWith({ relation: { type: 'belongsTo', foreignKey: 'proteinId', ownerKey: 'id' } })
    assert.match(problems.join('\n'), /"id" is not a parameter of proteins\/protein/)
  })

  test('relation type, alias and uniqueness', () => {
    assert.match(lintWith({ relation: { type: 'manyToMany' } }).join('\n'), /type must be hasMany, hasOne or belongsTo/)
    assert.match(lintWith({ relation: { alias: undefined } }).join('\n'), /need an alias/)
    const base = source()
    const rel = base.entities[0].relations[0]
    const twice = { ...base, entities: [{ ...base.entities[0], relations: [rel, rel] }] }
    assert.match(lintEntry(twice, lookup).join('\n'), /duplicate alias/)
  })

  test('an entity without an example, or with an example the entity cannot take', () => {
    assert.match(lintWith({ entity: { example: undefined } }).join('\n'), /missing example/)
    assert.match(lintWith({ entity: { example: { symbol: 'TP53' } } }).join('\n'), /example key "symbol" is not a declared parameter/)
    assert.match(lintWith({ entity: { example: {} } }).join('\n'), /example lacks required parameter "geneId"/)
  })

  test('an entity that cannot be requested or returns nothing', () => {
    assert.match(lintWith({ entity: { path: undefined } }).join('\n'), /needs a path or a resolve function/)
    assert.match(lintWith({ entity: { fields: undefined } }).join('\n'), /declares no output fields/)
    assert.match(lintWith({ entity: { name: 'Gene_Lookup' } }).join('\n'), /camelCase nouns/)
    assert.match(lintWith({ entity: { description: '' } }).join('\n'), /missing description/)
  })

  test('source metadata', () => {
    assert.match(lintWith({ entry: { category: 'Biology' } }).join('\n'), /category "Biology" is not one of/)
    assert.match(lintWith({ entry: { homepage: 'http://genes.example' } }).join('\n'), /homepage must be an https URL/)
    assert.match(lintWith({ entry: { connection: { database: 'ftp://genes' } } }).join('\n'), /https base URL/)
    assert.match(lintWith({ entry: { label: '' } }).join('\n'), /missing label/)
  })

  test('duplicate entity names', () => {
    const base = source()
    assert.match(lintEntry({ ...base, entities: [base.entities[0], base.entities[0]] }, lookup).join('\n'), /duplicate entity "gene"/)
  })

  test('relations into non-api sources are checked for type and target only', () => {
    const sql = { name: 'sql', driver: 'sqlite3', entities: [] }
    const problems = lintWith({ relation: { catalog: 'sql', entity: 'whatever', foreignKey: 'anything' } })
    assert.deepEqual(lintEntry({ ...source(), entities: [{ ...source().entities[0], relations: [{ alias: 'x', catalog: 'sql', entity: 't', foreignKey: 'f', localKey: 'geneId', type: 'hasMany' }] }] }, (n) => (n === 'sql' ? sql : null)), [])
    assert.match(problems.join('\n'), /target source "sql" is not registered/)
  })
})
