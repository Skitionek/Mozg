'use strict'

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createSchema } = require('graphql-yoga')

const { typeDefs, resolvers } = require('../src/schema')
const { createMozgServer } = require('../src/server')
const { registerCatalog } = require('../src/catalog')
const { validate, buildTools, callTool, SUPPORTED_VERSIONS, MODERN_VERSIONS, LEGACY_VERSIONS, mcpSettings } = require('../src/mcp')
const { version } = require('../package.json')

const SAMPLE_DB = path.join(__dirname, '..', 'examples', 'sample.db')
const SAMPLE = { driver: 'sqlite3', database: SAMPLE_DB }
const MODERN = MODERN_VERSIONS[0]

before(() => {
  if (fs.existsSync(SAMPLE_DB)) return
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'examples', 'seed.js')], { stdio: 'pipe' })
  if (result.status !== 0) throw new Error(`Seed failed: ${result.stderr.toString()}`)
})

// ── Helpers ─────────────────────────────────────────────────────────────────

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const close = (server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) })

/** The `_meta` a modern request must carry. */
const modernMeta = (extra = {}) => ({
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
  ...extra
})

/** POST one JSON-RPC message; returns status, headers and the parsed body (null when empty). */
async function post (base, message, headers = {}, { path: urlPath = '/mcp', raw } = {}) {
  const res = await fetch(base + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: raw !== undefined ? raw : JSON.stringify(message)
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
}

/** A modern request, with the headers the transport requires. */
function modern (base, method, params = {}, { id = 1, meta, headers = {} } = {}) {
  const message = { jsonrpc: '2.0', id, method, params: { ...params, _meta: meta || modernMeta() } }
  const required = { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': method }
  if (method === 'tools/call') required['Mcp-Name'] = params.name
  return post(base, message, { ...required, ...headers })
}

/** A legacy request: no per-request metadata. */
const legacy = (base, method, params, { id = 1, headers = {} } = {}) => post(base, { jsonrpc: '2.0', id, method, params }, headers)

const toolResult = (reply) => {
  assert.equal(reply.status, 200, JSON.stringify(reply.body))
  assert.ok(reply.body.result, JSON.stringify(reply.body))
  return reply.body.result
}

// ── The schema checker ──────────────────────────────────────────────────────

describe('argument validation', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      mode: { type: 'string', enum: ['a', 'b'] },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      keys: { type: 'object', additionalProperties: { type: 'string' } },
      inner: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'], additionalProperties: false }
    },
    required: ['name'],
    additionalProperties: false
  }

  test('accepts what fits', () => {
    assert.deepEqual(validate({ name: 'x', limit: 3, mode: 'a', tags: ['t'], keys: { a: 'b' }, inner: { x: 1 } }, schema), [])
  })

  test('says which argument is wrong and why', () => {
    assert.deepEqual(validate({}, schema), ['name is required'])
    assert.deepEqual(validate({ name: '' }, schema), ['name must not be empty'])
    assert.deepEqual(validate({ name: 'x', limit: '3' }, schema), ['limit must be integer, not a string'])
    assert.deepEqual(validate({ name: 'x', limit: 1.5 }, schema), ['limit must be integer, not a number'])
    assert.deepEqual(validate({ name: 'x', limit: 11 }, schema), ['limit must be at most 10'])
    assert.deepEqual(validate({ name: 'x', mode: 'c' }, schema), ['mode must be one of "a", "b"'])
    assert.deepEqual(validate({ name: 'x', tags: ['a', 1] }, schema), ['tags[1] must be string, not an integer'])
    assert.deepEqual(validate({ name: 'x', tags: ['a', 'b', 'c'] }, schema), ['tags takes at most 2 item(s)'])
    assert.deepEqual(validate({ name: 'x', keys: { a: 1 } }, schema), ['keys.a must be string, not an integer'])
    assert.deepEqual(validate({ name: 'x', inner: {} }, schema), ['inner.x is required'])
  })

  test('names the tool\'s arguments when one is unknown', () => {
    const [problem] = validate({ name: 'x', extra: 1 }, schema)
    assert.match(problem, /^extra is not an argument of this tool \(known: name, limit, mode, tags, keys, inner\)$/)
  })

  test('rejects a value of the wrong kind outright', () => {
    assert.deepEqual(validate(null, schema), ['arguments must be object, not null'])
    assert.deepEqual(validate([], schema), ['arguments must be object, not an array'])
  })
})

// ── The tools ───────────────────────────────────────────────────────────────

