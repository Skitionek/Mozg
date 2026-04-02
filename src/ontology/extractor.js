'use strict';

const RDF  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL  = 'http://www.w3.org/2002/07/owl#';
const XSD  = 'http://www.w3.org/2001/XMLSchema#';

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
const OWL_RESTRICTION       = OWL  + 'Restriction';
const OWL_ON_PROPERTY       = OWL  + 'onProperty';
const OWL_MIN_CARDINALITY   = OWL  + 'minCardinality';
const OWL_MAX_CARDINALITY   = OWL  + 'maxCardinality';
const OWL_EXACT_CARDINALITY = OWL  + 'exactCardinality';
const OWL_MIN_QUAL_CARD     = OWL  + 'minQualifiedCardinality';
const OWL_MAX_QUAL_CARD     = OWL  + 'maxQualifiedCardinality';
const OWL_QUAL_CARDINALITY  = OWL  + 'qualifiedCardinality';
const OWL_SOME_VALUES_FROM  = OWL  + 'someValuesFrom';
const OWL_EQUIVALENT_CLASS  = OWL  + 'equivalentClass';
const OWL_DISJOINT_WITH     = OWL  + 'disjointWith';

/** Maps XSD datatype IRIs to GraphQL scalar names. */
const XSD_TO_GRAPHQL = {
  [`${XSD}string`]:   'String',
  [`${XSD}boolean`]:  'Boolean',
  [`${XSD}integer`]:  'Int',
  [`${XSD}int`]:      'Int',
  [`${XSD}long`]:     'Int',
  [`${XSD}short`]:    'Int',
  [`${XSD}byte`]:     'Int',
  [`${XSD}float`]:    'Float',
  [`${XSD}double`]:   'Float',
  [`${XSD}decimal`]:  'Float',
  [`${XSD}dateTime`]: 'String',
  [`${XSD}date`]:     'String',
  [`${XSD}time`]:     'String',
  [`${XSD}anyURI`]:   'String',
};

/** Return the GraphQL scalar name for an XSD datatype IRI, defaulting to String. */
function xsdToGraphqlType(iri) {
  return XSD_TO_GRAPHQL[iri] ?? 'String';
}

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

  // ── Step 1: Build restriction map ─────────────────────────────────────
  // Maps restriction blank-node IRI → { propertyIri, minCard, maxCard, someValuesFrom }
  const restrictionMap = new Map();
  for (const [subj] of index) {
    if (!hasType(index, subj, OWL_RESTRICTION)) continue;
    const propertyIri = getFirst(index, subj, OWL_ON_PROPERTY);
    if (!propertyIri) continue;

    const parseCard = (val) => (val !== null ? parseInt(val, 10) : null);
    const minCard =
      parseCard(getFirst(index, subj, OWL_MIN_CARDINALITY)) ??
      parseCard(getFirst(index, subj, OWL_MIN_QUAL_CARD));
    const maxCard =
      parseCard(getFirst(index, subj, OWL_MAX_CARDINALITY)) ??
      parseCard(getFirst(index, subj, OWL_MAX_QUAL_CARD));
    const exactCard =
      parseCard(getFirst(index, subj, OWL_EXACT_CARDINALITY)) ??
      parseCard(getFirst(index, subj, OWL_QUAL_CARDINALITY));
    const someValuesFrom = getFirst(index, subj, OWL_SOME_VALUES_FROM);

    restrictionMap.set(subj, {
      propertyIri,
      minCard: exactCard ?? minCard,
      maxCard: exactCard ?? maxCard,
      someValuesFrom,
    });
  }

  // ── Step 2: Build per-property cardinality aggregates ─────────────────
  // Maps propertyIri → { minCard, maxCard, required }
  const propCardMap = new Map();
  for (const [, r] of restrictionMap) {
    const { propertyIri, minCard, maxCard, someValuesFrom } = r;
    const existing = propCardMap.get(propertyIri) ?? { minCard: null, maxCard: null, required: false };
    propCardMap.set(propertyIri, {
      minCard: minCard !== null
        ? (existing.minCard === null ? minCard : Math.min(existing.minCard, minCard))
        : existing.minCard,
      maxCard: maxCard !== null
        ? (existing.maxCard === null ? maxCard : Math.max(existing.maxCard, maxCard))
        : existing.maxCard,
      required: existing.required || (minCard ?? -1) >= 1 || someValuesFrom !== null,
    });
  }

  // ── Step 3: Extract OWL elements ──────────────────────────────────────
  for (const [subj] of index) {
    const types = getValues(index, subj, RDF_TYPE);

    if (types.includes(OWL_CLASS) || types.includes(RDFS_CLASS)) {
      // Filter out restriction blank nodes masquerading as classes
      if (hasType(index, subj, OWL_RESTRICTION)) continue;

      classes.push({
        iri: subj,
        label: getFirst(index, subj, RDFS_LABEL),
        comment: getFirst(index, subj, RDFS_COMMENT),
        subClassOf: getValues(index, subj, RDFS_SUBCLASSOF)
          .filter(v => !restrictionMap.has(v)),
        equivalentTo: getValues(index, subj, OWL_EQUIVALENT_CLASS)
          .filter(v => !restrictionMap.has(v)),
        disjointWith: getValues(index, subj, OWL_DISJOINT_WITH),
      });
    }

    if (types.includes(OWL_OBJECT_PROPERTY)) {
      const isFunctional = hasType(index, subj, OWL_FUNCTIONAL);
      let relationType = 'hasMany';
      if (isFunctional) relationType = 'hasOne';
      else if (hasType(index, subj, OWL_INVERSE_FUNC)) relationType = 'belongsTo';

      const card = propCardMap.get(subj) ?? { minCard: null, maxCard: null };

      objectProperties.push({
        iri: subj,
        label: getFirst(index, subj, RDFS_LABEL),
        comment: getFirst(index, subj, RDFS_COMMENT),
        domain: getValues(index, subj, RDFS_DOMAIN),
        range: getValues(index, subj, RDFS_RANGE),
        inverseOf: getFirst(index, subj, OWL_INVERSE_OF),
        relationType,
        isFunctional,
        minCard: card.minCard,
        maxCard: card.maxCard,
      });
    }

    if (types.includes(OWL_DATATYPE_PROPERTY)) {
      const card = propCardMap.get(subj) ?? { required: false };
      const range = getValues(index, subj, RDFS_RANGE);

      dataProperties.push({
        iri: subj,
        label: getFirst(index, subj, RDFS_LABEL),
        comment: getFirst(index, subj, RDFS_COMMENT),
        domain: getValues(index, subj, RDFS_DOMAIN),
        range,
        graphqlType: xsdToGraphqlType(range[0] ?? null),
        required: card.required,
      });
    }
  }

  return { classes, objectProperties, dataProperties, tripleCount: quads.length };
}

module.exports = { extractOntology, shortName, xsdToGraphqlType };
