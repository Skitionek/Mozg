'use strict'

/**
 * Human Phenotype Ontology — the standard vocabulary of phenotypic
 * abnormalities in human disease, with gene and disease annotations, served
 * by the JAX ontology API.  Free to use with attribution (see licence).
 * API docs: https://ontology.jax.org/api/docs
 *
 * Disease annotations come from OMIM and Orphanet, so HPO disease ids are
 * OMIM:… or ORPHA:… CURIEs; rows carry the MONDO equivalent as mondoId for
 * joining to MONDO-keyed sources.  Genes are NCBI Gene ids.
 */

const stripPrefix = (prefix) => (id) => (id == null ? null : String(id).replace(prefix, ''))
const ncbiGeneId = (r) => stripPrefix(/^NCBIGene:/)(r.id)

// HPO's API names Orphanet diseases "ORPHA:…"; accept the Orphanet: spelling other sources use.
const hpoDiseaseId = (v) => String(v).replace(/^Orphanet:/i, 'ORPHA:')

const TERM_FIELDS = {
  hpoId: 'id',
  name: 'name',
  definition: 'definition',
  comment: 'comment',
  synonyms: 'synonyms',
  xrefs: 'xrefs',
  pmids: (r) => (r.publicationReferences || []).filter((p) => /^PMID:/.test(p)).map((p) => p.slice(5)),
  descendantCount: 'descendantCount'
}

const TERM_LINKS = [
  { alias: 'children', description: 'Direct children of the term', entity: 'children', localKey: 'hpoId', foreignKey: 'hpoId', type: 'hasMany' },
  { alias: 'parents', description: 'Direct parents of the term', entity: 'parents', localKey: 'hpoId', foreignKey: 'hpoId', type: 'hasMany' },
  { alias: 'genes', description: 'Genes annotated to the phenotype', entity: 'genesForTerm', localKey: 'hpoId', foreignKey: 'hpoId', type: 'hasMany' },
  { alias: 'diseases', description: 'OMIM and Orphanet diseases presenting the phenotype', entity: 'diseasesForTerm', localKey: 'hpoId', foreignKey: 'hpoId', type: 'hasMany' }
]

const BRIEF_TERM = {
  hpoId: 'id',
  name: 'name',
  definition: 'definition',
  descendantCount: 'descendantCount'
}

const DISEASE_FIELDS = {
  diseaseId: 'id',
  name: 'name',
  mondoId: 'mondoId',
  description: 'description'
}

