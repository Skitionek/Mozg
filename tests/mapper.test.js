'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { mapOntology, toTypeName, toFieldName, toTableName } = require('../src/ontology/mapper');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const BASE = 'http://mozg.example.org/blog#';

const BLOG_PARSED = {
  classes: [
    { iri: `${BASE}User`,    label: 'User',    comment: null, subClassOf: [], equivalentTo: [], disjointWith: [] },
    { iri: `${BASE}Post`,    label: 'Post',    comment: null, subClassOf: [], equivalentTo: [], disjointWith: [] },
    { iri: `${BASE}Comment`, label: 'Comment', comment: null, subClassOf: [`${BASE}Post`], equivalentTo: [], disjointWith: [] },
  ],
  objectProperties: [
    {
      iri: `${BASE}hasPosts`,
      label: 'has posts',
      comment: null,
      domain: [`${BASE}User`],
      range: [`${BASE}Post`],
      relationType: 'hasMany',
      isFunctional: false,
      minCard: null,
      maxCard: null,
    },
    {
      iri: `${BASE}author`,
      label: 'author',
      comment: null,
      domain: [`${BASE}Post`],
      range: [`${BASE}User`],
      relationType: 'belongsTo',
      isFunctional: true,
      minCard: null,
      maxCard: null,
    },
  ],
  dataProperties: [
    {
      iri: `${BASE}name`,
      label: 'name',
      comment: null,
      domain: [`${BASE}User`],
      range: [`${XSD}string`],
      graphqlType: 'String',
      required: true,
    },
    {
      iri: `${BASE}age`,
      label: 'age',
      comment: null,
      domain: [`${BASE}User`],
      range: [`${XSD}integer`],
      graphqlType: 'Int',
      required: false,
    },
    {
      iri: `${BASE}title`,
      label: 'title',
      comment: null,
      domain: [`${BASE}Post`],
      range: [`${XSD}string`],
      graphqlType: 'String',
      required: false,
    },
  ],
  tripleCount: 20,
};

// An ontology with an abstract parent class
const HIERARCHY_PARSED = {
  classes: [
    { iri: `${BASE}Animal`,  label: 'Animal',  comment: null, subClassOf: [], equivalentTo: [], disjointWith: [] },
    { iri: `${BASE}Dog`,     label: 'Dog',     comment: null, subClassOf: [`${BASE}Animal`], equivalentTo: [], disjointWith: [] },
    { iri: `${BASE}Cat`,     label: 'Cat',     comment: null, subClassOf: [`${BASE}Animal`], equivalentTo: [], disjointWith: [] },
  ],
  objectProperties: [],
  dataProperties: [
    {
      iri: `${BASE}species`,
      label: 'species',
      comment: null,
      domain: [`${BASE}Dog`],
      range: [`${XSD}string`],
      graphqlType: 'String',
      required: false,
    },
  ],
  tripleCount: 10,
};

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

describe('toTypeName', () => {
  test('converts IRI local name to PascalCase', () => {
    assert.equal(toTypeName('http://example.org/blog#BlogPost', null), 'BlogPost');
  });

  test('prefers rdfs:label over IRI local name', () => {
    assert.equal(toTypeName('http://example.org/blog#p1', 'User Post'), 'UserPost');
  });

  test('handles IRI with slash segments', () => {
    assert.equal(toTypeName('http://example.org/ontology/Person', null), 'Person');
  });
});

describe('toFieldName', () => {
  test('converts label with spaces to camelCase', () => {
    assert.equal(toFieldName('http://example.org#hasPosts', 'has posts'), 'hasPosts');
  });

  test('lowercases first word', () => {
    assert.equal(toFieldName('http://example.org#Name', null), 'name');
  });
});

describe('toTableName', () => {
  test('converts PascalCase to snake_case', () => {
    assert.equal(toTableName('BlogPost'), 'blog_post');
  });

  test('single-word type name is lowercased', () => {
    assert.equal(toTableName('User'), 'user');
  });
});

// ---------------------------------------------------------------------------
// mapOntology
// ---------------------------------------------------------------------------

