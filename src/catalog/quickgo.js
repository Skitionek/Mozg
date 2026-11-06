'use strict'

/**
 * QuickGO — EBI's Gene Ontology browser and annotation service, serving the
 * GO term graph and every GO annotation from the GOA project (CC BY 4.0).
 * API docs: https://www.ebi.ac.uk/QuickGO/api/index.html
 *
 * Annotations link a gene product (UniProt accession) to a GO term with an
 * evidence code and a reference, so they join proteins to function in both
 * directions.
 */

// Accept the short aspect codes curators use as well as QuickGO's own names.
const ASPECTS = { P: 'biological_process', F: 'molecular_function', C: 'cellular_component' }
const aspect = (value) => ASPECTS[String(value).toUpperCase()] || String(value)

// QuickGO identifies gene products as "UniProtKB:P04637"; callers pass a bare accession.
const bareAccession = (id) => (id == null ? null : String(id).replace(/^UniProtKB:/, '').replace(/-\d+$/, ''))

const ANNOTATION_FIELDS = {
  uniprotAccession: (r) => (String(r.geneProductId || '').startsWith('UniProtKB:') ? bareAccession(r.geneProductId) : null),
  geneProductId: 'geneProductId',
  symbol: 'symbol',
  proteinName: 'name',
  goId: 'goId',
  goName: 'goName',
  aspect: 'goAspect',
  qualifier: 'qualifier',
  evidence: 'goEvidence',
  evidenceCode: 'evidenceCode',
  reference: 'reference',
  pmid: (r) => (/^PMID:/.test(r.reference || '') ? r.reference.slice(5) : null),
  taxonId: 'taxonId',
  assignedBy: 'assignedBy',
  date: 'date'
}

const ANNOTATION_RELATIONS = [
  { alias: 'term', description: 'The annotated GO term', entity: 'term', obo: 'go', type: 'hasOne' },
  { alias: 'protein', description: 'The annotated UniProt protein', catalog: 'uniprot', entity: 'protein', obo: 'uniprot', type: 'hasOne' },
  { alias: 'publication', description: 'The PubMed article supporting the annotation (Europe PMC)', catalog: 'europepmc', entity: 'article', obo: 'pubmed', type: 'hasOne' }
]

