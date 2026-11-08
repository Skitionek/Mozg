'use strict'

const { test, describe, before, after, afterEach, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { ViewStore, parseDefinitions, resolveEnv, resetViews, DEFAULT_LIMIT } = require('../src/views')
const { createMozgServer } = require('../src/server')

/** A clock the test moves by hand. */
function clock (start = 1_000_000) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms } }
  return c
}

const ROWS = [
  { id: 1, name: 'Ada', score: 9.5, tags: ['math', 'engines'], team: 'a' },
  { id: 2, name: 'Barbara', score: 7, tags: ['compilers'], team: 'b' },
  { id: 3, name: 'Carl', score: null, tags: [], team: 'a' },
  { id: 10, name: 'Dora', score: 8, tags: ['math'], team: 'b' }
]

const telemetry = { logger: { info () {}, warn () {} }, recordViewRefresh () {} }

/**
 * A store over one view, with a controllable data source.
 * `source.rows` is what the next refresh returns; `source.fail` makes it throw.
 */
function store (definition = {}, { env = {}, rows = ROWS } = {}) {
  const c = clock()
  const source = { rows, fail: null, runs: [], delay: 0 }
  const views = [{ name: 'people', query: { source: 'demo', from: 'people' }, ...definition }]
  const s = new ViewStore({
    env: { MOZG_VIEWS: JSON.stringify(views), ...env },
    now: c.now,
    telemetry,
    run: async (input) => {
      source.runs.push(input)
      if (source.delay) await new Promise((resolve) => setTimeout(resolve, source.delay))
      if (source.fail) throw new Error(source.fail)
      return { data: structuredClone(source.rows), count: source.rows.length }
    }
  })
  return { s, c, source }
}

describe('view definitions', () => {
  const parse = (views) => parseDefinitions({ MOZG_VIEWS: JSON.stringify(views) })

  test('none configured is none', () => {
    assert.deepEqual(parseDefinitions({}), [])
    assert.deepEqual(parseDefinitions({ MOZG_VIEWS: '  ' }), [])
  })

  test('are read with their defaults', () => {
    const [view] = parse([{ name: 'tp53', query: { source: 'uniprot', from: 'protein' }, refresh: { everyMs: 60000 } }])
    assert.equal(view.ttlMs, 0)
    assert.equal(view.everyMs, 60000)
    assert.equal(view.onStart, true, 'a timer implies a refresh at start')
    assert.equal(view.staleWhileRevalidate, true)
    assert.equal(view.minIntervalMs, 60000)
    assert.equal(view.maxRows, 10000)
  })

  test('are refused with a message saying which and why', () => {
    const query = { source: 's', from: 'f' }
    const cases = [
      ['{not json', /not valid JSON/],
      ['{"a":1}', /must be a JSON array/],
      [[{ query }], /name must be/],
      [[{ name: 'bad name', query }], /name must be/],
      [[{ name: 'x' }], /needs a query/],
      [[{ name: 'x', query: { from: 'f' } }], /needs a source or a connection/],
      [[{ name: 'x', query: { source: 's' } }], /needs from/],
      [[{ name: 'x', query: { ...query, view: 'y' } }], /may not set view/],
      [[{ name: 'x', query: { ...query, fresh: true } }], /may not set fresh/],
      [[{ name: 'x', query, refresh: { everyMs: 10 } }], /would hammer/],
      [[{ name: 'x', query, refresh: { ttlMs: -1 } }], /refresh\.ttlMs/],
      [[{ name: 'x', query, maxRows: 0 }], /maxRows/],
      [[{ name: 'x', query }, { name: 'X', query }], /twice/]
    ]
    for (const [views, message] of cases) {
      const env = { MOZG_VIEWS: typeof views === 'string' ? views : JSON.stringify(views) }
      assert.throws(() => parseDefinitions(env), message, JSON.stringify(views))
    }
  })

  test('{ env: VAR } is read from the environment, and a missing one is named', () => {
    const query = { connection: { driver: 'postgres', host: 'db', password: { env: 'DB_PASSWORD' } }, list: [{ env: 'DB_PASSWORD' }] }
    assert.deepEqual(resolveEnv(query, { DB_PASSWORD: 's3cret' }), { connection: { driver: 'postgres', host: 'db', password: 's3cret' }, list: ['s3cret'] })
    assert.throws(() => resolveEnv(query, {}), /DB_PASSWORD is not set/)
    assert.deepEqual(resolveEnv({ env: 'X', other: 1 }, {}), { env: 'X', other: 1 }, 'only a lone { env } is a reference')
  })
})

