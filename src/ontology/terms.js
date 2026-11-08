'use strict'

/**
 * Ontology terms, indexed for linking database values to them.
 *
 * `ingestOntology` reads an ontology's *schema* (classes and properties, to map
 * onto tables).  Linking needs its *terms*: each one's identifier, label,
 * synonyms and cross-references, so that a value in a database — "MONDO:0005015",
 * "diabetes mellitus", "Diabetes", "MESH:D003920" — can be resolved to the term
 * it names.
 *
 * Terms come from RDF (Turtle, RDF/XML: the OBO ontologies' OWL releases) or
 * from the OBO flat-file format, which the same ontologies publish about a tenth
 * the size and which is the better choice for a large one.
 */

const OBO_IRI_PREFIX = 'http://purl.obolibrary.org/obo/'

const P = {
  type: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  label: 'http://www.w3.org/2000/01/rdf-schema#label',
  comment: 'http://www.w3.org/2000/01/rdf-schema#comment',
  subClassOf: 'http://www.w3.org/2000/01/rdf-schema#subClassOf',
  owlClass: 'http://www.w3.org/2002/07/owl#Class',
  deprecated: 'http://www.w3.org/2002/07/owl#deprecated',
  prefLabel: 'http://www.w3.org/2004/02/skos/core#prefLabel',
  altLabel: 'http://www.w3.org/2004/02/skos/core#altLabel',
  skosDefinition: 'http://www.w3.org/2004/02/skos/core#definition',
  definition: OBO_IRI_PREFIX + 'IAO_0000115',
  altTerm: OBO_IRI_PREFIX + 'IAO_0000118',
  oboId: 'http://www.geneontology.org/formats/oboInOwl#id',
  xref: 'http://www.geneontology.org/formats/oboInOwl#hasDbXref',
  altId: 'http://www.geneontology.org/formats/oboInOwl#hasAlternativeId'
}
const SYNONYM_PREDICATES = new Set([
  'http://www.geneontology.org/formats/oboInOwl#hasExactSynonym',
  'http://www.geneontology.org/formats/oboInOwl#hasRelatedSynonym',
  'http://www.geneontology.org/formats/oboInOwl#hasBroadSynonym',
  'http://www.geneontology.org/formats/oboInOwl#hasNarrowSynonym',
  P.altLabel,
  P.altTerm
])

/** Case, spacing and Unicode form do not distinguish two spellings of a label. */
function normalizeText (value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * An identifier in one comparable form: `MONDO_0005015` and `mondo:0005015`
 * both read `MONDO:0005015`.  Text with no prefix is left as it is.
 */
function canonicalId (value) {
  const text = String(value).trim()
  const match = /^([A-Za-z][\w.-]*?)[:_](.+)$/.exec(text)
  return match ? `${match[1].toUpperCase()}:${match[2]}`.toUpperCase() : text.toUpperCase()
}

/** The identifier an OBO-style IRI encodes: `.../obo/MONDO_0005015` → `MONDO:0005015`. */
function idFromIri (iri) {
  if (!iri.startsWith(OBO_IRI_PREFIX)) return null
  const local = iri.slice(OBO_IRI_PREFIX.length)
  return /^[A-Za-z][\w.-]*_.+$/.test(local) ? canonicalId(local) : null
}

function iriFromId (id) {
  return OBO_IRI_PREFIX + String(id).replace(':', '_')
}

/**
 * @typedef {object} Term
 * @property {string} iri
 * @property {string|null} id            e.g. MONDO:0005015
 * @property {string|null} label
 * @property {string[]} synonyms
 * @property {string|null} definition
 * @property {string[]} xrefs            e.g. MESH:D003920
 * @property {string[]} parents          IRIs of the named superclasses
 * @property {boolean} deprecated
 */

const emptyTerm = (iri) => ({ iri, id: null, label: null, synonyms: [], definition: null, xrefs: [], parents: [], deprecated: false, altIds: [] })

class TermIndex {
  /** @param {Term[]} terms */
  constructor (terms) {
    this.terms = terms
    this.byIri = new Map()
    this.byId = new Map()
    this.byLabel = new Map()
    this.bySynonym = new Map()
    this.byXref = new Map()
    for (const term of terms) this.#add(term)
  }

  get size () {
    return this.terms.length
  }

  #add (term) {
    const push = (map, key, value) => {
      if (!key) return
      const list = map.get(key)
      if (list) list.push(value)
      else map.set(key, [value])
    }
    this.byIri.set(term.iri, term)
    push(this.byId, term.id && canonicalId(term.id), term)
    for (const alt of term.altIds || []) push(this.byId, canonicalId(alt), term)
    if (term.label) push(this.byLabel, normalizeText(term.label), term)
    for (const synonym of term.synonyms) push(this.bySynonym, normalizeText(synonym), term)
    for (const xref of term.xrefs) push(this.byXref, canonicalId(xref), term)
  }

  /**
   * The term a value names.
   * @param {unknown} value
   * @param {object} [options]
   * @param {string[]} [options.match]  which ways to try, in order (id, label, synonym, xref)
   * @param {string} [options.prefix]   OBO prefix to put in front of a bare local id (`0005015` → `MONDO:0005015`)
   * @returns {{ term: Term, matchedBy: string, ambiguous: number } | null}
   */
  lookup (value, { match = ['id', 'label', 'synonym', 'xref'], prefix } = {}) {
    if (value == null || typeof value === 'object') return null
    const text = String(value).trim()
    if (!text) return null

    for (const how of match) {
      let candidates
      if (how === 'id') {
        candidates = this.byIri.has(text) ? [this.byIri.get(text)] : this.byId.get(canonicalId(text))
        if (!candidates && prefix && /^[\w.-]+$/.test(text) && !/[:_]/.test(text)) candidates = this.byId.get(canonicalId(`${prefix}:${text}`))
      } else if (how === 'label') {
        candidates = this.byLabel.get(normalizeText(text))
      } else if (how === 'synonym') {
        candidates = this.bySynonym.get(normalizeText(text))
      } else if (how === 'xref') {
        candidates = this.byXref.get(canonicalId(text))
      }
      if (candidates && candidates.length) {
        // A current term beats an obsolete one with the same name.
        const live = candidates.filter((t) => !t.deprecated)
        const pool = live.length ? live : candidates
        return { term: pool[0], matchedBy: how, ambiguous: pool.length }
      }
    }
    return null
  }

  /**
   * Terms whose label or a synonym contains the text, best matches first: an
   * exact label, then a label that starts with it, then any containing it.
   */
  search (text, { limit = 20, match = ['id', 'label', 'synonym', 'xref'] } = {}) {
    const needle = normalizeText(text)
    if (!needle) return []
    const scored = []
    const exact = this.lookup(text, { match })
    if (exact) scored.push([0, exact.term])
    const seen = new Set(exact ? [exact.term.iri] : [])
    for (const term of this.terms) {
      if (seen.has(term.iri) || term.deprecated) continue
      const label = term.label ? normalizeText(term.label) : ''
      let score = null
      if (match.includes('label') && label.includes(needle)) score = label.startsWith(needle) ? 1 : 2
      else if (match.includes('synonym') && term.synonyms.some((s) => normalizeText(s).includes(needle))) score = 3
      if (score != null) scored.push([score, term])
    }
    return scored.sort((a, b) => a[0] - b[0] || String(a[1].label).localeCompare(String(b[1].label))).slice(0, limit).map(([, term]) => term)
  }
}