const DISEASE_RELATIONS = [
  { alias: 'phenotypes', description: 'Every phenotype annotated to the disease, by category', entity: 'phenotypesForDisease', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasMany' },
  { alias: 'genes', description: 'Genes associated with the disease', entity: 'genesForDisease', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasMany' },
  { alias: 'monarch', description: 'The disease in the Monarch Initiative graph, via its MONDO id', catalog: 'monarch', entity: 'entity', localKey: 'mondoId', foreignKey: 'id', type: 'hasOne' },
  { alias: 'opentargets', description: 'Open Targets disease record, via its MONDO id', catalog: 'opentargets', entity: 'disease', localKey: 'mondoId', foreignKey: 'diseaseId', type: 'hasOne' }
]

const GENE_FIELDS = {
  ncbiGeneId,
  symbol: 'name'
}

const GENE_RELATIONS = [
  { alias: 'gene', description: 'The NCBI Gene record', catalog: 'ncbi-gene', entity: 'gene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasOne' },
  { alias: 'hgnc', description: 'The HGNC record of the gene symbol', catalog: 'hgnc', entity: 'geneBySymbol', localKey: 'symbol', foreignKey: 'symbol', type: 'hasOne' },
  { alias: 'phenotypes', description: 'Every phenotype annotated to the gene', entity: 'phenotypesForGene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasMany' }
]

module.exports = {
  name: 'hpo',
  label: 'Human Phenotype Ontology (HPO)',
  description: 'Standardised vocabulary of phenotypic abnormalities in human disease, with phenotype–gene and phenotype–disease (OMIM, Orphanet) annotations. Term ids look like HP:0001250.',
  category: 'Function & ontologies',
  homepage: 'https://hpo.jax.org',
  docs: 'https://ontology.jax.org/api/docs',
  license: 'HPO licence (free with attribution) — https://hpo.jax.org/license',
  driver: 'api',
  connection: {
    database: 'https://ontology.jax.org/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  entities: [
    {
      name: 'term',
      description: 'One HPO term by id',
      path: '/hp/terms/{hpoId}',
      params: {
        hpoId: { description: 'HPO term id, e.g. HP:0001250' }
      },
      fields: TERM_FIELDS,
      example: { hpoId: 'HP:0001250' },
      relations: [
        ...TERM_LINKS,
        { alias: 'ols', description: 'The term in OLS, with cross-ontology links', catalog: 'ols', entity: 'term', localKey: 'hpoId', foreignKey: 'termId', type: 'hasOne' }
      ]
    },
    {
      name: 'children',
      description: 'Direct children of an HPO term',
      path: '/hp/terms/{hpoId}/children',
      params: {
        hpoId: { description: 'HPO term id, e.g. HP:0001250' }
      },
      fields: BRIEF_TERM,
      example: { hpoId: 'HP:0001250' },
      relations: TERM_LINKS
    },
    {
      name: 'parents',
      description: 'Direct parents of an HPO term',
      path: '/hp/terms/{hpoId}/parents',
      params: {
        hpoId: { description: 'HPO term id, e.g. HP:0001250' }
      },
      fields: BRIEF_TERM,
      example: { hpoId: 'HP:0001250' },
      relations: TERM_LINKS
    },
    {
      name: 'search',
      description: 'Search HPO term names, synonyms and ids',
      path: '/hp/search',
      params: {
        q: { required: true, description: 'Search text, e.g. seizure' }
      },
      rows: 'terms',
      fields: BRIEF_TERM,
      paginate: { limit: 'limit', page: 'page', pageBase: 0, max: 100 },
      example: { q: 'seizure' },
      relations: [
        { alias: 'term', description: 'The full term record', entity: 'term', localKey: 'hpoId', foreignKey: 'hpoId', type: 'hasOne' }
      ]
    },
    {
      name: 'genesForTerm',
      description: 'Genes annotated to a phenotype (or any of its descendants)',
      path: '/network/annotation/{hpoId}',
      params: {
        hpoId: { description: 'HPO term id, e.g. HP:0001250' }
      },
      rows: 'genes',
      fields: GENE_FIELDS,
      example: { hpoId: 'HP:0001250' },
      relations: GENE_RELATIONS
    },
    {
      name: 'diseasesForTerm',
      description: 'OMIM and Orphanet diseases presenting a phenotype',
      path: '/network/annotation/{hpoId}',
      params: {
        hpoId: { description: 'HPO term id, e.g. HP:0001250' }
      },
      rows: 'diseases',
      fields: DISEASE_FIELDS,
      example: { hpoId: 'HP:0001250' },
      relations: DISEASE_RELATIONS
    },
    {
      name: 'phenotypesForGene',
      description: 'Phenotypes annotated to a gene',
      path: '/network/annotation/NCBIGene:{ncbiGeneId}',
      params: {
        ncbiGeneId: { description: 'NCBI Gene id, e.g. 7157' }
      },
      rows: 'phenotypes',
      fields: {
        hpoId: 'id',
        name: 'name'
      },
      example: { ncbiGeneId: '7157' },
      relations: [
        { alias: 'term', description: 'The full phenotype term', entity: 'term', localKey: 'hpoId', foreignKey: 'hpoId', type: 'hasOne' }
      ]
    },
    {
      name: 'diseasesForGene',
      description: 'OMIM and Orphanet diseases associated with a gene',
      path: '/network/annotation/NCBIGene:{ncbiGeneId}',
      params: {
        ncbiGeneId: { description: 'NCBI Gene id, e.g. 7157' }
      },
      rows: 'diseases',
      fields: DISEASE_FIELDS,
      example: { ncbiGeneId: '7157' },
      relations: DISEASE_RELATIONS
    },
    {
      name: 'phenotypesForDisease',
      description: 'Phenotypes annotated to an OMIM or Orphanet disease, with their category',
      path: '/network/annotation/{diseaseId}',
      params: {
        diseaseId: { transform: hpoDiseaseId, description: 'OMIM or Orphanet disease id, e.g. OMIM:151623 or ORPHA:524 (MONDO ids are not accepted)' }
      },
      rows: (body) => Object.values((body && body.categories) || {}).flat(),
      fields: {
        hpoId: 'id',
        name: 'name',
        category: 'category',
        frequency: 'metadata.frequency',
        onset: 'metadata.onset',
        sex: 'metadata.sex',
        sources: 'metadata.sources'
      },
      example: { diseaseId: 'OMIM:151623' },
      relations: [
        { alias: 'term', description: 'The full phenotype term', entity: 'term', localKey: 'hpoId', foreignKey: 'hpoId', type: 'hasOne' }
      ]
    },
    {
      name: 'genesForDisease',
      description: 'Genes associated with an OMIM or Orphanet disease',
      path: '/network/annotation/{diseaseId}',
      params: {
        diseaseId: { transform: hpoDiseaseId, description: 'OMIM or Orphanet disease id, e.g. OMIM:151623 or ORPHA:524' }
      },
      rows: 'genes',
      fields: GENE_FIELDS,
      example: { diseaseId: 'OMIM:151623' },
      relations: GENE_RELATIONS
    }
  ]
}