describe('tools', () => {
  const schema = createSchema({ typeDefs, resolvers })
  const tools = buildTools({ schema, maxBytes: 100_000 })
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
  const call = (name, args = {}) => callTool(byName[name], args)

  test('are named for what they do, in a fixed order', () => {
    assert.deepEqual(tools.map((t) => t.name), ['catalog', 'query', 'introspect', 'obo_keys', 'ontologies', 'ontology_terms'])
    for (const tool of tools) {
      assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/)
      assert.ok(tool.title && tool.description.length > 40, tool.name)
    }
  })

  test('declare object input schemas that name every argument and refuse others', () => {
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object', tool.name)
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name)
      for (const required of tool.inputSchema.required || []) assert.ok(tool.inputSchema.properties[required], `${tool.name}.${required}`)
    }
  })

  test('say whether they only read and whether they reach outside the server', () => {
    for (const tool of tools) {
      assert.equal(typeof tool.annotations.openWorldHint, 'boolean', tool.name)
      if (tool.name === 'query') continue
      assert.equal(tool.annotations.readOnlyHint, true, tool.name)
      assert.equal(tool.annotations.destructiveHint, false, tool.name)
    }
    assert.equal(byName.query.annotations.openWorldHint, true)
    assert.equal(byName.catalog.annotations.openWorldHint, false)
  })

  test('do not promise that a query only reads: a Thrift method or a SOAP operation may not', () => {
    // A client may skip asking about a tool that says it is read-only.
    assert.notEqual(byName.query.annotations.readOnlyHint, true)
    assert.notEqual(byName.query.annotations.destructiveHint, false)
  })

  test('offer exactly the drivers, relation types and term formats the GraphQL API does', () => {
    const values = (name) => schema.getType(name).getValues().map((v) => v.name)
    assert.deepEqual(byName.catalog.inputSchema.properties.driver.enum, values('Driver'))
    assert.deepEqual(byName.query.inputSchema.properties.connection.properties.driver.enum, values('Driver'))
    assert.deepEqual(byName.query.inputSchema.properties.relations.items.properties.type.enum, values('RelationType'))
    assert.deepEqual(byName.ontology_terms.inputSchema.properties.format.enum, values('TermFormat'))
    assert.deepEqual(byName.ontology_terms.inputSchema.properties.match.items.enum, values('OntologyMatch'))
  })

  test('every argument of the query tool is one the GraphQL QueryInput takes', () => {
    const inputs = Object.keys(schema.getType('QueryInput').getFields())
    for (const name of Object.keys(byName.query.inputSchema.properties)) assert.ok(inputs.includes(name), name)
  })

  test('return structured content that fits their output schema, and the same data as text', async () => {
    const reply = await call('obo_keys', { search: 'uniprot' })
    assert.equal(reply.isError, false)
    assert.deepEqual(validate(reply.structuredContent, byName.obo_keys.outputSchema), [])
    assert.deepEqual(JSON.parse(reply.content[0].text), JSON.parse(JSON.stringify(reply.structuredContent)))
    assert.ok(reply.structuredContent.keys.every((k) => /uniprot/i.test(`${k.key}${k.label}${k.prefix}`)))
  })

  test('refuse bad arguments with a message that says what to change', async () => {
    const reply = await call('query', { from: 'users', limit: 'ten', surprise: true })
    assert.equal(reply.isError, true)
    assert.match(reply.content[0].text, /^Invalid arguments: /)
    assert.match(reply.content[0].text, /limit must be integer, not a string/)
    assert.match(reply.content[0].text, /surprise is not an argument/)
  })

  describe('catalog', () => {
    test('lists sources briefly, leaving out what is empty', async () => {
      const { structuredContent: { sources } } = await call('catalog')
      assert.ok(sources.length > 50)
      const uniprot = sources.find((s) => s.name === 'uniprot')
      assert.deepEqual(Object.keys(uniprot), ['name', 'label', 'description', 'category', 'driver', 'entities'])
      assert.ok(uniprot.entities.includes('protein'))
      assert.ok(sources.every((s) => !('auth' in s) && !('homepage' in s) && !('needsKey' in s) && !('selfHosted' in s)))
    })

    test('says which sources cannot be used without a key', async () => {
      const unregister = registerCatalog({
        name: 'keyed-test',
        label: 'Keyed',
        driver: 'api',
        auth: { header: 'x-key', required: true },
        connection: { database: 'https://keyed.example' },
        entities: [{ name: 'thing', path: '/thing/{id}', params: { id: {} }, fields: { id: 'id' } }]
      })
      try {
        const { structuredContent: { sources } } = await call('catalog')
        assert.deepEqual(sources.filter((s) => s.needsKey).map((s) => s.name), ['keyed-test'])
      } finally {
        unregister()
      }
    })

    test('filters by words, category and driver', async () => {
      const words = (await call('catalog', { search: 'PROTEIN structure' })).structuredContent.sources
      assert.ok(words.length > 0 && words.length < 20)
      assert.ok(words.some((s) => s.name === 'uniprot'))
      const category = (await call('catalog', { category: 'Proteins & structures' })).structuredContent.sources
      assert.ok(category.every((s) => s.category === 'Proteins & structures'))
      const drivers = (await call('catalog', { driver: 'sqlite3' })).structuredContent.sources
      assert.ok(drivers.length > 0 && drivers.every((s) => s.driver === 'sqlite3'))
      assert.deepEqual((await call('catalog', { search: 'zzzzzz-nothing' })).structuredContent.sources, [])
    })

    test('describes one source with what a query needs: fields and their keys, parameters, relations, links', async () => {
      const { structuredContent: { sources: [source] } } = await call('catalog', { name: 'uniprot' })
      assert.equal(source.name, 'uniprot')
      const protein = source.entities.find((e) => e.name === 'protein')
      assert.ok(protein.fields.some((f) => f.obo === 'uniprot'))
      assert.ok(protein.params.length > 0)
      assert.ok(protein.example)
      assert.ok(protein.relations.length > 0)
      assert.ok(protein.links.length > 0)
    })

    test('can narrow that to one entity', async () => {
      const { structuredContent: { sources: [source] } } = await call('catalog', { name: 'uniprot', entity: 'protein' })
      assert.deepEqual(source.entities.map((e) => e.name), ['protein'])
    })

    test('say what to do about a name or an entity that does not exist', async () => {
      const unknown = await call('catalog', { name: 'nope' })
      assert.equal(unknown.isError, true)
      assert.match(unknown.content[0].text, /Unknown catalog: nope\. Call catalog without a name/)
      const entity = await call('catalog', { name: 'uniprot', entity: 'nope' })
      assert.equal(entity.isError, true)
      assert.match(entity.content[0].text, /uniprot has no entity "nope"\. Its entities: protein/)
      const orphan = await call('catalog', { entity: 'protein' })
      assert.match(orphan.content[0].text, /entity goes with name/)
    })
  })

  describe('query', () => {
    test('needs a source or a connection', async () => {
      const reply = await call('query', { from: 'users' })
      assert.equal(reply.isError, true)
      assert.match(reply.content[0].text, /Give either source .* or connection/)
    })

    test('returns the rows of a connection, with relations, as GraphQL would', async () => {
      const reply = await call('query', { connection: SAMPLE, from: 'users', limit: 2, relations: [{ entity: 'posts', foreignKey: 'user_id' }] })
      assert.equal(reply.isError, false, reply.content[0].text)
      const { count, data } = reply.structuredContent
      assert.equal(count, 2)
      assert.equal(data.length, 2)
      assert.ok(Array.isArray(data[0].posts) && data[0].posts.length > 0)
      assert.deepEqual(validate(reply.structuredContent, byName.query.outputSchema), [])
    })

    test('returns a small number of rows unless asked for more, because the answer goes into a prompt', async () => {
      const { structuredContent } = await call('query', { connection: SAMPLE, from: 'comments' })
      assert.equal(structuredContent.count, 25)
      const more = await call('query', { connection: SAMPLE, from: 'comments', limit: 40 })
      assert.equal(more.structuredContent.count, 40)
    })

    test('hands a database\'s own error to the model, without credentials', async () => {
      const reply = await call('query', { connection: SAMPLE, from: 'no_such_table' })
      assert.equal(reply.isError, true)
      assert.match(reply.content[0].text, /no such table: no_such_table/)

      const leaky = { ...byName.catalog, run: async () => { throw new Error('connect failed: mongodb://admin:hunter2@db.example.com:27017') } }
      const failed = await callTool(leaky, {})
      assert.equal(failed.isError, true)
      assert.doesNotMatch(failed.content[0].text, /hunter2/)
      assert.match(failed.content[0].text, /admin:\*\*\*@db\.example\.com/)
    })

    test('turns what GraphQL refuses into a message about the argument', async () => {
      const reply = await call('query', { connection: SAMPLE, from: 'users', relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany' }], orderDirection: 'asc', link: [{ field: 'x', ontology: 'nope' }] })
      assert.equal(reply.isError, true)
      assert.match(reply.content[0].text, /nope/i)
    })
  })

  describe('introspect', () => {
    test('lists tables and columns', async () => {
      const { structuredContent } = await call('introspect', { connection: SAMPLE })
      const users = structuredContent.tables.find((t) => t.name === 'users')
      assert.ok(users.columns.some((c) => c.name === 'id' && c.isPrimaryKey))
      assert.deepEqual(validate(structuredContent, byName.introspect.outputSchema), [])
    })

    test('needs a source or a connection', async () => {
      assert.equal((await call('introspect')).isError, true)
    })
  })

  describe('ontologies', () => {
    test('are listed, and terms need one to be named', async () => {
      const { structuredContent } = await call('ontologies')
      assert.ok(Array.isArray(structuredContent.ontologies))
      const reply = await call('ontology_terms', { search: 'diabetes' })
      assert.equal(reply.isError, true)
      assert.match(reply.content[0].text, /Name an ontology/)
    })
  })

  describe('size cap', () => {
    const small = buildTools({ schema, maxBytes: 1500 })
    const smallCall = (name, args) => callTool(small.find((t) => t.name === name), args)

    test('cuts a long list at the end, and says so', async () => {
      const reply = await smallCall('query', { connection: SAMPLE, from: 'comments', limit: 100 })
      assert.equal(reply.isError, false)
      const out = reply.structuredContent
      assert.equal(out.truncated, true)
      assert.ok(out.returned > 0 && out.returned < 45)
      assert.equal(out.data.length, out.returned)
      assert.equal(out.count, 45, 'count stays what the query returned')
      assert.match(out.note, new RegExp(`Showing ${out.returned} of 45 data.*capped at 1500 bytes.*where, select or a smaller limit`))
      assert.ok(Buffer.byteLength(JSON.stringify(out)) <= 1500)
    })

    test('keeps the biggest prefix that fits', async () => {
      const reply = await smallCall('query', { connection: SAMPLE, from: 'comments', limit: 100 })
      const { returned, data } = reply.structuredContent
      assert.equal(data[0].id, 1, 'the start is kept, the end is dropped')
      // One more row would not have fit: that is what makes this the biggest prefix.
      const all = JSON.parse(JSON.stringify((await call('query', { connection: SAMPLE, from: 'comments', limit: 100 })).structuredContent.data))
      const withOneMore = { count: 45, data: all.slice(0, returned + 1), truncated: true, returned: returned + 1, note: reply.structuredContent.note }
      assert.ok(Buffer.byteLength(JSON.stringify(withOneMore)) > 1500)
    })

    test('leaves a result that fits alone', async () => {
      const reply = await smallCall('query', { connection: SAMPLE, from: 'users', limit: 1, select: ['id'] })
      assert.equal(reply.structuredContent.truncated, undefined)
    })

    test('applies to the catalog and to introspection too', async () => {
      const list = await smallCall('catalog', {})
      assert.equal(list.structuredContent.truncated, true)
      assert.match(list.structuredContent.note, /Narrow it with search or category/)
      assert.ok(list.structuredContent.sources.length > 0)
    })
  })
})

