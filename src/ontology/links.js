'use strict'

/**
 * Linking database values to ontology terms.
 *
 * A query can say `link: [{ field: "diseaseId", ontology: "mondo" }]`: once its
 * rows are in, each row's value of that field is looked up in the ontology and
 * the term it names is written beside it.  A value may be an identifier
 * (`MONDO:0005015`, `MONDO_0005015`, a bare `0005015` given the ontology's
 * prefix, or the term's IRI), a label ("diabetes mellitus"), a synonym, or a
 * cross-reference (`MESH:D003920`); `match` chooses which, and in what order.
 *
 * Where ontologies come from:
 *   - Named: the operator lists them in MOZG_ONTOLOGIES (Helm
 *     `mozg.ontologies`), a JSON array of
 *       { "name": "mondo", "url": "https://purl.obolibrary.org/obo/mondo.obo",
 *         "format": "obo", "label": "Mondo Disease Ontology", "obo": "mondo",
 *         "maxBytes": 268435456, "timeoutMs": 120000 }
 *     and a query names one.  An ontology loads on first use, once, and is
 *     kept (MOZG_ONTOLOGY_CACHE_MAX, refreshed after MOZG_ONTOLOGY_TTL_MS).
 *   - Inline: a query gives `url` or `content`.  The same screening as
 *     `ingestOntology` applies (no private addresses, 10 MB, 10 s), and the
 *     result is cached by content.
 *
 * There is no way for a caller to register or replace a *named* ontology: with
 * no authentication in front of Mozg, that would let anyone rewrite what
 * everyone else's links resolve to.
 */

const crypto = require('node:crypto')
const { LruCache } = require('../cache')
const { intOption, OPTIONS } = require('../config')
const { secureFetch, MAX_RESPONSE_SIZE } = require('./url-validator')
const { TermIndex, termsFromQuads, termsFromObo } = require('./terms')
const { parseTurtle } = require('./formats/turtle')
const { parseRdfXml } = require('./formats/rdfxml')
const { parseOwlXml } = require('./formats/owlxml')
const { iriFromId } = require('./terms')
const obo = require('../database/obo')

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_LINKS_PER_QUERY = 5
const MATCHES = ['id', 'label', 'synonym', 'xref']

// Term indexes, by what they were loaded from.  Bounded: a caller can vary
// the content or URL of an inline ontology.
const indexes = new LruCache({
  max: intOption('MOZG_ONTOLOGY_CACHE_MAX', OPTIONS.MOZG_ONTOLOGY_CACHE_MAX) || OPTIONS.MOZG_ONTOLOGY_CACHE_MAX,
  ttlMs: intOption('MOZG_ONTOLOGY_TTL_MS', DEFAULT_TTL_MS)
})
// Loads in progress, so concurrent first uses read the ontology once.
const loading = new Map()
// What happened the last time a named ontology tried to load.
const lastError = new Map()

/** The operator's ontologies, parsed fresh so a changed environment is honoured. */
function configuredOntologies (env = process.env) {
  const raw = env.MOZG_ONTOLOGIES
  if (!raw || !String(raw).trim()) return []
  let list
  try {
    list = JSON.parse(raw)
  } catch (err) {
    throw new Error(`MOZG_ONTOLOGIES is not valid JSON: ${err.message}`, { cause: err })
  }
  if (!Array.isArray(list)) throw new Error('MOZG_ONTOLOGIES must be a JSON array of ontologies')
  return list.map((entry, i) => {
    if (!entry || typeof entry.name !== 'string' || !entry.name) throw new Error(`MOZG_ONTOLOGIES[${i}] needs a name`)
    if (!entry.url) throw new Error(`MOZG_ONTOLOGIES[${i}] (${entry.name}) needs a url`)
    return entry
  })
}

function configuredOntology (name) {
  const entry = configuredOntologies().find((o) => o.name === name)
  if (!entry) {
    const known = configuredOntologies().map((o) => o.name)
    throw new Error(`Unknown ontology "${name}". ${known.length ? `Configured: ${known.join(', ')}.` : 'None is configured (MOZG_ONTOLOGIES).'} Or pass url or content.`)
  }
  return entry
}

