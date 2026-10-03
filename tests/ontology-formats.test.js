'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { parseRdfXml } = require('../src/ontology/formats/rdfxml')
const { parseOwlXml } = require('../src/ontology/formats/owlxml')
const { parseManchesterSyntax } = require('../src/ontology/formats/manchester')
const { extractOntology } = require('../src/ontology/extractor')

const RDF_XML = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
         xmlns:owl="http://www.w3.org/2002/07/owl#"
         xmlns="http://example.org/blog#">
  <owl:Class rdf:about="http://example.org/blog#User">
    <rdfs:label>User</rdfs:label>
  </owl:Class>
  <owl:Class rdf:about="http://example.org/blog#Post">
    <rdfs:label>Post</rdfs:label>
    <rdfs:subClassOf rdf:resource="http://example.org/blog#User"/>
  </owl:Class>
  <owl:ObjectProperty rdf:about="http://example.org/blog#hasPosts">
    <rdfs:domain rdf:resource="http://example.org/blog#User"/>
    <rdfs:range rdf:resource="http://example.org/blog#Post"/>
  </owl:ObjectProperty>
</rdf:RDF>`

describe('parseRdfXml', () => {
  test('parses RDF/XML into quads that the extractor understands', async () => {
    // Given an RDF/XML ontology with two classes and one object property
    // When it is parsed and extracted
    const quads = await parseRdfXml(RDF_XML)
    const ontology = extractOntology(quads)

    // Then the classes and the property are recovered
    const classIris = ontology.classes.map((c) => c.iri)
    assert.ok(classIris.includes('http://example.org/blog#User'), `got ${classIris}`)
    assert.ok(classIris.includes('http://example.org/blog#Post'), `got ${classIris}`)
    assert.equal(ontology.objectProperties.length, 1)
    assert.deepEqual(ontology.objectProperties[0].domain, ['http://example.org/blog#User'])
    assert.deepEqual(ontology.objectProperties[0].range, ['http://example.org/blog#Post'])
    assert.ok(quads.length > 0)
  })

  test('rejects malformed RDF/XML rather than resolving empty', async () => {
    // Given input that is not well-formed XML
    const malformed = '<rdf:RDF><owl:Class'

    // When it is parsed
    const attempt = parseRdfXml(malformed)

    // Then the parse error surfaces
    await assert.rejects(attempt)
  })
})

const OWL_XML = `<?xml version="1.0"?>
<Ontology xmlns="http://www.w3.org/2002/07/owl#">
  <Declaration><Class IRI="http://example.org/#User"/></Declaration>
  <Declaration><Class IRI="http://example.org/#Post"/></Declaration>
  <SubClassOf>
    <Class IRI="http://example.org/#Post"/>
    <Class IRI="http://example.org/#User"/>
  </SubClassOf>
  <Declaration><ObjectProperty IRI="http://example.org/#hasPosts"/></Declaration>
  <Declaration><DataProperty IRI="http://example.org/#title"/></Declaration>
</Ontology>`

describe('parseOwlXml', () => {
  test('recovers declared classes and properties', () => {
    // Given an OWL/XML ontology
    // When it is parsed
    const result = parseOwlXml(OWL_XML)

    // Then the declarations are reported
    const classIris = result.classes.map((c) => c.iri)
    assert.ok(classIris.includes('http://example.org/#User'), `got ${classIris}`)
    assert.ok(classIris.includes('http://example.org/#Post'), `got ${classIris}`)
    assert.equal(result.objectProperties.length, 1)
    assert.equal(result.dataProperties.length, 1)
  })

  test('reports tripleCount as 0, since it does not count triples', () => {
    // Given any OWL/XML input
    // When it is parsed
    const result = parseOwlXml(OWL_XML)

    // Then tripleCount is 0 — this parser works structurally, not by triple
    assert.equal(result.tripleCount, 0)
  })
})

const MANCHESTER = `Prefix: : <http://example.org/#>
Prefix: owl: <http://www.w3.org/2002/07/owl#>

Class: :User
    Annotations: rdfs:label "User"

Class: :Post
    Annotations: rdfs:label "Post"
    SubClassOf: :User

ObjectProperty: :hasPosts
    Domain: :User
    Range: :Post

DataProperty: :title
    Domain: :Post
    Range: xsd:string
`

describe('parseManchesterSyntax', () => {
  test('parses Class, ObjectProperty and DataProperty frames', () => {
    // Given a Manchester Syntax ontology
    // When it is parsed
    const result = parseManchesterSyntax(MANCHESTER)

    // Then each frame type is recovered with its prefix expanded
    const classIris = result.classes.map((c) => c.iri)
    assert.ok(classIris.includes('http://example.org/#User'), `got ${classIris}`)

    const post = result.classes.find((c) => c.iri === 'http://example.org/#Post')
    assert.ok(post.subClassOf.includes('http://example.org/#User'), `got ${JSON.stringify(post)}`)

    assert.equal(result.objectProperties.length, 1)
    assert.deepEqual(result.objectProperties[0].domain, ['http://example.org/#User'])
    assert.equal(result.dataProperties.length, 1)
    assert.deepEqual(result.dataProperties[0].domain, ['http://example.org/#Post'])
  })

  test('returns empty collections for input with no frames', () => {
    // Given input with only a prefix declaration
    const bare = 'Prefix: : <http://example.org/#>\n'

    // When it is parsed
    const result = parseManchesterSyntax(bare)

    // Then nothing is reported, rather than throwing
    assert.deepEqual(result.classes, [])
    assert.deepEqual(result.objectProperties, [])
    assert.deepEqual(result.dataProperties, [])
  })
})