describe('reading a view', () => {
  test('the first read waits for the rows, and later reads do not run the query again', async () => {
    const { s, source } = store()
    const first = await s.query({ view: 'people' })
    assert.equal(first.count, 4)
    assert.equal(source.runs.length, 1)
    await s.query({ view: 'people' })
    assert.equal(source.runs.length, 1)
  })

  test('refreshes with a query that bypasses the result cache', async () => {
    const { s, source } = store()
    await s.query({ view: 'people' })
    assert.equal(source.runs[0].fresh, true)
    assert.equal(source.runs[0].source, 'demo')
  })

  test('filters by a value, by a list, and by comparison', async () => {
    const { s } = store()
    const names = async (where) => (await s.query({ view: 'people', where })).data.map((r) => r.name)
    assert.deepEqual(await names({ team: 'a' }), ['Ada', 'Carl'])
    assert.deepEqual(await names({ id: '2' }), ['Barbara'], '"2" finds 2')
    assert.deepEqual(await names({ id: { in: [1, 10] } }), ['Ada', 'Dora'])
    assert.deepEqual(await names({ score: { gt: 7.5 } }), ['Ada', 'Dora'])
    assert.deepEqual(await names({ id: { gte: 3, lt: 10 } }), ['Carl'], 'ids compare as numbers, so 10 is not below 3')
    assert.deepEqual(await names({ team: { ne: 'a' } }), ['Barbara', 'Dora'])
    assert.deepEqual(await names({ name: { contains: 'AR' } }), ['Barbara', 'Carl'])
    assert.deepEqual(await names({ tags: { contains: 'math' } }), ['Ada', 'Dora'], 'contains looks in a list')
    assert.deepEqual(await names({ score: null }), ['Carl'], 'null finds the missing')
  })

  test('orders, with missing values last either way, then pages and selects', async () => {
    const { s } = store()
    const names = async (extra) => (await s.query({ view: 'people', ...extra })).data.map((r) => r.name)
    assert.deepEqual(await names({ orderBy: 'score' }), ['Barbara', 'Dora', 'Ada', 'Carl'])
    assert.deepEqual(await names({ orderBy: 'score', orderDirection: 'desc' }), ['Ada', 'Dora', 'Barbara', 'Carl'])
    assert.deepEqual(await names({ orderBy: 'id' }), ['Ada', 'Barbara', 'Carl', 'Dora'], 'numbers sort as numbers')
    assert.deepEqual(await names({ orderBy: 'id', limit: 2, offset: 1 }), ['Barbara', 'Carl'])
    const picked = await s.query({ view: 'people', select: ['name', 'team'], limit: 1 })
    assert.deepEqual(picked.data, [{ name: 'Ada', team: 'a' }])
  })

  test('says how many matched and whether the page is the whole of it', async () => {
    const { s } = store()
    const page = (await s.query({ view: 'people', where: { team: 'a' }, limit: 1 })).meta
    assert.equal(page.total, 2)
    assert.equal(page.truncated, true)
    const all = (await s.query({ view: 'people', where: { team: 'a' } })).meta
    assert.equal(all.truncated, false)
  })

  test('returns a default number of rows when asked for no limit, and says it cut', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({ id: i }))
    const { s } = store({ maxRows: 5000 }, { rows: many })
    const result = await s.query({ view: 'people' })
    assert.equal(result.count, DEFAULT_LIMIT)
    assert.equal(result.meta.total, 1500)
    assert.equal(result.meta.truncated, true)
    assert.equal((await s.query({ view: 'people', limit: 2000 })).count, 1500)
  })

  test('refuses a column it does not have, naming the ones it does', async () => {
    const { s } = store()
    const columns = 'id, name, score, tags, team'
    await assert.rejects(s.query({ view: 'people', where: { nme: 'x' } }), new RegExp(`no column "nme". Columns: ${columns}`))
    await assert.rejects(s.query({ view: 'people', select: ['nope'] }), /no column "nope"/)
    await assert.rejects(s.query({ view: 'people', orderBy: 'nope' }), /no column "nope" to order by/)
    await assert.rejects(s.query({ view: 'people', where: { id: { near: 3 } } }), /unknown operator "near"/)
  })

  test('refuses what a stored read cannot do', async () => {
    const { s } = store()
    await assert.rejects(s.query({ view: 'people', include: ['x'] }), /include cannot be used with view/)
    await assert.rejects(s.query({ view: 'people', relations: [{ entity: 'x' }] }), /relations cannot be used/)
    await assert.rejects(s.query({ view: 'people', source: 'uniprot' }), /either a view or a source/)
    await assert.rejects(s.query({ view: 'nope' }), /Unknown view "nope". Defined: people\./)
    await s.query({ view: 'people', include: [], relations: [] }) // empty lists are the same as none
  })

  test('hands out copies, so one reader cannot change what the next sees', async () => {
    const { s } = store()
    const first = await s.query({ view: 'people', limit: 1 })
    first.data[0].name = 'CHANGED'
    first.data[0].tags.push('x')
    const second = await s.query({ view: 'people', limit: 1 })
    assert.equal(second.data[0].name, 'Ada')
    assert.deepEqual(second.data[0].tags, ['math', 'engines'])
  })

  test('can link its rows to an ontology, as any query can', async () => {
    const { s } = store()
    const obo = '[Term]\nid: T:1\nname: Ada\n'
    const { data } = await s.query({ view: 'people', limit: 2, link: [{ field: 'name', content: obo, format: 'obo' }] })
    assert.equal(data[0].nameTerm.id, 'T:1')
    assert.equal(data[1].nameTerm, null)
    assert.equal((await s.query({ view: 'people', limit: 1 })).data[0].nameTerm, undefined, 'the stored rows were not changed')
  })
})

