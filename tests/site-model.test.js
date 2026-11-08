'use strict'

/* global document, getComputedStyle */

/**
 * The documentation site's Model page: a force graph of how the catalog's
 * databases connect through shared ontologies and identifier spaces.
 *
 *   - the data (scripts/model-graph.js) and the page build always run;
 *   - the in-browser tests drive the real page in Chromium and run where
 *     Playwright is installed (it is an optional tool here, as for
 *     scripts/record-demo.js), skipping cleanly where it is not.
 */

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const obo = require('../src/database/obo')
const { getCatalog } = require('../src/catalog')
const { buildModelGraph, sharedKeyTable, PRESETS, MAX_SOURCES } = require('../scripts/model-graph')
const { build, jsonForScript, modelFigure } = require('../scripts/build-site')

// ── The data ────────────────────────────────────────────────────────────────

/** A catalog entry as far as the graph reads one. */
const entry = (name, entities) => ({ name, label: name, category: 'Test', driver: 'api', entities })
// Catalog entities declare `fields` (a map) and `params` (a map), as the live ones do.
const entity = (name, columns, extra = {}) => ({ name, fields: Object.fromEntries(columns.map((c) => [c, {}])), params: {}, relations: [], ...extra })

describe('model graph data', () => {
  const live = buildModelGraph()

  test('is built from the live catalog, not written by hand', () => {
    const apiSources = getCatalog().filter((e) => e.driver === 'api')
    assert.equal(live.sources.length, apiSources.length)
    assert.equal(live.entities.length, apiSources.reduce((n, e) => n + e.entities.length, 0))
    assert.ok(live.keys.length > 30)
  })

  test('every entity names a real source and only identifier spaces that exist', () => {
    const sources = new Set(live.sources.map((s) => s.name))
    const keys = new Set(live.keys.map((k) => k.id))
    const ids = new Set()
    for (const e of live.entities) {
      assert.ok(sources.has(e.source), e.id)
      assert.ok(!ids.has(e.id), `${e.id} is unique`)
      ids.add(e.id)
      for (const k of [...e.returns, ...e.accepts]) assert.ok(keys.has(k), `${e.id} carries ${k}`)
    }
  })

  test('every relation joins two entities that exist, never an entity to itself', () => {
    const ids = new Set(live.entities.map((e) => e.id))
    for (const r of live.relations) {
      assert.ok(ids.has(r.from) && ids.has(r.to), `${r.from} -> ${r.to}`)
      assert.notEqual(r.from, r.to)
    }
    assert.ok(live.relations.length > 100)
  })

  test('says how many databases carry each identifier space, and which are ontologies by the project\'s own list', () => {
    for (const key of live.keys) {
      const carriers = new Set(live.entities.filter((e) => [...e.returns, ...e.accepts].includes(key.id)).map((e) => e.source))
      assert.equal(key.sources, carriers.size, key.id)
      assert.equal(key.ontology, obo.ONTOLOGY_KEYS.includes(key.id), key.id)
    }
    assert.ok(live.keys.find((k) => k.id === 'mondo').ontology)
    assert.ok(!live.keys.find((k) => k.id === 'uniprot').ontology, 'UniProt accessions are an identifier space, not an ontology')
  })

  test('presets name real databases, within the number the chart palette can colour', () => {
    const sources = new Set(live.sources.map((s) => s.name))
    assert.ok(PRESETS.length >= 2)
    for (const p of PRESETS) {
      assert.ok(p.sources.length <= MAX_SOURCES, p.id)
      assert.equal(new Set(p.sources).size, p.sources.length, `${p.id} has no repeats`)
      for (const s of p.sources) assert.ok(sources.has(s), `${p.id}: ${s}`)
      assert.ok(sharedKeyTable(live, p.sources).length > 0, `${p.id} shows at least one meeting point`)
    }
  })

  test('finds fields and parameters that carry a key, and joins them across databases', () => {
    const graph = buildModelGraph([
      entry('a', [entity('protein', ['uniprotAccession', 'name'])]),
      entry('b', [entity('pathways', ['id'], { params: { uniprotAccession: { in: 'path', required: true } } })]),
      entry('c', [entity('things', ['name'])])
    ])
    const [row, ...rest] = sharedKeyTable(graph, ['a', 'b', 'c'])
    assert.equal(rest.length, 0)
    assert.equal(row.key.id, 'uniprot')
    assert.deepEqual(row.databases.map((d) => [d.source, d.entities]), [['a', ['protein']], ['b', ['pathways']]])
    const protein = graph.entities.find((e) => e.id === 'a/protein')
    assert.deepEqual(protein.returns, ['uniprot'], 'a field returns it')
    assert.deepEqual(graph.entities.find((e) => e.id === 'b/pathways').accepts, ['uniprot'], 'a parameter accepts it')
  })

  test('a key carried by one database is not a meeting point', () => {
    const graph = buildModelGraph([
      entry('a', [entity('x', ['uniprotAccession']), entity('y', ['uniprotAccession'])]),
      entry('b', [entity('z', ['name'])])
    ])
    assert.deepEqual(sharedKeyTable(graph, ['a', 'b']), [])
  })

  test('drops a relation to an entity that is not in the catalog, and one that points at itself', () => {
    const graph = buildModelGraph([entry('a', [
      entity('x', ['id'], { relations: [{ entity: 'y', type: 'hasMany' }, { entity: 'ghost' }, { entity: 'x' }] }),
      entity('y', ['id'])
    ])])
    assert.deepEqual(graph.relations, [{ from: 'a/x', to: 'a/y', type: 'hasMany', key: null }])
  })
})

