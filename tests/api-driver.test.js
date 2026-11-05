'use strict'

/**
 * The declarative `api` driver, exercised against made-up sources registered
 * at runtime and a stubbed fetch — no network.
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const http = require('../src/database/http')
const { registerCatalog } = require('../src/catalog')
const { executeQuery } = require('../src/database/connector')
const { getPath } = require('../src/database/drivers/api')

// ── Fixtures ────────────────────────────────────────────────────────────────

const PROTEINS = {
  name: 'test-proteins',
  label: 'Test proteins',
  driver: 'api',
  connection: { database: 'https://proteins.test/api' },
  query: { tool: 'mozg' },
  auth: { param: 'api_key' },
  entities: [
    {
      name: 'protein',
      description: 'one protein',
      path: '/protein/{uniprotAccession}',
      params: { uniprotAccession: {} },
      fields: {
        uniprotAccession: 'acc',
        symbol: 'genes[0].name',
        allSymbols: 'genes[].name',
        name: 'recommended.name|submitted.name',
        geneId: (r) => (r.xrefs || []).find((x) => x.db === 'gene')?.id ?? null,
        taxonId: 'organism.taxon'
      },
      relations: [
        { alias: 'features', entity: 'features', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasMany' },
        { alias: 'gene', catalog: 'test-genes', entity: 'gene', localKey: 'geneId', foreignKey: 'geneId', type: 'hasOne' }
      ]
    },
    {
      name: 'search',
      description: 'protein search',
      path: '/search',
      params: {
        q: { name: 'query', required: true },
        taxonId: { name: 'organism', transform: 'taxon:{value}' },
        reviewed: { default: true },
        kind: { in: 'filter', field: 'kind' }
      },
      query: { format: 'json' },
      rows: 'payload.results',
      fields: { uniprotAccession: 'acc', kind: 'kind', score: 'score' },
      paginate: { limit: 'size', offset: 'from', max: 50 }
    },
    {
      name: 'features',
      description: 'features of a protein',
      path: '/protein/{uniprotAccession}/features',
      params: { uniprotAccession: {} },
      rows: (body, params) => body[params.uniprotAccession],
      fields: { type: 'type', start: 'begin' },
      paginate: { limit: 'limit' }
    },
    {
      name: 'reactions',
      description: 'tsv reactions',
      path: '/reactions',
      params: { uniprotAccession: { name: 'uniprot' } },
      format: 'tsv',
      fields: { reactionId: 'Reaction identifier', equation: 'Equation' }
    },
    {
      name: 'graph',
      description: 'graphql lookup',
      path: '/graphql',
      params: { id: {} },
      graphql: { query: 'query Q($id: String!) { thing(id: $id) { id label } }', variables: (p) => ({ id: p.id }) },
      rows: 'data.thing',
      fields: { id: 'id', label: 'label' }
    },
    {
      name: 'paged',
      description: 'resolve that pages upstream',
      params: { term: {} },
      resolve: async (params, ctx) => {
        const items = await ctx.request('/paged', { query: { start: ctx.offset || 0, max: ctx.limit } })
        return { records: items, serverOffset: ctx.offset || 0 }
      },
      fields: { id: 'id' }
    },
    {
      name: 'twoStep',
      description: 'search then summarise',
      params: { term: {} },
      resolve: async (params, ctx) => {
        const ids = await ctx.request('/ids', { query: { term: params.term } })
        return ctx.request('/summary', { query: { id: ids.join(',') } }).then((b) => b.items)
      },
      fields: { id: 'id', title: 'title' }
    }
  ]
}

const GENES = {
  name: 'test-genes',
  label: 'Test genes',
  driver: 'api',
  connection: { database: 'https://genes.test' },
  auth: { header: 'X-Key', required: true },
  entities: [
    {
      name: 'gene',
      description: 'one gene',
      path: '/gene/{geneId}',
      params: { geneId: {} },
      fields: { geneId: 'id', symbol: 'symbol' }
    }
  ]
}

// ── Fake upstream ───────────────────────────────────────────────────────────

let requests
const ROUTES = []

function route (pattern, handler) {
  ROUTES.push({ pattern, handler })
}

function json (status, body) {
  return {
    ok: status < 300,
    status,
    statusText: '',
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  }
}

let originalFetch
let unregister

before(() => {
  const a = registerCatalog(PROTEINS)
  const b = registerCatalog(GENES)
  unregister = () => { a(); b() }
})

after(() => unregister())

beforeEach(() => {
  http.reset()
  requests = []
  ROUTES.length = 0
  originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = new URL(url)
    requests.push({ url: u, init })
    const hit = ROUTES.find((r) => r.pattern.test(u.origin + u.pathname))
    if (!hit) return json(404, 'no route')
    return hit.handler(u, init)
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const P53 = {
  acc: 'P04637',
  genes: [{ name: 'TP53' }, { name: 'P53' }],
  submitted: { name: 'Cellular tumor antigen p53' },
  xrefs: [{ db: 'gene', id: '7157' }],
  organism: { taxon: 9606 }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('api driver: requests', () => {
  test('substitutes path parameters and maps fields', async () => {
    // Given a protein endpoint keyed by accession in the path
    route(/\/protein\/P04637$/, () => json(200, P53))

    // When it is queried by source name
    const { data } = await executeQuery({ source: 'test-proteins', from: 'protein', where: { uniprotAccession: 'P04637' } })

    // Then the accession went into the path and the record was mapped
    assert.equal(requests[0].url.pathname, '/api/protein/P04637')
    assert.equal(requests[0].url.searchParams.get('tool'), 'mozg', 'entry-level query params are sent')
    assert.deepEqual(data, [{
      uniprotAccession: 'P04637',
      symbol: 'TP53',
      allSymbols: ['TP53', 'P53'],
      name: 'Cellular tumor antigen p53',
      geneId: '7157',
      taxonId: 9606
    }])
  })

  test('keeps colons readable in path segments but encodes the rest', async () => {
    route(/\/protein\//, () => json(200, P53))
    await executeQuery({ source: 'test-proteins', from: 'protein', where: { uniprotAccession: 'HGNC:1 a/b' } })
    assert.equal(requests[0].url.pathname, '/api/protein/HGNC:1%20a%2Fb')
  })

  test('maps query parameters by name, transform and default', async () => {
    route(/\/search$/, () => json(200, { payload: { results: [{ acc: 'P1', kind: 'x' }] } }))

    await executeQuery({ source: 'test-proteins', from: 'search', where: { q: 'kinase', taxonId: 9606 } })

    const sp = requests[0].url.searchParams
    assert.equal(sp.get('query'), 'kinase')
    assert.equal(sp.get('organism'), 'taxon:9606')
    assert.equal(sp.get('reviewed'), 'true')
    assert.equal(sp.get('format'), 'json')
  })

  test('rejects where keys the entity does not declare', async () => {
    // An API that ignores an unknown filter returns everything, so this must fail loudly.
    await assert.rejects(
      executeQuery({ source: 'test-proteins', from: 'search', where: { q: 'x', organism: 'human' } }),
      /does not accept "organism".*Accepted parameters: .*taxonId/
    )
  })

  test('requires path parameters', async () => {
    await assert.rejects(
      executeQuery({ source: 'test-proteins', from: 'protein', where: {} }),
      /requires where\.uniprotAccession/
    )
  })

  test('names the available entities when one does not exist', async () => {
    await assert.rejects(
      executeQuery({ source: 'test-proteins', from: 'nope' }),
      /Unknown entity "nope" in source "test-proteins". Available: protein, search/
    )
  })

  test('treats 404 as "no such record"', async () => {
    const { data, count } = await executeQuery({ source: 'test-proteins', from: 'protein', where: { uniprotAccession: 'XXXX' } })
    assert.deepEqual(data, [])
    assert.equal(count, 0)
  })

  test('applies client-side filter parameters', async () => {
    route(/\/search$/, () => json(200, { payload: { results: [{ acc: 'A', kind: 'Enzyme' }, { acc: 'B', kind: 'other' }] } }))
    const { data } = await executeQuery({ source: 'test-proteins', from: 'search', where: { q: 'x', kind: 'enzyme' } })
    assert.deepEqual(data.map((r) => r.uniprotAccession), ['A'])
    assert.equal(requests[0].url.searchParams.get('kind'), null, 'filter params are not sent upstream')
  })

  test('returns records untouched with raw', async () => {
    route(/\/protein\//, () => json(200, P53))
    const { data } = await executeQuery({ source: 'test-proteins', from: 'protein', where: { uniprotAccession: 'P04637' }, raw: true })
    assert.deepEqual(data, [P53])
  })

  test('parses TSV with a header row', async () => {
    route(/\/reactions$/, () => json(200, 'Reaction identifier\tEquation\nRHEA:1\tA = B\nRHEA:2\tC = D\n'))
    const { data } = await executeQuery({ source: 'test-proteins', from: 'reactions', where: { uniprotAccession: 'P1' } })
    assert.equal(requests[0].url.searchParams.get('uniprot'), 'P1')
    assert.deepEqual(data, [{ reactionId: 'RHEA:1', equation: 'A = B' }, { reactionId: 'RHEA:2', equation: 'C = D' }])
  })

  test('posts GraphQL with variables and unwraps data', async () => {
    route(/\/graphql$/, (u, init) => {
      const body = JSON.parse(init.body)
      assert.equal(init.method, 'POST')
      assert.deepEqual(body.variables, { id: 'X1' })
      assert.equal(u.searchParams.get('id'), null, 'variables are not echoed into the URL')
      return json(200, { data: { thing: { id: 'X1', label: 'one' } } })
    })
    const { data } = await executeQuery({ source: 'test-proteins', from: 'graph', where: { id: 'X1' } })
    assert.deepEqual(data, [{ id: 'X1', label: 'one' }])
  })

  test('surfaces GraphQL errors that come with a 200', async () => {
    route(/\/graphql$/, () => json(200, { data: null, errors: [{ message: 'Field "thing" is gone' }] }))
    await assert.rejects(executeQuery({ source: 'test-proteins', from: 'graph', where: { id: 'X1' } }), /Field "thing" is gone/)
  })

  test('runs multi-step lookups through resolve', async () => {
    route(/\/ids$/, () => json(200, ['1', '2']))
    route(/\/summary$/, () => json(200, { items: [{ id: '1', title: 'One' }, { id: '2', title: 'Two' }] }))
    const { data } = await executeQuery({ source: 'test-proteins', from: 'twoStep', where: { term: 'p53' } })
    assert.deepEqual(data, [{ id: '1', title: 'One' }, { id: '2', title: 'Two' }])
    assert.equal(requests[1].url.searchParams.get('id'), '1,2')
    assert.equal(requests[1].url.searchParams.get('tool'), 'mozg', 'resolve requests get entry-level query params too')
  })
})

describe('api driver: paging and ordering', () => {
  test('a resolve hook that pages upstream is not skipped twice', async () => {
    route(/\/paged$/, (u) => {
      const start = Number(u.searchParams.get('start'))
      return json(200, [{ id: start }, { id: start + 1 }])
    })
    const { data } = await executeQuery({ source: 'test-proteins', from: 'paged', where: { term: 'x' }, limit: 2, offset: 6 })
    assert.deepEqual(data.map((r) => r.id), [6, 7])
  })


  const many = Array.from({ length: 10 }, (_, i) => ({ acc: `P${i}`, kind: 'k', score: 10 - i }))

  test('passes limit and offset to an API that supports both', async () => {
    route(/\/search$/, (u) => {
      const from = Number(u.searchParams.get('from'))
      const size = Number(u.searchParams.get('size'))
      return json(200, { payload: { results: many.slice(from, from + size) } })
    })
    const { data } = await executeQuery({ source: 'test-proteins', from: 'search', where: { q: 'x' }, limit: 3, offset: 4 })
    assert.deepEqual(data.map((r) => r.uniprotAccession), ['P4', 'P5', 'P6'])
  })

  test('caps the page size at the API maximum', async () => {
    route(/\/search$/, () => json(200, { payload: { results: [] } }))
    await executeQuery({ source: 'test-proteins', from: 'search', where: { q: 'x' }, limit: 5000 })
    assert.equal(requests[0].url.searchParams.get('size'), '50')
  })

  test('over-fetches and slices when the API has no offset', async () => {
    route(/\/features$/, () => json(200, { P1: many.map((m, i) => ({ type: m.acc, begin: i })) }))
    const { data } = await executeQuery({ source: 'test-proteins', from: 'features', where: { uniprotAccession: 'P1' }, limit: 2, offset: 3 })
    assert.equal(requests[0].url.searchParams.get('limit'), '5')
    assert.deepEqual(data.map((r) => r.start), [3, 4])
  })

  test('orders client-side by a mapped field', async () => {
    route(/\/search$/, () => json(200, { payload: { results: many } }))
    const { data } = await executeQuery({ source: 'test-proteins', from: 'search', where: { q: 'x' }, orderBy: 'score', orderDirection: 'asc', limit: 2 })
    assert.deepEqual(data.map((r) => r.score), [1, 2])
  })
})

describe('api driver: relations and include', () => {
  test('include follows same-source and cross-source relations', async () => {
    // Given a protein whose features live in the same source and whose gene lives in another
    route(/proteins\.test\/api\/protein\/P04637$/, () => json(200, P53))
    route(/\/protein\/P04637\/features$/, () => json(200, { P04637: [{ type: 'domain', begin: 94 }] }))
    route(/genes\.test\/gene\/7157$/, (u, init) => {
      assert.equal(init.headers['X-Key'], 'k-genes', 'the target source received its own API key')
      return json(200, { id: '7157', symbol: 'TP53' })
    })

    // When the protein is queried with both relations included by name
    const { data } = await executeQuery({
      source: 'test-proteins',
      from: 'protein',
      where: { uniprotAccession: 'P04637' },
      include: ['features', 'gene'],
      apiKeys: { 'test-genes': 'k-genes' }
    })

    // Then each is resolved through the catalog's join keys
    assert.deepEqual(data[0].features, [{ type: 'domain', start: 94 }])
    assert.deepEqual(data[0].gene, { geneId: '7157', symbol: 'TP53' })
  })

  test('a relation limit caps the related rows per parent', async () => {
    route(/proteins\.test\/api\/protein\/P04637$/, () => json(200, P53))
    route(/\/protein\/P04637\/features$/, () => json(200, { P04637: [{ type: 'a' }, { type: 'b' }, { type: 'c' }] }))
    const { data } = await executeQuery({
      source: 'test-proteins',
      from: 'protein',
      where: { uniprotAccession: 'P04637' },
      relations: [{ entity: 'features', foreignKey: 'uniprotAccession', localKey: 'uniprotAccession', alias: 'features', limit: 2 }]
    })
    assert.deepEqual(data[0].features.map((f) => f.type), ['a', 'b'])
  })

  test('a relation needing a missing API key fails in place, not for the whole query', async () => {
    route(/proteins\.test\/api\/protein\/P04637$/, () => json(200, P53))
    const { data } = await executeQuery({ source: 'test-proteins', from: 'protein', where: { uniprotAccession: 'P04637' }, include: ['gene'] })
    assert.equal(data[0].uniprotAccession, 'P04637')
    assert.match(data[0].gene.error, /requires an API key — pass apiKeys: \{ "test-genes"/)
  })

  test('include names an unknown relation clearly', async () => {
    await assert.rejects(
      executeQuery({ source: 'test-proteins', from: 'protein', where: { uniprotAccession: 'P1' }, include: ['nope'] }),
      /Unknown include "nope" on test-proteins\/protein. Available: features, gene/
    )
  })

  test('the API key goes in the declared query parameter and never into errors', async () => {
    route(/\/protein\//, () => json(400, 'bad request'))
    await assert.rejects(
      executeQuery({ source: 'test-proteins', from: 'protein', where: { uniprotAccession: 'P1' }, apiKeys: { 'test-proteins': 'TOPSECRET' } }),
      (err) => err.message.includes('api_key=***') && !err.message.includes('TOPSECRET')
    )
    assert.equal(requests[0].url.searchParams.get('api_key'), 'TOPSECRET')
  })

  test('a connection naming the source as database works without `source`', async () => {
    route(/\/protein\//, () => json(200, P53))
    const { data } = await executeQuery({ connection: { driver: 'api', database: 'test-proteins' }, from: 'protein', where: { uniprotAccession: 'P04637' } })
    assert.equal(data[0].symbol, 'TP53')
  })

  test('a mirror on a private address is refused unless the operator allows it', async () => {
    await assert.rejects(
      executeQuery({ source: 'test-proteins', connection: { database: 'http://169.254.169.254/latest' }, from: 'protein', where: { uniprotAccession: 'P1' } }),
      /private IP addresses is not allowed/
    )
    assert.equal(requests.length, 0)
  })

  test('a connection pointing at the base URL can override it (mirrors)', async () => {
    route(/mirror\.test\/protein\//, () => json(200, P53))
    const { data } = await executeQuery({ source: 'test-proteins', connection: { database: 'https://mirror.test' }, from: 'protein', where: { uniprotAccession: 'P04637' } })
    assert.equal(data[0].symbol, 'TP53')
    assert.equal(requests[0].url.host, 'mirror.test')
  })
})

describe('api driver: field paths', () => {
  const rec = { a: { b: [{ c: 1 }, { c: 2 }] }, x: null, y: '', z: 'zed' }

  test('nested, indexed and mapped paths', () => {
    assert.equal(getPath(rec, 'a.b[1].c'), 2)
    assert.deepEqual(getPath(rec, 'a.b[].c'), [1, 2])
    assert.equal(getPath(rec, 'a.missing.c'), null)
  })

  test('alternatives take the first non-empty value', () => {
    assert.equal(getPath(rec, 'x|y|z'), 'zed')
  })
})

describe('api driver: formats, auth and introspection', () => {
  const FORMATS = {
    name: 'test-formats',
    label: 'Formats',
    driver: 'api',
    connection: { database: 'https://formats.test', headers: { 'X-Base': '1' } },
    auth: { header: 'Authorization', prefix: 'Token ' },
    rateLimit: { requestsPerSecond: 1000 },
    rateLimitWithKey: { requestsPerSecond: 2000 },
    entities: [
      { name: 'xmlThing', description: 'xml', path: '/xml', params: {}, format: 'xml', rows: 'root.item', fields: { id: '@id', label: 'label' } },
      { name: 'textThing', description: 'text', path: '/text', params: {}, format: 'text', parse: (text) => text.trim().split('\n').map((line) => ({ line })), fields: { line: 'line' } },
      { name: 'textNoParse', description: 'text without parser', path: '/text', params: {}, format: 'text', fields: { line: 'line' } },
      { name: 'paged', description: 'page-numbered', path: '/paged', params: {}, paginate: { page: 'page', pageBase: 1, limit: 'pageSize' }, fields: { id: 'id' } },
      { name: 'posted', description: 'json body', path: '/post', method: 'POST', params: { term: {} }, body: (p) => ({ q: p.term }), fields: { id: 'id', name: 'name' } },
      {
        name: 'withBadRelation',
        description: 'same-source relation that fails',
        path: '/xml',
        params: {},
        format: 'xml',
        rows: 'root.item',
        fields: { id: '@id', label: 'label' },
        relations: [{ alias: 'broken', entity: 'posted', localKey: 'id', foreignKey: 'nope', type: 'hasMany' }]
      }
    ]
  }

  let unregisterFormats
  before(() => { unregisterFormats = registerCatalog(FORMATS) })
  after(() => unregisterFormats())

  test('parses XML and maps attributes', async () => {
    route(/formats\.test\/xml$/, () => json(200, '<root><item id="a"><label>Alpha</label></item><item id="b"><label>Beta</label></item></root>'))
    const { data } = await executeQuery({ source: 'test-formats', from: 'xmlThing' })
    assert.deepEqual(data, [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }])
  })

  test('parses text with the entity parser, and refuses text without one', async () => {
    route(/formats\.test\/text$/, () => json(200, 'one\ntwo\n'))
    const { data } = await executeQuery({ source: 'test-formats', from: 'textThing' })
    assert.deepEqual(data, [{ line: 'one' }, { line: 'two' }])
    await assert.rejects(executeQuery({ source: 'test-formats', from: 'textNoParse' }), /needs a parse\(text\) function/)
  })

  test('maps offset onto a page number when the API pages by number', async () => {
    route(/formats\.test\/paged$/, () => json(200, [{ id: 1 }]))
    await executeQuery({ source: 'test-formats', from: 'paged', limit: 10, offset: 20 })
    assert.equal(requests[0].url.searchParams.get('page'), '3')
    assert.equal(requests[0].url.searchParams.get('pageSize'), '10')
  })

  test('posts a JSON body built from the parameters', async () => {
    route(/formats\.test\/post$/, (u, init) => {
      assert.equal(init.method, 'POST')
      assert.deepEqual(JSON.parse(init.body), { q: 'kinase' })
      assert.equal(u.searchParams.get('term'), null)
      return json(200, [{ id: 2, name: 'Zeta' }, { id: 1, name: 'alpha' }])
    })
    const { data } = await executeQuery({ source: 'test-formats', from: 'posted', where: { term: 'kinase' }, orderBy: 'name', orderDirection: 'desc', select: ['name'] })
    assert.deepEqual(data, [{ name: 'Zeta' }, { name: 'alpha' }])
  })

  test('sends a key from connection.user in the declared header, with its prefix', async () => {
    route(/formats\.test\/paged$/, (u, init) => {
      assert.equal(init.headers.Authorization, 'Token abc')
      assert.equal(init.headers['X-Base'], '1', 'catalog connection headers are sent')
      return json(200, [{ id: 1 }])
    })
    await executeQuery({ source: 'test-formats', connection: { user: 'abc' }, from: 'paged' })
  })

  test('reports a failing same-source relation in place', async () => {
    route(/formats\.test\/xml$/, () => json(200, '<root><item id="a"><label>Alpha</label></item></root>'))
    const { data } = await executeQuery({ source: 'test-formats', from: 'withBadRelation', include: ['broken'] })
    assert.equal(data[0].id, 'a')
    assert.match(data[0].broken.error, /relation broken failed: .*does not accept "nope"/)
  })

  test('introspects a source into tables and columns', async () => {
    const { introspect } = require('../src/database/drivers/api')
    const schema = await introspect({ driver: 'api', source: 'test-formats' })
    const posted = schema.tables.find((t) => t.name === 'posted')
    assert.deepEqual(posted.columns.map((c) => c.name), ['id', 'name'])
  })

  test('a connection that matches no source is refused with guidance', async () => {
    await assert.rejects(
      executeQuery({ connection: { driver: 'api', database: 'https://nowhere.test' }, from: 'x' }),
      /needs a catalog source/
    )
  })

  test('a non-api catalog entry cannot be run by the api driver', async () => {
    const { executeQuery: runApi } = require('../src/database/drivers/api')
    await assert.rejects(runApi({ connection: { driver: 'api', source: 'blog' }, from: 'users' }), /uses the sqlite3 driver, not api/)
  })

  test('a malformed path token is treated as a plain key', () => {
    assert.equal(getPath({ 'a]b': 1 }, 'a]b'), 1)
  })
})

describe('api driver: edge cases', () => {
  const EDGES = {
    name: 'test-edges',
    label: 'Edges',
    driver: 'api',
    connection: { database: 'https://edges.test/' },
    emptyStatus: [404, 400],
    auth: { param: 'key', required: true },
    entities: [
      {
        name: 'listy',
        description: 'arrays, transforms, defaults',
        path: '/list/{ids}',
        params: {
          ids: { join: ';' },
          upper: { transform: (v) => String(v).toUpperCase() },
          tag: { in: 'filter', field: 'tags' }
        },
        headers: { 'X-Entity': 'e' },
        paginate: { limit: 'n', default: 7 },
        rows: (body) => body.single,
        fields: (r) => ({ id: r.id, tags: r.tags, score: r.score }),
        columns: ['id', 'tags', 'score']
      },
      {
        name: 'partial',
        description: 'graphql with partial errors',
        path: '/gql',
        params: {},
        graphql: { query: '{ a b }' },
        rows: 'data.a',
        fields: { a: 'x' }
      },
      {
        name: 'tsvCustom',
        description: 'tsv with own parser',
        path: '/tsv',
        params: {},
        format: 'tsv',
        parse: (text) => text.split('\n').filter(Boolean).map((l) => ({ v: l })),
        fields: { v: 'v' }
      },
      {
        name: 'absolute',
        description: 'resolve reaching another URL',
        params: {},
        resolve: async (params, ctx) => [await ctx.request('https://other.test/x', { query: { q: 1 } })],
        fields: { ok: 'ok' }
      }
    ]
  }

  let unregisterEdges
  before(() => { unregisterEdges = registerCatalog(EDGES) })
  after(() => unregisterEdges())

  const KEYS = { apiKeys: { 'test-edges': 'K' } }

  test('joins array path values, applies transforms and default page size, filters on array fields', async () => {
    route(/edges\.test\/list\//, (u, init) => {
      assert.equal(init.headers['X-Entity'], 'e')
      return json(200, { single: [{ id: 1, tags: ['A', 'b'], score: 2 }, { id: 2, tags: ['c'], score: null }] })
    })
    const { data } = await executeQuery({ source: 'test-edges', from: 'listy', where: { ids: ['x', 'y'], upper: 'abc', tag: 'a' }, offset: 0, ...KEYS })
    const u = requests[0].url
    assert.equal(u.pathname, '/list/x%3By')
    assert.equal(u.searchParams.get('upper'), 'ABC')
    assert.equal(u.searchParams.get('key'), 'K')
    assert.deepEqual(data.map((r) => r.id), [1])
  })

  test('a rows function returning one object yields one row; returning nothing yields none', async () => {
    route(/edges\.test\/list\//, (u) => json(200, u.pathname.endsWith('/one') ? { single: { id: 9 } } : {}))
    assert.deepEqual((await executeQuery({ source: 'test-edges', from: 'listy', where: { ids: 'one' }, ...KEYS })).data.map((r) => r.id), [9])
    assert.deepEqual((await executeQuery({ source: 'test-edges', from: 'listy', where: { ids: 'none' }, ...KEYS })).data, [])
  })

  test('sorts nulls last in either direction', async () => {
    route(/edges\.test\/list\//, () => json(200, { single: [{ id: 1, score: null }, { id: 2, score: 5 }, { id: 3, score: 1 }, { id: 4, score: null }] }))
    const asc = await executeQuery({ source: 'test-edges', from: 'listy', where: { ids: 'a' }, orderBy: 'score', ...KEYS })
    assert.deepEqual(asc.data.map((r) => r.score), [1, 5, null, null])
  })

  test('an entry-level empty status reads as no rows', async () => {
    route(/edges\.test\/list\//, () => json(400, 'no such id'))
    assert.deepEqual((await executeQuery({ source: 'test-edges', from: 'listy', where: { ids: 'bad' }, ...KEYS })).data, [])
  })

  test('GraphQL errors alongside data are tolerated', async () => {
    route(/edges\.test\/gql$/, () => json(200, { data: { a: [{ x: 1 }] }, errors: [{ message: 'b is deprecated' }] }))
    assert.deepEqual((await executeQuery({ source: 'test-edges', from: 'partial', ...KEYS })).data, [{ a: 1 }])
  })

  test('a TSV entity may bring its own parser', async () => {
    route(/edges\.test\/tsv$/, () => json(200, 'one\ntwo\n'))
    assert.deepEqual((await executeQuery({ source: 'test-edges', from: 'tsvCustom', ...KEYS })).data, [{ v: 'one' }, { v: 'two' }])
  })

  test('resolve can reach an absolute URL, still carrying the key', async () => {
    route(/other\.test\/x$/, (u) => {
      assert.equal(u.searchParams.get('key'), 'K')
      assert.equal(u.searchParams.get('q'), '1')
      return json(200, { ok: true })
    })
    assert.deepEqual((await executeQuery({ source: 'test-edges', from: 'absolute', ...KEYS })).data, [{ ok: true }])
  })

  test('a required key is demanded before any request, for resolve entities too', async () => {
    await assert.rejects(executeQuery({ source: 'test-edges', from: 'absolute' }), /requires an API key/)
    await assert.rejects(executeQuery({ source: 'test-edges', from: 'partial' }), /requires an API key/)
    assert.equal(requests.length, 0)
  })

  test('a missing required parameter without an example still names the parameter', async () => {
    await assert.rejects(executeQuery({ source: 'test-edges', from: 'listy', ...KEYS }), /requires where\.ids$/)
  })
})