describe('freshness', () => {
  test('every answer says how old it is', async () => {
    const { s, c } = store({ refresh: { ttlMs: 60_000 } })
    const first = await s.query({ view: 'people' })
    assert.equal(first.meta.view, 'people')
    assert.equal(first.meta.ageMs, 0)
    assert.equal(first.meta.stale, false)
    assert.equal(first.meta.ttlMs, 60_000)
    assert.equal(first.meta.refreshedAt, new Date(c.now()).toISOString())
    c.advance(10_000)
    assert.equal((await s.query({ view: 'people' })).meta.ageMs, 10_000)
  })

  test('a stale read is answered from the old rows while a refresh runs behind it', async () => {
    const { s, c, source } = store({ refresh: { ttlMs: 60_000, minIntervalMs: 0 } })
    await s.query({ view: 'people' })
    source.rows = [{ id: 99, name: 'New' }]
    c.advance(61_000)
    const stale = await s.query({ view: 'people' })
    assert.equal(stale.meta.stale, true)
    assert.equal(stale.count, 4, 'the old rows answered')
    await s.states.get('people').refreshing
    const fresh = await s.query({ view: 'people' })
    assert.equal(fresh.meta.stale, false)
    assert.deepEqual(fresh.data.map((r) => r.name), ['New'])
  })

  test('with staleWhileRevalidate off, a stale read waits for the new rows', async () => {
    const { s, c, source } = store({ refresh: { ttlMs: 60_000, staleWhileRevalidate: false, minIntervalMs: 0 } })
    await s.query({ view: 'people' })
    source.rows = [{ id: 99, name: 'New' }]
    c.advance(61_000)
    const answer = await s.query({ view: 'people' })
    assert.deepEqual(answer.data.map((r) => r.name), ['New'])
    assert.equal(answer.meta.stale, false)
  })

  test('a view with no ttl never goes stale on its own', async () => {
    const { s, c, source } = store()
    await s.query({ view: 'people' })
    c.advance(10 * 24 * 3600 * 1000)
    const answer = await s.query({ view: 'people' })
    assert.equal(answer.meta.stale, false)
    assert.equal(source.runs.length, 1)
  })

  test('a failed refresh keeps the last good rows, flags them stale and records why', async () => {
    const { s, c, source } = store({ refresh: { ttlMs: 60_000, staleWhileRevalidate: false, minIntervalMs: 0 } })
    await s.query({ view: 'people' })
    source.fail = 'upstream is down'
    c.advance(61_000)
    const answer = await s.query({ view: 'people' })
    assert.equal(answer.count, 4, 'the last good rows still answer')
    assert.equal(answer.meta.stale, true)
    assert.equal(answer.meta.error, 'upstream is down')
    assert.equal(s.list()[0].error, 'upstream is down')
    source.fail = null
    c.advance(1)
    await s.refresh('people')
    assert.equal(s.list()[0].error, null, 'a good refresh clears it')
  })

  test('the first read of a view that cannot be built fails with the reason', async () => {
    const { s, source } = store()
    source.fail = 'upstream is down'
    await assert.rejects(s.query({ view: 'people' }), /upstream is down/)
  })

  test('a source that is down is not hammered by reads', async () => {
    const { s, c, source } = store({ refresh: { minIntervalMs: 30_000 } })
    source.fail = 'down'
    await assert.rejects(s.query({ view: 'people' }), /down/)
    for (let i = 0; i < 5; i++) {
      await assert.rejects(s.query({ view: 'people' }), /has no rows yet: its last refresh failed \(down\)\. It is tried again at most every 30 s/)
    }
    assert.equal(source.runs.length, 1, 'five more reads, one attempt')
    c.advance(30_000)
    await assert.rejects(s.query({ view: 'people' }), /down/)
    assert.equal(source.runs.length, 2, 'tried again once the interval passed')
  })

  test('a stale view whose source is down is retried no more than once an interval', async () => {
    const { s, c, source } = store({ refresh: { ttlMs: 1000, minIntervalMs: 30_000 } })
    await s.query({ view: 'people' })
    source.fail = 'down'
    c.advance(31_000)
    await s.query({ view: 'people' })
    await s.states.get('people').refreshing?.catch(() => {})
    for (let i = 0; i < 5; i++) await s.query({ view: 'people' })
    assert.equal(source.runs.length, 2, 'the first run and one retry')
  })
})