// ── The endpoint ────────────────────────────────────────────────────────────

describe('settings', () => {
  test('default to on, no browser origins, and a 100 kB cap', () => {
    assert.deepEqual(mcpSettings({}), { enabled: true, allowedOrigins: [], maxResultBytes: 100_000 })
  })

  test('read the environment, tolerating slashes and case in origins', () => {
    const env = { MOZG_MCP: 'off', MOZG_MCP_ALLOWED_ORIGINS: 'https://App.example.com/, http://localhost:3000 ,', MOZG_MCP_MAX_RESULT_BYTES: '5000' }
    assert.deepEqual(mcpSettings(env), { enabled: false, allowedOrigins: ['https://app.example.com', 'http://localhost:3000'], maxResultBytes: 5000 })
  })

  test('keep the cap large enough to hold a message', () => {
    assert.equal(mcpSettings({ MOZG_MCP_MAX_RESULT_BYTES: '10' }).maxResultBytes, 1000)
  })
})

describe('the MCP endpoint', () => {
  let server
  let base

  before(async () => {
    server = createMozgServer({ env: { MOZG_METRICS: 'on' } })
    base = await listen(server)
  })
  after(() => close(server))

  describe('modern protocol (2026-07-28)', () => {
    test('server/discover says what the server is and what it speaks', async () => {
      const result = toolResult(await modern(base, 'server/discover'))
      assert.equal(result.resultType, 'complete')
      assert.deepEqual(result.supportedVersions, SUPPORTED_VERSIONS)
      assert.equal(result.supportedVersions[0], MODERN)
      assert.deepEqual(result.capabilities, { tools: {} })
      assert.deepEqual(result._meta['io.modelcontextprotocol/serverInfo'], { name: 'mozg', title: 'Mozg', version })
      assert.match(result.instructions, /catalog/)
      assert.equal(result.cacheScope, 'public')
      assert.ok(result.ttlMs > 0)
    })

    test('tools/list returns the tools in a fixed order, cacheable', async () => {
      const first = toolResult(await modern(base, 'tools/list'))
      const second = toolResult(await modern(base, 'tools/list', {}, { id: 2 }))
      assert.equal(first.resultType, 'complete')
      assert.deepEqual(first.tools.map((t) => t.name), ['catalog', 'query', 'introspect', 'obo_keys', 'ontologies', 'ontology_terms'])
      assert.deepEqual(first.tools, second.tools)
      assert.ok(first.ttlMs > 0)
      assert.equal(first.cacheScope, 'public')
      assert.equal(first.nextCursor, undefined)
      assert.ok(first.tools.every((t) => !('run' in t)))
    })

    test('tools/call runs a tool and answers in the result envelope', async () => {
      const reply = await modern(base, 'tools/call', { name: 'query', arguments: { connection: SAMPLE, from: 'users', limit: 2 } })
      const result = toolResult(reply)
      assert.equal(result.resultType, 'complete')
      assert.equal(result.isError, false)
      assert.equal(result.structuredContent.count, 2)
      assert.equal(JSON.parse(result.content[0].text).count, 2)
      assert.equal(reply.body.id, 1)
      assert.ok(result._meta['io.modelcontextprotocol/serverInfo'])
    })

    test('a tool that fails is a result with isError, not a protocol error', async () => {
      const result = toolResult(await modern(base, 'tools/call', { name: 'query', arguments: { from: 'users' } }))
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /Give either source/)
    })

    test('an unknown tool, or a call without a name, is a protocol error', async () => {
      const unknown = await modern(base, 'tools/call', { name: 'drop_tables', arguments: {} })
      assert.equal(unknown.status, 200)
      assert.equal(unknown.body.error.code, -32602)
      assert.match(unknown.body.error.message, /Unknown tool: drop_tables/)

      const nameless = await post(base, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { _meta: modernMeta() } }, { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/call' })
      assert.equal(nameless.body.error.code, -32602)

      const bad = await modern(base, 'tools/call', { name: 'obo_keys', arguments: 'search' })
      assert.equal(bad.body.error.code, -32602)
      assert.match(bad.body.error.message, /arguments must be an object/)
    })

    test('a method Mozg does not have is 404 with -32601', async () => {
      for (const method of ['resources/list', 'prompts/list', 'ping', 'subscriptions/listen', 'logging/setLevel']) {
        const reply = await modern(base, method)
        assert.equal(reply.status, 404, method)
        assert.equal(reply.body.error.code, -32601, method)
        assert.equal(reply.body.id, 1)
      }
      const inherited = await modern(base, 'constructor')
      assert.equal(inherited.status, 404, 'a name from Object.prototype is not a method')
    })

    test('a version Mozg does not speak is 400 with -32022 and the versions it does', async () => {
      const reply = await post(base, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: modernMeta({ 'io.modelcontextprotocol/protocolVersion': '1900-01-01' }) } },
        { 'MCP-Protocol-Version': '1900-01-01', 'Mcp-Method': 'tools/list' })
      assert.equal(reply.status, 400)
      assert.equal(reply.body.error.code, -32022)
      assert.deepEqual(reply.body.error.data, { supported: SUPPORTED_VERSIONS, requested: '1900-01-01' })
    })

    test('a version in the header alone is judged the same way', async () => {
      const reply = await post(base, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'MCP-Protocol-Version': '3000-01-01' })
      assert.equal(reply.status, 400)
      assert.equal(reply.body.error.code, -32022)
    })

    test('metadata that is required but missing is 400 with -32602', async () => {
      const noCapabilities = await modern(base, 'tools/list', {}, { meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } })
      assert.equal(noCapabilities.status, 400)
      assert.equal(noCapabilities.body.error.code, -32602)
      assert.match(noCapabilities.body.error.message, /clientCapabilities/)

      // The header promises a modern request; the body has no metadata at all.
      const noMeta = await post(base, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' })
      assert.equal(noMeta.status, 400)
      assert.equal(noMeta.body.error.code, -32602)
      assert.match(noMeta.body.error.message, /protocolVersion/)

      const notText = await modern(base, 'tools/list', {}, { meta: modernMeta({ 'io.modelcontextprotocol/protocolVersion': 20260728 }) })
      assert.equal(notText.status, 400)
      assert.equal(notText.body.error.code, -32602)
    })

    describe('header validation', () => {
      const body = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: modernMeta() } })

      test('MCP-Protocol-Version must be there and agree with the body', async () => {
        const missing = await post(base, body('tools/list'), { 'Mcp-Method': 'tools/list' })
        assert.equal(missing.status, 400)
        assert.equal(missing.body.error.code, -32020)
        assert.match(missing.body.error.message, /MCP-Protocol-Version header is missing/)

        const differs = await post(base, body('tools/list'), { 'MCP-Protocol-Version': '2025-11-25', 'Mcp-Method': 'tools/list' })
        assert.equal(differs.status, 400)
        assert.equal(differs.body.error.code, -32020)
        assert.match(differs.body.error.message, /'2025-11-25' does not match .* '2026-07-28'/)
      })

      test('Mcp-Method must be there and agree with the body', async () => {
        const missing = await post(base, body('tools/list'), { 'MCP-Protocol-Version': MODERN })
        assert.equal(missing.status, 400)
        assert.equal(missing.body.error.code, -32020)

        const differs = await post(base, body('tools/list'), { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/call' })
        assert.equal(differs.status, 400)
        assert.equal(differs.body.error.code, -32020)
        assert.match(differs.body.error.message, /'tools\/call' does not match .* 'tools\/list'/)
      })

      test('Mcp-Name must be there on tools/call and agree with the tool', async () => {
        const call = body('tools/call', { name: 'obo_keys', arguments: {} })
        const headers = { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/call' }

        const missing = await post(base, call, headers)
        assert.equal(missing.status, 400)
        assert.equal(missing.body.error.code, -32020)

        // The point of the check: a gateway that routes on the header must not be told one tool while another runs.
        const differs = await post(base, call, { ...headers, 'Mcp-Name': 'query' })
        assert.equal(differs.status, 400)
        assert.equal(differs.body.error.code, -32020)
        assert.match(differs.body.error.message, /'query' does not match .* 'obo_keys'/)

        const same = await post(base, call, { ...headers, 'Mcp-Name': 'obo_keys' })
        assert.equal(same.status, 200)
      })

      test('Mcp-Name may be Base64-encoded, and is decoded before the comparison', async () => {
        const call = body('tools/call', { name: 'obo_keys', arguments: {} })
        const encoded = `=?base64?${Buffer.from('obo_keys').toString('base64')}?=`
        const ok = await post(base, call, { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/call', 'Mcp-Name': encoded })
        assert.equal(ok.status, 200)
        const wrong = await post(base, call, { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/call', 'Mcp-Name': `=?base64?${Buffer.from('query').toString('base64')}?=` })
        assert.equal(wrong.status, 400)
      })
    })
  })

  describe('legacy protocol (2025-03-26 to 2025-11-25)', () => {
    const init = (version = '2025-06-18') => legacy(base, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'old', version: '1' } })

    test('initialize agrees to a version Mozg knows and describes the server', async () => {
      for (const asked of LEGACY_VERSIONS) {
        const reply = await init(asked)
        assert.equal(reply.status, 200)
        assert.equal(reply.body.result.protocolVersion, asked)
        assert.deepEqual(reply.body.result.capabilities, { tools: {} })
        assert.deepEqual(reply.body.result.serverInfo, { name: 'mozg', title: 'Mozg', version })
        assert.match(reply.body.result.instructions, /catalog/)
        assert.equal(reply.body.result.resultType, undefined, 'legacy results have no resultType')
      }
    })

    test('initialize offers the newest legacy version to a client that asks for one Mozg does not have', async () => {
      assert.equal((await init('2024-11-05')).body.result.protocolVersion, LEGACY_VERSIONS[0])
      assert.equal((await init(MODERN)).body.result.protocolVersion, LEGACY_VERSIONS[0])
    })

    test('keeps no session: none is minted, and one that is sent is ignored', async () => {
      const reply = await init()
      assert.equal(reply.headers.get('mcp-session-id'), null)
      const list = await legacy(base, 'tools/list', undefined, { headers: { 'Mcp-Session-Id': 'abc', 'MCP-Protocol-Version': '2025-06-18', 'Last-Event-ID': '7' } })
      assert.equal(list.status, 200)
      assert.equal(list.headers.get('mcp-session-id'), null)
    })

    test('initialize needs its parameters', async () => {
      const noVersion = await legacy(base, 'initialize', { capabilities: {} })
      assert.equal(noVersion.body.error.code, -32602)
      const noCapabilities = await legacy(base, 'initialize', { protocolVersion: '2025-06-18' })
      assert.equal(noCapabilities.body.error.code, -32602)
      const nothing = await legacy(base, 'initialize')
      assert.equal(nothing.body.error.code, -32602)
    })

    test('the initialized notification is accepted without an answer', async () => {
      const reply = await post(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'MCP-Protocol-Version': '2025-06-18' })
      assert.equal(reply.status, 202)
      assert.equal(reply.body, null)
    })

    test('tools/list and tools/call work with or without the version header', async () => {
      for (const headers of [{}, { 'MCP-Protocol-Version': '2025-06-18' }, { 'MCP-Protocol-Version': '2025-11-25' }]) {
        const list = toolResult(await legacy(base, 'tools/list', undefined, { headers }))
        assert.equal(list.tools.length, 6)
        assert.equal(list.resultType, undefined)
        const call = toolResult(await legacy(base, 'tools/call', { name: 'obo_keys', arguments: { search: 'chebi' } }, { headers }))
        assert.equal(call.isError, false)
        assert.ok(call.structuredContent.keys.length > 0)
        assert.equal(call.resultType, undefined)
        assert.equal(call._meta, undefined)
      }
    })

    test('ping answers with an empty result', async () => {
      assert.deepEqual(toolResult(await legacy(base, 'ping')), {})
    })

    test('a method Mozg does not have is a JSON-RPC error in a 200, as older clients expect', async () => {
      const reply = await legacy(base, 'resources/list')
      assert.equal(reply.status, 200)
      assert.equal(reply.body.error.code, -32601)
      assert.equal((await legacy(base, 'toString')).body.error.code, -32601)
    })

    test('a legacy version named in the per-request metadata is served as legacy', async () => {
      const reply = await post(base, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } } })
      assert.equal(reply.status, 200)
      assert.equal(reply.body.result.resultType, undefined)
    })
  })

  describe('HTTP', () => {
    test('GET and DELETE are 405: there is no stream and no session to end', async () => {
      for (const method of ['GET', 'DELETE', 'PUT']) {
        const res = await fetch(`${base}/mcp`, { method })
        assert.equal(res.status, 405, method)
        assert.equal(res.headers.get('allow'), 'POST, OPTIONS')
        assert.equal((await res.json()).error.code, -32600)
      }
    })

    test('also answers on /mcp/', async () => {
      const reply = await post(base, { jsonrpc: '2.0', id: 1, method: 'ping' }, {}, { path: '/mcp/' })
      assert.deepEqual(reply.body.result, {})
    })

    test('wants JSON', async () => {
      const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
      assert.equal(res.status, 415)
    })

    test('a body that is not JSON is a parse error without an id', async () => {
      const reply = await post(base, null, {}, { raw: '{"jsonrpc":' })
      assert.equal(reply.status, 400)
      assert.equal(reply.body.error.code, -32700)
      assert.equal('id' in reply.body, false)
    })

    test('a body that is not a single request is refused', async () => {
      const cases = [
        ['batch', JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]), /Batches are not supported/],
        ['not JSON-RPC', JSON.stringify({ id: 1, method: 'ping' }), /JSON-RPC 2\.0/],
        ['a response', JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), /not responses/],
        ['a null id', JSON.stringify({ jsonrpc: '2.0', id: null, method: 'ping' }), /string or an integer/],
        ['a fractional id', JSON.stringify({ jsonrpc: '2.0', id: 1.5, method: 'ping' }), /string or an integer/],
        ['params that are not an object', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: [] }), /params must be an object/]
      ]
      for (const [label, raw, message] of cases) {
        const reply = await post(base, null, {}, { raw })
        assert.equal(reply.status, 400, label)
        assert.match(reply.body.error.message, message, label)
      }
    })

    test('a body that is too large is 413', async () => {
      const reply = await post(base, null, {}, { raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(1_100_000) } }) })
      assert.equal(reply.status, 413)
      assert.equal(reply.body.error.code, -32600)
    })

    test('never caches, and tags the request id', async () => {
      const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'abc123' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })
      assert.equal(res.headers.get('cache-control'), 'no-store')
      assert.equal(res.headers.get('x-request-id'), 'abc123')
      assert.match(res.headers.get('content-type'), /^application\/json/)
    })
  })

  describe('metrics', () => {
    test('count requests by era, method and outcome, and tool calls by tool', async () => {
      await modern(base, 'tools/call', { name: 'obo_keys', arguments: {} })
      await modern(base, 'tools/call', { name: 'query', arguments: { from: 'x' } })
      await legacy(base, 'tools/list')
      await modern(base, 'resources/list')
      await post(base, { jsonrpc: '2.0', method: 'notifications/initialized' })
      const text = await (await fetch(`${base}/metrics`)).text()
      const has = (series) => assert.ok(text.includes(series), `${series}\n${text.split('\n').filter((l) => l.includes('mcp')).join('\n')}`)
      has('mozg_mcp_requests_total{era="modern",method="tools/call",outcome="ok"}')
      has('mozg_mcp_requests_total{era="modern",method="tools/call",outcome="tool_error"}')
      has('mozg_mcp_requests_total{era="legacy",method="tools/list",outcome="ok"}')
      has('mozg_mcp_requests_total{era="modern",method="other",outcome="error"}')
      has('mozg_mcp_requests_total{era="-",method="notification",outcome="ok"}')
      has('mozg_mcp_tool_calls_total{tool="obo_keys",outcome="ok"}')
      has('mozg_mcp_tool_calls_total{tool="query",outcome="error"}')
      has('mozg_http_requests_total{method="POST",route="mcp",status="200"}')
    })

    test('never put a name the caller invented into a label', async () => {
      await modern(base, 'invented/method-123')
      await modern(base, 'tools/call', { name: 'invented-tool-456', arguments: {} })
      const text = await (await fetch(`${base}/metrics`)).text()
      assert.ok(!text.includes('invented'))
    })
  })
})

