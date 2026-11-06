'use strict'

/**
 * One behavioural suite, run by every connector's integration test against
 * its real backend, so the drivers are held to the same contract:
 *
 *   select / where / orderBy / limit / offset · hasMany / hasOne / belongsTo
 *   · nested relations · introspection · a relation from a row into an api
 *   source · readable errors that leak no credentials.
 *
 * Each backend describes itself with an adapter:
 *   name, connection, seed(), teardown()?,
 *   entity: (table) => name the driver expects in `from` (default: same),
 *   field:  (column) => name the driver returns (default: same),
 *   skip:   { <capability>: 'reason' } for what a backend genuinely cannot do,
 *   badCredentials: connection that must fail to authenticate (optional).
 */

const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { USERS, POSTS, COMMENTS, PROTEINS } = require('./fixture')

/** A tiny api source standing in for UniProt, served from a stubbed fetch. */
const FAKE_UNIPROT = {
  name: 'it-uniprot',
  label: 'Integration UniProt',
  driver: 'api',
  connection: { database: 'https://it-uniprot.test' },
  entities: [{
    name: 'protein',
    description: 'protein by accession',
    path: '/protein/{uniprotAccession}',
    params: { uniprotAccession: {} },
    fields: { uniprotAccession: 'acc', proteinName: 'name' }
  }]
}

const UNIPROT_NAMES = { P04637: 'Cellular tumor antigen p53', P38398: 'Breast cancer type 1 susceptibility protein', P00533: 'Epidermal growth factor receptor' }

function runConnectorSuite (adapter) {
  const skip = adapter.skip || {}
  const entity = adapter.entity || ((t) => t)
  const f = adapter.field || ((c) => c)
  const it = (name, capability, fn) => test(name, { skip: (capability && skip[capability]) || false }, fn)

  describe(`${adapter.name} connector`, { skip: adapter.skipAll }, () => {
    let executeQuery
    let introspectDatabase
    let unregister
    let originalFetch

    before(async () => {
      await adapter.seed()
      executeQuery = require('../../src/database/connector').executeQuery
      introspectDatabase = require('../../src/database/introspect').introspectDatabase
      unregister = require('../../src/catalog').registerCatalog(FAKE_UNIPROT)
      originalFetch = globalThis.fetch
      globalThis.fetch = async (url, init) => {
        const u = new URL(String(url))
        if (u.host !== 'it-uniprot.test') return originalFetch(url, init)
        const acc = u.pathname.split('/').pop()
        const body = UNIPROT_NAMES[acc] ? { acc, name: UNIPROT_NAMES[acc] } : null
        return {
          ok: Boolean(body),
          status: body ? 200 : 404,
          statusText: '',
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify(body)
        }
      }
    })

    after(async () => {
      globalThis.fetch = originalFetch
      if (unregister) unregister()
      if (adapter.teardown) await adapter.teardown()
    })

    const q = (input) => executeQuery({ connection: adapter.connection, ...input })

    it('selects, filters, orders and pages', 'paging', async () => {
      // Given four users, when asked for names in order, skipping one and taking two
      const { data } = await q({ from: entity('users'), select: [f('id'), f('name')], orderBy: f('name'), orderDirection: 'desc', limit: 2, offset: 1 })

      // Then the second and third names in descending order come back
      const expected = USERS.map((u) => u.name).sort().reverse().slice(1, 3)
      assert.deepEqual(data.map((r) => r[f('name')]), expected)
      assert.ok(!Object.hasOwn(data[0], f('email')), 'unselected columns are left out')
    })

    it('filters by equality', null, async () => {
      const { data } = await q({ from: entity('posts'), where: { [f('user_id')]: 3 } })
      assert.deepEqual(data.map((r) => Number(r[f('id')])).sort(), POSTS.filter((p) => p.user_id === 3).map((p) => p.id))
    })

    it('resolves hasMany, hasOne and belongsTo', 'relations', async () => {
      const { data: users } = await q({
        from: entity('users'),
        where: { [f('id')]: 1 },
        relations: [
          { entity: entity('posts'), localKey: f('id'), foreignKey: f('user_id'), type: 'hasMany', alias: 'posts' },
          { entity: entity('posts'), localKey: f('id'), foreignKey: f('user_id'), type: 'hasOne', alias: 'aPost' }
        ]
      })
      assert.equal(users.length, 1)
      assert.equal(users[0].posts.length, POSTS.filter((p) => p.user_id === 1).length)
      assert.ok(users[0].aPost && Number(users[0].aPost[f('user_id')]) === 1)

      const { data: posts } = await q({
        from: entity('posts'),
        where: { [f('id')]: 4 },
        relations: [{ entity: entity('users'), foreignKey: f('user_id'), ownerKey: f('id'), type: 'belongsTo', alias: 'author' }]
      })
      assert.equal(posts[0].author[f('name')], 'Carl')
    })

    it('nests relations three levels deep', 'relations', async () => {
      const { data } = await q({
        from: entity('users'),
        where: { [f('id')]: 3 },
        relations: [{
          entity: entity('posts'),
          localKey: f('id'),
          foreignKey: f('user_id'),
          type: 'hasMany',
          alias: 'posts',
          relations: [{ entity: entity('comments'), localKey: f('id'), foreignKey: f('post_id'), type: 'hasMany', alias: 'comments' }]
        }]
      })
      const proteinsPost = data[0].posts.find((p) => Number(p[f('id')]) === 4)
      assert.equal(proteinsPost.comments.length, COMMENTS.filter((c) => c.post_id === 4).length)
    })

    it('introspects tables and columns', 'introspect', async () => {
      const schema = await introspectDatabase(adapter.connection)
      const names = schema.tables.map((t) => t.name)
      for (const table of ['users', 'posts', 'comments', 'proteins']) {
        assert.ok(names.includes(entity(table)), `${entity(table)} in ${names.join(', ')}`)
      }
      const users = schema.tables.find((t) => t.name === entity('users'))
      const columns = users.columns.map((c) => c.name)
      for (const column of ['name', 'email']) assert.ok(columns.includes(f(column)), `${f(column)} in ${columns.join(', ')}`)
    })

    it('follows a relation from its rows into an api source', 'crossCatalog', async () => {
      const { data } = await q({
        from: entity('proteins'),
        orderBy: f('id'),
        relations: [{ catalog: 'it-uniprot', entity: 'protein', localKey: f('uniprot_accession'), foreignKey: 'uniprotAccession', type: 'hasOne', alias: 'uniprot' }]
      })
      assert.equal(data.length, PROTEINS.length)
      for (const row of data) {
        assert.equal(row.uniprot.proteinName, UNIPROT_NAMES[row[f('uniprot_accession')]])
      }
    })

    it('reports bad credentials readably without leaking them', 'credentials', async () => {
      const bad = adapter.badCredentials
      await assert.rejects(
        executeQuery({ connection: bad, from: entity('users'), limit: 1 }),
        (err) => {
          assert.ok(err.message.length > 0)
          assert.ok(!err.message.includes(bad.password), `password leaked in: ${err.message}`)
          return true
        }
      )
    })
  })
}

module.exports = { runConnectorSuite }