function detectTermFormat (content, hint) {
  if (hint && hint !== 'auto') return hint
  const head = content.trimStart().slice(0, 2000)
  if (/^(format-version:|\[Term\]|ontology:|data-version:)/m.test(head)) return 'obo'
  if (/^<\?xml|^<rdf:RDF|^<Ontology/.test(head)) return head.includes('<rdf:RDF') ? 'rdfxml' : 'owlxml'
  return 'turtle'
}

/** Parse ontology text into a TermIndex. */
async function indexFromContent (content, format) {
  const kind = detectTermFormat(content, format)
  let terms
  if (kind === 'obo') terms = termsFromObo(content)
  else if (kind === 'turtle') terms = termsFromQuads(await parseTurtle(content))
  else if (kind === 'rdfxml') terms = termsFromQuads(await parseRdfXml(content))
  else if (kind === 'owlxml') {
    // OWL/XML is read for its class structure only: labels and ids, no synonyms.
    terms = parseOwlXml(content).classes.map((c) => ({
      iri: c.iri, id: null, label: c.label || null, synonyms: [], definition: null, xrefs: [], parents: [], deprecated: false, altIds: []
    }))
  } else {
    throw new Error(`Cannot read terms from the ${kind} format: use turtle, rdfxml, owlxml or obo`)
  }
  if (!terms.length) throw new Error('The ontology has no terms (classes) to link to')
  return new TermIndex(terms)
}

/** Load once, sharing the work among concurrent callers, caching on success only. */
async function cachedIndex (key, load, name) {
  const hit = indexes.get(key)
  if (hit) return hit
  if (!loading.has(key)) {
    loading.set(key, load().then(
      (index) => { indexes.set(key, index); lastError.delete(name || key); return index },
      (err) => { if (name) lastError.set(name, err.message); throw err }
    ).finally(() => loading.delete(key)))
  }
  return loading.get(key)
}

/**
 * The term index a link or a search refers to.
 * @param {{ ontology?: string, url?: string, content?: string, format?: string }} source
 * @returns {Promise<{ index: TermIndex, name: string, prefix: string|null }>}
 */
async function getTermIndex ({ ontology, url, content, format }) {
  if (ontology) {
    const entry = configuredOntology(ontology)
    const index = await cachedIndex(`named:${entry.name}:${entry.url}`, async () => {
      const { text } = await secureFetch(entry.url, {
        maxSize: entry.maxBytes || 256 * 1024 * 1024,
        timeout: entry.timeoutMs || 120_000
      })
      return indexFromContent(text, entry.format || format)
    }, entry.name)
    return { index, name: entry.name, prefix: entry.obo ? (obo.KEYS[entry.obo] ? obo.KEYS[entry.obo].prefix : entry.obo.toUpperCase()) : null }
  }
  if (content) {
    const key = `content:${crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)}:${format || 'auto'}`
    return { index: await cachedIndex(key, () => indexFromContent(content, format)), name: 'inline', prefix: null }
  }
  if (url) {
    const index = await cachedIndex(`url:${format || 'auto'}:${url}`, async () => {
      const { text } = await secureFetch(url, { maxSize: MAX_RESPONSE_SIZE })
      return indexFromContent(text, format)
    })
    return { index, name: 'inline', prefix: null }
  }
  throw new Error('A link needs an ontology: the name of a configured one, or a url, or content')
}

// ── Applying links ──────────────────────────────────────────────────────────

/** The shape a resolved term takes in a result row. */
function present (found, name, details) {
  const { term, matchedBy, ambiguous } = found
  const out = { iri: term.iri, id: term.id, label: term.label, matchedBy, ontology: name }
  if (ambiguous > 1) out.ambiguous = ambiguous
  if (term.deprecated) out.deprecated = true
  if (details) Object.assign(out, { definition: term.definition, synonyms: term.synonyms, xrefs: term.xrefs, parents: term.parents })
  return out
}

