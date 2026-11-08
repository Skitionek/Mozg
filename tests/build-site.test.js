'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createSlugger, rewriteHref, renderMarkdown, examplesMarkdown, withoutTitle, tableOfContents, build } = require('../scripts/build-site')

const PAGES = new Map([['README.md', 'index.html'], ['docs/connectors.md', 'connectors.html']])

test('heading ids match GitHub\'s', () => {
  const slug = createSlugger()
  assert.equal(slug('Findings and fixes'), 'findings-and-fixes')
  assert.equal(slug('Other databases & APIs'), 'other-databases--apis')
  assert.equal(slug('🧬 Life-science sources'), '-life-science-sources')
  assert.equal(slug('Status'), 'status')
  assert.equal(slug('Status'), 'status-1')
})

test('headings are named by their plain text, without inline HTML', async () => {
  const { headings, html } = await renderMarkdown(
    '## `api` driver\n\n## Other databases &amp; APIs\n\n## Safe <b>bold</b> <scr<script>ipt>x</script>\n\n## `<b>` in code\n', 'README.md', PAGES)
  assert.deepEqual(headings.map((h) => [h.id, h.text]), [
    ['api-driver', 'api driver'],
    ['other-databases--apis', 'Other databases & APIs'],
    ['safe-bold-scriptx', 'Safe bold <script>x'],
    ['b-in-code', '<b> in code']
  ])
  assert.match(html, /<h2 id="b-in-code">.*<code>&lt;b&gt;<\/code> in code<\/h2>/)
  // Plain text can hold "<", so the contents column escapes it.
  const toc = tableOfContents(headings)
  assert.match(toc, /<a href="#safe-bold-scriptx">Safe bold &lt;script&gt;x<\/a>/)
  assert.doesNotMatch(toc, /<script|<b>/)
})

test('links between Markdown files become links between pages', () => {
  assert.equal(rewriteHref('docs/connectors.md', 'README.md', PAGES), 'connectors.html')
  assert.equal(rewriteHref('connectors.md#findings-and-fixes', 'docs/deploy.md', PAGES), 'connectors.html#findings-and-fixes')
  assert.equal(rewriteHref('../README.md', 'docs/deploy.md', PAGES), 'index.html')
  assert.equal(rewriteHref('media/mozg-demo.mp4', 'docs/deploy.md', PAGES), 'media/mozg-demo.mp4')
})

test('links to other repository files point at GitHub; others are kept', () => {
  assert.equal(rewriteHref('../.github/workflows/connectors.yml', 'docs/connectors.md', PAGES),
    'https://github.com/Skitionek/Mozg/blob/main/.github/workflows/connectors.yml')
  assert.equal(rewriteHref('../deploy/helm/mozg', 'docs/deploy.md', PAGES), 'https://github.com/Skitionek/Mozg/tree/main/deploy/helm/mozg')
  for (const href of ['https://example.org/a.md', '#status', 'mailto:a@example.org', '//cdn.example/x.js', '../../outside.md']) {
    assert.equal(rewriteHref(href, 'docs/deploy.md', PAGES), href)
  }
})

test('Markdown renders with ids, escaped code and scrollable tables', async () => {
  const { html, title, headings } = await renderMarkdown(
    '# Title\n\n## A `code` heading\n\n```graphql\n{ a(x: "<b>") }\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSee [deploy](docs/connectors.md#x).\n',
    'README.md', PAGES)
  assert.equal(title, 'Title')
  assert.deepEqual(headings.map((h) => h.id), ['title', 'a-code-heading'])
  assert.match(html, /<h2 id="a-code-heading">/)
  assert.match(html, /<code class="language-graphql">\{ a\(x: &quot;&lt;b&gt;&quot;\) \}/)
  assert.match(html, /<div class="table-wrap"><table>/)
  assert.match(html, /href="connectors.html#x"/)
})

test('examples are grouped by category', () => {
  const md = examplesMarkdown([
    { name: 'One', description: 'First', category: 'SQLite', query: '{ a }' },
    { name: 'Two', description: 'Second', category: 'Catalog', query: '{ b }' },
    { name: 'Three', description: 'Third', category: 'SQLite', query: '{ c }' }
  ])
  assert.match(md, /^# Examples/)
  assert.ok(md.indexOf('## SQLite') < md.indexOf('### Three'))
  assert.ok(md.indexOf('### Three') < md.indexOf('## Catalog'))
  assert.match(md, /```graphql\n\{ c \}\n```/)
})

test('the overview drops the README title and tagline the hero repeats', () => {
  assert.equal(withoutTitle('# Mozg\n\n> tagline\n\nBody'), 'Body')
  assert.equal(withoutTitle('# Mozg\n\nBody'), 'Body')
})

test('the built site: every page, and every internal link and anchor resolves', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mozg-site-'))
  try {
    const { pages } = await build({ out, commit: '0123456789abcdef' })
    for (const page of ['index.html', 'sources.html', 'model.html', 'examples.html', 'mcp.html', 'connectors.html', 'deploy.html', 'dumps.html', 'changelog.html']) {
      assert.ok(pages.includes(page), `${page} built`)
    }
    assert.ok(fs.existsSync(path.join(out, 'style.css')))
    assert.ok(fs.existsSync(path.join(out, '.nojekyll')))

    const ids = new Map()
    const html = new Map()
    for (const page of pages) {
      const text = fs.readFileSync(path.join(out, page), 'utf8')
      html.set(page, text)
      ids.set(page, new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])))
    }
    const broken = []
    for (const [page, text] of html) {
      for (const [, href] of text.matchAll(/\shref="([^"]+)"/g)) {
        if (/^(https?:|mailto:|\/\/)/.test(href)) continue
        const [file, anchor] = href.split('#')
        const target = file || page
        if (!fs.existsSync(path.join(out, target))) {
          broken.push(`${page}: ${href} (no file)`)
        } else if (anchor && ids.has(target) && !ids.get(target).has(decodeURIComponent(anchor))) {
          broken.push(`${page}: ${href} (no #${anchor})`)
        }
      }
    }
    assert.deepEqual(broken, [])
    assert.match(html.get('index.html'), /<section class="hero">/)
    assert.match(html.get('index.html'), /commit\/0123456789abcdef/)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})