// ── The page ────────────────────────────────────────────────────────────────

describe('the built Model page', () => {
  let out
  let html
  before(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-model-'))
    await build({ out })
    html = fs.readFileSync(path.join(out, 'model.html'), 'utf8')
  })
  after(() => fs.rmSync(out, { recursive: true, force: true }))

  test('is a page of the site, with its script and styles', () => {
    assert.ok(fs.existsSync(path.join(out, 'graph.js')))
    assert.match(html, /<script src="graph\.js" defer><\/script>/)
    assert.match(html, /<a href="model\.html" aria-current="page">Model<\/a>/)
    assert.match(html, /class="content content-wide"/)
    assert.ok(fs.readFileSync(path.join(out, 'style.css'), 'utf8').includes('.model-stage'))
  })

  test('embeds the live graph as data, and leaves no placeholder behind', () => {
    const embedded = JSON.parse(/<script type="application\/json" id="model-data">(.*?)<\/script>/s.exec(html)[1])
    assert.deepEqual(embedded.presets.map((p) => p.id), PRESETS.map((p) => p.id))
    assert.equal(embedded.entities.length, buildModelGraph().entities.length)
    assert.ok(!html.includes('<!-- model-graph -->'))
  })

  test('carries a complete table of the first example, for a reader without JavaScript', () => {
    const rows = [...html.matchAll(/<tr><th scope="row">([^<]+)<div/g)].map((m) => m[1])
    const expected = sharedKeyTable(buildModelGraph(), PRESETS[0].sources).map((r) => r.key.prefix)
    assert.deepEqual(rows, expected)
    assert.ok(rows.length >= 5)
  })

  test('explains itself in text, with figures that come from the catalog', () => {
    const graph = buildModelGraph()
    const shared = graph.keys.filter((k) => k.sources >= 2).length
    assert.match(html, new RegExp(`Of the catalog's ${graph.keys.length} identifier spaces, ${shared} are shared by two or more of its ${graph.sources.length} databases`))
    assert.match(html, /How to read it/)
    assert.match(html, /What the picture leaves out/)
  })

  test('puts nothing a catalog could contain where it can break out of the script element', () => {
    const hostile = { a: '</script><script>alert(1)</script>', b: '<!-- x -->', c: 'a\u2028b\u2029c' }
    const text = jsonForScript(hostile)
    assert.ok(!text.includes('<') && !text.includes('\u2028') && !text.includes('\u2029'))
    assert.deepEqual(JSON.parse(text), hostile)
    const figure = modelFigure({ ...buildModelGraph(), sources: [{ name: '</script>', label: 'x', category: 'x', entities: 0 }] })
    assert.equal((figure.match(/<\/script>/g) || []).length, 1, 'only the closing tag of the data element')
  })

  test('refuses to build if the prose loses its marker, rather than publish a page with no graph', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-nomarker-'))
    try {
      fs.mkdirSync(path.join(root, 'docs'))
      for (const f of ['README.md', 'CHANGELOG.md', 'docs/sources.md', 'docs/connectors.md', 'docs/deploy.md', 'docs/dumps.md']) fs.writeFileSync(path.join(root, f), '# X\n\nbody\n')
      fs.writeFileSync(path.join(root, 'docs/model.md'), '# Model\n\nno marker here\n')
      fs.mkdirSync(path.join(root, 'examples'))
      fs.writeFileSync(path.join(root, 'examples/queries.json'), '[]')
      await assert.rejects(build({ out: path.join(root, '_site'), root }), /no <!-- model-graph --> for the force graph/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

// ── In a browser ────────────────────────────────────────────────────────────

let chromium = null
try { ({ chromium } = require('playwright')) } catch { /* optional, see the header */ }

describe('the Model page in a browser', { skip: !chromium && 'Playwright is not installed (it is optional; see scripts/record-demo.js)' }, () => {
  let out
  let browser

  before(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-model-browser-'))
    await build({ out })
    try {
      browser = await chromium.launch()
    } catch (err) {
      browser = null
      console.warn(`Chromium could not be started, so the browser tests are skipped: ${err.message.split('\n')[0]}`)
    }
  })
  after(async () => {
    if (browser) await browser.close()
    fs.rmSync(out, { recursive: true, force: true })
  })

  /** Open the page; the viewport holds the whole figure, so every point of it can be pointed at. */
  async function open (t, { scheme = 'light', width = 1280, height = 1500, reducedMotion = 'no-preference', touch = false } = {}) {
    if (!browser) { t.skip('no browser'); return null }
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion, hasTouch: touch })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error' && !/cdnjs|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()) })
    await page.goto(`file://${path.join(out, 'model.html')}`)
    await page.waitForSelector('#model-graph.is-ready')
    await page.waitForTimeout(250)
    const model = (fn, arg) => page.evaluate(`(${fn.toString()})(document.getElementById('model-graph').__model, ${JSON.stringify(arg)})`)
    const canvas = await page.locator('.model-stage canvas').boundingBox()
    const where = (id) => model((m, id) => { const n = m.nodes.find((x) => x.id === id); const [x, y] = m.toScreen(n); return { x, y } }, id)
    /** The id of an entity the current view draws (the most connected, so it is never hidden). */
    const anEntity = () => model((m) => m.nodes.filter((n) => n.type === 'entity').sort((a, b) => b.degree - a.degree)[0].id)
    return { page, context, errors, model, canvas, where, anEntity }
  }

  test('draws the first example without errors, in light and dark', async (t) => {
    for (const scheme of ['light', 'dark']) {
      const p = await open(t, { scheme })
      if (!p) return
      const { keys, entities } = await p.model((m) => ({ keys: m.nodes.filter((n) => n.type === 'key').length, entities: m.nodes.filter((n) => n.type === 'entity').length }))
      assert.ok(keys >= 8 && entities >= 15, `${scheme}: ${keys} identifier spaces, ${entities} entities`)
      // The dark palette is its own set of steps, not the light one.
      const s1 = await p.page.evaluate(() => getComputedStyle(document.querySelector('.model')).getPropertyValue('--m-s1').trim())
      assert.equal(s1, scheme === 'dark' ? '#3987e5' : '#2a78d6')
      assert.deepEqual(p.errors, [])
      await p.context.close()
    }
  })

  test('lays every example out cleanly: no pill overlaps another, and no shape sits on a pill', async (t) => {
    const p = await open(t)
    if (!p) return
    for (const preset of PRESETS) {
      await p.page.locator(`.model-preset[data-preset="${preset.id}"]`).click()
      await p.page.waitForTimeout(150)
      const problems = await p.model((m) => {
        const bad = []
        const pills = m.nodes.filter((n) => n.type === 'key')
        const dots = m.nodes.filter((n) => n.type === 'entity')
        for (let i = 0; i < pills.length; i++) {
          for (let j = i + 1; j < pills.length; j++) {
            const a = pills[i]
            const b = pills[j]
            if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) bad.push(`${a.label} overlaps ${b.label}`)
          }
          for (const d of dots) {
            const cx = Math.max(pills[i].x - pills[i].w / 2, Math.min(d.x, pills[i].x + pills[i].w / 2))
            const cy = Math.max(pills[i].y - pills[i].h / 2, Math.min(d.y, pills[i].y + pills[i].h / 2))
            if (Math.hypot(d.x - cx, d.y - cy) < d.r) bad.push(`${d.id} sits on ${pills[i].label}`)
          }
        }
        return bad
      })
      assert.deepEqual(problems, [], preset.id)
    }
    await p.context.close()
  })

  test('is deterministic: the same page lays out the same way twice', async (t) => {
    const layouts = []
    for (let i = 0; i < 2; i++) {
      const p = await open(t, { reducedMotion: 'reduce' })
      if (!p) return
      layouts.push(await p.model((m) => m.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)])))
      await p.context.close()
    }
    assert.deepEqual(layouts[0], layouts[1])
  })

  test('gives each database its own colour AND its own shape, so colour is never the only cue', async (t) => {
    const p = await open(t)
    if (!p) return
    // Fill every slot, so the whole palette and the whole set of shapes are on screen at once.
    await p.page.locator('.model-picker summary').click()
    for (const name of ['ensembl', 'hgnc', 'uniprot', 'reactome', 'chebi']) await p.page.locator(`.model-picker-item input[value="${name}"]`).check()
    const legend = await p.page.evaluate(() => [...document.querySelectorAll('.model-legend-item')].map((b) => {
      const svg = b.querySelector('svg')
      const shape = svg.firstElementChild
      return { name: b.dataset.name, fill: shape.style.fill, geometry: shape.tagName + (shape.getAttribute('points') || '') }
    }))
    assert.equal(legend.length, 8)
    assert.equal(new Set(legend.map((l) => l.fill)).size, legend.length, 'distinct colours')
    assert.equal(new Set(legend.map((l) => l.geometry)).size, legend.length, 'distinct shapes')
    await p.context.close()
  })

  test('hovering names the entity and its database; the hit area is bigger than the mark', async (t) => {
    const p = await open(t)
    if (!p) return
    const id = await p.anEntity()
    const at = await p.where(id)
    await p.page.mouse.move(p.canvas.x + at.x, p.canvas.y + at.y)
    await p.page.waitForTimeout(80)
    const tip = p.page.locator('.model-tooltip')
    assert.ok(await tip.isVisible())
    assert.ok((await tip.textContent()).includes(id.replace('/', ' / ')), 'the tooltip names the database and the entity')
    const found = await p.model((m, at) => (m.hit(at.x + 11, at.y) || {}).id, at)
    assert.equal(found, id, 'a pointer 11px from a small mark still finds it')
    await p.context.close()
  })

  test('selecting a pill shows what it joins and marks its row in the table; the background and Escape clear', async (t) => {
    const p = await open(t)
    if (!p) return
    const at = await p.where('key:mondo')
    await p.page.mouse.click(p.canvas.x + at.x, p.canvas.y + at.y)
    assert.match(await p.page.locator('.model-detail h3').textContent(), /^MONDO/)
    assert.equal(await p.page.locator('.model-table tr.is-selected').count(), 1)
    await p.page.mouse.click(p.canvas.x + 8, p.canvas.y + p.canvas.height - 8)
    assert.equal(await p.page.locator('.model-detail .model-hint').count(), 1, 'the background clears it')
    await p.page.locator('.model-legend-item').nth(1).click()
    assert.equal(await p.page.locator('.model-legend-item[aria-pressed="true"]').count(), 1)
    assert.ok(await p.page.evaluate(() => document.activeElement.classList.contains('model-legend-item')), 'focus stays on the button that was pressed')
    await p.page.keyboard.press('Escape')
    assert.equal(await p.page.locator('.model-legend-item[aria-pressed="true"]').count(), 0)
    await p.context.close()
  })

  test('dragging a node pins it where it is dropped; a double click releases it', async (t) => {
    const p = await open(t)
    if (!p) return
    const id = await p.anEntity()
    const at = await p.where(id)
    await p.page.mouse.move(p.canvas.x + at.x, p.canvas.y + at.y)
    await p.page.mouse.down()
    await p.page.mouse.move(p.canvas.x + at.x - 60, p.canvas.y + at.y + 40, { steps: 6 })
    await p.page.mouse.up()
    const pinned = await p.model((m, id) => m.nodes.find((n) => n.id === id).fx, id)
    assert.notEqual(pinned, null)
    const now = await p.where(id)
    await p.page.mouse.dblclick(p.canvas.x + now.x, p.canvas.y + now.y)
    assert.equal(await p.model((m, id) => m.nodes.find((n) => n.id === id).fx, id), null)
    await p.context.close()
  })

  test('a database keeps its colour and shape while others come and go, and at most eight are drawn', async (t) => {
    const p = await open(t)
    if (!p) return
    const slots = () => p.model((m) => [...m.slotOf])
    const before = await slots()
    await p.page.locator('.model-picker summary').click()
    const [removed, freed] = before[1]
    await p.page.locator(`.model-picker-item input[value="${removed}"]`).uncheck()
    assert.deepEqual(await slots(), before.filter(([name]) => name !== removed), 'the others were not repainted')
    await p.page.locator('.model-picker-item input[value="gtex"]').check()
    assert.equal((await p.model((m) => m.slotOf.get('gtex'))), freed, 'a new database takes the freed slot')

    for (const name of ['ensembl', 'hgnc', 'reactome', 'uniprot', 'chebi']) await p.page.locator(`.model-picker-item input[value="${name}"]`).check()
    const ninth = p.page.locator('.model-picker-item input[value="chembl"]')
    await ninth.click({ force: true })
    assert.equal(await ninth.isChecked(), false, 'a ninth is refused')
    assert.equal(await ninth.getAttribute('aria-disabled'), 'true', 'and stays focusable, so a keyboard user learns why')
    assert.match(await p.page.locator('.model-status').textContent(), /At most 8 databases/)
    assert.equal((await slots()).map(([, s]) => s).sort().join(''), '01234567')
    await p.context.close()
  })

  test('presets set their databases; declared relations appear on request', async (t) => {
    const p = await open(t)
    if (!p) return
    await p.page.locator('.model-preset[data-preset="genes"]').click()
    assert.deepEqual(await p.model((m) => [...m.slotOf.keys()]), PRESETS.find((x) => x.id === 'genes').sources)
    const count = () => p.model((m) => m.links.filter((l) => l.kind === 'relation').length)
    assert.equal(await count(), 0)
    await p.page.locator('input[name="relations"]').check()
    assert.ok((await count()) > 0)
    await p.context.close()
  })

  test('everything is reachable without a pointer: the table\'s buttons select nodes', async (t) => {
    const p = await open(t)
    if (!p) return
    await p.page.locator('.model-table summary').focus()
    await p.page.keyboard.press('Enter')
    await p.page.keyboard.press('Tab')
    await p.page.keyboard.press('Enter')
    assert.equal(await p.page.locator('.model-detail h3').count(), 1)
    const buttons = await p.page.locator('.model-table button').count()
    assert.ok(buttons >= 15, `${buttons} buttons in the table`)
    await p.context.close()
  })

  test('on a phone the layout is sized to the screen, and a touch does not trap page scrolling', async (t) => {
    const p = await open(t, { width: 390, height: 1700, touch: true })
    if (!p) return
    assert.ok(p.canvas.width <= 390)
    const touchAction = await p.page.evaluate(() => getComputedStyle(document.querySelector('.model-stage canvas')).touchAction)
    assert.ok(!/^none$/.test(touchAction), `touch-action is "${touchAction}"`)
    const spread = await p.model((m) => { const xs = m.nodes.map((n) => n.x * m.view.k + m.view.x); return Math.max(...xs) - Math.min(...xs) })
    assert.ok(spread > 200, `the graph spans ${Math.round(spread)}px of a 390px screen`)
    assert.deepEqual(p.errors, [])
    await p.context.close()
  })
})
