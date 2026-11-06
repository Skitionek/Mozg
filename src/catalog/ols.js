'use strict'

const { ONTOLOGY_KEYS } = require('../database/obo')

/**
 * OLS — EBI's Ontology Lookup Service (OLS4): one API over 250+ biomedical
 * ontologies, including MONDO, EFO, HP, GO, UBERON, CL, ChEBI, DOID and
 * NCBITaxon.  Each ontology keeps its own licence; OLS itself is open.
 * API docs: https://www.ebi.ac.uk/ols4/help
 *
 * Terms are addressed by CURIE (MONDO:0007254).  When `ontology` is omitted
 * it is taken from the CURIE prefix, so `termId` alone is usually enough.
 * Rows expose the identifier again under the canonical name its kind uses
 * elsewhere in the catalog (diseaseId, hpoId, goId, chebiId), which is what
 * lets one ontology lookup lead straight into the source that owns the term.
 */

// Prefixes whose terms are diseases, so they can be followed into disease sources.
const DISEASE_PREFIXES = new Set(['MONDO', 'EFO', 'DOID', 'ORPHANET', 'OMIM', 'MESH', 'NCIT'])

const prefixOf = (curie) => String(curie || '').split(':')[0]
const ontologyFor = (params) => String(params.ontology || prefixOf(params.termId)).toLowerCase()

const curieWhen = (prefix) => (r) => (prefixOf(r.obo_id).toUpperCase() === prefix ? r.obo_id : null)

const TERM_FIELDS = {
  termId: 'obo_id',
  name: 'label',
  ontology: 'ontology_name',
  description: 'description[0]',
  synonyms: 'synonyms',
  iri: 'iri',
  isObsolete: 'is_obsolete',
  hasChildren: 'has_children',
  replacedBy: 'term_replaced_by',
  xrefs: (r) => (r.obo_xref || []).map((x) => (x.database ? `${x.database}:${x.id}` : x.id)),
  diseaseId: (r) => (DISEASE_PREFIXES.has(prefixOf(r.obo_id).toUpperCase()) ? r.obo_id : null),
  hpoId: curieWhen('HP'),
  goId: curieWhen('GO'),
  chebiId: curieWhen('CHEBI')
}

const TERM_RELATIONS = [
  { alias: 'children', description: 'Direct is_a children of the term', entity: 'children', localKey: 'termId', obo: '*', foreignKey: 'termId', type: 'hasMany' },
  { alias: 'parents', description: 'Direct is_a parents of the term', entity: 'parents', localKey: 'termId', obo: '*', foreignKey: 'termId', type: 'hasMany' },
  { alias: 'disease', description: 'Open Targets disease record, for disease terms', catalog: 'opentargets', entity: 'disease', localKey: 'diseaseId', obo: '*', foreignKey: 'diseaseId', type: 'hasOne' },
  { alias: 'monarch', description: 'Monarch Initiative entity (genes, phenotypes, associations), for disease and phenotype terms', catalog: 'monarch', entity: 'entity', localKey: 'diseaseId', obo: '*', foreignKey: 'id', type: 'hasOne' },
  { alias: 'phenotype', description: 'HPO record, for HP terms', catalog: 'hpo', entity: 'term', obo: 'hp', type: 'hasOne' },
  { alias: 'goTerm', description: 'QuickGO record, for GO terms', catalog: 'quickgo', entity: 'term', obo: 'go', type: 'hasOne' },
  { alias: 'compound', description: 'ChEBI record, for ChEBI terms', catalog: 'chebi', entity: 'compound', obo: 'chebi', type: 'hasOne' }
]

const TERM_PARAMS = {
  termId: { required: true, description: 'Term CURIE, e.g. MONDO:0007254, HP:0001250, GO:0006915, UBERON:0002107' },
  ontology: { description: 'OLS ontology id, e.g. mondo, efo, hp — defaults to the CURIE prefix' }
}

// Look the term up in its ontology, then (for children/parents) follow the
// hierarchy link OLS returns with it — that link carries the double-encoded
// IRI OLS needs, which is not something to rebuild by hand.
async function findTerm (params, ctx) {
  const body = await ctx.request(`/ontologies/${encodeURIComponent(ontologyFor(params))}/terms`, { query: { obo_id: params.termId } })
  return (body && body._embedded && body._embedded.terms) || []
}

const followLink = (link) => async (params, ctx) => {
  const [term] = await findTerm(params, ctx)
  const href = term && term._links && term._links[link] && term._links[link].href
  if (!href) return []
  const size = Math.min((ctx.limit || 0) + (ctx.offset || 0) || 100, 500)
  const body = await ctx.request(href.replace(/^http:/, 'https:'), { query: { size } })
  return (body && body._embedded && body._embedded.terms) || []
}

