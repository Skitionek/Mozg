'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { getCatalog, listCatalog } = require('../src/catalog/index')
const { entityColumns, entityParams } = require('../src/database/sources')

/** The relation on `source/entity` that targets `catalog/target`, if any. */
function link (source, entity, catalog, target) {
  const [entry] = getCatalog(source)
  const e = entry.entities.find((x) => x.name === entity)
  assert.ok(e, `${source}/${entity} should exist`)
  return (e.relations || []).find((r) => (r.catalog || source) === catalog && (!target || r.entity === target))
}

describe('catalog', () => {
  test('listCatalog returns an array of name strings', () => {
    const names = listCatalog()
    assert.ok(Array.isArray(names), 'should be an array')
    assert.ok(names.length >= 1, 'should have at least one entry')
    for (const n of names) {
      assert.equal(typeof n, 'string')
    }
  })

  test('getCatalog with no argument returns all entries', () => {
    const all = getCatalog()
    const names = listCatalog()
    assert.equal(all.length, names.length)
  })

  test('getCatalog with a name returns a single-element array', () => {
    const entries = getCatalog('jsonplaceholder')
    assert.equal(entries.length, 1)
  })

  test('getCatalog throws for unknown catalog name', () => {
    assert.throws(
      () => getCatalog('no-such-catalog'),
      /Unknown catalog/
    )
  })

  test('every catalog entry has required top-level fields', () => {
    const entries = getCatalog()
    for (const entry of entries) {
      assert.ok(entry.name, `${entry.name}: name is required`)
      assert.ok(entry.label, `${entry.name}: label is required`)
      assert.ok(entry.driver, `${entry.name}: driver is required`)
      assert.ok(entry.connection, `${entry.name}: connection is required`)
      assert.ok(
        typeof entry.connection === 'object' && entry.connection !== null,
        `${entry.name}: connection must be an object`
      )
      assert.ok(Array.isArray(entry.entities), `${entry.name}: entities must be an array`)
    }
  })

  test('every catalog entity has a name, known columns, and relations (if any) as an array', () => {
    const entries = getCatalog()
    for (const entry of entries) {
      for (const entity of entry.entities) {
        assert.ok(entity.name, `${entry.name}/${entity.name}: name is required`)
        // api entities derive their columns from `fields`
        assert.ok(entityColumns(entity).length > 0 || entry.driver !== 'api', `${entry.name}/${entity.name}: needs columns or fields`)
        assert.ok(Array.isArray(entry.driver === 'api' ? entityColumns(entity) : entity.columns), `${entry.name}/${entity.name}: columns must be an array`)
        assert.ok(entity.relations == null || Array.isArray(entity.relations), `${entry.name}/${entity.name}: relations must be an array`)
      }
    }
  })

  test('every catalog relation has entity, foreignKey, and type', () => {
    const entries = getCatalog()
    for (const entry of entries) {
      for (const entity of entry.entities) {
        for (const rel of entity.relations || []) {
          assert.ok(rel.entity, `relation in ${entry.name}/${entity.name}: entity is required`)
          assert.ok(rel.foreignKey, `relation in ${entry.name}/${entity.name}: foreignKey is required`)
          assert.ok(rel.type, `relation in ${entry.name}/${entity.name}: type is required`)
          assert.ok(
            ['hasMany', 'hasOne', 'belongsTo'].includes(rel.type),
            `relation in ${entry.name}/${entity.name}: type must be a valid RelationType`
          )
        }
      }
    }
  })

  test('getCatalog is lazy – each call to getCatalog loads only requested entries', () => {
    // Verify that calling getCatalog with a specific name only returns that entry
    for (const name of listCatalog()) {
      const entries = getCatalog(name)
      assert.equal(entries.length, 1)
      assert.equal(entries[0].name, name)
    }
  })

  test('catalog files are not loaded until getCatalog is called (lazy loading)', () => {
    const path = require('node:path')
    const catalogDir = path.join(__dirname, '../src/catalog')

    // Evict all catalog entry modules from the require cache
    for (const name of listCatalog()) {
      const resolved = require.resolve(path.join(catalogDir, name === 'neo4j-movies' ? 'neo4j-movies' : name))
      delete require.cache[resolved]
    }

    // Also evict the index so we get a fresh loader registry
    const indexResolved = require.resolve(path.join(catalogDir, 'index'))
    delete require.cache[indexResolved]

    // Re-require only the index – no entry file should be loaded yet
    const { getCatalog: freshGet, listCatalog: freshList } = require(path.join(catalogDir, 'index'))

    // Confirm entry files are absent from cache before any getCatalog call
    for (const name of freshList()) {
      const resolved = require.resolve(path.join(catalogDir, name))
      assert.equal(require.cache[resolved], undefined, `${name} should not be cached before getCatalog()`)
    }

    // Load one specific entry and confirm only that file is now cached
    const targetName = freshList()[0]
    freshGet(targetName)
    const targetResolved = require.resolve(path.join(catalogDir, targetName))
    assert.ok(require.cache[targetResolved], `${targetName} should be cached after getCatalog('${targetName}')`)

    // Other entry files must still be absent
    for (const name of freshList().slice(1)) {
      const resolved = require.resolve(path.join(catalogDir, name))
      assert.equal(require.cache[resolved], undefined, `${name} should not yet be cached`)
    }
  })

  // Spot-check individual catalog entries

  test('chinook has Artist entity with ArtistId column', () => {
    const [entry] = getCatalog('chinook')
    const artist = entry.entities.find(e => e.name === 'Artist')
    assert.ok(artist, 'Artist entity should exist')
    assert.ok(artist.columns.includes('ArtistId'))
  })

  test('jsonplaceholder /posts entity has a hasMany relation to /comments', () => {
    const [entry] = getCatalog('jsonplaceholder')
    const posts = entry.entities.find(e => e.name === '/posts')
    assert.ok(posts, '/posts entity should exist')
    const rel = posts.relations.find(r => r.entity === '/comments' && r.type === 'hasMany')
    assert.ok(rel, '/posts should have a hasMany relation to /comments')
  })

  test('rnacentral is served by the RNAcentral REST API', () => {
    const [entry] = getCatalog('rnacentral')
    assert.equal(entry.driver, 'api')
    assert.match(entry.connection.database, /^https:\/\/rnacentral\.org\//)
    assert.ok(entry.entities.find((e) => e.name === 'rna'), 'rna entity should exist')
  })

  test('neo4j-movies has neo4j driver with scheme set', () => {
    const [entry] = getCatalog('neo4j-movies')
    assert.equal(entry.driver, 'neo4j')
    assert.ok(entry.connection.scheme, 'connection.scheme should be set')
  })

  // Cross-source relation spot-checks: the joins the life-science graph relies on
  test('a UniProt protein links to its structures, predicted model, domains and pathways', () => {
    assert.ok(link('uniprot', 'protein', 'pdbe', 'bestStructures'), 'structures via PDBe SIFTS')
    assert.ok(link('uniprot', 'protein', 'alphafold', 'prediction'), 'AlphaFold model')
    assert.ok(link('uniprot', 'protein', 'interpro', 'proteinEntries'), 'InterPro domains')
    assert.ok(link('uniprot', 'protein', 'reactome', 'pathwaysForProtein'), 'Reactome pathways')
  })

  test('PDBe best structures lead on to the RCSB entry', () => {
    const rel = link('pdbe', 'bestStructures', 'pdb', 'entry')
    assert.ok(rel)
    assert.equal(rel.foreignKey, 'pdbId')
  })

  test('ChEMBL molecules and PubChem compounds join by InChIKey', () => {
    assert.equal(link('chembl', 'molecule', 'pubchem').foreignKey, 'inchiKey')
    assert.equal(link('pubchem', 'compound', 'chembl').foreignKey, 'inchiKey')
  })

  test('kegg converts compounds to ChEBI, its working link out', () => {
    assert.ok(link('kegg', '/conv/chebi', 'chebi', 'compound'))
  })

  test('PubMed and Europe PMC link both ways by PMID', () => {
    assert.equal(link('pubmed', 'article', 'europepmc', 'article').foreignKey, 'pmid')
    assert.equal(link('europepmc', 'article', 'pubmed', 'article').foreignKey, 'pmid')
  })

  test('every cross-catalog relation references a valid catalog name', () => {
    const allNames = new Set(listCatalog())
    const entries = getCatalog()
    for (const entry of entries) {
      for (const entity of entry.entities) {
        for (const rel of entity.relations) {
          if (rel.catalog) {
            assert.ok(
              allNames.has(rel.catalog),
              `${entry.name}/${entity.name}: cross-catalog relation references unknown catalog "${rel.catalog}"`
            )
          }
        }
      }
    }
  })

  // ── Ontology and vocabulary sources ────────────────────────────────────

  test('chebi uses the ChEBI 2.0 API and returns structure identifiers', () => {
    const [entry] = getCatalog('chebi')
    assert.equal(entry.driver, 'api')
    assert.match(entry.connection.database, /ebi\.ac\.uk\/chebi/)
    const compound = entry.entities.find((e) => e.name === 'compound')
    for (const field of ['chebiId', 'name', 'formula', 'inchiKey', 'smiles', 'mass']) {
      assert.ok(entityColumns(compound).includes(field), `compound should carry ${field}`)
    }
  })

  test('geneontology looks up a term by goId', () => {
    const [entry] = getCatalog('geneontology')
    const term = entry.entities.find((e) => e.name === 'term')
    assert.deepEqual(entityParams(term).filter((p) => p.required).map((p) => p.name), ['goId'])
  })

  test('mesh looks up a descriptor by meshId', () => {
    const [entry] = getCatalog('mesh')
    assert.match(entry.connection.database, /nlm\.nih\.gov/)
    assert.ok(entityParams(entry.entities.find((e) => e.name === 'descriptor')).some((p) => p.name === 'meshId'))
  })

  test('regulondb searches genes through its GraphQL API', () => {
    const [entry] = getCatalog('regulondb')
    assert.equal(entry.driver, 'api')
    const genes = entry.entities.find((e) => e.name === 'genes')
    assert.ok(genes && genes.graphql, 'genes should be a GraphQL entity')
  })
})
