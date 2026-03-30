'use strict';

const { parseTurtle }          = require('./formats/turtle');
const { parseRdfXml }          = require('./formats/rdfxml');
const { parseOwlXml }          = require('./formats/owlxml');
const { parseManchesterSyntax } = require('./formats/manchester');
const { extractOntology }      = require('./extractor');

/**
 * Detect the serialisation format from a Content-Type header string.
 * Returns null when unrecognised.
 */
function formatFromContentType(ct) {
  if (!ct) return null;
  const lower = ct.toLowerCase();
  if (lower.includes('turtle') || lower.includes('text/turtle')) return 'turtle';
  if (lower.includes('rdf+xml') || lower.includes('application/rdf+xml')) return 'rdfxml';
  if (lower.includes('owl+xml')) return 'owlxml';
  return null;
}

/**
 * Detect the serialisation format from a file-path / URL extension.
 * Returns null when unrecognised.
 */
function formatFromExtension(url) {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.ttl') || path.endsWith('.n3') || path.endsWith('.nt')) return 'turtle';
  if (path.endsWith('.rdf')) return 'rdfxml';
  // .owl files are most commonly RDF/XML; users should pass format: owlxml explicitly
  // when using the OWL/XML functional syntax
  if (path.endsWith('.owl')) return 'rdfxml';
  if (path.endsWith('.owx')) return 'owlxml';
  if (path.endsWith('.manchstr') || path.endsWith('.omn')) return 'manchester';
  return null;
}

/**
 * Detect the serialisation format from the content of the file.
 */
function detectFormat(content) {
  const trimmed = content.trimStart();
  // OWL/XML: XML with OWL namespace
  if (
    (trimmed.startsWith('<?xml') || trimmed.startsWith('<Ontology') || trimmed.startsWith('<rdf:RDF')) &&
    trimmed.includes('www.w3.org/2002/07/owl')
  ) {
    // Distinguish OWL/XML functional syntax from RDF/XML
    if (trimmed.includes('<Ontology') && !trimmed.includes('<rdf:RDF')) return 'owlxml';
    return 'rdfxml';
  }
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<rdf:RDF') || trimmed.startsWith('<Ontology')) {
    return 'rdfxml';
  }
  // Turtle / N-Triples: @prefix, @base, PREFIX, BASE
  if (/^(@prefix|@base|PREFIX|BASE)\b/i.test(trimmed)) return 'turtle';
  // Manchester OWL
  if (/^(Ontology:|Class:|ObjectProperty:|DataProperty:)/.test(trimmed)) return 'manchester';
  // Default: try Turtle
  return 'turtle';
}

/**
 * Main entry point – parse an OWL ontology and return an OntologyResult.
 *
 * @param {{ content?: string, url?: string, format?: string }} input
 * @returns {Promise<{ classes, objectProperties, dataProperties, tripleCount }>}
 */
async function parseOntology(input) {
  let { content, url, format } = input || {};

  // ── Fetch from URL if content not provided ─────────────────────────────
  if (url && !content) {
    const res = await globalThis.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ontology from ${url}: ${res.status} ${res.statusText}`);
    }
    content = await res.text();

    // Try to detect format from Content-Type
    if (!format || format === 'auto') {
      format = formatFromContentType(res.headers.get('content-type')) ||
               formatFromExtension(url) ||
               null;
    }
  }

  if (!content) {
    throw new Error('Either content or url must be provided');
  }

  // ── Detect format if still unknown ─────────────────────────────────────
  if (!format || format === 'auto') {
    format = detectFormat(content);
  }

  // ── Route to parser ─────────────────────────────────────────────────────
  switch (format) {
    case 'turtle': {
      const quads = await parseTurtle(content);
      return extractOntology(quads);
    }
    case 'rdfxml': {
      const quads = await parseRdfXml(content);
      return extractOntology(quads);
    }
    case 'owlxml':
      return parseOwlXml(content);
    case 'manchester':
      return parseManchesterSyntax(content);
    default:
      throw new Error(`Unknown ontology format: ${format}`);
  }
}

module.exports = { parseOntology };
