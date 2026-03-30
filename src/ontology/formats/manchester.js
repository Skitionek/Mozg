'use strict';

/**
 * Minimal Manchester OWL Syntax parser.
 *
 * Handles:
 *   Prefix: declarations
 *   Class: frames with SubClassOf, Annotations (rdfs:label / rdfs:comment)
 *   ObjectProperty: frames with Domain, Range, InverseOf, Characteristics
 *   DataProperty: frames with Domain, Range
 */

const FRAME_KEYWORDS = ['Class:', 'ObjectProperty:', 'DataProperty:', 'Individual:', 'AnnotationProperty:'];

function expandCurie(curie, prefixMap) {
  if (!curie) return curie;
  curie = curie.trim();
  // Already a full IRI
  if (curie.startsWith('<') && curie.endsWith('>')) return curie.slice(1, -1);
  // Check for prefix match
  const colon = curie.indexOf(':');
  if (colon !== -1) {
    const prefix = curie.slice(0, colon + 1); // includes ':'
    const local = curie.slice(colon + 1);
    if (prefixMap[prefix]) return prefixMap[prefix] + local;
    // Well-known prefixes
    const BUILTIN = {
      'owl:':  'http://www.w3.org/2002/07/owl#',
      'rdfs:': 'http://www.w3.org/2000/01/rdf-schema#',
      'rdf:':  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      'xsd:':  'http://www.w3.org/2001/XMLSchema#',
    };
    if (BUILTIN[prefix]) return BUILTIN[prefix] + local;
  }
  return curie;
}