// ── From RDF quads ──────────────────────────────────────────────────────────

/** Terms from parsed RDF (n3 / rdfxml-streaming-parser quads). */
function termsFromQuads (quads) {
  const byIri = new Map()
  const classes = new Set()
  const get = (iri) => {
    let term = byIri.get(iri)
    if (!term) {
      term = emptyTerm(iri)
      byIri.set(iri, term)
    }
    return term
  }
  const prefLabels = new Map()

  for (const quad of quads) {
    if (quad.subject.termType !== 'NamedNode') continue
    const predicate = quad.predicate.value
    const subject = quad.subject.value
    const object = quad.object.value

    if (predicate === P.type) {
      if (object === P.owlClass) classes.add(subject)
      continue
    }
    if (predicate === P.label) get(subject).label = get(subject).label || object
    else if (predicate === P.prefLabel) prefLabels.set(subject, object)
    else if (SYNONYM_PREDICATES.has(predicate)) get(subject).synonyms.push(object)
    else if (predicate === P.definition || predicate === P.skosDefinition) get(subject).definition = object
    else if (predicate === P.comment) get(subject).definition ||= object
    else if (predicate === P.xref) get(subject).xrefs.push(object)
    else if (predicate === P.oboId) get(subject).id = object
    else if (predicate === P.altId) get(subject).altIds.push(object)
    else if (predicate === P.deprecated) get(subject).deprecated = object === 'true'
    else if (predicate === P.subClassOf && quad.object.termType === 'NamedNode') get(subject).parents.push(object)
  }

  const terms = []
  for (const iri of classes) {
    const term = get(iri)
    term.label = term.label || prefLabels.get(iri) || null
    term.id = term.id || idFromIri(iri)
    terms.push(term)
  }
  // Superclasses that are not terms themselves (restrictions, imports) are noise.
  for (const term of terms) term.parents = term.parents.filter((parent) => classes.has(parent))
  return terms
}

// ── From the OBO flat-file format ───────────────────────────────────────────

/** `"text" EXACT [refs]` → the quoted text, with escapes read. */
function quoted (value) {
  const match = /^"((?:[^"\\]|\\.)*)"/.exec(value)
  return match ? match[1].replace(/\\(.)/g, '$1') : null
}

/**
 * Terms from an OBO flat file: `[Term]` stanzas of `tag: value` lines.  Only
 * what linking needs is read; other tags and stanza types are skipped.
 */
function termsFromObo (content) {
  const terms = []
  let current = null
  const finish = () => {
    if (current && current.id) {
      current.iri = iriFromId(current.id)
      terms.push(current)
    }
    current = null
  }

  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('[')) {
      finish()
      current = line === '[Term]' ? emptyTerm('') : null
      continue
    }
    if (!current || !line || line.startsWith('!')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const tag = line.slice(0, colon)
    // A trailing `! comment` and `{modifiers}` are not part of the value.
    const value = line.slice(colon + 1).trim()
    const plain = value.replace(/\s+!.*$/, '').replace(/\s+\{.*\}$/, '').trim()

    switch (tag) {
      case 'id': current.id = plain; break
      case 'name': current.label = value; break
      case 'alt_id': current.altIds.push(plain); break
      case 'def': current.definition = quoted(value); break
      case 'synonym': { const text = quoted(value); if (text) current.synonyms.push(text); break }
      case 'xref': current.xrefs.push(plain.split(/\s+/)[0]); break
      case 'is_a': current.parents.push(iriFromId(plain.split(/\s+/)[0])); break
      case 'is_obsolete': current.deprecated = plain === 'true'; break
      default: break
    }
  }
  finish()

  const known = new Set(terms.map((t) => t.iri))
  for (const term of terms) term.parents = term.parents.filter((parent) => known.has(parent))
  return terms
}

module.exports = { TermIndex, termsFromQuads, termsFromObo, canonicalId, normalizeText, idFromIri, iriFromId }
