'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog, listCatalog } = require('../src/catalog/index');

describe('catalog', () => {
  test('listCatalog returns an array of name strings', () => {
    const names = listCatalog();
    assert.ok(Array.isArray(names), 'should be an array');
    assert.ok(names.length >= 1, 'should have at least one entry');
    for (const n of names) {
      assert.equal(typeof n, 'string');
    }
  });

  test('getCatalog with no argument returns all entries', () => {
    const all = getCatalog();
    const names = listCatalog();
    assert.equal(all.length, names.length);
  });

  test('getCatalog with a name returns a single-element array', () => {
    const entries = getCatalog('jsonplaceholder');
    assert.equal(entries.length, 1);
  });

  test('getCatalog throws for unknown catalog name', () => {
    assert.throws(
      () => getCatalog('no-such-catalog'),
      /Unknown catalog/,
    );
  });

  test('every catalog entry has required top-level fields', () => {
    const entries = getCatalog();
    for (const entry of entries) {
      assert.ok(entry.name,        `${entry.name}: name is required`);
      assert.ok(entry.label,       `${entry.name}: label is required`);
      assert.ok(entry.driver,      `${entry.name}: driver is required`);
      assert.ok(entry.connection,  `${entry.name}: connection is required`);
      assert.ok(
        typeof entry.connection === 'object' && entry.connection !== null,
        `${entry.name}: connection must be an object`,
      );
      assert.ok(Array.isArray(entry.entities), `${entry.name}: entities must be an array`);
    }
  });

  test('every catalog entity has name, columns array, and relations array', () => {
    const entries = getCatalog();
    for (const entry of entries) {
      for (const entity of entry.entities) {
        assert.ok(entity.name,                   `${entry.name}/${entity.name}: name is required`);
        assert.ok(Array.isArray(entity.columns),  `${entry.name}/${entity.name}: columns must be an array`);
        assert.ok(Array.isArray(entity.relations), `${entry.name}/${entity.name}: relations must be an array`);
      }
    }
  });

  test('every catalog relation has entity, foreignKey, and type', () => {
    const entries = getCatalog();
    for (const entry of entries) {
      for (const entity of entry.entities) {
        for (const rel of entity.relations) {
          assert.ok(rel.entity,     `relation in ${entry.name}/${entity.name}: entity is required`);
          assert.ok(rel.foreignKey, `relation in ${entry.name}/${entity.name}: foreignKey is required`);
          assert.ok(rel.type,       `relation in ${entry.name}/${entity.name}: type is required`);
          assert.ok(
            ['hasMany', 'hasOne', 'belongsTo'].includes(rel.type),
            `relation in ${entry.name}/${entity.name}: type must be a valid RelationType`,
          );
        }
      }
    }
  });

  test('getCatalog is lazy – each call to getCatalog loads only requested entries', () => {
    // Verify that calling getCatalog with a specific name only returns that entry
    for (const name of listCatalog()) {
      const entries = getCatalog(name);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].name, name);
    }
  });

  test('catalog files are not loaded until getCatalog is called (lazy loading)', () => {
    const path = require('node:path');
    const catalogDir = path.join(__dirname, '../src/catalog');

    // Evict all catalog entry modules from the require cache
    for (const name of listCatalog()) {
      const resolved = require.resolve(path.join(catalogDir, name === 'neo4j-movies' ? 'neo4j-movies' : name));
      delete require.cache[resolved];
    }

    // Also evict the index so we get a fresh loader registry
    const indexResolved = require.resolve(path.join(catalogDir, 'index'));
    delete require.cache[indexResolved];

    // Re-require only the index – no entry file should be loaded yet
    const { getCatalog: freshGet, listCatalog: freshList } = require(path.join(catalogDir, 'index'));

    // Confirm entry files are absent from cache before any getCatalog call
    for (const name of freshList()) {
      const resolved = require.resolve(path.join(catalogDir, name));
      assert.equal(require.cache[resolved], undefined, `${name} should not be cached before getCatalog()`);
    }

    // Load one specific entry and confirm only that file is now cached
    const targetName = freshList()[0];
    freshGet(targetName);
    const targetResolved = require.resolve(path.join(catalogDir, targetName));
    assert.ok(require.cache[targetResolved], `${targetName} should be cached after getCatalog('${targetName}')`);

    // Other entry files must still be absent
    for (const name of freshList().slice(1)) {
      const resolved = require.resolve(path.join(catalogDir, name));
      assert.equal(require.cache[resolved], undefined, `${name} should not yet be cached`);
    }
  });

  // Spot-check individual catalog entries

  test('chinook has Artist entity with ArtistId column', () => {
    const [entry] = getCatalog('chinook');
    const artist = entry.entities.find(e => e.name === 'Artist');
    assert.ok(artist, 'Artist entity should exist');
    assert.ok(artist.columns.includes('ArtistId'));
  });

  test('jsonplaceholder /posts entity has a hasMany relation to /comments', () => {
    const [entry] = getCatalog('jsonplaceholder');
    const posts = entry.entities.find(e => e.name === '/posts');
    assert.ok(posts, '/posts entity should exist');
    const rel = posts.relations.find(r => r.entity === '/comments' && r.type === 'hasMany');
    assert.ok(rel, '/posts should have a hasMany relation to /comments');
  });

  test('rnacentral has postgres driver and public connection host', () => {
    const [entry] = getCatalog('rnacentral');
    assert.equal(entry.driver, 'postgres');
    assert.ok(entry.connection.host, 'connection.host should be set');
  });

  test('neo4j-movies has neo4j driver with scheme set', () => {
    const [entry] = getCatalog('neo4j-movies');
    assert.equal(entry.driver, 'neo4j');
    assert.ok(entry.connection.scheme, 'connection.scheme should be set');
  });
});