describe('refreshing', () => {
  test('is single-flight: callers during a refresh share it', async () => {
    const { s, source } = store()
    source.delay = 20
    const results = await Promise.all([s.refresh('people'), s.refresh('people'), s.query({ view: 'people' })])
    assert.equal(source.runs.length, 1)
    assert.equal(results[2].count, 4)
  })

  test('on request, is limited to once per minIntervalMs, and says how long to wait', async () => {
    const { s, c, source } = store({ refresh: { minIntervalMs: 60_000 } })
    await s.requestRefresh('people')
    c.advance(5000)
    await assert.rejects(s.requestRefresh('people'), /refreshed 5 s ago .* every 60 s; try again in 55 s/)
    assert.equal(source.runs.length, 1)
    c.advance(55_000)
    await s.requestRefresh('people')
    assert.equal(source.runs.length, 2)
  })

  test('cuts a query that returns more than maxRows and says so', async () => {
    const { s } = store({ maxRows: 2 })
    const result = await s.query({ view: 'people' })
    assert.equal(result.count, 2)
    assert.equal(s.list()[0].truncated, true)
    assert.equal(s.list()[0].rowCount, 2)
  })

  test('refuses rows that would pass the byte budget, keeping what it had', async () => {
    const { s, source } = store({}, { env: { MOZG_VIEWS_MAX_BYTES: '300' } })
    await s.query({ view: 'people', limit: 1 })
    const before = s.list()[0].rowCount
    source.rows = Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'x'.repeat(40) }))
    await assert.rejects(s.refresh('people'), /MOZG_VIEWS_MAX_BYTES/)
    assert.equal(s.list()[0].rowCount, before, 'the earlier rows are still there')
  })

  test('reads { env: VAR } from the environment each time it refreshes', async () => {
    const { s, source } = store({ query: { connection: { driver: 'postgres', password: { env: 'VIEW_DB_PASSWORD' } }, from: 't' } }, { env: { VIEW_DB_PASSWORD: 'hunter2' } })
    await s.query({ view: 'people' })
    assert.equal(source.runs[0].connection.password, 'hunter2')
    const missing = store({ query: { connection: { driver: 'postgres', password: { env: 'NOPE' } }, from: 't' } })
    await assert.rejects(missing.s.query({ view: 'people' }), /NOPE is not set/)
  })

  test('describes each view in the listing', async () => {
    const { s } = store({ description: 'People', refresh: { ttlMs: 1000, everyMs: 5000 } })
    const [before] = s.list()
    assert.equal(before.name, 'people')
    assert.equal(before.description, 'People')
    assert.equal(before.source, 'demo')
    assert.equal(before.rowCount, null)
    assert.equal(before.refreshedAt, null)
    await s.query({ view: 'people' })
    const [after] = s.list()
    assert.deepEqual(after.columns, ['id', 'name', 'score', 'tags', 'team'])
    assert.equal(after.rowCount, 4)
    assert.equal(after.everyMs, 5000)
  })
})

