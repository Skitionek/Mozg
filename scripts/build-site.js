#!/usr/bin/env node
'use strict'

/**
 * Builds the documentation site published on GitHub Pages: the README as
 * the overview, every page under docs/, the runnable examples, the
 * changelog, the demo recording and the paper.  The site describes Mozg; it
 * does not run it (the query builder needs a Mozg server: `npm start`).
 *
 * Usage: node scripts/build-site.js [--out _site] [--paper paper/mozg.pdf]
 *
 * Links between Markdown files become links between pages; links to other
 * files in the repository point at them on GitHub.  Headings get the same
 * ids GitHub gives them, so anchors keep working.
 */

const fs = require('node:fs')
const path = require('node:path')
const { buildModelGraph, sharedKeyTable } = require('./model-graph')

const ROOT = path.join(__dirname, '..')
const REPOSITORY = `https://github.com/${process.env.GITHUB_REPOSITORY || 'Skitionek/Mozg'}`
const BRANCH = 'main'
const HIGHLIGHT = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1'

/** Site pages, in navigation order.  `src` is a Markdown file in the repository. */
const PAGES = [
  { src: 'README.md', out: 'index.html', nav: 'Overview' },
  { src: 'docs/sources.md', out: 'sources.html', nav: 'Sources' },
  { src: 'docs/model.md', out: 'model.html', nav: 'Model', graph: true },
  { examples: 'examples/queries.json', out: 'examples.html', nav: 'Examples', title: 'Examples' },
  { src: 'docs/mcp.md', out: 'mcp.html', nav: 'MCP' },
  { src: 'docs/connectors.md', out: 'connectors.html', nav: 'Connectors' },
  { src: 'docs/deploy.md', out: 'deploy.html', nav: 'Deploy' },
  { src: 'docs/dumps.md', out: 'dumps.html', nav: 'Database dumps' },
  { src: 'CHANGELOG.md', out: 'changelog.html', nav: 'Changelog' }
]

/** Where docs/model.md says the force graph goes. */
const MODEL_MARKER = '<!-- model-graph -->'

const MEDIA_DIR = 'docs/media'
const DEMO_VIDEO = 'mozg-demo.mp4'
const DEMO_WEBM = 'mozg-demo.webm'
const DEMO_POSTER = 'mozg-demo-poster.png'

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e])

/**
 * The text a reader sees in inline Markdown tokens: inline HTML tags are
 * dropped, entities in prose decoded, code spans kept as written.
 */
function plainText (tokens) {
  return tokens.map((token) => {
    if (token.type === 'html') return ''
    if (token.tokens) return plainText(token.tokens)
    if (token.type === 'text') return decodeEntities(token.text)
    return token.text || ''
  }).join('')
}

/** GitHub's heading ids, from a heading's plain text: lower case, punctuation and symbols dropped, spaces to hyphens, repeats numbered. */
function createSlugger () {
  const seen = new Map()
  return (text) => {
    const base = String(text)
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
      .replace(/ /g, '-')
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    return n ? `${base}-${n}` : base
  }
}

/**
 * Where a link in the Markdown file `from` should point on the site.
 * `pages` maps repository paths of Markdown files to page file names.
 */
function rewriteHref (href, from, pages, root = ROOT) {
  if (!href || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href
  const [target, anchor = ''] = href.split('#')
  const hash = anchor ? `#${anchor}` : ''
  if (!target) return href
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(from), target)).replace(/^\.\//, '')
  if (repoPath.startsWith('..')) return href
  if (pages.has(repoPath)) return `${pages.get(repoPath)}${hash}`
  if (repoPath === MEDIA_DIR || repoPath.startsWith(`${MEDIA_DIR}/`)) return `media/${repoPath.slice(MEDIA_DIR.length + 1)}${hash}`
  let kind = 'blob'
  try {
    if (fs.statSync(path.join(root, repoPath)).isDirectory()) kind = 'tree'
  } catch { /* a path GitHub may still know; link it as a file */ }
  return `${REPOSITORY}/${kind}/${BRANCH}/${repoPath}${hash}`
}