describe('the MCP endpoint and browsers', () => {
  const origin = 'https://app.example.com'
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
  let servers = []

  async function start (env) {
    const server = createMozgServer({ env })
    servers.push(server)
    return listen(server)
  }
  after(async () => { await Promise.all(servers.map(close)); servers = [] })

  test('refuses a request from a page by default: DNS rebinding and cross-site calls must not reach a local server', async () => {
    const base = await start({})
    const reply = await post(base, ping, { Origin: origin })
    assert.equal(reply.status, 403)
    assert.equal(reply.body.error.code, -32600)
    assert.match(reply.body.error.message, /MOZG_MCP_ALLOWED_ORIGINS/)
    assert.equal(reply.headers.get('access-control-allow-origin'), null)
    assert.equal((await post(base, ping, { Origin: 'null' })).status, 403, 'a sandboxed page is not trusted either')
  })

  test('serves a client that sends no origin, which is every client that is not a browser', async () => {
    const base = await start({})
    assert.equal((await post(base, ping)).status, 200)
  })

  test('serves an origin the operator named, and says so for the browser', async () => {
    const base = await start({ MOZG_MCP_ALLOWED_ORIGINS: `${origin}/, https://other.example.com` })
    const reply = await post(base, ping, { Origin: origin })
    assert.equal(reply.status, 200)
    assert.equal(reply.headers.get('access-control-allow-origin'), origin)
    assert.equal(reply.headers.get('vary'), 'Origin')
    assert.equal((await post(base, ping, { Origin: 'https://evil.example.com' })).status, 403)
    assert.equal((await post(base, ping, { Origin: 'https://app.example.com.evil.example' })).status, 403, 'a prefix is not a match')
  })

  test('answers a browser\'s preflight for an allowed origin only', async () => {
    const base = await start({ MOZG_MCP_ALLOWED_ORIGINS: origin })
    const allowed = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,mcp-protocol-version' } })
    assert.equal(allowed.status, 204)
    assert.equal(allowed.headers.get('access-control-allow-origin'), origin)
    assert.match(allowed.headers.get('access-control-allow-methods'), /POST/)
    assert.equal(allowed.headers.get('access-control-allow-headers'), 'content-type,mcp-protocol-version')
    const denied = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' } })
    assert.equal(denied.status, 403)
  })

  test('* admits every origin', async () => {
    const base = await start({ MOZG_MCP_ALLOWED_ORIGINS: '*' })
    const reply = await post(base, ping, { Origin: 'https://anything.example' })
    assert.equal(reply.status, 200)
    assert.equal(reply.headers.get('access-control-allow-origin'), '*')
  })

  test('is not there at all when switched off', async () => {
    const base = await start({ MOZG_MCP: 'off' })
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ping) })
    assert.equal(res.status, 404)
    assert.equal((await fetch(`${base}/graphql?query=%7B__typename%7D`)).status, 200, 'GraphQL is unaffected')
  })

  test('caps what a tool returns as the operator says', async () => {
    const base = await start({ MOZG_MCP_MAX_RESULT_BYTES: '2000' })
    const result = toolResult(await modern(base, 'tools/call', { name: 'query', arguments: { connection: SAMPLE, from: 'comments', limit: 100 } }))
    assert.equal(result.structuredContent.truncated, true)
    assert.ok(Buffer.byteLength(result.content[0].text) <= 2000)
  })
})