/** Call `visit(parent, key)` for every place `path` ends at, looking through arrays. */
function eachLeaf (value, path, visit) {
  const [head, ...rest] = path
  if (Array.isArray(value)) {
    for (const item of value) eachLeaf(item, path, visit)
    return
  }
  if (value == null || typeof value !== 'object') return
  if (rest.length === 0) visit(value, head)
  else eachLeaf(value[head], rest, visit)
}

function validateSpec (spec) {
  if (!spec || typeof spec.field !== 'string' || !spec.field) throw new Error('A link needs a field')
  for (const how of spec.match || []) {
    if (!MATCHES.includes(how)) throw new Error(`link.match "${how}" is not one of: ${MATCHES.join(', ')}`)
  }
}

/**
 * Write the ontology term each row's `field` names beside it, as `<field>Term`
 * (or `as`): the term, or null when the value names none.  A field holding a
 * list gets a list; `a.b` follows relation rows and lists.
 *
 * @param {object[]} rows  mutated in place
 * @param {object[]} specs  OntologyLinkInput documents
 */
async function applyLinks (rows, specs) {
  if (!specs || !specs.length || !rows.length) return
  if (specs.length > MAX_LINKS_PER_QUERY) throw new Error(`A query takes at most ${MAX_LINKS_PER_QUERY} links, not ${specs.length}`)

  for (const spec of specs) {
    validateSpec(spec)
    const { index, name, prefix } = await getTermIndex(spec)
    const options = { match: spec.match && spec.match.length ? spec.match : MATCHES, prefix: spec.obo ? (obo.KEYS[spec.obo] ? obo.KEYS[spec.obo].prefix : spec.obo.toUpperCase()) : prefix }
    const resolve = (value) => {
      const found = index.lookup(value, options)
      return found ? present(found, name, spec.details) : null
    }
    const path = spec.field.split('.')
    const leaf = path[path.length - 1]
    const target = spec.as || `${leaf}Term`

    // A field no row has is a typo, and linking it would quietly give every
    // row a null.  (Only for a plain field: a path through related rows may
    // legitimately find nothing to follow.)
    if (path.length === 1 && !rows.some((row) => Object.hasOwn(row, leaf))) {
      throw new Error(`Cannot link "${spec.field}": the rows have no such field. Fields: ${Object.keys(rows[0]).join(', ')}`)
    }

    for (const row of rows) {
      eachLeaf(row, path, (parent, key) => {
        const value = parent[key]
        parent[target] = Array.isArray(value) ? value.map(resolve) : resolve(value)
      })
    }
  }
}

// ── What is available ───────────────────────────────────────────────────────

/** The configured ontologies and whether each has loaded. */
function listOntologies () {
  return configuredOntologies().map((entry) => {
    const loaded = indexes.peek(`named:${entry.name}:${entry.url}`)
    return {
      name: entry.name,
      label: entry.label || null,
      url: entry.url,
      format: entry.format || null,
      obo: entry.obo || null,
      loaded: Boolean(loaded),
      termCount: loaded ? loaded.size : null,
      error: lastError.get(entry.name) || null
    }
  })
}

/** Terms matching a search text, in the shape callers read. */
async function searchTerms ({ search, limit = 20, match, ...source }) {
  const { index, name } = await getTermIndex(source)
  return index.search(search, { limit: Math.min(Math.max(limit, 1), 200), match: match && match.length ? match : MATCHES })
    .map((term) => ({ ...term, ontology: name }))
}

/** Forget every loaded ontology (tests, or after changing MOZG_ONTOLOGIES). */
function resetOntologies () {
  indexes.clear()
  loading.clear()
  lastError.clear()
}

module.exports = {
  applyLinks,
  getTermIndex,
  listOntologies,
  searchTerms,
  resetOntologies,
  configuredOntologies,
  indexFromContent,
  iriFromId,
  MAX_LINKS_PER_QUERY
}
