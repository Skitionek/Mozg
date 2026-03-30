'use strict';

const { XMLParser } = require('fast-xml-parser');

function parseOwlXml(content) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(content);
  const onto = doc?.Ontology ?? doc?.['rdf:RDF']?.['owl:Ontology'] ?? {};
  const classes = [];
  const objectProperties = [];
  const dataProperties = [];

  // Extract declarations
  const decls = [].concat(onto.Declaration ?? []);
  for (const d of decls) {
    if (d.Class?.['@_IRI']) {
      classes.push({ iri: d.Class['@_IRI'], label: null, comment: null, subClassOf: [] });
    }
    if (d.ObjectProperty?.['@_IRI']) {
      objectProperties.push({
        iri: d.ObjectProperty['@_IRI'],
        label: null,
        comment: null,
        domain: [],
        range: [],
        inverseOf: null,
        relationType: 'hasMany',
      });
    }
    if (d.DataProperty?.['@_IRI']) {
      dataProperties.push({ iri: d.DataProperty['@_IRI'], label: null, comment: null, domain: [], range: [] });
    }
  }

  // SubClassOf
  for (const ax of [].concat(onto.SubClassOf ?? [])) {
    const sub = ax.Class?.[0]?.['@_IRI'] ?? ax.Class?.['@_IRI'];
    const sup = ax.Class?.[1]?.['@_IRI'];
    if (sub && sup) {
      const c = classes.find(c => c.iri === sub);
      if (c) c.subClassOf.push(sup);
    }
  }

  // ObjectPropertyDomain
  for (const ax of [].concat(onto.ObjectPropertyDomain ?? [])) {
    const p = ax.ObjectProperty?.['@_IRI'];
    const d = ax.Class?.['@_IRI'];
    if (p && d) {
      const op = objectProperties.find(o => o.iri === p);
      if (op) op.domain.push(d);
    }
  }

  // ObjectPropertyRange
  for (const ax of [].concat(onto.ObjectPropertyRange ?? [])) {
    const p = ax.ObjectProperty?.['@_IRI'];
    const r = ax.Class?.['@_IRI'];
    if (p && r) {
      const op = objectProperties.find(o => o.iri === p);
      if (op) op.range.push(r);
    }
  }

  // FunctionalObjectProperty → hasOne
  for (const ax of [].concat(onto.FunctionalObjectProperty ?? [])) {
    const p = ax.ObjectProperty?.['@_IRI'];
    if (p) {
      const op = objectProperties.find(o => o.iri === p);
      if (op) op.relationType = 'hasOne';
    }
  }

  // AnnotationAssertion for rdfs:label / rdfs:comment
  for (const ax of [].concat(onto.AnnotationAssertion ?? [])) {
    const prop =
      ax.AnnotationProperty?.['@_abbreviatedIRI'] ??
      ax.AnnotationProperty?.['@_IRI'] ??
      '';
    const subj = ax.IRI ?? ax.AbbreviatedIRI ?? '';
    const val =
      typeof ax.Literal === 'string'
        ? ax.Literal
        : (ax.Literal?.['#text'] ?? '');

    const isLabel = prop.includes('label');
    const isComment = prop.includes('comment');

    for (const list of [classes, objectProperties, dataProperties]) {
      const item = list.find(
        i =>
          i.iri === subj ||
          i.iri.endsWith('#' + subj) ||
          i.iri.endsWith('/' + subj)
      );
      if (item) {
        if (isLabel) item.label = val;
        if (isComment) item.comment = val;
      }
    }
  }

  return { classes, objectProperties, dataProperties, tripleCount: 0 };
}

module.exports = { parseOwlXml };