module.exports = {
  name: 'quickgo',
  label: 'QuickGO',
  description: 'EBI\'s Gene Ontology service: GO terms and their hierarchy, and every GO annotation (GOA) linking UniProt proteins to biological processes, molecular functions and cellular components, with evidence.',
  category: 'Function & ontologies',
  homepage: 'https://www.ebi.ac.uk/QuickGO/',
  docs: 'https://www.ebi.ac.uk/QuickGO/api/index.html',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/QuickGO/services',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'annotations',
      description: 'GO annotations of one UniProt protein',
      path: '/annotation/search',
      params: {
        uniprotAccession: { required: true, name: 'geneProductId', transform: bareAccession, description: 'UniProtKB accession, e.g. P04637' },
        aspect: { transform: aspect, description: 'biological_process, molecular_function or cellular_component (or P, F, C)' },
        goId: { description: 'Keep only annotations to this GO term (exact, no descendants), e.g. GO:0006915' }
      },
      query: { includeFields: 'goName,name' },
      rows: 'results',
      fields: ANNOTATION_FIELDS,
      paginate: { limit: 'limit', page: 'page', pageBase: 1, max: 200 },
      example: { uniprotAccession: 'P04637', aspect: 'biological_process' },
      relations: ANNOTATION_RELATIONS
    },
    {
      name: 'annotationsForTerm',
      description: 'Gene products annotated to a GO term, optionally within one organism',
      path: '/annotation/search',
      params: {
        goId: { required: true, description: 'GO term id, e.g. GO:0006915' },
        taxonId: { description: 'NCBI taxonomy id of the organism, e.g. 9606' },
        includeDescendants: { name: 'goUsage', transform: (v) => (v === true || v === 'true' ? 'descendants' : 'exact'), description: 'true to include annotations to descendant terms' }
      },
      query: { includeFields: 'goName,name' },
      rows: 'results',
      fields: ANNOTATION_FIELDS,
      paginate: { limit: 'limit', page: 'page', pageBase: 1, max: 200 },
      example: { goId: 'GO:0006915', taxonId: 9606 },
      relations: ANNOTATION_RELATIONS
    },
    {
      name: 'term',
      description: 'One GO term with its definition, aspect, synonyms and cross-references',
      path: '/ontology/go/terms/{goId}/complete',
      params: {
        goId: { description: 'GO term id, e.g. GO:0006915' }
      },
      rows: 'results',
      fields: {
        goId: 'id',
        name: 'name',
        aspect: 'aspect',
        definition: 'definition.text',
        isObsolete: 'isObsolete',
        synonyms: 'synonyms[].name',
        childIds: 'children[].id',
        replacedBy: 'replaces[].id',
        secondaryIds: 'secondaryIds',
        reactomeIds: (r) => (r.xRefs || []).filter((x) => x.dbCode === 'Reactome').map((x) => x.dbId),
        pmids: (r) => ((r.definition && r.definition.xrefs) || []).filter((x) => x.dbCode === 'PMID').map((x) => x.dbId)
      },
      example: { goId: 'GO:0006915' },
      relations: [
        { alias: 'children', description: 'Direct children of the term (is_a, part_of, regulates…)', entity: 'children', obo: 'go', type: 'hasMany' },
        { alias: 'ancestors', description: 'Every ancestor of the term over is_a and part_of', entity: 'ancestors', obo: 'go', type: 'hasMany' },
        { alias: 'humanAnnotations', description: 'Human gene products annotated to the term', entity: 'annotationsForTerm', obo: 'go', type: 'hasMany', where: { taxonId: 9606 } },
        { alias: 'goc', description: 'The same term in the GO Consortium API', catalog: 'geneontology', entity: 'term', obo: 'go', type: 'hasOne' }
      ]
    },
    {
      name: 'children',
      description: 'Direct children of a GO term, with the relation linking each',
      path: '/ontology/go/terms/{goId}/children',
      params: {
        goId: { description: 'GO term id, e.g. GO:0006915' }
      },
      rows: 'results[0].children',
      fields: {
        goId: 'id',
        name: 'name',
        relation: 'relation',
        hasChildren: 'hasChildren'
      },
      example: { goId: 'GO:0006915' },
      relations: [
        { alias: 'term', description: 'The child term in full', entity: 'term', obo: 'go', type: 'hasOne' }
      ]
    },
    {
      name: 'ancestors',
      description: 'Every ancestor of a GO term (including itself) over the chosen relations',
      path: '/ontology/go/terms/{goId}/ancestors',
      params: {
        goId: { description: 'GO term id, e.g. GO:0006915' },
        relations: { default: 'is_a,part_of', description: 'Comma-separated relations to follow: is_a, part_of, occurs_in, regulates' }
      },
      rows: (body) => (body.results && body.results[0] ? body.results[0].ancestors || [] : []),
      fields: { goId: (id) => id },
      example: { goId: 'GO:0006915' },
      relations: [
        { alias: 'term', description: 'The ancestor term in full', entity: 'term', obo: 'go', type: 'hasOne' }
      ]
    },
    {
      name: 'search',
      description: 'Free-text search over GO term names and synonyms',
      path: '/ontology/go/search',
      params: {
        query: { required: true, description: 'Search text, e.g. apoptosis' }
      },
      rows: 'results',
      fields: {
        goId: 'id',
        name: 'name',
        aspect: 'aspect',
        definition: 'definition.text',
        isObsolete: 'isObsolete'
      },
      paginate: { limit: 'limit', page: 'page', pageBase: 1, max: 600 },
      example: { query: 'apoptotic process' },
      relations: [
        { alias: 'term', description: 'The term in full', entity: 'term', obo: 'go', type: 'hasOne' }
      ]
    }
  ]
}