// ── The official SDKs ───────────────────────────────────────────────────────
//
// The tests above check Mozg against the specification as read; these check it
// against the people who wrote the clients.  The 1.x SDK speaks the handshake
// protocol, which most assistants deployed today still do; 2.x speaks
// 2026-07-28 and falls back to the handshake on its own.

function optionalImport (name) {
  try {
    require.resolve(name)
    return import(name)
  } catch {
    return null
  }
}

describe('official MCP SDK clients', { skip: !optionalImport('@modelcontextprotocol/sdk/client/index.js') && '@modelcontextprotocol/sdk is not installed' }, () => {
  let server
  let url
  before(async () => {
    server = createMozgServer({ env: {} })
    url = new URL(`${await listen(server)}/mcp`)
  })
  after(() => close(server))

  /** The same story for either client: discover, list, call, fail. */
  async function useTools (client) {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name), ['catalog', 'query', 'introspect', 'obo_keys', 'ontologies', 'ontology_terms'])
    assert.deepEqual(tools.filter((t) => t.annotations.readOnlyHint === true).map((t) => t.name), ['catalog', 'introspect', 'obo_keys', 'ontologies', 'ontology_terms'])

    const keys = await client.callTool({ name: 'obo_keys', arguments: { search: 'chebi' } })
    assert.notEqual(keys.isError, true)
    assert.ok(keys.structuredContent.keys.some((k) => k.key === 'chebi'))

    const rows = await client.callTool({ name: 'query', arguments: { connection: SAMPLE, from: 'users', limit: 3, select: ['id', 'name'] } })
    assert.notEqual(rows.isError, true, rows.content[0].text)
    assert.equal(rows.structuredContent.count, 3)

    const catalog = await client.callTool({ name: 'catalog', arguments: { name: 'uniprot', entity: 'protein' } })
    assert.ok(catalog.structuredContent.sources[0].entities[0].fields.length > 0)

    const bad = await client.callTool({ name: 'query', arguments: { from: 'users', limit: 'many' } })
    assert.equal(bad.isError, true)
    assert.match(bad.content[0].text, /limit must be integer/)

    await assert.rejects(client.callTool({ name: 'no_such_tool', arguments: {} }), /Unknown tool: no_such_tool/)
  }

  test('1.x connects with the initialize handshake and uses the tools', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const client = new Client({ name: 'sdk-1x', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(url))
    try {
      assert.equal(client.getServerVersion().name, 'mozg')
      assert.deepEqual(client.getServerCapabilities(), { tools: {} })
      assert.match(client.getInstructions(), /catalog/)
      await useTools(client)
    } finally {
      await client.close()
    }
  })

  const v2 = optionalImport('@modelcontextprotocol/client')

  test('2.x speaks 2026-07-28 when it can: discover, then stateless requests', { skip: !v2 && '@modelcontextprotocol/client is not installed' }, async () => {
    const { Client, StreamableHTTPClientTransport } = await v2
    const client = new Client({ name: 'sdk-2x', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
    await client.connect(new StreamableHTTPClientTransport(url))
    try {
      assert.equal(client.getNegotiatedProtocolVersion(), MODERN)
      assert.deepEqual(client.getDiscoverResult().supportedVersions, SUPPORTED_VERSIONS)
      assert.equal(client.getServerVersion().name, 'mozg')
      await useTools(client)
    } finally {
      await client.close()
    }
  })

  test('2.x can pin the version', { skip: !v2 && '@modelcontextprotocol/client is not installed' }, async () => {
    const { Client, StreamableHTTPClientTransport } = await v2
    const client = new Client({ name: 'sdk-2x', version: '1.0.0' }, { versionNegotiation: { mode: { pin: MODERN } } })
    await client.connect(new StreamableHTTPClientTransport(url))
    try {
      assert.equal(client.getNegotiatedProtocolVersion(), MODERN)
      assert.notEqual((await client.callTool({ name: 'ontologies', arguments: {} })).isError, true)
    } finally {
      await client.close()
    }
  })

  test('2.x with its default settings uses the handshake, and Mozg serves that too', { skip: !v2 && '@modelcontextprotocol/client is not installed' }, async () => {
    const { Client, StreamableHTTPClientTransport } = await v2
    const client = new Client({ name: 'sdk-2x-legacy', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(url))
    try {
      assert.ok(LEGACY_VERSIONS.includes(client.getNegotiatedProtocolVersion()))
      await useTools(client)
    } finally {
      await client.close()
    }
  })
})
