'use strict'

/**
 * OBO keys: one rule — same key, same value, same thing — and everything
 * that has to be true for it to hold: canonical forms, conventions,
 * relations declared by key, and joins nobody declared.
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const obo = require('../src/database/obo')
const http = require('../src/database/http')
const { registerCatalog, loadCatalogDir, getCatalog } = require('../src/catalog')
const sources = require('../src/database/sources')
const { executeQuery } = require('../src/database/connector')
const { lintEntry } = require('../src/database/catalog-lint')

describe('canonical forms', () => {
  const cases = [
    ['chebi', '15365', 'CHEBI:15365'],
    ['chebi', 'chebi:15365', 'CHEBI:15365'],
    ['hgnc', '11998', 'HGNC:11998'],
    ['uniprot', 'UniProtKB:P04637', 'P04637'],
    ['ensembl', 'ENSG00000141510.18', 'ENSG00000141510'],
    ['ncbigene', 'NCBIGene:7157', '7157'],
    ['ncbitaxon', '9606', 9606],
    ['pdb', '1tup', '1TUP'],
    ['doi', 'https://doi.org/10.1038/ABC', '10.1038/abc'],
    ['inchikey', 'bsynrymutxbxsq-uhfffaoysa-n', 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N'],
    ['flybase', 'FB:FBgn0000490', 'FBgn0000490'],
    ['*', 'Orphanet:558', 'ORPHA:558'],
    ['*', 'MONDO_0007254', 'MONDO:0007254']
  ]
  for (const [key, input, expected] of cases) {
    test(`${key}: ${input} → ${expected}`, () => {
      assert.equal(obo.normalize(key, input), expected)
      assert.ok(obo.isCanonical(key, expected))
    })
  }

  test('lists are normalised element-wise', () => {
    assert.deepEqual(obo.normalize('pdb', ['1tup', '4hhb']), ['1TUP', '4HHB'])
  })

  test('a value that is not an identifier of the key is left alone, and reported as off-key', () => {
    assert.equal(obo.normalize('dbsnp', 'chr10:123340431'), 'chr10:123340431')
    assert.equal(obo.isCanonical('dbsnp', 'chr10:123340431'), false)
    assert.equal(obo.normalize('uniprot', null), null)
  })
})

describe('conventions', () => {
  test('canonical names, names ending in them, and plurals carry the key', () => {
    assert.equal(obo.conventionalKey('uniprotAccession'), 'uniprot')
    assert.equal(obo.conventionalKey('partnerUniprotAccession'), 'uniprot')
    assert.equal(obo.conventionalKey('pdbIds'), 'pdb')
    assert.equal(obo.conventionalKey('targetEnsemblGeneIds'), 'ensembl')
    assert.equal(obo.conventionalKey('symbol'), null, 'a gene symbol is not an identifier')
    assert.equal(obo.conventionalKey(undefined), null)
  })

  test('the more specific ChEMBL names win over the generic one', () => {
    assert.equal(obo.conventionalKey('moleculeChemblId'), 'chembl.compound')
    assert.equal(obo.conventionalKey('targetChemblId'), 'chembl.target')
    assert.equal(obo.conventionalKey('chemblId'), 'chembl')
  })

  test('explicit annotations override the convention; a list on a field means a CURIE from any of them', () => {
    const entity = { obo: { chemblId: 'chembl.compound', geneId: ['hgnc', 'mgi'], taxonId: null } }
    assert.equal(obo.fieldKey(entity, 'chemblId'), 'chembl.compound')
    assert.equal(obo.fieldKey(entity, 'geneId'), '*')
    assert.equal(obo.fieldKey(entity, 'taxonId'), null)
    assert.deepEqual(obo.paramKeys(entity, 'geneId'), ['hgnc', 'mgi'])
    assert.deepEqual(obo.paramKeys({ params: { q: { obo: 'go' } } }, 'q'), ['go'])
  })

  test('a disease parameter takes disease ontologies, not any CURIE', () => {
    const keys = obo.paramKeys({}, 'diseaseId')
    assert.ok(keys.includes('mondo') && keys.includes('efo'))
    assert.ok(!obo.accepts(keys, 'uniprot'))
    assert.ok(obo.accepts(keys, '*'), 'a CURIE field may feed it, checked per value')
  })

  test('refined keys fit their parent and back, but not each other', () => {
    assert.ok(obo.accepts(['chembl.compound'], 'chembl'))
    assert.ok(obo.accepts(['chembl'], 'chembl.target'))
    assert.ok(!obo.accepts(['chembl.compound'], 'chembl.target'))
  })

  test('the key of a CURIE comes from its prefix, in any spelling', () => {
    assert.equal(obo.keyOfCurie('UniProtKB:P04637'), 'uniprot')
    assert.equal(obo.keyOfCurie('Orphanet:558'), 'orpha')
    assert.equal(obo.keyOfCurie('P04637'), null)
    assert.equal(obo.keyOfValue('*', 'HP:0001250'), 'hp')
    assert.equal(obo.keyOfValue('uniprot', 'P04637'), 'uniprot')
  })
})

// ── Joins by key, against made-up sources ───────────────────────────────────

const PROTEINS = {
  name: 'obo-proteins',
  label: 'Proteins',
  driver: 'api',
  connection: { database: 'https://obo-proteins.test' },
  entities: [
    {
      name: 'protein',
      description: 'a protein',
      path: '/p/{uniprotAccession}',
      params: { uniprotAccession: {} },
      fields: { uniprotAccession: 'acc', partnerUniprotAccession: 'partner', diseaseId: 'disease', taxonId: 'taxon' },
      relations: [
        { alias: 'structures', catalog: 'obo-structures', entity: 'byProtein', obo: 'uniprot', type: 'hasMany' },
        { alias: 'partner', entity: 'protein', localKey: 'partnerUniprotAccession', obo: 'uniprot', type: 'hasOne' }
      ]
    }
  ]
}

const STRUCTURES = {
  name: 'obo-structures',
  label: 'Structures',
  driver: 'api',
  connection: { database: 'https://obo-structures.test' },
  entities: [
    { name: 'byProtein', description: 'structures of a protein', path: '/s/{uniprotAccession}', params: { uniprotAccession: {} }, fields: { pdbId: 'id' } },
    { name: 'disease', description: 'a disease', path: '/d/{diseaseId}', params: { diseaseId: {} }, fields: { diseaseId: 'id', name: 'name' } },
    { name: 'mondoOnly', description: 'MONDO lookups', path: '/m/{mondoId}', params: { mondoId: {} }, fields: { mondoId: 'id' } }
  ]
}

let unregister
before(() => {
  const a = registerCatalog(PROTEINS)
  const b = registerCatalog(STRUCTURES)
  sources.clearLinkCache()
  unregister = () => { a(); b(); sources.clearLinkCache() }
})
after(() => unregister())

let originalFetch
let requested
beforeEach(() => {
  http.reset()
  requested = []
  originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    requested.push(u.host + u.pathname)
    const body = {
      'obo-proteins.test/p/P04637': { acc: 'uniprotkb:p04637', partner: 'Q00987', disease: 'MONDO_0007254', taxon: '9606' },
      'obo-proteins.test/p/Q00987': { acc: 'Q00987' },
      'obo-structures.test/s/P04637': [{ id: '1tup' }],
      'obo-structures.test/d/MONDO:0007254': { id: 'MONDO:0007254', name: 'breast carcinoma' },
      'obo-structures.test/m/MONDO:0007254': { id: 'MONDO:0007254' }
    }[u.host + u.pathname]
    return {
      ok: body != null,
      status: body != null ? 200 : 404,
      statusText: '',
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body ?? {})
    }
  }
})
afterEach(() => { globalThis.fetch = originalFetch })

describe('relations declared by OBO key', () => {
  test('resolve their join fields from the annotations on both sides', () => {
    const entity = PROTEINS.entities[0]
    const rel = sources.resolveRelation(PROTEINS, entity, entity.relations[0])
    assert.equal(rel.localKey, 'uniprotAccession')
    assert.equal(rel.foreignKey, 'uniprotAccession')
  })

  test('keep an explicit localKey where several fields carry the key', () => {
    const entity = PROTEINS.entities[0]
    assert.equal(sources.resolveRelation(PROTEINS, entity, entity.relations[1]).localKey, 'partnerUniprotAccession')
  })

  test('fail clearly when a side has nothing for the key', () => {
    const entity = PROTEINS.entities[0]
    assert.throws(() => sources.resolveRelation(PROTEINS, entity, { alias: 'x', catalog: 'obo-structures', entity: 'byProtein', obo: 'chebi' }), /no parameter for OBO key "chebi"/)
    assert.throws(() => sources.resolveRelation(PROTEINS, { ...entity, fields: { x: 'x' } }, entity.relations[0]), /no field with OBO key "uniprot"/)
  })

  test('run end to end, with keyed output values in canonical form', async () => {
    const { data } = await executeQuery({ source: 'obo-proteins', from: 'protein', where: { uniprotAccession: 'P04637' }, include: ['structures', 'partner'] })
    const [row] = data
    assert.equal(row.uniprotAccession, 'P04637', 'uniprotkb:p04637 normalised')
    assert.equal(row.diseaseId, 'MONDO:0007254', 'MONDO_0007254 normalised')
    assert.equal(row.taxonId, 9606)
    assert.deepEqual(row.structures, [{ pdbId: '1TUP' }])
    assert.equal(row.partner.uniprotAccession, 'Q00987')
  })

  test('the lint catches a join between different identifier spaces', () => {
    const bad = { ...PROTEINS, entities: [{ ...PROTEINS.entities[0], relations: [{ alias: 'x', catalog: 'obo-structures', entity: 'byProtein', localKey: 'taxonId', foreignKey: 'uniprotAccession', type: 'hasMany' }] }] }
    const problems = lintEntry(bad, (n) => getCatalog(n)[0])
    assert.match(problems.join('\n'), /joins "taxonId" \(OBO key ncbitaxon\) to "uniprotAccession", which takes uniprot/)
  })

  test('the lint rejects unknown keys', () => {
    const bad = { ...PROTEINS, entities: [{ ...PROTEINS.entities[0], obo: { taxonId: 'taxonomy' }, params: { uniprotAccession: { obo: 'uniprotkb' } }, relations: [{ alias: 'x', entity: 'protein', obo: 'proteins', type: 'hasOne' }] }] }
    const out = lintEntry(bad, (n) => getCatalog(n)[0]).join('\n')
    assert.match(out, /obo.taxonId names unknown OBO key "taxonomy"/)
    assert.match(out, /params.uniprotAccession.obo names unknown OBO key "uniprotkb"/)
    assert.match(out, /obo names unknown OBO key "proteins"/)
  })
})

describe('implicit links (no declaration at all)', () => {
  test('every entity whose required parameter takes a key a field carries', () => {
    const links = sources.implicitLinks(PROTEINS, PROTEINS.entities[0]).map((l) => l.name)
    assert.ok(links.includes('obo-structures/byProtein'))
    assert.ok(links.includes('obo-structures/byProtein(partnerUniprotAccession)'))
    assert.ok(links.includes('obo-structures/disease'), 'a CURIE field reaches a disease parameter')
  })

  test('include follows one by name, converting the value to the target\'s form', async () => {
    const { data } = await executeQuery({ source: 'obo-proteins', from: 'protein', where: { uniprotAccession: 'P04637' }, include: ['obo-structures/disease', 'obo-structures/mondoOnly'] })
    assert.deepEqual(data[0]['obo-structures/disease'], [{ diseaseId: 'MONDO:0007254', name: 'breast carcinoma' }])
  })

  test('include names an unknown link with a hint', async () => {
    await assert.rejects(
      executeQuery({ source: 'obo-proteins', from: 'protein', where: { uniprotAccession: 'P04637' }, include: ['obo-structures/nowhere'] }),
      /Unknown include "obo-structures\/nowhere".*shares an OBO key/
    )
  })
})

describe('joining by key converts or refuses values', () => {
  const { fetchRelation } = require('../src/database/relations')
  const conn = { driver: 'api', source: 'obo-structures' }
  const run = (input) => executeQuery(input)

  test('a CURIE from another space resolves to nothing instead of a wrong match', async () => {
    const out = await fetchRelation(run, conn, { d: 'HP:0001250' }, { entity: 'mondoOnly', localKey: 'd', foreignKey: 'mondoId', obo: 'mondo', type: 'hasMany' })
    assert.deepEqual(out, [])
    assert.equal(requested.length, 0)
  })

  test('a * relation normalises the CURIE it passes on', async () => {
    const out = await fetchRelation(run, conn, { d: 'MONDO_0007254' }, { entity: 'disease', localKey: 'd', foreignKey: 'diseaseId', obo: '*', type: 'hasOne' })
    assert.equal(out.diseaseId, 'MONDO:0007254')
  })
})

describe('self-hosted sources', () => {
  const ENTRY = {
    name: 'obo-selfhosted',
    label: 'Self-hosted',
    driver: 'sqlite3',
    connection: { database: { env: 'MOZG_TEST_SQLITE_PATH', default: ':memory:' }, password: { env: 'MOZG_TEST_SECRET' } },
    entities: [{ name: 't', columns: ['accession'], obo: { accession: 'uniprot' }, relations: [] }]
  }

  test('connection values come from the environment', () => {
    const undo = registerCatalog(ENTRY)
    process.env.MOZG_TEST_SECRET = 's3cret'
    try {
      const c = sources.connectionForSource('obo-selfhosted')
      assert.equal(c.database, ':memory:', 'default used when the variable is unset')
      assert.equal(c.password, 's3cret')
      assert.ok(sources.isServerHeld(ENTRY))
    } finally {
      delete process.env.MOZG_TEST_SECRET
      undo()
    }
  })

  test('a server-held connection cannot be redirected by the caller', () => {
    const undo = registerCatalog(ENTRY)
    try {
      assert.throws(
        () => sources.normalizeQueryInput({ source: 'obo-selfhosted', connection: { host: 'evil.example' }, from: 't' }),
        /hosted with this server and its connection cannot be overridden/
      )
    } finally {
      undo()
    }
  })

  test('keyed columns of a SQL table are reachable as implicit links', () => {
    const undo = registerCatalog(ENTRY)
    sources.clearLinkCache()
    try {
      const links = sources.implicitLinks(PROTEINS, PROTEINS.entities[0]).map((l) => l.name)
      assert.ok(links.includes('obo-selfhosted/t'))
    } finally {
      undo()
      sources.clearLinkCache()
    }
  })

  test('MOZG_SOURCES_DIR entries are registered from JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-sources-'))
    fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ ...ENTRY, name: 'obo-from-dir' }))
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'not json')
    // Directory entries stay registered for the life of the process (each
    // test file runs in its own), exactly as they do in a deployment.
    const names = loadCatalogDir(dir)
    assert.deepEqual(names, ['obo-from-dir'])
    assert.equal(getCatalog('obo-from-dir')[0].driver, 'sqlite3')
    assert.throws(() => loadCatalogDir(dir), /already registered/)
    assert.deepEqual(loadCatalogDir(path.join(dir, 'missing')), [])
  })
})

describe('explicit relations by OBO key in a query', () => {
  test('are resolved against the catalog, nested ones too', async () => {
    const { data } = await executeQuery({
      source: 'obo-proteins',
      from: 'protein',
      where: { uniprotAccession: 'P04637' },
      relations: [{ alias: 'mine', catalog: 'obo-structures', entity: 'byProtein', obo: 'uniprot' }]
    })
    assert.deepEqual(data[0].mine, [{ pdbId: '1TUP' }])
  })

  test('without a catalog source they fail clearly instead of querying an undefined key', async () => {
    const { fetchRelation } = require('../src/database/relations')
    await assert.rejects(
      fetchRelation(executeQuery, { driver: 'api', source: 'obo-structures' }, { a: 1 }, { entity: 'byProtein', obo: 'uniprot' }),
      /declared by OBO key "uniprot" but not resolved/
    )
    assert.throws(
      () => sources.normalizeQueryInput({ connection: { driver: 'sqlite3', database: ':memory:' }, from: 't', relations: [{ entity: 'x', obo: 'uniprot' }] }),
      /needs a catalog source/
    )
  })
})