module.exports = {
  name: 'ols',
  label: 'Ontology Lookup Service (OLS)',
  description: 'EBI\'s Ontology Lookup Service: one API over 250+ biomedical ontologies — MONDO, EFO, HP, GO, UBERON, CL, ChEBI, DOID, NCBITaxon and more. Look up a term by CURIE, walk its hierarchy, or search across ontologies.',
  category: 'Function & ontologies',
  homepage: 'https://www.ebi.ac.uk/ols4/',
  docs: 'https://www.ebi.ac.uk/ols4/help',
  license: 'Apache-2.0 (service); each ontology carries its own licence',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/ols4/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'term',
      obo: { termId: ONTOLOGY_KEYS },
      description: 'One ontology term by CURIE',
      params: TERM_PARAMS,
      resolve: findTerm,
      fields: TERM_FIELDS,
      example: { termId: 'MONDO:0007254' },
      relations: TERM_RELATIONS
    },
    {
      name: 'children',
      obo: { termId: ONTOLOGY_KEYS },
      description: 'Direct is_a children of a term',
      params: TERM_PARAMS,
      resolve: followLink('children'),
      fields: TERM_FIELDS,
      example: { termId: 'MONDO:0007254' },
      relations: TERM_RELATIONS
    },
    {
      name: 'parents',
      obo: { termId: ONTOLOGY_KEYS },
      description: 'Direct is_a parents of a term',
      params: TERM_PARAMS,
      resolve: followLink('parents'),
      fields: TERM_FIELDS,
      example: { termId: 'HP:0001250' },
      relations: TERM_RELATIONS
    },
    {
      name: 'search',
      obo: { termId: ONTOLOGY_KEYS },
      description: 'Search term labels and synonyms, across all ontologies or within one',
      path: '/search',
      params: {
        q: { required: true, description: 'Search text, e.g. breast carcinoma' },
        ontology: { description: 'Restrict to ontologies (comma-separated OLS ids), e.g. mondo or mondo,efo' },
        exact: { description: 'true for exact label/synonym matches only' },
        type: { description: 'class, property or individual (default: all)' }
      },
      rows: 'response.docs',
      fields: {
        termId: 'obo_id',
        name: 'label',
        ontology: 'ontology_name',
        description: 'description[0]',
        synonyms: 'exact_synonyms',
        iri: 'iri',
        type: 'type',
        diseaseId: (r) => (DISEASE_PREFIXES.has(prefixOf(r.obo_id).toUpperCase()) ? r.obo_id : null),
        hpoId: curieWhen('HP'),
        goId: curieWhen('GO'),
        chebiId: curieWhen('CHEBI')
      },
      paginate: { limit: 'rows', offset: 'start', max: 1000 },
      example: { q: 'breast carcinoma', ontology: 'mondo' },
      relations: [
        { alias: 'term', description: 'The full term record', entity: 'term', localKey: 'termId', obo: '*', foreignKey: 'termId', type: 'hasOne' },
        ...TERM_RELATIONS.filter((r) => r.catalog)
      ]
    },
    {
      name: 'ontology',
      description: 'Metadata of one ontology loaded in OLS: title, version, size',
      path: '/ontologies/{ontology}',
      params: {
        ontology: { description: 'OLS ontology id, e.g. mondo, efo, go, hp, uberon' }
      },
      fields: {
        ontology: 'ontologyId',
        title: 'config.title',
        description: 'config.description',
        prefix: 'config.preferredPrefix',
        version: 'config.version|version',
        homepage: 'config.homepage',
        numberOfTerms: 'numberOfTerms',
        status: 'status',
        loaded: 'loaded'
      },
      example: { ontology: 'mondo' },
      relations: []
    },
    {
      name: 'ontologies',
      description: 'Every ontology loaded in OLS',
      path: '/ontologies',
      rows: '_embedded.ontologies',
      fields: {
        ontology: 'ontologyId',
        title: 'config.title',
        prefix: 'config.preferredPrefix',
        version: 'config.version|version',
        numberOfTerms: 'numberOfTerms',
        status: 'status'
      },
      paginate: { limit: 'size', page: 'page', pageBase: 0, max: 500 },
      example: {},
      relations: [
        { alias: 'details', description: 'Full metadata of the ontology', entity: 'ontology', localKey: 'ontology', foreignKey: 'ontology', type: 'hasOne' }
      ]
    }
  ]
}
