'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseTurtle } = require('../src/ontology/formats/turtle');
const { extractOntology } = require('../src/ontology/extractor');
const { parseOntology } = require('../src/ontology/index');

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
`;

describe('Turtle parser', () => {
  test('parses triples from Turtle content', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    assert.ok(quads.length > 0, 'should produce at least one quad');
  });
});

describe('OWL extractor', () => {
  test('extracts classes from Turtle quads', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);

    assert.ok(result.classes.length >= 3, `expected >=3 classes, got ${result.classes.length}`);
    const userClass = result.classes.find((c) => c.iri.endsWith('#User'));
    assert.ok(userClass, 'should find User class');
    assert.equal(userClass.label, 'User');
  });

  test('extracts object properties', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);

    const prop = result.objectProperties.find((p) => p.iri.endsWith('#hasPosts'));
    assert.ok(prop, 'should find hasPosts property');
    assert.equal(prop.relationType, 'hasMany');
  });

  test('extracts data properties', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);

    const prop = result.dataProperties.find((p) => p.iri.endsWith('#name'));
    assert.ok(prop, 'should find name data property');
  });

  test('tripleCount matches quads', async () => {
    const quads = await parseTurtle(BLOG_TURTLE);
    const result = extractOntology(quads);
    assert.equal(result.tripleCount, quads.length);
  });
});

describe('parseOntology (integration)', () => {
  test('auto-detects Turtle format from content', async () => {
    const result = await parseOntology({ content: BLOG_TURTLE });
    assert.ok(result.classes.length >= 3);
    assert.ok(result.tripleCount > 0);
  });

  test('explicit turtle format', async () => {
    const result = await parseOntology({ content: BLOG_TURTLE, format: 'turtle' });
    assert.ok(result.classes.length >= 3);
  });

  test('throws when neither content nor url is provided', async () => {
    await assert.rejects(
      () => parseOntology({}),
      /content.*url/i
    );
  });
});