describe('starting', () => {
  afterEach(() => mock.timers.reset())

  test('refreshes at start the views that ask, and on a timer for those with everyMs', async () => {
    mock.timers.enable({ apis: ['setInterval'] })
    const { s, source } = store({ refresh: { everyMs: 10_000 } })
    s.start()
    await s.states.get('people').refreshing
    assert.equal(source.runs.length, 1, 'refreshed at start')
    mock.timers.tick(11_001)
    await s.states.get('people').refreshing
    assert.equal(source.runs.length, 2, 'and again on the timer')
    s.stop()
    mock.timers.tick(60_000)
    assert.equal(source.runs.length, 2, 'stop ends the timer')
  })

  test('a view with neither is left until it is read', async () => {
    const { s, source } = store({ refresh: { ttlMs: 1000 } })
    s.start()
    assert.equal(source.runs.length, 0)
  })

  test('a failing refresh at start does not stop the server or leak a rejection', async () => {
    const { s, source } = store({ refresh: { onStart: true } })
    source.fail = 'down'
    s.start()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(s.list()[0].error, 'down')
  })
})

describe('views over HTTP', () => {
  const SAMPLE_DB = path.join(__dirname, '..', 'examples', 'sample.db')
  const saved = process.env.MOZG_VIEWS
  let server
  let base

  before(async () => {
    if (!fs.existsSync(SAMPLE_DB)) {
      const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'examples', 'seed.js')], { stdio: 'pipe' })
      if (result.status !== 0) throw new Error(`Seed failed: ${result.stderr.toString()}`)
    }
    process.env.MOZG_VIEWS = JSON.stringify([{
      name: 'users-view',
      description: 'The sample users',
      query: { connection: { driver: 'sqlite3', database: SAMPLE_DB }, from: 'users' },
      refresh: { minIntervalMs: 0 }
    }])
    resetViews()
    server = createMozgServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(async () => {
    if (saved === undefined) delete process.env.MOZG_VIEWS
    else process.env.MOZG_VIEWS = saved
    resetViews()
    await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve) })
  })

  const graphql = (query, variables) => fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  }).then((r) => r.json())

  test('lists the view before it has rows', async () => {
    const out = await graphql('{ views { name description source from rowCount refreshedAt refreshing stale } }')
    assert.equal(out.errors, undefined, JSON.stringify(out.errors))
    assert.deepEqual(out.data.views, [{ name: 'users-view', description: 'The sample users', source: 'sqlite3', from: 'users', rowCount: null, refreshedAt: null, refreshing: false, stale: null }])
  })

  test('a read builds the rows from the real database, and filters, orders and reports freshness', async () => {
    const out = await graphql(`{
      query(input: { view: "users-view", where: { name: { contains: "o" } }, orderBy: "name", select: ["id", "name"], limit: 3 }) { count data }
    }`)
    assert.equal(out.errors, undefined, JSON.stringify(out.errors))
    const names = out.data.query.data.map((r) => r.name)
    assert.ok(names.length > 0 && names.every((n) => /o/i.test(n)), names.join(', '))
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)))
    assert.deepEqual(Object.keys(out.data.query.data[0]), ['id', 'name'])
  })

  test('meta rides in the result, and the listing now shows the rows', async () => {
    const out = await graphql('{ query(input: { view: "users-view", limit: 1 }) { meta } views { rowCount columns refreshedAt } }')
    assert.equal(out.errors, undefined, JSON.stringify(out.errors))
    const { meta } = out.data.query
    assert.equal(meta.view, 'users-view')
    assert.equal(typeof meta.ageMs, 'number')
    assert.equal(meta.stale, false)
    assert.ok(meta.total >= 4)
    assert.ok(out.data.views[0].rowCount >= 4)
    assert.ok(out.data.views[0].columns.includes('name'))
  })

  test('refreshView refreshes it, and an unknown view is an error', async () => {
    const ok = await graphql('mutation { refreshView(name: "users-view") { name rowCount error } }')
    assert.equal(ok.errors, undefined, JSON.stringify(ok.errors))
    assert.ok(ok.data.refreshView.rowCount >= 4)
    const bad = await graphql('mutation { refreshView(name: "nope") { name } }')
    assert.match(bad.errors[0].message, /Unknown view "nope"/)
  })

  test('a query with neither from nor view is refused', async () => {
    const out = await graphql('{ query(input: { connection: { driver: sqlite3, database: "x.db" } }) { count } }')
    assert.match(out.errors[0].message, /needs from .* unless it reads a view/)
  })

  test('the metrics show the view\'s rows, age and refreshes', async () => {
    const text = await (await fetch(`${base}/metrics`)).text()
    assert.match(text, /mozg_view_rows\{view="users-view"\} \d+/)
    assert.match(text, /mozg_view_age_seconds\{view="users-view"\} [\d.]+/)
    assert.match(text, /mozg_view_refreshes_total\{view="users-view",outcome="ok"\} [1-9]/)
    assert.match(text, /mozg_queries_total\{driver="view",source="users-view",outcome="ok",nested="false"\} [1-9]/)
  })
})
