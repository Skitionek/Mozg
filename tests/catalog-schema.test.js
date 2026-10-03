'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { introspectFromCatalog } = require('../src/database/catalog-schema')

describe('introspectFromCatalog', () => {
  test('describes a known REST source from its catalog entry', async () => {
    // Given a connection pointing at a base URL the catalog knows
    const connection = { database: 'https://jsonplaceholder.typicode.com' }

    // When introspecting it
    const { tables } = introspectFromCatalog(connection)

    // Then the catalog's declared entities are reported as tables
    const names = tables.map((t) => t.name)
    assert.ok(names.includes('/posts'), `expected /posts in ${names}`)

    const posts = tables.find((t) => t.name === '/posts')
    const columnNames = posts.columns.map((c) => c.name)
    assert.ok(columnNames.includes('title'), `expected a title column in ${columnNames}`)
    assert.equal(posts.columns.find((c) => c.name === 'id').isPrimaryKey, true)
  })

  test('tolerates a trailing slash on the base URL', async () => {
    // Given the same base URL with a trailing slash
    const connection = { database: 'https://jsonplaceholder.typicode.com/' }

    // When introspecting it
    const { tables } = introspectFromCatalog(connection)

    // Then the entry is still matched
    assert.ok(tables.length > 0)
  })

  test('reports no tables for a base URL the catalog does not know', async () => {
    // Given a URL that is in no catalog entry
    const connection = { database: 'https://unknown.example.invalid' }

    // When introspecting it
    const { tables } = introspectFromCatalog(connection)

    // Then nothing is claimed about it
    assert.deepEqual(tables, [])
  })

  test('combines entities from every catalog entry sharing a base URL', async () => {
    // Given a base URL that backs several distinct catalog entries (NCBI
    // E-utilities serves ncbi, genbank, pubmed and geo alike, distinguished
    // only by a `where: { db }` the caller supplies per query — information a
    // bare connection does not carry)
    const connection = { database: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils' }

    // When introspecting it
    const { tables } = introspectFromCatalog(connection)
    const names = tables.map((t) => t.name)

    // Then entities from more than one of those entries are present, each
    // listed once even where entries overlap
    assert.ok(new Set(names).size === names.length, `expected no duplicates, got ${names}`)
    assert.ok(names.length > 1, `expected entities from multiple entries, got ${names}`)
  })
})
