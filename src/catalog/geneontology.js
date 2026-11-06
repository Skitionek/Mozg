'use strict'

const { GENE_CURIE_KEYS } = require('../database/obo')

/**
 * Gene Ontology Consortium API — GO terms and the GO annotations the
 * consortium aggregates from every model organism database (CC BY 4.0).
 * API docs: https://api.geneontology.org/api
 *
 * Unlike QuickGO (UniProt-centred), annotation subjects here are whichever
 * identifier the contributing database uses: UniProtKB:…, MGI:…, ZFIN:…,
 * FB:…, WB:…, SGD:…  Gene products are addressed by that CURIE.
 */

const ASSOCIATION_FIELDS = {
  geneId: 'subject.id',
  symbol: 'subject.label',
  uniprotAccession: (r) => {
    const id = r.subject && r.subject.id
    return id && id.startsWith('UniProtKB:') ? id.slice('UniProtKB:'.length).replace(/-\d+$/, '') : null
  },
  taxonId: (r) => {
    const id = r.subject && r.subject.taxon && r.subject.taxon.id
    return id ? Number(String(id).replace('NCBITaxon:', '')) : null
  },
  organism: 'subject.taxon.label',
  goId: 'object.id',
  goName: 'object.label',
  aspect: 'object.category[0]',
  negated: 'negated',
  evidence: 'evidence_types[0].label',
  evidenceCode: 'evidence_types[0].id',
  providedBy: 'provided_by[0]',
  references: 'publications[].id'
}

module.exports = {
  name: 'geneontology',
  label: 'Gene Ontology (GO Consortium)',
  description: 'The GO Consortium\'s API: Gene Ontology terms and the functional annotations contributed by UniProt and every model organism database (MGI, RGD, ZFIN, FlyBase, WormBase, SGD, …).',
  category: 'Function & ontologies',
  homepage: 'https://geneontology.org',
  docs: 'https://api.geneontology.org/api',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://api.geneontology.org/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  entities: [
    {
      name: 'term',
      description: 'One GO term with its definition, synonyms and cross-references',
      path: '/ontology/term/{goId}',
      params: {
        goId: { description: 'GO term id, e.g. GO:0006915' }
      },
      fields: {
        goId: 'goid',
        name: 'label',
        definition: 'definition',
        synonyms: 'synonyms',
        alternativeIds: 'alternativeIds',
        xrefs: 'xrefs',
        subsets: 'subsets',
        comment: (r) => r.comment || null
      },
      example: { goId: 'GO:0006915' },
      relations: [
        { alias: 'genes', description: 'Gene products annotated to this term, across all contributing databases', entity: 'genesForTerm', obo: 'go', type: 'hasMany' },
        { alias: 'quickgo', description: 'The same term in QuickGO, with aspect and hierarchy', catalog: 'quickgo', entity: 'term', obo: 'go', type: 'hasOne' }
      ]
    },
    {
      name: 'genesForTerm',
      obo: { geneId: ['uniprot', ...GENE_CURIE_KEYS] },
      description: 'Gene products annotated to a GO term (including its descendants)',
      path: '/bioentity/function/{goId}/genes',
      params: {
        goId: { description: 'GO term id, e.g. GO:0006915' },
        taxonId: { name: 'taxon', transform: (v) => (String(v).startsWith('NCBITaxon:') ? v : `NCBITaxon:${v}`), description: 'NCBI taxonomy id to restrict to, e.g. 9606' }
      },
      rows: 'associations',
      fields: ASSOCIATION_FIELDS,
      paginate: { limit: 'rows', offset: 'start', max: 1000 },
      example: { goId: 'GO:0006915', taxonId: 9606 },
      relations: [
        { alias: 'protein', description: 'The UniProt entry, for UniProtKB subjects', catalog: 'uniprot', entity: 'protein', obo: 'uniprot', type: 'hasOne' },
        { alias: 'functions', description: 'Every GO annotation of this gene product', entity: 'functionsForGene', obo: '*', type: 'hasMany' }
      ]
    },
    {
      name: 'functionsForGene',
      obo: { geneId: ['uniprot', ...GENE_CURIE_KEYS] },
      description: 'GO annotations of one gene or gene product, by the contributing database\'s CURIE',
      path: '/bioentity/gene/{geneId}/function',
      params: {
        geneId: { description: 'Gene CURIE, e.g. UniProtKB:P04637, HGNC:11998, MGI:98834, ZFIN:ZDB-GENE-990415-270' }
      },
      rows: 'associations',
      fields: ASSOCIATION_FIELDS,
      paginate: { limit: 'rows', offset: 'start', max: 1000 },
      example: { geneId: 'UniProtKB:P04637' },
      relations: [
        { alias: 'term', description: 'The annotated GO term', entity: 'term', obo: 'go', type: 'hasOne' }
      ]
    }
  ]
}
