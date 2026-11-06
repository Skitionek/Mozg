#!/usr/bin/env node
'use strict'

/* global document, window */

/**
 * Record the demo video of the query builder (docs/media/mozg-demo.*).
 *
 * Drives the web UI with Playwright against the live public APIs, with a
 * caption bar naming each step and a visible cursor:
 *
 *   1. UniProt / protein from the catalog, its example where (P04637), a few
 *      typed fields and three includes (PDBe structures, AlphaFold, Reactome
 *      pathways); run, then the JSON, Table and Graph views of the result;
 *   2. an include joined only by a shared OBO key (Ensembl gene id → Open
 *      Targets diseases);
 *   3. a plain REST API from the catalog: JSONPlaceholder posts with their
 *      comments and authors;
 *   4. GraphiQL, asking the catalog query which sources exist.
 *
 * then encodes Playwright's capture (blank lead-in trimmed) as:
 *
 *   docs/media/mozg-demo.webm         VP9, CRF 40
 *   docs/media/mozg-demo.mp4          H.264, CRF 28, +faststart
 *   docs/media/mozg-demo-poster.png   a frame of the step 1 graph view
 *
 * Requirements — deliberately NOT dependencies of this package:
 *   - Playwright with Chromium, installed globally and resolvable by require(),
 *     e.g. `npm install -g playwright && npx playwright install chromium`,
 *     with NODE_PATH pointing at the global node_modules if needed;
 *   - ffmpeg (with libx264 and libvpx-vp9) on PATH;
 *   - network access to the public APIs the storyline queries (UniProt, PDBe,
 *     AlphaFold DB, Reactome, Open Targets, JSONPlaceholder) and to unpkg.com,
 *     which serves GraphiQL's assets.
 *
 * Usage:
 *   node scripts/record-demo.js
 *
 * Uses the Mozg server at MOZG_URL (default http://localhost:4123) when one
 * answers /healthz there; otherwise starts `node src/index.js` on that port for
 * the duration of the recording.  Every step waits for real results and fails
 * loudly on an error banner, so a failed upstream API cannot slip into the video.
 */

const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'docs', 'media')
const BASE = (process.env.MOZG_URL || 'http://localhost:4123').replace(/\/$/, '')
const SIZE = { width: 1280, height: 720 }
const QUERY_TIMEOUT_MS = 90_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── Server ──────────────────────────────────────────────────────────────────

async function healthy () {
  try {
    const res = await fetch(`${BASE}/healthz`)
    return res.ok
  } catch {
    return false
  }
}

/** Use a running server, or start one; returns a function that stops ours. */
async function ensureServer () {
  if (await healthy()) return () => {}
  const port = new URL(BASE).port || '80'
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
    env: { ...process.env, PORT: port },
    stdio: 'ignore'
  })
  for (let i = 0; i < 60; i++) {
    if (await healthy()) return () => child.kill('SIGTERM')
    await sleep(500)
  }
  child.kill('SIGKILL')
  throw new Error(`Mozg did not answer ${BASE}/healthz`)
}

// ── In-page overlay: caption bar, cursor, click ripple ─────────────────────
// Installed into every document (the builder and GraphiQL) before it loads.
// The caption is a subtitle bar across the bottom of the frame; each page is
// fitted into the space above it (FRAME_CSS) so the bar hides none of it.

const CAPTION_BAR_PX = 64

// The builder's app shell is `min-height: 100vh`, so at 720 px its sidebar
// would push the result panel below the fold; pinned to the frame, the sidebar
// scrolls on its own, as it does on a taller screen.  Its toast is lifted clear
// of the bar.  GraphiQL's "Loading …" placeholder is hidden until it renders.
const FRAME_CSS = {
  builder: `
    body { height: calc(100vh - ${CAPTION_BAR_PX}px); min-height: 0; }
    #toast { bottom: calc(${CAPTION_BAR_PX}px + 1.5rem); }`,
  graphiql: `
    html, body, #root { height: calc(100vh - ${CAPTION_BAR_PX}px) !important; min-height: 0 !important; }
    #root:not(:has(.graphiql-container)) { visibility: hidden; }`
}

