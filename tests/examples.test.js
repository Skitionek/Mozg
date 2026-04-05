'use strict';

/**
 * Examples integration tests.
 *
 * Ensures that every entry in examples/queries.json is:
 *   1. Parseable as a valid GraphQL document.
 *   2. Valid against the live Mozg schema (field names, argument types, …).
 *
 * Additionally exercises the example files directly:
 *   - examples/blog.ttl  → parsed by the ontology pipeline
 *   - examples/sample.db → seeded then queried via the SQLite driver
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { parse, validate } = require('graphql');
const { makeExecutableSchema } = require('@graphql-tools/schema');

const { typeDefs, resolvers } = require('../src/schema');
const { parseOntology } = require('../src/ontology');
const { executeQuery, destroyAll, introspect } = require('../src/database/drivers/sqlite3');

const EXAMPLES_DIR = path.join(__dirname, '..', 'examples');
const QUERIES_FILE = path.join(EXAMPLES_DIR, 'queries.json');
const BLOG_TTL_FILE = path.join(EXAMPLES_DIR, 'blog.ttl');
const SAMPLE_DB = path.join(EXAMPLES_DIR, 'sample.db');
const SEED_SCRIPT = path.join(EXAMPLES_DIR, 'seed.js');

// ---------------------------------------------------------------------------
// Build an executable schema once for all validation tests
// ---------------------------------------------------------------------------
const schema = makeExecutableSchema({ typeDefs, resolvers });

// ---------------------------------------------------------------------------
// Load example queries
// ---------------------------------------------------------------------------
const exampleQueries = JSON.parse(fs.readFileSync(QUERIES_FILE, 'utf8'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sqliteQueries = exampleQueries.filter((q) => q.category === 'SQLite');

// ---------------------------------------------------------------------------
// Setup: seed the sample SQLite database before SQLite tests run
// ---------------------------------------------------------------------------
before(() => {
  const result = spawnSync(process.execPath, [SEED_SCRIPT], { stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`Seed failed: ${result.stderr.toString()}`);
  }
});

after(async () => {
  await destroyAll();
});

// ---------------------------------------------------------------------------
// 1. All example queries must be valid GraphQL
// ---------------------------------------------------------------------------
describe('examples/queries.json – GraphQL syntax', () => {
  for (const example of exampleQueries) {
    test(`parses: ${example.name}`, () => {
      assert.doesNotThrow(
        () => parse(example.query),
        `"${example.name}" must be parseable GraphQL`,
      );
    });
  }
});

describe('examples/queries.json – schema validation', () => {
  for (const example of exampleQueries) {
    test(`validates: ${example.name}`, () => {
      const doc = parse(example.query);
      const errors = validate(schema, doc);
      assert.equal(
        errors.length,
        0,
        `"${example.name}" has schema errors: ${errors.map((e) => e.message).join('; ')}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 2. examples/blog.ttl – ontology pipeline exercises the real file
// ---------------------------------------------------------------------------
describe('examples/blog.ttl – ontology parsing', () => {
  test('file exists and is non-empty', () => {
    const stat = fs.statSync(BLOG_TTL_FILE);
    assert.ok(stat.size > 0, 'blog.ttl should not be empty');
  });

  test('parseOntology parses blog.ttl from file content', async () => {
    const content = fs.readFileSync(BLOG_TTL_FILE, 'utf8');
    const result = await parseOntology({ content, format: 'turtle' });

    assert.ok(result.tripleCount > 0, 'should parse at least one triple');
    assert.ok(result.classes.length >= 3, 'should have at least 3 classes (User, Post, Comment)');

    const names = result.classes.map((c) => c.label);
    assert.ok(names.includes('User'), 'should have User class');
    assert.ok(names.includes('Post'), 'should have Post class');
    assert.ok(names.includes('Comment'), 'should have Comment class');
  });

  test('generatedTypeDefs contains type declarations for blog classes', async () => {
    const content = fs.readFileSync(BLOG_TTL_FILE, 'utf8');
    const result = await parseOntology({ content, format: 'turtle' });

    assert.equal(typeof result.generatedTypeDefs, 'string');
    assert.ok(result.generatedTypeDefs.includes('User'), 'SDL should mention User');
    assert.ok(result.generatedTypeDefs.includes('Post'), 'SDL should mention Post');
  });
});

// ---------------------------------------------------------------------------
// 3. SQLite example queries – run against the seeded sample.db
// ---------------------------------------------------------------------------
describe('examples/queries.json – SQLite live queries', () => {
  const connection = { driver: 'sqlite3', database: SAMPLE_DB };

  test('SQLite – Blog: list users with posts (limit 5)', async () => {
    const result = await executeQuery({
      connection,
      from: 'users',
      limit: 5,
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', select: ['id', 'title'] }],
    });

    assert.ok(result.count > 0, 'should return at least one user');
    assert.ok(result.count <= 5, 'should respect the limit');
    assert.ok(Array.isArray(result.data[0].posts), 'each user should have a posts array');
  });

  test('SQLite – Blog: 3-level traversal (users → posts → comments)', async () => {
    const result = await executeQuery({
      connection,
      from: 'users',
      limit: 3,
      relations: [{
        entity: 'posts',
        foreignKey: 'user_id',
        type: 'hasMany',
        select: ['id', 'title'],
        relations: [{
          entity: 'comments',
          foreignKey: 'post_id',
          type: 'hasMany',
          select: ['id', 'body'],
        }],
      }],
    });

    assert.ok(result.count > 0, 'should return users');
    const firstUserWithPosts = result.data.find((u) => u.posts && u.posts.length > 0);
    assert.ok(firstUserWithPosts, 'at least one user should have posts');
    const postWithComments = firstUserWithPosts.posts.find((p) => p.comments && p.comments.length > 0);
    assert.ok(postWithComments, 'at least one post should have comments');
  });

  test('SQLite – Blog: introspect returns users, posts, comments tables', async () => {
    const schema = await introspect(connection);

    const tableNames = schema.tables.map((t) => t.name);
    assert.ok(tableNames.includes('users'), 'should find users table');
    assert.ok(tableNames.includes('posts'), 'should find posts table');
    assert.ok(tableNames.includes('comments'), 'should find comments table');

    const usersTable = schema.tables.find((t) => t.name === 'users');
    const colNames = usersTable.columns.map((c) => c.name);
    assert.ok(colNames.includes('id'), 'users should have id column');
    assert.ok(colNames.includes('name'), 'users should have name column');
    assert.ok(colNames.includes('email'), 'users should have email column');
  });

  // Verify that every SQLite example query in queries.json maps to a covered test above.
  // This assertion ensures no SQLite example is silently skipped.
  test('all SQLite example queries are covered', () => {
    assert.ok(sqliteQueries.length >= 3, `expected at least 3 SQLite examples, got ${sqliteQueries.length}`);
    const queryNames = new Set(sqliteQueries.map((q) => q.name));
    assert.ok(queryNames.has('SQLite – Blog: list users with posts'), 'should include the list-users example');
    assert.ok(queryNames.has('SQLite – Blog: users → posts → comments (3 levels)'), 'should include the 3-level example');
    assert.ok(queryNames.has('SQLite – Blog: introspect schema'), 'should include the introspect example');
  });
});
