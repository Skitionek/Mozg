'use strict'

const { test, describe, before, after, afterEach, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { TermIndex, termsFromObo, termsFromQuads, canonicalId, normalizeText } = require('../src/ontology/terms')
const { parseTurtle } = require('../src/ontology/formats/turtle')
const links = require('../src/ontology/links')
const registry = require('../src/database/registry')
const { executeQuery } = require('../src/database/connector')
const { resetResultCache } = require('../src/database/result-cache')
const { createMozgServer } = require('../src/server')

const OBO = `format-version: 1.2
ontology: mini

[Term]
id: MINI:0000001
name: disease

[Term]
id: MINI:0000002
name: diabetes mellitus
def: "A metabolic disease with \\"high\\" blood sugar." [ORCID:0000]
synonym: "sugar diabetes" EXACT []
synonym: "DM" RELATED [MESH:D003920]
xref: MESH:D003920 {source="MONDO:equivalentTo"}
xref: OMIM:222100 "type 1"
alt_id: MINI:0000099
is_a: MINI:0000001 ! disease

[Term]
id: MINI:0000003
name: asthma
is_a: MINI:0000001 ! disease
is_a: MINI:9999999 ! not in this file

[Term]
id: MINI:0000004
name: diabetes mellitus
is_obsolete: true

[Typedef]
id: part_of
name: part of
`

const TURTLE = `
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix oboInOwl: <http://www.geneontology.org/formats/oboInOwl#> .
@prefix obo: <http://purl.obolibrary.org/obo/> .

obo:MINI_0000001 a owl:Class ; rdfs:label "disease" .
obo:MINI_0000002 a owl:Class ;
  rdfs:label "diabetes mellitus" ;
  rdfs:subClassOf obo:MINI_0000001, [ a owl:Restriction ] ;
  oboInOwl:hasExactSynonym "sugar diabetes" ;
  oboInOwl:hasDbXref "MESH:D003920" ;
  obo:IAO_0000115 "A metabolic disease." .
obo:MINI_0000005 a owl:Class ; rdfs:label "old thing" ; owl:deprecated true .
<http://example.org/other> a owl:Class ; rdfs:label "Not an OBO IRI" .
`

describe('reading terms', () => {
  test('from an OBO flat file: names, synonyms, xrefs, parents, obsolescence', () => {
    const terms = termsFromObo(OBO)
    assert.deepEqual(terms.map((t) => t.id), ['MINI:0000001', 'MINI:0000002', 'MINI:0000003', 'MINI:0000004'], 'the Typedef is not a term')
    const dm = terms[1]
    assert.equal(dm.label, 'diabetes mellitus')
    assert.equal(dm.definition, 'A metabolic disease with "high" blood sugar.', 'escapes in the quoted definition are read')
    assert.deepEqual(dm.synonyms, ['sugar diabetes', 'DM'])
    assert.deepEqual(dm.xrefs, ['MESH:D003920', 'OMIM:222100'], 'modifiers and trailing descriptions are dropped')
    assert.deepEqual(dm.altIds, ['MINI:0000099'])
    assert.deepEqual(dm.parents, ['http://purl.obolibrary.org/obo/MINI_0000001'])
    assert.deepEqual(terms[2].parents, ['http://purl.obolibrary.org/obo/MINI_0000001'], 'a parent outside the file is dropped')
    assert.equal(terms[3].deprecated, true)
    assert.equal(dm.iri, 'http://purl.obolibrary.org/obo/MINI_0000002')
  })

  test('from RDF: classes only, with ids from OBO IRIs and parents among the terms', async () => {
    const terms = termsFromQuads(await parseTurtle(TURTLE))
    const byLabel = Object.fromEntries(terms.map((t) => [t.label, t]))
    assert.deepEqual(terms.map((t) => t.label).sort(), ['Not an OBO IRI', 'diabetes mellitus', 'disease', 'old thing'])
    assert.equal(byLabel['diabetes mellitus'].id, 'MINI:0000002')
    assert.deepEqual(byLabel['diabetes mellitus'].synonyms, ['sugar diabetes'])
    assert.deepEqual(byLabel['diabetes mellitus'].xrefs, ['MESH:D003920'])
    assert.equal(byLabel['diabetes mellitus'].definition, 'A metabolic disease.')
    assert.deepEqual(byLabel['diabetes mellitus'].parents, ['http://purl.obolibrary.org/obo/MINI_0000001'], 'the restriction is not a parent')
    assert.equal(byLabel['old thing'].deprecated, true)
    assert.equal(byLabel['Not an OBO IRI'].id, null, 'no id is invented for a non-OBO IRI')
  })

  test('identifiers and labels compare in one form', () => {
    assert.equal(canonicalId('mondo_0005015'), 'MONDO:0005015')
    assert.equal(canonicalId('MONDO:0005015'), 'MONDO:0005015')
    assert.equal(normalizeText('  Diabetes   MELLITUS '), 'diabetes mellitus')
  })
})

describe('TermIndex.lookup', () => {
  const index = new TermIndex(termsFromObo(OBO))

  test('finds a term by identifier in any spelling, by IRI, by alternative id, or by bare local id', () => {
    for (const value of ['MINI:0000002', 'mini_0000002', 'http://purl.obolibrary.org/obo/MINI_0000002', 'MINI:0000099']) {
      assert.equal(index.lookup(value).term.label, 'diabetes mellitus', value)
      assert.equal(index.lookup(value).matchedBy, 'id')
    }
    assert.equal(index.lookup('0000002'), null, 'a bare id needs a prefix to be read as one')
    assert.equal(index.lookup('0000002', { prefix: 'MINI' }).term.label, 'diabetes mellitus')
  })

  test('finds it by label ignoring case and spacing, then synonym, then cross-reference', () => {
    assert.deepEqual(['Diabetes   MELLITUS', 'sugar diabetes', 'mesh:d003920'].map((v) => index.lookup(v).matchedBy), ['label', 'synonym', 'xref'])
    assert.equal(index.lookup('Asthma').term.id, 'MINI:0000003')
  })

  test('prefers a current term to an obsolete one of the same name, and reports the ambiguity', () => {
    const found = index.lookup('diabetes mellitus')
    assert.equal(found.term.id, 'MINI:0000002')
    assert.equal(found.term.deprecated, false)
    assert.equal(found.ambiguous, 1, 'only the live one counts')
  })

  test('match restricts and orders the ways a value may name a term', () => {
    assert.equal(index.lookup('asthma', { match: ['id'] }), null)
    assert.equal(index.lookup('MINI:0000003', { match: ['label'] }), null)
    assert.equal(index.lookup('sugar diabetes', { match: ['label', 'synonym'] }).matchedBy, 'synonym')
  })

  test('does not make a term of nothing, an object or an unknown value', () => {
    for (const value of [null, undefined, '', '   ', {}, [], 'no such thing']) assert.equal(index.lookup(value), null)
  })

  test('search ranks an exact label, then a prefix, then a substring, then a synonym; never an obsolete term', () => {
    const labels = (text) => index.search(text).map((t) => t.label)
    assert.deepEqual(labels('asthma'), ['asthma'])
    assert.deepEqual(labels('dis'), ['disease'], 'a prefix of "disease"')
    assert.deepEqual(labels('mellitus'), ['diabetes mellitus'], 'a substring, and the obsolete twin is not offered')
    assert.deepEqual(labels('sugar'), ['diabetes mellitus'], 'a synonym')
    assert.deepEqual(labels(''), [])
  })
})

describe('applying links to rows', () => {
  const config = JSON.stringify([{ name: 'mini', url: 'https://ontologies.example.org/mini.obo', format: 'obo', obo: 'mini', label: 'Mini' }])
  const realFetch = globalThis.fetch
  const saved = process.env.MOZG_ONTOLOGIES
  let fetches

  before(() => {
    process.env.MOZG_ONTOLOGIES = config
    fetches = []
    globalThis.fetch = async (url) => {
      fetches.push(String(url))
      return new Response(OBO, { status: 200, headers: { 'content-type': 'text/plain' } })
    }
  })
  after(() => {
    globalThis.fetch = realFetch
    if (saved === undefined) delete process.env.MOZG_ONTOLOGIES
    else process.env.MOZG_ONTOLOGIES = saved
    links.resetOntologies()
  })

  test('lists the configured ontologies, loaded or not', async () => {
    links.resetOntologies()
    assert.deepEqual(links.listOntologies(), [{
      name: 'mini', label: 'Mini', url: 'https://ontologies.example.org/mini.obo', format: 'obo', obo: 'mini', loaded: false, termCount: null, error: null
    }])
    await links.applyLinks([{ d: 'asthma' }], [{ field: 'd', ontology: 'mini' }])
    assert.equal(links.listOntologies()[0].loaded, true)
    assert.equal(links.listOntologies()[0].termCount, 4)
  })

  test('writes the term beside the value, or null, and loads the ontology once', async () => {
    links.resetOntologies()
    fetches.length = 0
    const rows = [{ id: 1, disease: 'MINI:0000002' }, { id: 2, disease: 'asthma' }, { id: 3, disease: 'unheard of' }, { id: 4, disease: null }]
    await links.applyLinks(rows, [{ field: 'disease', ontology: 'mini' }])
    assert.deepEqual(rows[0].diseaseTerm, { iri: 'http://purl.obolibrary.org/obo/MINI_0000002', id: 'MINI:0000002', label: 'diabetes mellitus', matchedBy: 'id', ontology: 'mini' })
    assert.equal(rows[1].diseaseTerm.matchedBy, 'label')
    assert.equal(rows[2].diseaseTerm, null)
    assert.equal(rows[3].diseaseTerm, null)
    await links.applyLinks(rows, [{ field: 'disease', ontology: 'mini' }])
    assert.equal(fetches.length, 1, 'fetched once for both uses')
  })

  test('shares one load among concurrent first uses', async () => {
    links.resetOntologies()
    fetches.length = 0
    await Promise.all([1, 2, 3].map(() => links.applyLinks([{ d: 'asthma' }], [{ field: 'd', ontology: 'mini' }])))
    assert.equal(fetches.length, 1)
  })

  test('reads a bare local id with the ontology\'s own prefix', async () => {
    const rows = [{ d: '0000003' }]
    await links.applyLinks(rows, [{ field: 'd', ontology: 'mini' }])
    assert.equal(rows[0].dTerm.id, 'MINI:0000003')
  })

  test('as names the key, match restricts, details adds the rest', async () => {
    const rows = [{ d: 'sugar diabetes' }]
    await links.applyLinks(rows, [{ field: 'd', ontology: 'mini', as: 'term', match: ['label'] }])
    assert.equal(rows[0].term, null, 'a synonym is not a label')
    await links.applyLinks(rows, [{ field: 'd', ontology: 'mini', as: 'term', details: true }])
    assert.deepEqual(rows[0].term.synonyms, ['sugar diabetes', 'DM'])
    assert.deepEqual(rows[0].term.xrefs, ['MESH:D003920', 'OMIM:222100'])
    assert.match(rows[0].term.definition, /metabolic disease/)
  })

  test('a field holding a list gets a list of terms', async () => {
    const rows = [{ ds: ['asthma', 'nothing', 'MINI:0000001'] }]
    await links.applyLinks(rows, [{ field: 'ds', ontology: 'mini' }])
    assert.deepEqual(rows[0].dsTerm.map((t) => t && t.label), ['asthma', null, 'disease'])
  })

  test('a.b follows related rows and lists', async () => {
    const rows = [{ id: 1, target: { disease: 'asthma' }, hits: [{ disease: 'MINI:0000001' }, { disease: 'x' }] }, { id: 2, target: null }]
    await links.applyLinks(rows, [{ field: 'target.disease', ontology: 'mini' }, { field: 'hits.disease', ontology: 'mini' }])
    assert.equal(rows[0].target.diseaseTerm.label, 'asthma')
    assert.deepEqual(rows[0].hits.map((h) => h.diseaseTerm && h.diseaseTerm.label), ['disease', null])
    assert.equal(rows[1].target, null)
  })

  test('a field the rows do not have is an error naming the ones they do, not a column of nulls', async () => {
    const rows = [{ id: 1, hpoId: 'HP:0002063' }, { id: 2, hpoId: 'HP:0001250' }]
    await assert.rejects(
      links.applyLinks(rows, [{ field: 'phenotypeId', ontology: 'mini' }]),
      /Cannot link "phenotypeId": the rows have no such field\. Fields: id, hpoId/
    )
    assert.deepEqual(Object.keys(rows[0]), ['id', 'hpoId'], 'the rows were left alone')
    // A path through related rows may find nothing to follow, and is not an error.
    await links.applyLinks([{ id: 1, target: null }], [{ field: 'target.disease', ontology: 'mini' }])
    // A field that is present but empty is a value of null, not a typo.
    await links.applyLinks([{ d: null }], [{ field: 'd', ontology: 'mini' }])
  })

  test('gives a clear error for an unknown ontology, a bad match and too many links', async () => {
    await assert.rejects(links.applyLinks([{ d: 'x' }], [{ field: 'd', ontology: 'nope' }]), /Unknown ontology "nope"\. Configured: mini\./)
    await assert.rejects(links.applyLinks([{ d: 'x' }], [{ field: 'd', ontology: 'mini', match: ['fuzzy'] }]), /not one of: id, label, synonym, xref/)
    await assert.rejects(links.applyLinks([{ d: 'x' }], [{ ontology: 'mini' }]), /needs a field/)
    await assert.rejects(links.applyLinks([{ d: 'x' }], Array.from({ length: 6 }, () => ({ field: 'd', ontology: 'mini' }))), /at most 5 links/)
    await assert.rejects(links.applyLinks([{ d: 'x' }], [{ field: 'd' }]), /needs an ontology/)
  })

  test('keeps a named ontology loaded however many inline ones come after it', async () => {
    // Given a named ontology that has loaded
    links.resetOntologies()
    await links.applyLinks([{ d: 'asthma' }], [{ field: 'd', ontology: 'mini' }])
    fetches.length = 0

    // When more distinct inline ontologies are used than the cache holds
    for (let n = 0; n < 30; n++) {
      const content = `format-version: 1.2\n\n[Term]\nid: INL:${String(n).padStart(7, '0')}\nname: inline term ${n}\n`
      await links.applyLinks([{ d: `inline term ${n}` }], [{ field: 'd', content }])
    }

    // Then the named one is still loaded, and using it does not fetch it again
    assert.equal(links.listOntologies()[0].loaded, true)
    await links.applyLinks([{ d: 'asthma' }], [{ field: 'd', ontology: 'mini' }])
    assert.equal(fetches.length, 0)
  })

  test('does not cache a failed load, and says why in the listing', async () => {
    links.resetOntologies()
    globalThis.fetch = async () => new Response('nope', { status: 500 })
    await assert.rejects(links.applyLinks([{ d: 'x' }], [{ field: 'd', ontology: 'mini' }]))
    assert.match(links.listOntologies()[0].error, /./)
    globalThis.fetch = async () => new Response(OBO, { status: 200 })
    await links.applyLinks([{ d: 'asthma' }], [{ field: 'd', ontology: 'mini' }])
    assert.equal(links.listOntologies()[0].loaded, true)
    assert.equal(links.listOntologies()[0].error, null)
  })
})

describe('inline ontologies', () => {
  test('content is read and cached, in any supported format', async () => {
    links.resetOntologies()
    const turtle = [{ d: 'MESH:D003920' }]
    await links.applyLinks(turtle, [{ field: 'd', content: TURTLE }])
    assert.equal(turtle[0].dTerm.label, 'diabetes mellitus')
    assert.equal(turtle[0].dTerm.ontology, 'inline')

    const obo = [{ d: 'MESH:D003920' }]
    await links.applyLinks(obo, [{ field: 'd', content: OBO, format: 'obo' }])
    assert.equal(obo[0].dTerm.id, 'MINI:0000002')
  })

  test('an ontology with no terms is an error, not an empty index', async () => {
    await assert.rejects(links.applyLinks([{ d: 'x' }], [{ field: 'd', content: '@prefix : <http://x/> .' }]), /no terms/)
  })

  test('a url goes through the same screening as ingestOntology', async () => {
    await assert.rejects(links.applyLinks([{ d: 'x' }], [{ field: 'd', url: 'http://127.0.0.1/mini.obo' }]), /private|not allowed/i)
  })
})

describe('links in a query', () => {
  afterEach(() => { mock.restoreAll(); resetResultCache() })

  test('are applied to the finished rows and kept from the driver', async () => {
    let seen
    mock.method(registry, 'getDriver', () => ({
      executeQuery: async (input) => { seen = input; return { data: [{ id: 1, disease: 'asthma' }, { id: 2, disease: 'DM' }], count: 2 } }
    }))
    const { data } = await executeQuery({
      connection: { driver: 'sqlite3', database: 'links.db' },
      from: 'patients',
      link: [{ field: 'disease', content: OBO, format: 'obo' }]
    })
    assert.equal(seen.link, undefined, 'link is not a driver option')
    assert.equal(data[0].diseaseTerm.id, 'MINI:0000003')
    assert.equal(data[1].diseaseTerm.id, 'MINI:0000002', 'DM is a synonym')
    assert.equal(data[1].diseaseTerm.matchedBy, 'synonym')
  })

  test('follow a field of an included relation', async () => {
    mock.method(registry, 'getDriver', () => ({
      executeQuery: async () => ({ data: [{ id: 1, target: { disease: 'asthma' } }], count: 1 })
    }))
    const { data } = await executeQuery({
      connection: { driver: 'sqlite3', database: 'rel.db' },
      from: 'x',
      link: [{ field: 'target.disease', content: OBO, format: 'obo' }]
    })
    assert.equal(data[0].target.diseaseTerm.label, 'asthma')
  })
})

describe('links over HTTP', () => {
  const SAMPLE_DB = path.join(__dirname, '..', 'examples', 'sample.db')
  let server
  let base
  before(async () => {
    if (!fs.existsSync(SAMPLE_DB)) {
      const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'examples', 'seed.js')], { stdio: 'pipe' })
      if (result.status !== 0) throw new Error(`Seed failed: ${result.stderr.toString()}`)
    }
    server = createMozgServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) }))

  const graphql = (query, variables) => fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  }).then((r) => r.json())

  test('a query links a column of a real database to an ontology given inline', async () => {
    const ontology = '[Term]\nid: PEOPLE:1\nname: Alice Müller\n\n[Term]\nid: PEOPLE:2\nname: Bob Smith\nsynonym: "Bobby" EXACT []\n'
    const out = await graphql(`query ($db: String!, $content: String!) {
      query(input: {
        connection: { driver: sqlite3, database: $db }, from: "users", limit: 5,
        link: [{ field: "name", content: $content, format: obo, as: "person" }]
      }) { count data }
    }`, { db: SAMPLE_DB, content: ontology })
    assert.equal(out.errors, undefined, JSON.stringify(out.errors))
    const rows = out.data.query.data
    assert.ok(rows.length > 0)
    const alice = rows.find((r) => r.name === 'Alice Müller')
    assert.ok(alice, 'the sample database has an Alice Müller')
    assert.equal(alice.person.id, 'PEOPLE:1', 'a label with a non-ASCII letter matches')
    assert.equal(rows.find((r) => r.name === 'Bob Smith').person.id, 'PEOPLE:2')
    assert.ok(rows.filter((r) => !['Alice Müller', 'Bob Smith'].includes(r.name)).every((r) => r.person === null), 'the rest name no term')
  })

  test('ontologyTerms searches an ontology; ontologies lists none when none is configured', async () => {
    const out = await graphql(`query ($content: String!) {
      ontologies { name }
      ontologyTerms(search: "ally", content: $content, format: obo) { id label synonyms ontology }
    }`, { content: '[Term]\nid: PEOPLE:1\nname: Alice\nsynonym: "Ally" EXACT []\n' })
    assert.equal(out.errors, undefined, JSON.stringify(out.errors))
    assert.deepEqual(out.data.ontologies, [])
    assert.deepEqual(out.data.ontologyTerms, [{ id: 'PEOPLE:1', label: 'Alice', synonyms: ['Ally'], ontology: 'inline' }])
  })
})
