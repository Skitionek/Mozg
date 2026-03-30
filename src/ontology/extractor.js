'use strict';

const RDF  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL  = 'http://www.w3.org/2002/07/owl#';

const RDF_TYPE              = RDF  + 'type';
const RDFS_LABEL            = RDFS + 'label';
const RDFS_COMMENT          = RDFS + 'comment';
const RDFS_SUBCLASSOF       = RDFS + 'subClassOf';
const RDFS_DOMAIN           = RDFS + 'domain';
const RDFS_RANGE            = RDFS + 'range';
const OWL_CLASS             = OWL  + 'Class';
const OWL_OBJECT_PROPERTY   = OWL  + 'ObjectProperty';
const OWL_DATATYPE_PROPERTY = OWL  + 'DatatypeProperty';
const OWL_FUNCTIONAL        = OWL  + 'FunctionalProperty';
const OWL_INVERSE_FUNC      = OWL  + 'InverseFunctionalProperty';
const OWL_INVERSE_OF        = OWL  + 'inverseOf';
const RDFS_CLASS            = RDFS + 'Class';

/** Extract the local part of an IRI (after # or last /). */
function shortName(iri) {
  const hash = iri.lastIndexOf('#');
  if (hash !== -1) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  if (slash !== -1) return iri.slice(slash + 1);
  return iri;
}

/** Build a Map<subject → Map<predicate → object[]>> from quads. */
function buildIndex(quads) {
  const index = new Map();
  for (const quad of quads) {
    const s = quad.subject.value;
    if (!index.has(s)) index.set(s, new Map());
    const pMap = index.get(s);
    const p = quad.predicate.value;
    if (!pMap.has(p)) pMap.set(p, []);
    pMap.get(p).push(quad.object.value);
  }
  return index;
}

function getValues(index, subject, predicate) {
  return index.get(subject)?.get(predicate) ?? [];
}

function getFirst(index, subject, predicate) {
  return getValues(index, subject, predicate)[0] ?? null;
}

function hasType(index, subject, type) {
  return getValues(index, subject, RDF_TYPE).includes(type);
}

function extractOntology(quads) {
  const index = buildIndex(quads);
  const classes = [];
  const objectProperties = [];
  const dataProperties = [];

  for (const [subj] of index) {
    const types = getValues(index, subj, RDF_TYPE);

    if (types.includes(OWL_CLASS) || types.includes(RDFS_CLASS)) {
      classes.push({
        iri: subj,
        label: getFirst(index, subj, RDFS_LABEL),
        comment: getFirst(index, subj, RDFS_COMMENT),
        subClassOf: getValues(index, subj, RDFS_SUBCLASSOF),
      });
    }

    if (types.includes(OWL_OBJECT_PROPERTY)) {
      let relationType = 'hasMany';
      if (hasType(index, subj, OWL_FUNCTIONAL)) relationType = 'hasOne';
      else if (hasType(index, subj, OWL_INVERSE_FUNC)) relationType = 'belongsTo';

      objectProperties.push({
        iri: subj,
        label: getFirst(index, subj, RDFS_LABEL),
        comment: getFirst(index, subj, RDFS_COMMENT),
        domain: getValues(index, subj, RDFS_DOMAIN),
        range: getValues(index, subj, RDFS_RANGE),
        inverseOf: getFirst(index, subj, OWL_INVERSE_OF),
        relationType,
      });
    }

    if (types.includes(OWL_DATATYPE_PROPERTY)) {
      dataProperties.push({
        iri: subj,
        label: getFirst(index, subj, RDFS_LABEL),
        comment: getFirst(index, subj, RDFS_COMMENT),
        domain: getValues(index, subj, RDFS_DOMAIN),
        range: getValues(index, subj, RDFS_RANGE),
      });
    }
  }

  return { classes, objectProperties, dataProperties, tripleCount: quads.length };
}

module.exports = { extractOntology, shortName };
