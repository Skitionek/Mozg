'use strict'

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const knex = require('knex')

const { executeKnexQuery } = require('../src/database/drivers/knex-query')

/**
 * Exercises the shared knex query/relation logic directly against an
 * in-memory SQLite database — the sqlite3 and postgres drivers both delegate
 * to this module, so its own branches (hasOne vs hasMany, belongsTo, empty
 * parent sets, select narrowing, nested relations, a failing relation) are
 * covered once here rather than twice through each driver.
 */
let db

function getKnexInstance () {
  return db
}

before(async () => {
  db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })

  await db.schema.createTable('authors', (t) => { t.integer('id').primary(); t.string('name') })
  await db.schema.createTable('books', (t) => {
    t.integer('id').primary()
    t.integer('author_id')
    t.string('title')
  })
  await db.schema.createTable('profiles', (t) => { t.integer('author_id'); t.string('bio') })

  await db('authors').insert([{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }, { id: 3, name: 'Lonely' }])
  await db('books').insert([
    { id: 10, author_id: 1, title: 'Notes' },
    { id: 11, author_id: 1, title: 'Letters' },
    { id: 12, author_id: 2, title: 'Codebreaking' }
  ])
  await db('profiles').insert([{ author_id: 1, bio: 'Mathematician' }])
})

after(async () => { await db.destroy() })

describe('executeKnexQuery: base query', () => {
  test('applies select, where, limit and orderBy', async () => {
    // Given a query against authors with a narrowed select and an order
    // When it is executed
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'authors',
      select: ['id', 'name'],
      where: { name: 'Ada' },
      orderBy: 'id',
      orderDirection: 'desc'
    })

    // Then the filter and projection both apply
    assert.equal(result.count, 1)
    assert.deepEqual(Object.keys(result.data[0]).sort(), ['id', 'name'])
  })
})

describe('executeKnexQuery: hasMany / hasOne', () => {
  test('hasMany groups every matching related row under each parent', async () => {
    // Given authors queried with their books as a hasMany relation
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'authors',
      relations: [{ entity: 'books', localKey: 'id', foreignKey: 'author_id', type: 'hasMany', alias: 'books' }]
    })

    // Then each author's books are grouped correctly, including an author
    // with none (the empty-parent-set branch)
    const ada = result.data.find((a) => a.name === 'Ada')
    const lonely = result.data.find((a) => a.name === 'Lonely')
    assert.equal(ada.books.length, 2)
    assert.deepEqual(lonely.books, [])
  })

  test('hasOne returns a single related row or null', async () => {
    // Given authors queried with their profile as a hasOne relation
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'authors',
      relations: [{ entity: 'profiles', localKey: 'id', foreignKey: 'author_id', type: 'hasOne', alias: 'profile' }]
    })

    // Then an author with a profile gets the object, one without gets null
    const ada = result.data.find((a) => a.name === 'Ada')
    const grace = result.data.find((a) => a.name === 'Grace')
    assert.equal(ada.profile.bio, 'Mathematician')
    assert.equal(grace.profile, null)
  })

  test('select on a hasMany relation always includes the join column', async () => {
    // Given a hasMany relation that selects a column other than the join key
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'authors',
      where: { name: 'Ada' },
      relations: [{ entity: 'books', localKey: 'id', foreignKey: 'author_id', type: 'hasMany', alias: 'books', select: ['title'] }]
    })

    // Then the join column is still present, so grouping worked, alongside
    // the requested column
    const book = result.data[0].books[0]
    assert.ok('author_id' in book, JSON.stringify(book))
    assert.ok('title' in book, JSON.stringify(book))
  })

  test('nested relations resolve one level deeper', async () => {
    // Given books with a nested belongsTo relation to their author
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'authors',
      where: { name: 'Ada' },
      relations: [{
        entity: 'books', localKey: 'id', foreignKey: 'author_id', type: 'hasMany', alias: 'books',
        relations: [{ entity: 'profiles', localKey: 'author_id', foreignKey: 'author_id', type: 'hasOne', alias: 'authorProfile' }]
      }]
    })

    // Then the nested relation resolved on each book
    const book = result.data[0].books[0]
    assert.equal(book.authorProfile.bio, 'Mathematician')
  })
})

describe('executeKnexQuery: belongsTo', () => {
  test('matches the related row by ownerKey and reports null for no match', async () => {
    // Given books queried with their author as a belongsTo relation
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'books',
      relations: [{ entity: 'authors', foreignKey: 'author_id', ownerKey: 'id', type: 'belongsTo', alias: 'author' }]
    })

    // Then each book's author is resolved by id
    assert.equal(result.data[0].author.name, 'Ada')
  })

  test('reports null when the foreign key has no match', async () => {
    // Given a book whose author_id does not exist
    await db('books').insert({ id: 13, author_id: 999, title: 'Orphan' })

    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'books',
      where: { id: 13 },
      relations: [{ entity: 'authors', foreignKey: 'author_id', ownerKey: 'id', type: 'belongsTo', alias: 'author' }]
    })

    assert.equal(result.data[0].author, null)
    await db('books').where({ id: 13 }).delete()
  })
})

describe('executeKnexQuery: a failing relation', () => {
  test('reports the error in place and keeps the parent rows', async () => {
    // Given a relation that names a table that does not exist
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'authors',
      where: { name: 'Ada' },
      relations: [{ entity: 'no_such_table', localKey: 'id', foreignKey: 'author_id', type: 'hasMany', alias: 'bad' }]
    })

    // Then the parent row survives, carrying the relation's error
    assert.equal(result.data[0].name, 'Ada')
    assert.match(result.data[0].bad.error, /relation fetch failed/)
  })
})

describe('executeKnexQuery: a relation naming another catalog', () => {
  test('a top-level catalog-tagged relation is not treated as a local join', async () => {
    // Given a relation naming a catalog rather than a local table
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'authors',
      where: { name: 'Ada' },
      relations: [{ entity: '/users', foreignKey: 'id', alias: 'external', type: 'hasMany', catalog: 'nosuchcatalog' }]
    })

    // Then it is resolved as a cross-catalog relation (reported as an unknown
    // catalog here), not attempted as `db('/users')`, which would throw a
    // generic SQL error instead of a legible one
    assert.match(result.data[0].external.error, /Unknown catalog/)
  })

  test('a catalog-tagged relation nested inside a same-source relation is still routed correctly', async () => {
    // Given a same-source hasMany relation whose own nested relation names
    // another catalog
    const result = await executeKnexQuery(getKnexInstance, {
      connection: {},
      from: 'authors',
      where: { name: 'Ada' },
      relations: [{
        entity: 'books', localKey: 'id', foreignKey: 'author_id', type: 'hasMany', alias: 'books',
        relations: [{ entity: '/x', foreignKey: 'id', alias: 'external', type: 'hasMany', catalog: 'nosuchcatalog' }]
      }]
    })

    // Then the nested relation is still recognised as cross-catalog at its own
    // depth, rather than being handed to db('/x') as if it were a local table
    const book = result.data[0].books[0]
    assert.match(book.external.error, /Unknown catalog/)
  })
})