/** Renders one Markdown file to { html, title, headings }. */
async function renderMarkdown (markdown, from, pages) {
  const { Marked, Renderer } = await import('marked')
  const slug = createSlugger()
  const headings = []
  const marked = new Marked({
    gfm: true,
    walkTokens (token) {
      if ((token.type === 'link' || token.type === 'image') && token.href) token.href = rewriteHref(token.href, from, pages)
    },
    renderer: {
      heading ({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens)
        const text = plainText(tokens)
        const id = slug(text)
        headings.push({ depth, id, text })
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${inner}</h${depth}>\n`
      },
      code ({ text, lang }) {
        const language = (lang || '').trim().split(/\s+/)[0]
        const cls = language ? ` class="language-${escapeHtml(language)}"` : ''
        return `<pre><code${cls}>${escapeHtml(text)}</code></pre>\n`
      },
      table (token) {
        return `<div class="table-wrap">${Renderer.prototype.table.call(this, token)}</div>\n`
      }
    }
  })
  const html = marked.parse(markdown)
  const h1 = headings.find((h) => h.depth === 1)
  return { html, title: h1 ? h1.text : path.basename(from, '.md'), headings }
}

/** The examples page, from examples/queries.json, grouped by category. */
function examplesMarkdown (examples) {
  const byCategory = new Map()
  for (const example of examples) {
    if (!byCategory.has(example.category)) byCategory.set(example.category, [])
    byCategory.get(example.category).push(example)
  }
  const lines = [
    '# Examples',
    '',
    `${examples.length} queries, each checked against the Mozg schema by \`tests/examples.test.js\`.`,
    'Run Mozg (`npm start`) and paste one into the query builder at `http://localhost:4000`, or POST it to `/graphql`.',
    'The SQLite ones read `examples/sample.db`, which ships with the repository; the life-science ones reach the public APIs.',
    ''
  ]
  for (const [category, items] of byCategory) {
    lines.push(`## ${category}`, '')
    for (const example of items) {
      lines.push(`### ${example.name}`, '', example.description || '', '', '```graphql', example.query, '```', '')
    }
  }
  return lines.join('\n')
}

function tableOfContents (headings) {
  const items = headings.filter((h) => h.depth === 2 || h.depth === 3)
  if (items.length < 3) return ''
  // Collapsed on narrow screens; the page script opens it where it sits beside the text.
  return `<nav class="toc" aria-label="On this page"><details><summary class="toc-title">On this page</summary><ul>${items
    .map((h) => `<li class="toc-${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
    .join('')}</ul></details></nav>`
}

function demoSection (media) {
  if (!media.video && !media.webm) return ''
  const sources = [
    media.webm ? `<source src="media/${DEMO_WEBM}" type="video/webm">` : '',
    media.video ? `<source src="media/${DEMO_VIDEO}" type="video/mp4">` : ''
  ].join('')
  const poster = media.poster ? ` poster="media/${DEMO_POSTER}"` : ''
  return `<figure class="demo"><video controls preload="metadata" playsinline${poster}>${sources}</video>` +
    '<figcaption>Mozg\'s query builder: picking a life-science source, running a query across several databases, and following OBO-key joins.</figcaption></figure>'
}

/** JSON safe to put inside a <script> element: no "</script>", no "<!--". */
function jsonForScript (value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * The force graph's markup, data and a complete fallback table.  The table is
 * the first example's connections: what a reader without JavaScript (or whose
 * script failed) sees, and what the script replaces.
 */
function modelFigure (graph) {
  const first = graph.presets[0]
  const rows = sharedKeyTable(graph, first.sources).map(({ key, databases }) => {
    const carried = databases.map((d) => `<div class="model-cell-db"><strong>${escapeHtml(d.source)}</strong>: ${escapeHtml(d.entities.join(', '))}</div>`).join('')
    return `<tr><th scope="row">${escapeHtml(key.prefix)}<div class="model-cell-sub">${escapeHtml(key.label)}</div></th><td>${key.ontology ? 'ontology' : 'identifier space'}</td><td>${carried}</td></tr>`
  }).join('')
  const shared = graph.keys.filter((k) => k.sources >= 2).length
  return `<section class="model" id="model-graph" aria-label="Interactive graph of how databases connect through shared ontologies and identifier spaces">
  <div class="model-bar">
    <div class="model-presets" role="group" aria-label="Example models"></div>
    <details class="model-picker"><summary>Choose databases</summary><div class="model-picker-list"></div></details>
    <div class="model-options">
      <label><input type="checkbox" name="relations"> Declared relations</label>
      <label><input type="checkbox" name="unshared"> Identifier spaces used by one database</label>
    </div>
  </div>
  <p class="model-status" role="status" aria-live="polite"></p>
  <div class="model-main">
    <div class="model-stage">
      <canvas role="img" aria-label="Force-directed graph. Coloured shapes are entities of the chosen databases; pills are the ontologies and identifier spaces they share. The table below lists every connection."></canvas>
      <div class="model-tooltip" role="tooltip" hidden></div>
      <div class="model-zoom" role="group" aria-label="View">
        <button type="button" data-action="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" data-action="fit">Fit</button>
        <button type="button" data-action="reset">Reset layout</button>
      </div>
    </div>
    <aside class="model-side" aria-label="Legend and details">
      <ul class="model-legend" aria-label="Databases; press one to show only it"></ul>
      <div class="model-detail" aria-live="polite"></div>
    </aside>
  </div>
  <details class="model-table">
    <summary>Table: every connection shown</summary>
    <div class="table-wrap"><table>
      <caption class="model-cell-sub">Identifier spaces and ontologies shared by two or more of the chosen databases, and the entities that carry each.  Of the catalog's ${graph.keys.length} identifier spaces, ${shared} are shared by two or more of its ${graph.sources.length} databases.</caption>
      <thead><tr><th scope="col">Identifier space</th><th scope="col">Kind</th><th scope="col">Carried by</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </details>
  <script type="application/json" id="model-data">${jsonForScript(graph)}</script>
</section>`
}

function layout ({ page, nav, title, body, toc, hero, commit, paper, scripts = '' }) {
  const links = nav.map((p) => `<a href="${p.out}"${p.out === page.out ? ' aria-current="page"' : ''}>${escapeHtml(p.nav)}</a>`).join('')
  const paperLink = paper ? '<a href="mozg.pdf">Paper (PDF)</a>' : ''
  const source = page.src ? `${REPOSITORY}/blob/${BRANCH}/${page.src}` : `${REPOSITORY}/blob/${BRANCH}/${page.examples}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.out === 'index.html' ? 'Mozg — slow-by-design federated queries' : `${title} — Mozg`)}</title>
<meta name="description" content="Mozg: a slow-by-design GraphQL layer that queries 47 public life-science databases and your own, live, and joins them by OBO keys.">
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="${HIGHLIGHT}/styles/github.min.css" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="${HIGHLIGHT}/styles/github-dark.min.css" media="(prefers-color-scheme: dark)">
</head>
<body>
<header class="site-header">
  <a class="brand" href="index.html">Mozg</a>
  <nav class="site-nav" aria-label="Documentation">${links}${paperLink}<a href="${REPOSITORY}">GitHub</a></nav>
</header>
${hero}
<div class="page${toc ? ' has-toc' : ''}">
  ${toc}
  <main class="content${page.graph ? ' content-wide' : ''}">
${body}
  </main>
</div>
<footer class="site-footer">
  <p>Generated from <a href="${source}">${escapeHtml(page.src || page.examples)}</a>${commit ? ` at <a href="${REPOSITORY}/commit/${commit}"><code>${commit.slice(0, 7)}</code></a>` : ''}. Mozg is MIT-licensed.</p>
</footer>
<script src="${HIGHLIGHT}/highlight.min.js"></script>
<script src="${HIGHLIGHT}/languages/graphql.min.js"></script>
<script>
  if (window.hljs) { hljs.configure({ ignoreUnescapedHTML: true }); hljs.highlightAll() }
  const toc = document.querySelector('.toc details')
  if (toc && matchMedia('(min-width: 64rem)').matches) toc.open = true
</script>
${scripts}</body>
</html>
`
}

function hero (media) {
  return `<section class="hero">
  <h1>Mozg</h1>
  <p class="tagline">A <strong>slow-by-design</strong> GraphQL layer: one query reaches 47 public life-science databases and your own, live, and joins them by OBO keys.</p>
  <p class="cta"><a href="#quick-start">Get started</a><a href="sources.html">Browse the sources</a><a href="examples.html">See examples</a></p>
  ${demoSection(media)}
</section>`
}

/** Drops the README's own title and tagline, which the overview's hero repeats. */
function withoutTitle (markdown) {
  return markdown.replace(/^# [^\n]*\n+(> [^\n]*\n+)?/, '')
}

async function build ({ out = path.join(ROOT, '_site'), paper = null, root = ROOT, commit = process.env.GITHUB_SHA || '' } = {}) {
  const pageBySrc = new Map(PAGES.filter((p) => p.src).map((p) => [p.src, p.out]))
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })

  const mediaSrc = path.join(root, MEDIA_DIR)
  const media = { video: false, webm: false, poster: false }
  if (fs.existsSync(mediaSrc)) {
    fs.cpSync(mediaSrc, path.join(out, 'media'), { recursive: true })
    media.video = fs.existsSync(path.join(mediaSrc, DEMO_VIDEO))
    media.webm = fs.existsSync(path.join(mediaSrc, DEMO_WEBM))
    media.poster = fs.existsSync(path.join(mediaSrc, DEMO_POSTER))
  }
  const hasPaper = Boolean(paper && fs.existsSync(paper))
  if (hasPaper) fs.copyFileSync(paper, path.join(out, 'mozg.pdf'))
  fs.copyFileSync(path.join(__dirname, 'site', 'style.css'), path.join(out, 'style.css'))
  fs.copyFileSync(path.join(__dirname, 'site', 'graph.js'), path.join(out, 'graph.js'))
  fs.writeFileSync(path.join(out, '.nojekyll'), '')

  const written = []
  for (const page of PAGES) {
    let markdown
    if (page.examples) markdown = examplesMarkdown(JSON.parse(fs.readFileSync(path.join(root, page.examples), 'utf8')))
    else markdown = fs.readFileSync(path.join(root, page.src), 'utf8')
    const isIndex = page.out === 'index.html'
    const rendered = await renderMarkdown(isIndex ? withoutTitle(markdown) : markdown, page.src || 'docs/examples.md', pageBySrc)
    let body = rendered.html
    if (page.graph) {
      if (!body.includes(MODEL_MARKER)) throw new Error(`${page.src} has no ${MODEL_MARKER} for the force graph`)
      body = body.replace(MODEL_MARKER, modelFigure(buildModelGraph()))
    }
    const html = layout({
      page,
      nav: PAGES,
      title: page.title || rendered.title,
      body,
      scripts: page.graph ? '<script src="graph.js" defer></script>\n' : '',
      toc: tableOfContents(rendered.headings),
      hero: isIndex ? hero(media) : '',
      commit,
      paper: hasPaper
    })
    fs.writeFileSync(path.join(out, page.out), html)
    written.push(page.out)
  }
  return { out, pages: written, media, paper: hasPaper }
}

module.exports = { PAGES, modelFigure, jsonForScript, createSlugger, rewriteHref, renderMarkdown, examplesMarkdown, withoutTitle, build, tableOfContents }

if (require.main === module) {
  const argv = process.argv.slice(2)
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  build({ out: path.resolve(arg('--out') || '_site'), paper: arg('--paper') ? path.resolve(arg('--paper')) : null })
    .then(({ out, pages, media, paper }) => {
      console.log(`Built ${pages.length} pages into ${path.relative(process.cwd(), out) || '.'}: ${pages.join(', ')}`)
      console.log(`Demo video: ${media.video || media.webm ? 'yes' : 'no'}; paper: ${paper ? 'yes' : 'no'}`)
    }, (err) => {
      console.error(err)
      process.exitCode = 1
    })
}
