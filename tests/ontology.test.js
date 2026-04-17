'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

let parseTurtle, extractOntology, parseOntology;
try {
  ({ parseTurtle } = require('../src/ontology/formats/turtle'));
  ({ extractOntology } = require('../src/ontology/extractor'));
  ({ parseOntology } = require('../src/ontology/index'));
} catch { /* n3 not installed — tests will be skipped */ }
const SKIP = !parseTurtle ? 'n3 not installed — ontology parser unavailable' : false;

const BLOG_TURTLE = `
@prefix : <http://mozg.example.org/blog#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

:BlogOntology a owl:Ontology .

:User    a owl:Class ; rdfs:label "User" .
:Post    a owl:Class ; rdfs:label "Post" .
:Comment a owl:Class ; rdfs:label "Comment" .

:hasPosts a owl:ObjectProperty ;
  rdfs:label "has posts" ;
  rdfs:domain :User ;
  rdfs:range :Post .

:name a owl:DatatypeProperty ;
  rdfs:domain :User ;
  rdfs:range xsd:string .

:age a owl:DatatypeProperty ;
  rdfs:domain :User ;
  rdfs:range xsd:integer .

# Restriction: User must have at least one name
:User rdfs:subClassOf [
  a owl:Restriction ;
  owl:onProperty :name ;
  owl:minCardinality "1"^^xsd:int
] .
`;

describe('Turtle parser', { skip: SKIP }, () => {
  test('parses triples from Turtle content', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    assert.ok(quads.length > 0, 'should produce at least one quad');
  });
});

describe('OWL extractor', { skip: SKIP }, () => {
  test('extracts classes from Turtle quads', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);

    assert.ok(result.classes.length >= 3, `expected >=3 classes, got ${result.classes.length}`);
    const userClass = result.classes.find((c) => c.iri.endsWith('#User'));
    assert.ok(userClass, 'should find User class');
    assert.equal(userClass.label, 'User');
  });

  test('classes have equivalentTo and disjointWith arrays', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);

    const userClass = result.classes.find((c) => c.iri.endsWith('#User'));
    assert.ok(Array.isArray(userClass.equivalentTo), 'equivalentTo should be an array');
    assert.ok(Array.isArray(userClass.disjointWith), 'disjointWith should be an array');
  });

  test('extracts object properties', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);

    const prop = result.objectProperties.find((p) => p.iri.endsWith('#hasPosts'));
    assert.ok(prop, 'should find hasPosts property');
    assert.equal(prop.relationType, 'hasMany');
    assert.equal(prop.isFunctional, false);
    assert.equal(prop.minCard, null);
    assert.equal(prop.maxCard, null);
  });

  test('extracts data properties with graphqlType and required', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);

    const nameProp = result.dataProperties.find((p) => p.iri.endsWith('#name'));
    assert.ok(nameProp, 'should find name data property');
    assert.equal(nameProp.graphqlType, 'String');
    assert.equal(nameProp.required, true, 'name should be required via minCardinality restriction');

    const ageProp = result.dataProperties.find((p) => p.iri.endsWith('#age'));
    assert.ok(ageProp, 'should find age data property');
    assert.equal(ageProp.graphqlType, 'Int');
    assert.equal(ageProp.required, false);
  });

  test('tripleCount matches quads', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);
    assert.equal(result.tripleCount, quads.length);
  });
});

describe('parseOntology (integration)', { skip: SKIP }, () => {
  test('auto-detects Turtle format from content', async () => {
    const result = await parseOntology({ content: BLOG_TURTLE });
    assert.ok(result.classes.length >= 3);
    assert.ok(result.tripleCount > 0);
  });

  test('explicit turtle format', async () => {
    const result = await parseOntology({ content: BLOG_TURTLE, format: 'turtle' });
    assert.ok(result.classes.length >= 3);
  });

  test('result includes generatedTypeDefs string', async () => {
    const result = await parseOntology({ content: BLOG_TURTLE });
    assert.equal(typeof result.generatedTypeDefs, 'string');
    assert.ok(result.generatedTypeDefs.length > 0, 'generatedTypeDefs should not be empty');
  });

  test('result includes generatedTypes summary', async () => {
    const result = await parseOntology({ content: BLOG_TURTLE });
    assert.ok(Array.isArray(result.generatedTypes), 'generatedTypes should be an array');
    const userType = result.generatedTypes.find((t) => t.name === 'User');
    assert.ok(userType, 'should have a User generated type');
    assert.equal(typeof userType.fieldCount, 'number');
    assert.equal(typeof userType.relationCount, 'number');
    assert.equal(userType.isAbstract, false);
  });

  test('validationReport is null when validate is not set', async () => {
    const result = await parseOntology({ content: BLOG_TURTLE });
    assert.equal(result.validationReport, null);
  });

  test('throws when neither content nor url is provided', async () => {
    await assert.rejects(
      () => parseOntology({}),
      /content.*url/i
    );
  });
});
