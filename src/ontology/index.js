'use strict'

const crypto = require('node:crypto')
const { parseTurtle } = require('./formats/turtle')
const { parseRdfXml } = require('./formats/rdfxml')
const { parseOwlXml } = require('./formats/owlxml')
const { parseManchesterSyntax } = require('./formats/manchester')
const { extractOntology, xsdToGraphqlType } = require('./extractor')
const { mapOntology } = require('./mapper')
const { validateOntologyAgainstDb } = require('./validator')

// ---------------------------------------------------------------------------
// In-memory cache: SHA-256 (first 16 hex chars) of raw content → result
// ---------------------------------------------------------------------------
const ontologyCache = new Map()

function contentHash (str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16)
}

/**
 * Detect the serialization format from a Content-Type header string.
 * Returns null when unrecognised.
 */
function formatFromContentType (ct) {
  if (!ct) return null
  const lower = ct.toLowerCase()
  if (lower.includes('turtle') || lower.includes('text/turtle')) return 'turtle'
  if (lower.includes('rdf+xml') || lower.includes('application/rdf+xml')) return 'rdfxml'
  if (lower.includes('owl+xml')) return 'owlxml'
  return null
}

/**
 * Detect the serialization format from a file-path / URL extension.
 * Returns null when unrecognised.
 */
function formatFromExtension (url) {
  const path = url.split('?')[0].toLowerCase()
  if (path.endsWith('.ttl') || path.endsWith('.n3') || path.endsWith('.nt')) return 'turtle'
  if (path.endsWith('.rdf')) return 'rdfxml'
  // .owl files are most commonly RDF/XML; users should pass format: owlxml explicitly
  // when using the OWL/XML functional syntax
  if (path.endsWith('.owl')) return 'rdfxml'
  if (path.endsWith('.owx')) return 'owlxml'
  if (path.endsWith('.manchstr') || path.endsWith('.omn')) return 'manchester'
  return null
}

/**
 * Detect the serialization format from the content of the file.
 */
function detectFormat (content) {
  const trimmed = content.trimStart()
  // OWL/XML: XML with OWL namespace
  if (
    (trimmed.startsWith('<?xml') || trimmed.startsWith('<Ontology') || trimmed.startsWith('<rdf:RDF')) &&
    trimmed.includes('www.w3.org/2002/07/owl')
  ) {
    // Distinguish OWL/XML functional syntax from RDF/XML
    if (trimmed.includes('<Ontology') && !trimmed.includes('<rdf:RDF')) return 'owlxml'
    return 'rdfxml'
  }
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<rdf:RDF') || trimmed.startsWith('<Ontology')) {
    return 'rdfxml'
  }
  // Turtle / N-Triples: @prefix, @base, PREFIX, BASE
  if (/^(@prefix|@base|PREFIX|BASE)\b/i.test(trimmed)) return 'turtle'
  // Manchester OWL
  if (/^(Ontology:|Class:|ObjectProperty:|DataProperty:)/.test(trimmed)) return 'manchester'
  // Default: try Turtle
  return 'turtle'
}

/**
 * Ensure every parsed result has the full set of fields introduced by the
 * enhanced extractor, regardless of which parser produced it.  Parsers that
 * pre-date those fields (owlxml, manchester) may omit them; this fills in
 * safe defaults so downstream code never has to guard for undefined.
 */
function normalizeResult (parsed) {
  return {
    ...parsed,
    classes: parsed.classes.map((c) => ({
      equivalentTo: [],
      disjointWith: [],
      ...c
    })),
    objectProperties: parsed.objectProperties.map((op) => ({
      isFunctional: op.relationType === 'hasOne',
      minCard: null,
      maxCard: null,
      ...op
    })),
    dataProperties: parsed.dataProperties.map((dp) => ({
      graphqlType: xsdToGraphqlType(dp.range[0] ?? null),
      required: false,
      ...dp
    }))
  }
}

/**
 * Main entry point – parse an OWL ontology, map it to a GraphQL schema, and
 * (optionally) validate it against a live database.
 *
 * Results are cached by content hash so repeated ingestion of the same
 * ontology is free.
 *
 * @param {{ content?: string, url?: string, format?: string,
 *           validate?: boolean, connection?: object }} input
 * @returns {Promise<OntologyResult>}
 */
async function parseOntology (input) {
  let { content, url, format, validate, connection } = input || {}

  // ── Fetch from URL if content not provided ─────────────────────────────
  if (url && !content) {
    const res = await globalThis.fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to fetch ontology from ${url}: ${res.status} ${res.statusText}`)
    }
    content = await res.text()

    // Try to detect format from Content-Type
    if (!format || format === 'auto') {
      format = formatFromContentType(res.headers.get('content-type')) ||
               formatFromExtension(url) ||
               null
    }
  }

  if (!content) {
    throw new Error('Either content or url must be provided')
  }

  // ── Detect format if still unknown ─────────────────────────────────────
  if (!format || format === 'auto') {
    format = detectFormat(content)
  }

  // ── Check cache ─────────────────────────────────────────────────────────
  const hash = contentHash(content)
  if (ontologyCache.has(hash) && !validate) {
    return ontologyCache.get(hash)
  }

  // ── Route to parser ─────────────────────────────────────────────────────
  let raw
  switch (format) {
    case 'turtle': {
      const quads = await parseTurtle(content)
      raw = extractOntology(quads)
      break
    }
    case 'rdfxml': {
      const quads = await parseRdfXml(content)
      raw = extractOntology(quads)
      break
    }
    case 'owlxml':
      raw = parseOwlXml(content)
      break
    case 'manchester':
      raw = parseManchesterSyntax(content)
      break
    default:
      throw new Error(`Unknown ontology format: ${format}`)
  }

  // ── Normalize + map ─────────────────────────────────────────────────────
  const parsed = normalizeResult(raw)
  const { typeDefs: generatedTypeDefs, entityMap } = mapOntology(parsed)

  const generatedTypes = []
  for (const [name, entity] of entityMap) {
    generatedTypes.push({
      name,
      iri: entity.iri,
      isAbstract: entity.isAbstract,
      fieldCount: entity.fields.length,
      relationCount: entity.relations.length
    })
  }

  // ── Optional validation against live DB ────────────────────────────────
  let validationReport = null
  if (validate && connection) {
    validationReport = await validateOntologyAgainstDb(entityMap, connection)
  }

  const result = {
    ...parsed,
    generatedTypeDefs,
    generatedTypes,
    validationReport
  }

  // Cache only when not doing validation (validation depends on external DB state)
  if (!validate) {
    ontologyCache.set(hash, result)
  }

  return result
}

module.exports = { parseOntology }
