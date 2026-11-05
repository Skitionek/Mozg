'use strict'

/**
 * MyGene.info — gene annotation aggregated from NCBI, Ensembl, UniProt,
 * HGNC, Reactome, GO and more, queryable by symbol, name, alias or any
 * annotation field, across species.
 * API docs: https://docs.mygene.info/en/latest/
 */

// Several MyGene fields are an object for a gene with one value and an array
// of objects for a gene with several (multiple Ensembl genes, alternative
// genomic positions); the first entry is the canonical one in both cases.
const one = (value) => (Array.isArray(value) ? value[0] : value) || null
const list = (value) => (value == null ? [] : [].concat(value))

const REQUESTED = [
  'symbol', 'name', 'taxid', 'entrezgene', 'type_of_gene', 'alias', 'summary',
  'map_location', 'genomic_pos', 'ensembl.gene', 'uniprot.Swiss-Prot', 'uniprot.TrEMBL',
  'HGNC', 'MIM'
].join(',')

const GENE_FIELDS = {
  ncbiGeneId: (r) => (r.entrezgene != null ? String(r.entrezgene) : (r._id != null ? String(r._id) : null)),
  symbol: 'symbol',
  name: 'name',
  taxonId: (r) => (r.taxid != null ? Number(r.taxid) : null),
  type: 'type_of_gene',
  aliases: (r) => list(r.alias),
  summary: 'summary',
  mapLocation: 'map_location',
  chromosome: (r) => (one(r.genomic_pos) || {}).chr || null,
  start: (r) => (one(r.genomic_pos) || {}).start || null,
  end: (r) => (one(r.genomic_pos) || {}).end || null,
  strand: (r) => (one(r.genomic_pos) || {}).strand || null,
  ensemblGeneId: (r) => (one(r.ensembl) || {}).gene || null,
  uniprotAccession: (r) => one((r.uniprot || {})['Swiss-Prot']) || null,
  uniprotAccessions: (r) => list((r.uniprot || {})['Swiss-Prot']),
  hgncId: (r) => (r.HGNC ? `HGNC:${r.HGNC}` : null),
  omimId: (r) => (r.MIM != null ? String(r.MIM) : null),
  score: '_score'
}

const GENE_RELATIONS = [
  { alias: 'ncbiGene', description: 'NCBI Gene record', catalog: 'ncbi-gene', entity: 'gene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasOne' },
  { alias: 'ensembl', description: 'Ensembl gene record', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'hgnc', description: 'HGNC nomenclature record', catalog: 'hgnc', entity: 'gene', localKey: 'hgncId', foreignKey: 'hgncId', type: 'hasOne' },
  { alias: 'protein', description: 'Reviewed UniProtKB protein', catalog: 'uniprot', entity: 'protein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' },
  { alias: 'generifs', description: 'GeneRIF literature statements about this gene', entity: 'generifs', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasMany' }
]

module.exports = {
  name: 'mygene',
  label: 'MyGene.info',
  description: 'Gene annotation aggregated from NCBI Gene, Ensembl, UniProt, HGNC and more, searchable by symbol, name, alias or annotation field across species. Fast way to resolve any gene identifier to the others.',
  category: 'Genes & genomes',
  homepage: 'https://mygene.info',
  docs: 'https://docs.mygene.info/en/latest/',
  license: 'Aggregated sources keep their own licences; the service is free to use',
  driver: 'api',
  connection: {
    database: 'https://mygene.info/v3',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'gene',
      description: 'One gene by NCBI Gene id',
      path: '/gene/{ncbiGeneId}',
      params: {
        ncbiGeneId: { description: 'NCBI Gene (Entrez) id, e.g. 7157' }
      },
      query: { fields: REQUESTED },
      fields: GENE_FIELDS,
      example: { ncbiGeneId: '7157' },
      relations: GENE_RELATIONS
    },
    {
      name: 'genes',
      description: 'Genes matching a query, best match first',
      path: '/query',
      params: {
        q: { in: 'query', required: true, description: 'Query: a symbol (CDK2), a field query (symbol:TP53, ensembl.gene:ENSG00000141510, uniprot:P04637), or free text' },
        species: { in: 'query', default: 'human', description: 'Comma-separated species names or taxonomy ids: human, mouse, rat, fruitfly, zebrafish, 9606, …; "all" for every species' }
      },
      query: (params) => ({ q: params.q, species: params.species, fields: REQUESTED }),
      rows: 'hits',
      fields: GENE_FIELDS,
      paginate: { limit: 'size', offset: 'from', max: 1000 },
      example: { q: 'symbol:CDK2' },
      relations: GENE_RELATIONS
    },
    {
      name: 'generifs',
      description: 'GeneRIFs: one-sentence functional statements about a gene, each backed by a publication',
      path: '/gene/{ncbiGeneId}',
      params: {
        ncbiGeneId: { description: 'NCBI Gene (Entrez) id, e.g. 7157' }
      },
      query: { fields: 'generif' },
      rows: (body, params) => list(body && body.generif).map((g) => ({ ...g, _gene: params.ncbiGeneId })),
      fields: {
        ncbiGeneId: (r) => String(r._gene),
        pmid: (r) => (r.pubmed != null ? String(r.pubmed) : null),
        text: 'text'
      },
      example: { ncbiGeneId: '7157' },
      relations: [
        { alias: 'article', description: 'The PubMed article behind this statement', catalog: 'pubmed', entity: 'article', localKey: 'pmid', foreignKey: 'pmid', type: 'hasOne' }
      ]
    }
  ]
}
