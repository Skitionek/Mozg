'use strict'

/**
 * HGNC — the HUGO Gene Nomenclature Committee's approved human gene symbols
 * and names, with the authoritative mapping from a symbol to Ensembl, NCBI
 * Gene, UniProt, OMIM and the model-organism databases.
 * API docs: https://www.genenames.org/help/rest/
 */

const first = (value) => (Array.isArray(value) ? (value[0] != null ? value[0] : null) : (value != null ? value : null))
const list = (value) => (value == null ? [] : [].concat(value))

const GENE_FIELDS = {
  hgncId: 'hgnc_id',
  symbol: 'symbol',
  name: 'name',
  status: 'status',
  locusGroup: 'locus_group',
  locusType: 'locus_type',
  location: 'location',
  aliasSymbols: (r) => list(r.alias_symbol),
  previousSymbols: (r) => list(r.prev_symbol),
  geneGroups: (r) => list(r.gene_group),
  ensemblGeneId: 'ensembl_gene_id',
  ncbiGeneId: 'entrez_id',
  uniprotAccession: (r) => first(r.uniprot_ids),
  uniprotAccessions: (r) => list(r.uniprot_ids),
  omimIds: (r) => list(r.omim_id),
  refseqAccessions: (r) => list(r.refseq_accession),
  maneSelect: (r) => list(r.mane_select),
  mgiIds: (r) => list(r.mgd_id),
  rgdIds: (r) => list(r.rgd_id),
  pmids: (r) => list(r.pubmed_id).map(String),
  dateModified: 'date_modified'
}

const GENE_RELATIONS = [
  { alias: 'ensembl', description: 'Ensembl gene record', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'ncbiGene', description: 'NCBI Gene record', catalog: 'ncbi-gene', entity: 'gene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasOne' },
  { alias: 'protein', description: 'Canonical UniProtKB protein', catalog: 'uniprot', entity: 'protein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' },
  { alias: 'alliance', description: 'Alliance of Genome Resources gene page (orthology, phenotypes)', catalog: 'alliance', entity: 'gene', localKey: 'hgncId', foreignKey: 'geneId', type: 'hasOne' },
  { alias: 'orthologs', description: 'Model-organism orthologues (Alliance of Genome Resources)', catalog: 'alliance', entity: 'orthologs', localKey: 'hgncId', foreignKey: 'geneId', type: 'hasMany' },
  { alias: 'target', description: 'Open Targets target record', catalog: 'opentargets', entity: 'target', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'gwasAssociations', description: 'GWAS Catalog associations mapped to this gene', catalog: 'gwas', entity: 'associationsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
  { alias: 'clinvarVariants', description: 'ClinVar variants in this gene', catalog: 'clinvar', entity: 'variantsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
  { alias: 'civic', description: 'CIViC clinical evidence summary', catalog: 'civic', entity: 'gene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasOne' },
  { alias: 'drugInteractions', description: 'Drug–gene interactions (DGIdb)', catalog: 'dgidb', entity: 'interactionsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' }
]

// Every lookup shares one shape: /fetch/{field}/{value} → response.docs[].
const fetchBy = (name, description, field, param, paramDescription, example) => ({
  name,
  description,
  path: `/fetch/${field}/{${param}}`,
  params: { [param]: { description: paramDescription } },
  rows: 'response.docs',
  fields: GENE_FIELDS,
  example: { [param]: example },
  relations: GENE_RELATIONS
})

module.exports = {
  name: 'hgnc',
  label: 'HGNC',
  description: 'HUGO Gene Nomenclature Committee: approved symbols and names for human genes, with previous symbols, aliases and authoritative links to Ensembl, NCBI Gene, UniProt, OMIM, MGI and RGD.',
  category: 'Genes & genomes',
  homepage: 'https://www.genenames.org',
  docs: 'https://www.genenames.org/help/rest/',
  license: 'CC0',
  driver: 'api',
  connection: {
    database: 'https://rest.genenames.org',
    headers: { Accept: 'application/json' }
  },
  // HGNC asks clients to stay at or below 10 requests per second.
  rateLimit: { requestsPerSecond: 8, maxConcurrent: 4 },
  entities: [
    fetchBy('gene', 'One approved human gene by HGNC id', 'hgnc_id', 'hgncId', 'HGNC id, e.g. HGNC:11998', 'HGNC:11998'),
    fetchBy('geneBySymbol', 'One human gene by its approved symbol', 'symbol', 'symbol', 'Approved gene symbol, e.g. TP53', 'TP53'),
    fetchBy('genesByPreviousSymbol', 'Genes that used to carry this symbol', 'prev_symbol', 'symbol', 'A withdrawn or previous symbol, e.g. FAM46C', 'FAM46C'),
    fetchBy('genesByAlias', 'Genes known by this alias', 'alias_symbol', 'alias', 'An alias symbol, e.g. p53', 'p53'),
    fetchBy('geneByEnsemblId', 'The human gene for an Ensembl gene id', 'ensembl_gene_id', 'ensemblGeneId', 'Ensembl gene stable id, e.g. ENSG00000141510', 'ENSG00000141510'),
    fetchBy('geneByNcbiGeneId', 'The human gene for an NCBI Gene id', 'entrez_id', 'ncbiGeneId', 'NCBI Gene id, e.g. 7157', '7157'),
    {
      name: 'search',
      description: 'Approved symbols matching a query (wildcards allowed), best match first',
      path: '/search/{query}',
      params: {
        query: { description: 'Search term; * is a wildcard, e.g. TP5*, or field:value such as locus_type:"RNA, micro"' }
      },
      rows: 'response.docs',
      fields: {
        hgncId: 'hgnc_id',
        symbol: 'symbol',
        score: 'score'
      },
      example: { query: 'TP5*' },
      relations: [
        { alias: 'gene', description: 'Full HGNC record', entity: 'gene', localKey: 'hgncId', foreignKey: 'hgncId', type: 'hasOne' }
      ]
    }
  ]
}