function installOverlay ({ barPx, frameCss }) {
  if (window.top !== window || window.__demo) return
  const api = {}
  window.__demo = api

  // The caption survives navigation, so it shows while the next page loads.
  let current = null
  try {
    current = JSON.parse(window.sessionStorage.getItem('demo-caption') || 'null')
  } catch { /* no storage: start without a caption */ }

  const mount = () => {
    const style = document.createElement('style')
    style.textContent = `
      ${window.location.pathname.startsWith('/graphql') ? frameCss.graphiql : frameCss.builder}
      #demo-caption {
        position: fixed; left: 0; right: 0; bottom: 0; height: ${barPx}px;
        z-index: 2147483646; display: flex; align-items: center; justify-content: center; gap: 14px;
        padding: 0 24px; background: #07080d; color: #f1f5f9;
        border-top: 1px solid rgba(124, 116, 255, .55);
        font: 500 18px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
        pointer-events: none;
      }
      #demo-caption > * { transition: opacity .25s ease; }
      #demo-caption.off > * { opacity: 0; }
      #demo-caption b {
        color: #b9b4ff; font-size: 12.5px; font-weight: 700; white-space: nowrap;
        letter-spacing: .08em; text-transform: uppercase;
        padding: 3px 10px; border-radius: 999px;
        background: rgba(108, 99, 255, .18); border: 1px solid rgba(124, 116, 255, .6);
      }
      #demo-cursor {
        position: fixed; left: 0; top: 0; z-index: 2147483647;
        width: 26px; height: 26px; pointer-events: none; display: none;
        filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .55));
      }
      .demo-ripple {
        position: fixed; z-index: 2147483645; width: 44px; height: 44px;
        margin: -22px 0 0 -22px; border-radius: 50%; pointer-events: none;
        border: 3px solid rgba(255, 101, 132, .95); background: rgba(255, 101, 132, .25);
        animation: demo-ripple .55s ease-out forwards;
      }
      @keyframes demo-ripple {
        from { transform: scale(.3); opacity: 1; }
        to   { transform: scale(1.35); opacity: 0; }
      }`
    document.head.appendChild(style)

    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    caption.className = 'off'
    caption.innerHTML = '<b></b><span></span>'
    document.body.appendChild(caption)

    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2 L4 21 L9 16.4 L12.4 23.6 L15.6 22.2 L12.2 15.1 L19 15.1 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.body.appendChild(cursor)

    const ripple = (x, y) => {
      const r = document.createElement('div')
      r.className = 'demo-ripple'
      r.style.left = `${x}px`
      r.style.top = `${y}px`
      document.body.appendChild(r)
      setTimeout(() => r.remove(), 700)
    }
    window.addEventListener('mousemove', (e) => {
      cursor.style.display = 'block'
      cursor.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`
    }, true)
    window.addEventListener('mousedown', (e) => ripple(e.clientX, e.clientY), true)

    api.ripple = ripple
    api.render = () => {
      const [step, text] = current || ['', '']
      caption.querySelector('b').textContent = step
      caption.querySelector('span').textContent = text
      caption.classList.toggle('off', !text)
    }
    api.render()
  }

  api.caption = (step, text) => {
    current = [step, text]
    try {
      window.sessionStorage.setItem('demo-caption', JSON.stringify(current))
    } catch { /* no storage: the caption just won't carry over */ }
    if (api.render) api.render()
  }

  // Mount as soon as <body> exists, before slow scripts hold up DOMContentLoaded.
  if (document.body) {
    mount()
  } else {
    const observer = new window.MutationObserver(() => {
      if (!document.body) return
      observer.disconnect()
      mount()
    })
    observer.observe(document, { childList: true, subtree: true })
  }
}

// ── Driving helpers ─────────────────────────────────────────────────────────

class Demo {
  constructor (page, startedAt) {
    this.page = page
    this.startedAt = startedAt
    this.mouse = { x: SIZE.width / 2, y: SIZE.height / 2 }
    this.marks = {}
  }

  /** Seconds since the video started. */
  mark (name) {
    this.marks[name] = (Date.now() - this.startedAt) / 1000
  }

  async caption (step, text, holdMs = 0) {
    await this.page.evaluate(([s, t]) => window.__demo.caption(s, t), [step, text])
    if (holdMs) await sleep(holdMs)
  }

  async moveTo (x, y) {
    const from = { ...this.mouse }
    const distance = Math.hypot(x - from.x, y - from.y)
    const steps = Math.max(6, Math.min(22, Math.round(distance / 22)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      await this.page.mouse.move(from.x + (x - from.x) * ease, from.y + (y - from.y) * ease)
      await sleep(10)
    }
    this.mouse = { x, y }
  }

  /** Scroll an element into the comfortable part of the viewport, smoothly. */
  async reveal (locator) {
    await locator.waitFor({ state: 'visible', timeout: 15_000 })
    const scrolled = await locator.evaluate((el, viewport) => {
      const r = el.getBoundingClientRect()
      let inView = r.top >= 70 && r.bottom <= viewport.height - 90
      // Also inside every scrolling ancestor (the include list scrolls on its own).
      for (let p = el.parentElement; inView && p; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(window.getComputedStyle(p).overflowY)) {
          const box = p.getBoundingClientRect()
          inView = r.top >= box.top && r.bottom <= box.bottom
        }
      }
      if (inView) return false
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }, SIZE)
    if (scrolled) await sleep(700)
  }

  async point (locator, { dx = 0.5 } = {}) {
    await this.reveal(locator)
    const box = await locator.boundingBox()
    if (!box) throw new Error(`Not visible: ${locator}`)
    await this.moveTo(box.x + box.width * dx, box.y + box.height / 2)
  }

  async click (selector, pauseMs = 500) {
    const locator = this.page.locator(selector).first()
    await this.point(locator)
    await sleep(120)
    await this.page.mouse.down()
    await this.page.mouse.up()
    await sleep(pauseMs)
  }

  /** Type into a field one key at a time, replacing what it holds ('' clears it). */
  async type (selector, text, { delay = 60 } = {}) {
    await this.click(selector, 200)
    await this.page.keyboard.press('Control+A')
    await this.page.keyboard.press('Backspace')
    if (text) await this.page.locator(selector).first().pressSequentially(text, { delay })
    await sleep(350)
  }

  /**
   * Choose an option of a <select>.  Headless Chromium draws no popup for a
   * native select, so the list is shown in place (as a list box) long enough
   * to see the choice being made.
   */
  async choose (selector, value) {
    const select = this.page.locator(selector).first()
    await this.point(select, { dx: 0.35 })
    await this.page.evaluate(({ x, y }) => window.__demo.ripple(x, y), this.mouse)
    await sleep(250)
    await select.evaluate((el) => { el.size = 9 })
    await sleep(350)
    // Scroll the chosen option to the middle of the list box, then highlight it.
    await select.evaluate((el, v) => {
      const option = [...el.options].find((o) => o.value === v)
      const r = option.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      el.scrollTo({ top: el.scrollTop + (r.top - box.top) - el.clientHeight / 2 + r.height / 2, behavior: 'smooth' })
    }, value)
    await sleep(550)
    await select.evaluate((el, v) => { el.focus(); el.value = v }, value)
    const box = await select.evaluate((el) => {
      const r = el.options[el.selectedIndex].getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    if (box.height > 0) {
      await this.moveTo(box.x + Math.min(box.width / 2, 110), box.y + box.height / 2)
      await this.page.evaluate(({ x, y }) => window.__demo.ripple(x, y), this.mouse)
    }
    await sleep(650)
    await select.evaluate((el) => { el.removeAttribute('size') })
    await select.selectOption(value)
    await sleep(400)
  }

  /** Smoothly scroll a scroll container by dy (and dx) pixels. */
  async scroll (selector, dy, waitMs = 900, dx = 0) {
    await this.page.locator(selector).first().evaluate((el, [top, left]) => el.scrollBy({ top, left, behavior: 'smooth' }), [dy, dx])
    await sleep(waitMs)
  }

  /** Scroll the JSON result so the nth occurrence of a key sits near the top. */
  async revealKey (key, nth = 0, waitMs = 1200) {
    const found = await this.page.evaluate(([k, n]) => {
      // The output is preformatted text, one JSON line per line: find the line.
      const out = document.getElementById('result-output')
      const text = out.textContent
      let at = -1
      for (let i = 0; i <= n; i++) {
        at = text.indexOf(`"${k}":`, at + 1)
        if (at < 0) return false
      }
      const line = text.slice(0, at).split('\n').length - 1
      const style = window.getComputedStyle(out)
      const top = parseFloat(style.paddingTop) + line * parseFloat(style.lineHeight)
      out.scrollTo({ top: Math.max(0, top - out.clientHeight * 0.18), behavior: 'smooth' })
      return true
    }, [key, nth])
    if (!found) throw new Error(`No "${key}" #${nth} in the JSON result`)
    await sleep(waitMs)
  }

  async scrollTo (selector, top, waitMs = 700) {
    await this.page.locator(selector).first().evaluate((el, to) => el.scrollTo({ top: to, behavior: 'smooth' }), top)
    await sleep(waitMs)
  }

  /** Click ▶ Run Query and wait for a successful GraphQL result. */
  async runQuery () {
    await this.page.evaluate(() => { document.getElementById('timing').textContent = '' })
    await this.click('#run-query-btn', 0)
    await this.page.waitForFunction(() =>
      document.getElementById('run-spinner').classList.contains('hidden') &&
      document.getElementById('timing').textContent !== '', null, { timeout: QUERY_TIMEOUT_MS })
    const result = await this.page.evaluate('lastResult')
    if (!result || result.errors || !result.data || !result.data.query) {
      throw new Error(`Query failed: ${JSON.stringify(result && result.errors).slice(0, 500)}`)
    }
    const { count, data } = result.data.query
    if (!count || !Array.isArray(data) || data.length === 0) throw new Error('Query returned no rows')
    // A new result starts at its top, whatever the previous one was scrolled to.
    await this.page.evaluate(() => {
      for (const id of ['result-output', 'result-graph', 'result-table-wrap']) {
        document.getElementById(id).scrollTo({ top: 0, left: 0 })
      }
    })
    return data
  }

  /** Point at something without clicking it, e.g. a link that opens a new tab. */
  async gesture (selector, pauseMs = 400) {
    await this.point(this.page.locator(selector).first())
    await this.page.evaluate(({ x, y }) => window.__demo.ripple(x, y), this.mouse)
    await sleep(pauseMs)
  }
}

/** Fail on any nested `error` a relation reports instead of rows. */
function assertNoNestedErrors (rows, label) {
  const text = JSON.stringify(rows)
  if (/"error"\s*:/.test(text)) throw new Error(`${label}: a relation returned an error — ${text.slice(0, 400)}`)
}

// ── Storyline ───────────────────────────────────────────────────────────────

async function storyline (demo) {
  const { page } = demo

  // Intro ─────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/`)
  await page.waitForSelector('#catalog-select option[value="uniprot"]', { state: 'attached', timeout: 30_000 })
  await page.mouse.move(demo.mouse.x, demo.mouse.y)
  demo.mark('start')
  await demo.caption('Mozg', 'One GraphQL endpoint over 47 public life-science databases — and any other API or database', 3000)

  // 1 · UniProt with includes ─────────────────────────────────────────────
  await demo.caption('1 · Catalog source', 'Pick a known source — UniProt — and its protein entity. No connection details needed.')
  await demo.choose('#catalog-select', 'uniprot')
  await demo.choose('#catalog-entity-select', 'protein')
  await demo.click('button[onclick="applyCatalog()"]', 700)
  await page.waitForSelector('#include-list input[data-alias="structures"]')
  await demo.caption('1 · Catalog source', 'The entity’s example fills the where clause: P04637, human p53', 1400)
  await demo.point(page.locator('#q-where'))
  await sleep(1100)
  await demo.caption('1 · Catalog source', 'Choose a few fields — the GraphQL query on the right is written as you type')
  await demo.type('#q-select', 'uniprotAccession, symbol, name, length, ensemblGeneId', { delay: 40 })

  await demo.caption('1 · Includes', 'Tick includes: PDBe structures, the AlphaFold model, Reactome pathways — three more databases')
  await demo.scrollTo('aside', 0)
  for (const alias of ['structures', 'alphafold', 'pathways']) {
    await demo.click(`#include-list input[data-alias="${alias}"]`, 450)
  }
  await sleep(600)

  await demo.caption('1 · Run', '▶ Run Query: one GraphQL request, answered from four databases')
  const proteins = await demo.runQuery()
  assertNoNestedErrors(proteins, 'uniprot/protein')
  await sleep(1300)
  await demo.caption('1 · Result', 'p53 from UniProt, with its PDBe structures, AlphaFold model and Reactome pathways nested inside')
  await demo.revealKey('structures', 0, 1500)
  await demo.revealKey('pathways', 0, 1500)

  await demo.caption('1 · Table', 'Table view: one row per protein, related data in its columns')
  await demo.click('#view-table-btn', 2200)

  await demo.caption('1 · Graph', 'Graph view: p53 and the structures, AlphaFold model and pathways joined to it')
  await demo.click('#view-graph-btn', 1000)
  demo.mark('poster')
  await sleep(2400)

  // 2 · Join by OBO key ───────────────────────────────────────────────────
  await demo.click('#view-json-btn', 300)
  await demo.caption('2 · OBO links', 'Beyond declared relations: any source that takes the same OBO-keyed identifier is offered too')
  for (const alias of ['structures', 'alphafold', 'pathways']) {
    await demo.click(`#include-list input[data-alias="${alias}"]`, 250)
  }
  const link = page.locator('#include-list input[data-alias="opentargets/targetDiseases"]')
  await link.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await sleep(800)
  await demo.caption('2 · OBO links', 'p53’s Ensembl gene id (OBO key “ensembl”) leads straight into Open Targets')
  await demo.click('#include-list input[data-alias="opentargets/targetDiseases"]', 1000)

  const diseases = await demo.runQuery()
  assertNoNestedErrors(diseases, 'opentargets/targetDiseases')
  if (!diseases[0]['opentargets/targetDiseases'] || diseases[0]['opentargets/targetDiseases'].length === 0) {
    throw new Error('The OBO link returned no diseases')
  }
  await demo.caption('2 · OBO links', 'Diseases associated with TP53, fetched from Open Targets by the shared Ensembl id', 900)
  await demo.revealKey('diseaseName', 0, 2000)
  await demo.revealKey('diseaseName', 2, 1500)

  // 3 · A plain REST API ──────────────────────────────────────────────────
  await demo.caption('3 · Any REST API', 'Not only life science: JSONPlaceholder’s posts, from the same catalog')
  await demo.choose('#catalog-select', 'jsonplaceholder')
  await demo.choose('#catalog-entity-select', '/posts')
  await demo.click('button[onclick="applyCatalog()"]', 700)
  await demo.caption('3 · Any REST API', 'A REST connection with its relations to comments and users; clear the where, take 5 posts')
  await demo.type('#q-where', '')
  await demo.type('#q-limit', '5', { delay: 120 })
  await sleep(300)

  const posts = await demo.runQuery()
  assertNoNestedErrors(posts, 'jsonplaceholder/posts')
  if (!posts.every((p) => Array.isArray(p.comments) && p.comments.length > 0)) throw new Error('Posts came back without comments')
  await demo.caption('3 · Any REST API', 'Each post with its comments and author, joined across REST endpoints', 1800)
  await demo.click('#view-table-btn', 2000)
  await demo.click('#view-graph-btn', 1400)
  await demo.scroll('#result-graph', 0, 1600, 480)

  // 4 · GraphiQL ──────────────────────────────────────────────────────────
  await demo.caption('4 · GraphiQL', 'It is all plain GraphQL — GraphiQL is at /graphql')
  await demo.gesture('header nav a[href="/graphql"]', 500)
  await page.goto(`${BASE}/graphql`)
  await page.waitForSelector('.graphiql-query-editor .monaco-editor', { timeout: 45_000 })
  await page.mouse.move(demo.mouse.x, demo.mouse.y)
  await demo.caption('4 · GraphiQL', 'Ask the catalog itself which sources it knows')
  await sleep(400)
  await demo.click('.graphiql-query-editor .view-lines', 200)
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.type('{ catalog(category: "Proteins & structures") { name label entities { name } } }', { delay: 35 })
  await page.keyboard.press('Escape')
  await sleep(400)
  await demo.click('button[aria-label^="Prettify"]', 700)
  await demo.click('button.graphiql-execute-button', 0)
  await page.waitForFunction(() => {
    const el = document.querySelector('.graphiql-response')
    return el && /"uniprot"/.test(el.textContent)
  }, null, { timeout: QUERY_TIMEOUT_MS })
  await demo.caption('4 · GraphiQL', 'Mozg — github.com/Skitionek/Mozg', 3200)
  demo.mark('end')
}

// ── Encoding ────────────────────────────────────────────────────────────────

function ffmpeg (args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
}

function encode (raw, marks) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const webm = path.join(OUT_DIR, 'mozg-demo.webm')
  const mp4 = path.join(OUT_DIR, 'mozg-demo.mp4')
  const poster = path.join(OUT_DIR, 'mozg-demo-poster.png')
  // Drop the blank lead-in before the first paint; keep a short tail.
  const start = Math.max(0, marks.start - 0.2).toFixed(2)
  const length = (marks.end - marks.start + 0.6).toFixed(2)

  ffmpeg(['-ss', start, '-i', raw, '-t', length, '-an',
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', webm])
  ffmpeg(['-ss', start, '-i', raw, '-t', length, '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4])
  ffmpeg(['-ss', (marks.poster - marks.start + 0.2).toFixed(2), '-i', mp4, '-frames:v', '1', poster])
  return { webm, mp4, poster }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main () {
  const { chromium } = require('playwright')
  const stopServer = await ensureServer()
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-demo-'))
  const browser = await chromium.launch()
  let raw
  let demo
  try {
    const context = await browser.newContext({
      viewport: SIZE,
      deviceScaleFactor: 1,
      recordVideo: { dir: videoDir, size: SIZE }
    })
    await context.addInitScript(installOverlay, { barPx: CAPTION_BAR_PX, frameCss: FRAME_CSS })
    const startedAt = Date.now()
    const page = await context.newPage()
    page.on('pageerror', (err) => console.warn(`page error: ${err.message}`))
    demo = new Demo(page, startedAt)
    try {
      await storyline(demo)
    } catch (err) {
      const shot = path.join(videoDir, 'failure.png')
      await page.screenshot({ path: shot }).then(() => console.error(`screenshot of the failure: ${shot}`), () => {})
      throw err
    } finally {
      await context.close()
      raw = await page.video().path()
    }
  } finally {
    await browser.close()
    stopServer()
  }

  const files = encode(raw, demo.marks)
  for (const file of Object.values(files)) {
    console.log(`${path.relative(ROOT, file)}  ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`)
  }
  console.log(`duration ≈ ${(demo.marks.end - demo.marks.start).toFixed(1)} s (raw capture: ${raw})`)
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