describe('mapOntology – entityMap', () => {
  test('creates an entry for each class', () => {
    const { entityMap } = mapOntology(BLOG_PARSED);
    assert.ok(entityMap.has('User'), 'should have User');
    assert.ok(entityMap.has('Post'), 'should have Post');
    assert.ok(entityMap.has('Comment'), 'should have Comment');
  });

  test('entity tableName is snake_case of typeName', () => {
    const { entityMap } = mapOntology(BLOG_PARSED);
    assert.equal(entityMap.get('User').tableName, 'user');
    assert.equal(entityMap.get('Post').tableName, 'post');
  });

  test('data properties become fields on the domain type', () => {
    const { entityMap } = mapOntology(BLOG_PARSED);
    const user = entityMap.get('User');
    assert.ok(user.fields.length >= 2, 'User should have at least 2 fields');
    const nameField = user.fields.find((f) => f.fieldName === 'name');
    assert.ok(nameField, 'User should have a name field');
    assert.equal(nameField.graphqlType, 'String');
    assert.equal(nameField.required, true);
  });

  test('xsd:integer data property has graphqlType Int', () => {
    const { entityMap } = mapOntology(BLOG_PARSED);
    const user = entityMap.get('User');
    const ageField = user.fields.find((f) => f.fieldName === 'age');
    assert.ok(ageField, 'User should have an age field');
    assert.equal(ageField.graphqlType, 'Int');
  });

  test('object properties become relations on the domain type', () => {
    const { entityMap } = mapOntology(BLOG_PARSED);
    const user = entityMap.get('User');
    const postsRel = user.relations.find((r) => r.fieldName === 'hasPosts');
    assert.ok(postsRel, 'User should have a hasPosts relation');
    assert.equal(postsRel.relationType, 'hasMany');
    assert.equal(postsRel.targetTypeName, 'Post');
    assert.equal(postsRel.targetTable, 'post');
  });

  test('belongsTo relation has correct foreign key convention', () => {
    const { entityMap } = mapOntology(BLOG_PARSED);
    const post = entityMap.get('Post');
    const authorRel = post.relations.find((r) => r.fieldName === 'author');
    assert.ok(authorRel, 'Post should have an author relation');
    assert.equal(authorRel.relationType, 'belongsTo');
    assert.equal(authorRel.localKey, 'user_id');
    assert.equal(authorRel.foreignKey, 'id');
  });
});

describe('mapOntology – abstract / interface detection', () => {
  test('Animal is abstract because it has subclasses and no own properties', () => {
    const { entityMap } = mapOntology(HIERARCHY_PARSED);
    const animal = entityMap.get('Animal');
    assert.ok(animal, 'Animal should be in entityMap');
    assert.equal(animal.isAbstract, true);
  });

  test('Dog and Cat are concrete (not abstract)', () => {
    const { entityMap } = mapOntology(HIERARCHY_PARSED);
    assert.equal(entityMap.get('Dog').isAbstract, false);
    assert.equal(entityMap.get('Cat').isAbstract, false);
  });

  test('Dog and Cat implement Animal interface', () => {
    const { entityMap } = mapOntology(HIERARCHY_PARSED);
    assert.ok(entityMap.get('Dog').implementsInterfaces.includes('Animal'));
    assert.ok(entityMap.get('Cat').implementsInterfaces.includes('Animal'));
  });

  test('Post is NOT abstract even though Comment is a subclass (Post has data props)', () => {
    const { entityMap } = mapOntology(BLOG_PARSED);
    assert.equal(entityMap.get('Post').isAbstract, false);
  });
});

describe('mapOntology – typeDefs SDL', () => {
  test('returns a non-empty SDL string', () => {
    const { typeDefs } = mapOntology(BLOG_PARSED);
    assert.equal(typeof typeDefs, 'string');
    assert.ok(typeDefs.length > 0);
  });

  test('SDL contains type declarations for concrete classes', () => {
    const { typeDefs } = mapOntology(BLOG_PARSED);
    assert.ok(typeDefs.includes('type User'), 'SDL should contain "type User"');
    assert.ok(typeDefs.includes('type Post'), 'SDL should contain "type Post"');
  });

  test('SDL contains id field on each type', () => {
    const { typeDefs } = mapOntology(BLOG_PARSED);
    const typeBlocks = typeDefs.split(/(?=type |interface )/);
    for (const block of typeBlocks) {
      if (!block.trim()) continue;
      assert.ok(block.includes('id: ID!'), `Block missing id field:\n${block}`);
    }
  });

  test('SDL emits interface for abstract class', () => {
    const { typeDefs } = mapOntology(HIERARCHY_PARSED);
    assert.ok(typeDefs.includes('interface Animal'), 'SDL should contain "interface Animal"');
  });

  test('SDL uses implements for subclasses of abstract parent', () => {
    const { typeDefs } = mapOntology(HIERARCHY_PARSED);
    assert.ok(
      typeDefs.includes('type Dog implements Animal') ||
      typeDefs.includes('type Dog implements Animal {'),
      'Dog should implement Animal'
    );
  });

  test('hasMany relation emits list field type', () => {
    const { typeDefs } = mapOntology(BLOG_PARSED);
    assert.ok(typeDefs.includes('[Post!]!'), 'hasPosts should be [Post!]!');
  });

  test('required field emits non-null type', () => {
    const { typeDefs } = mapOntology(BLOG_PARSED);
    assert.ok(typeDefs.includes('name: String!'), 'required name field should be String!');
  });

  test('optional field does not emit non-null type', () => {
    const { typeDefs } = mapOntology(BLOG_PARSED);
    assert.ok(typeDefs.includes('age: Int'), 'optional age field should be Int (nullable)');
    assert.ok(!typeDefs.includes('age: Int!'), 'optional age field must not be Int!');
  });
});
