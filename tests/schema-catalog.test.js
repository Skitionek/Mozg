'use strict'

/**
 * The catalog-facing GraphQL surface: catalog filters, the fields derived for
 * api entities (columns, params), and introspect(source:).
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { graphql } = require('graphql')
const { makeExecutableSchema } = require('@graphql-tools/schema')
const { typeDefs, resolvers } = require('../src/schema')

const schema = makeExecutableSchema({ typeDefs, resolvers })
const run = async (source) => {
  const res = await graphql({ schema, source })
  assert.equal(res.errors, undefined, JSON.stringify(res.errors))
  return res.data
}

describe('catalog query', () => {
  test('describes an api source: auth, derived columns, params with examples, named relations', async () => {
    const { catalog } = await run(`{
      catalog(name: "ncbi-gene") {
        name category driver auth { required param header }
        entities { name columns example params { name in required example } relations { alias catalog entity limit } }
      }
    }`)
    const [entry] = catalog
    assert.equal(entry.driver, 'api')
    assert.equal(entry.category, 'Genes & genomes')
    assert.equal(entry.auth.required, false)

    const gene = entry.entities.find((e) => e.name === 'gene')
    assert.ok(gene.columns.includes('ncbiGeneId'))
    assert.deepEqual({ ...gene.params.find((p) => p.name === 'ncbiGeneId') }, { name: 'ncbiGeneId', in: 'path', required: true, example: gene.example.ncbiGeneId })
    assert.ok(gene.relations.some((r) => r.catalog === 'uniprot'))
  })

  test('filters by category and by driver', async () => {
    const { byCategory, byDriver } = await run(`{
      byCategory: catalog(category: "Literature") { name category }
      byDriver: catalog(driver: kegg) { name driver }
    }`)
    assert.ok(byCategory.length >= 2)
    assert.ok(byCategory.every((e) => e.category === 'Literature'))
    assert.deepEqual(byDriver.map((e) => e.name), ['kegg'])
  })
})

describe('introspect', () => {
  test('describes a catalog source by name', async () => {
    const { introspect } = await run('{ introspect(source: "uniprot") { tables { name columns { name } } } }')
    const protein = introspect.tables.find((t) => t.name === 'protein')
    assert.ok(protein.columns.some((c) => c.name === 'uniprotAccession'))
  })

  test('needs a connection or a source', async () => {
    const res = await graphql({ schema, source: '{ introspect { tables { name } } }' })
    assert.match(res.errors[0].message, /needs a connection or a source/)
  })
})