function parseManchesterSyntax(content) {
  const lines = content.split(/\r?\n/);
  const prefixMap = {};
  const classes = [];
  const objectProperties = [];
  const dataProperties = [];

  // ── 1. Extract Prefix declarations ──────────────────────────────────────
  for (const line of lines) {
    const m = line.match(/^Prefix:\s+(\S+)\s+<([^>]+)>/);
    if (m) prefixMap[m[1]] = m[2]; // e.g. ":" → "http://example.org/"
  }

  // ── 2. Split into frames ─────────────────────────────────────────────────
  const frames = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const isFrameStart = FRAME_KEYWORDS.some(kw => trimmed.startsWith(kw));
    if (isFrameStart) {
      if (current) frames.push(current);
      current = [trimmed];
    } else if (current) {
      current.push(trimmed);
    }
  }
  if (current) frames.push(current);

  // ── 3. Parse each frame ──────────────────────────────────────────────────
  for (const frameLines of frames) {
    const header = frameLines[0];

    if (header.startsWith('Class:')) {
      const iriRaw = header.slice('Class:'.length).trim();
      const iri = expandCurie(iriRaw, prefixMap);
      const cls = { iri, label: null, comment: null, subClassOf: [] };

      let section = null;
      for (let i = 1; i < frameLines.length; i++) {
        const l = frameLines[i];
        if (!l) continue;
        if (l.startsWith('SubClassOf:')) {
          section = 'subClassOf';
          const val = l.slice('SubClassOf:'.length).trim();
          if (val && !val.includes('(')) {
            for (const part of val.split(',')) {
              const exp = expandCurie(part.trim(), prefixMap);
              if (exp) cls.subClassOf.push(exp);
            }
          }
        } else if (l.startsWith('Annotations:')) {
          section = 'annotations';
        } else if (section === 'annotations') {
          // rdfs:label "Some Label"
          const labelM = l.match(/rdfs:label\s+"([^"]+)"/);
          if (labelM) cls.label = labelM[1];
          const commentM = l.match(/rdfs:comment\s+"([^"]+)"/);
          if (commentM) cls.comment = commentM[1];
        } else if (section === 'subClassOf') {
          // Continuation line (comma-separated or next value)
          if (!l.includes(':') && !l.startsWith('Annotations')) {
            const val = l.replace(/^,\s*/, '').trim();
            if (val && !val.includes('(')) {
              const exp = expandCurie(val, prefixMap);
              if (exp) cls.subClassOf.push(exp);
            }
          }
        }
      }

      classes.push(cls);
    } else if (header.startsWith('ObjectProperty:')) {
      const iriRaw = header.slice('ObjectProperty:'.length).trim();
      const iri = expandCurie(iriRaw, prefixMap);
      const op = {
        iri,
        label: null,
        comment: null,
        domain: [],
        range: [],
        inverseOf: null,
        relationType: 'hasMany',
      };

      let section = null;
      for (let i = 1; i < frameLines.length; i++) {
        const l = frameLines[i];
        if (!l) continue;
        if (l.startsWith('Domain:')) {
          section = 'domain';
          const val = l.slice('Domain:'.length).trim();
          if (val) op.domain.push(expandCurie(val, prefixMap));
        } else if (l.startsWith('Range:')) {
          section = 'range';
          const val = l.slice('Range:'.length).trim();
          if (val) op.range.push(expandCurie(val, prefixMap));
        } else if (l.startsWith('InverseOf:')) {
          const val = l.slice('InverseOf:'.length).trim();
          op.inverseOf = expandCurie(val, prefixMap);
        } else if (l.startsWith('Characteristics:')) {
          const chars = l.slice('Characteristics:'.length).trim();
          if (chars.includes('Functional')) op.relationType = 'hasOne';
          if (chars.includes('InverseFunctional')) op.relationType = 'belongsTo';
        } else if (l.startsWith('Annotations:')) {
          section = 'annotations';
        } else if (section === 'annotations') {
          const labelM = l.match(/rdfs:label\s+"([^"]+)"/);
          if (labelM) op.label = labelM[1];
          const commentM = l.match(/rdfs:comment\s+"([^"]+)"/);
          if (commentM) op.comment = commentM[1];
        } else if (section === 'domain') {
          const val = l.replace(/^,\s*/, '').trim();
          if (val && !val.includes(':')) { /* skip section headers */ }
          else if (val) op.domain.push(expandCurie(val, prefixMap));
        } else if (section === 'range') {
          const val = l.replace(/^,\s*/, '').trim();
          if (val && !val.includes(':')) { /* skip section headers */ }
          else if (val) op.range.push(expandCurie(val, prefixMap));
        }
      }

      objectProperties.push(op);
    } else if (header.startsWith('DataProperty:')) {
      const iriRaw = header.slice('DataProperty:'.length).trim();
      const iri = expandCurie(iriRaw, prefixMap);
      const dp = { iri, label: null, comment: null, domain: [], range: [] };

      let section = null;
      for (let i = 1; i < frameLines.length; i++) {
        const l = frameLines[i];
        if (!l) continue;
        if (l.startsWith('Domain:')) {
          section = 'domain';
          const val = l.slice('Domain:'.length).trim();
          if (val) dp.domain.push(expandCurie(val, prefixMap));
        } else if (l.startsWith('Range:')) {
          section = 'range';
          const val = l.slice('Range:'.length).trim();
          if (val) dp.range.push(expandCurie(val, prefixMap));
        } else if (l.startsWith('Annotations:')) {
          section = 'annotations';
        } else if (section === 'annotations') {
          const labelM = l.match(/rdfs:label\s+"([^"]+)"/);
          if (labelM) dp.label = labelM[1];
          const commentM = l.match(/rdfs:comment\s+"([^"]+)"/);
          if (commentM) dp.comment = commentM[1];
        } else if (section === 'domain') {
          const val = l.replace(/^,\s*/, '').trim();
          if (val && val.includes(':')) dp.domain.push(expandCurie(val, prefixMap));
        } else if (section === 'range') {
          const val = l.replace(/^,\s*/, '').trim();
          if (val && val.includes(':')) dp.range.push(expandCurie(val, prefixMap));
        }
      }

      dataProperties.push(dp);
    }
  }

  return { classes, objectProperties, dataProperties, tripleCount: 0 };
}

module.exports = { parseManchesterSyntax };
