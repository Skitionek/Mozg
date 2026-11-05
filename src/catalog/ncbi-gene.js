'use strict'

/**
 * NCBI Gene via the NCBI Datasets v2 API — gene records for every annotated
 * organism, with RefSeq annotation, nomenclature and cross-references to
 * Ensembl, UniProt (Swiss-Prot), HGNC and OMIM.
 * API docs: https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/
 *
 * 5 requests/second without a key, 10 with one: pass apiKeys: { "ncbi-gene": "…" }.
 */

const unique = (values) => [...new Set(values.filter(Boolean))]

const GENE_FIELDS = {
  ncbiGeneId: 'gene.gene_id',
  symbol: 'gene.symbol',
  name: 'gene.description',
  taxonId: (r) => (r.gene && r.gene.tax_id != null ? Number(r.gene.tax_id) : null),
  organism: 'gene.taxname',
  commonName: 'gene.common_name',
  type: 'gene.type',
  chromosome: 'gene.chromosomes[0]',
  mapLocation: 'gene.map_locations[0].map_value',
  orientation: 'gene.orientation',
  assembly: 'gene.annotations[0].assembly_name',
  genomicAccession: 'gene.annotations[0].genomic_locations[0].genomic_accession_version',
  start: (r) => {
    const v = r.gene && r.gene.annotations && r.gene.annotations[0] && r.gene.annotations[0].genomic_locations && r.gene.annotations[0].genomic_locations[0]
    return v && v.genomic_range ? Number(v.genomic_range.begin) : null
  },
  end: (r) => {
    const v = r.gene && r.gene.annotations && r.gene.annotations[0] && r.gene.annotations[0].genomic_locations && r.gene.annotations[0].genomic_locations[0]
    return v && v.genomic_range ? Number(v.genomic_range.end) : null
  },
  ensemblGeneIds: (r) => unique((r.gene && r.gene.ensembl_gene_ids) || []),
  ensemblGeneId: 'gene.ensembl_gene_ids[0]',
  uniprotAccessions: (r) => unique((r.gene && r.gene.swiss_prot_accessions) || []),
  uniprotAccession: 'gene.swiss_prot_accessions[0]',
  hgncId: (r) => {
    const n = r.gene && r.gene.nomenclature_authority
    return n && n.authority === 'HGNC' ? n.identifier : null
  },
  nomenclatureId: 'gene.nomenclature_authority.identifier',
  omimIds: 'gene.omim_ids',
  synonyms: 'gene.synonyms',
  summary: 'gene.summary[0].description',
  transcriptCount: 'gene.transcript_count',
  proteinCount: 'gene.protein_count'
}

const GENE_RELATIONS = [
  { alias: 'proteins', description: 'Reviewed UniProtKB entries cross-referenced to this gene', catalog: 'uniprot', entity: 'proteins', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasMany', where: { reviewed: true } },
  { alias: 'ensemblGene', description: 'The matching Ensembl gene', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'hgnc', description: 'HGNC nomenclature record (human genes)', catalog: 'hgnc', entity: 'gene', localKey: 'hgncId', foreignKey: 'hgncId', type: 'hasOne' },
  { alias: 'mygene', description: 'MyGene.info aggregate annotation', catalog: 'mygene', entity: 'gene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasOne' },
  { alias: 'orthologs', description: 'Orthologous genes in other organisms (NCBI Orthologs)', entity: 'orthologs', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasMany' },
  { alias: 'taxonomy', description: 'The organism this gene belongs to', entity: 'taxonomy', localKey: 'taxonId', foreignKey: 'taxonId', type: 'hasOne' },
  { alias: 'publications', description: 'PubMed articles linked to this gene, most recent first', catalog: 'pubmed', entity: 'articlesForGene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasMany' },
  { alias: 'clinvarVariants', description: 'ClinVar variants in this gene (human)', catalog: 'clinvar', entity: 'variantsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
  { alias: 'gwasAssociations', description: 'GWAS Catalog associations mapped to this gene (human)', catalog: 'gwas', entity: 'associationsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' }
]

module.exports = {
  name: 'ncbi-gene',
  label: 'NCBI Gene (Datasets)',
  description: 'NCBI Gene records for every annotated organism via the NCBI Datasets v2 API: nomenclature, RefSeq genomic location, summaries, orthologs and cross-references to Ensembl, UniProt, HGNC and OMIM; plus the NCBI Taxonomy.',
  category: 'Genes & genomes',
  homepage: 'https://www.ncbi.nlm.nih.gov/gene/',
  docs: 'https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/',
  license: 'Public domain (US Government work)',
  driver: 'api',
  connection: {
    database: 'https://api.ncbi.nlm.nih.gov/datasets/v2',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 2 },
  rateLimitWithKey: { requestsPerSecond: 10, maxConcurrent: 4 },
  auth: { header: 'api-key', required: false, signup: 'https://www.ncbi.nlm.nih.gov/account/settings/' },
  entities: [
    {
      name: 'gene',
      description: 'One NCBI Gene record by Gene ID',
      path: '/gene/id/{ncbiGeneId}',
      params: {
        ncbiGeneId: { description: 'NCBI Gene ID, e.g. 7157 (or several, comma-separated)' }
      },
      rows: 'reports',
      fields: GENE_FIELDS,
      example: { ncbiGeneId: '7157' },
      relations: GENE_RELATIONS
    },
    {
      name: 'geneBySymbol',
      description: 'The NCBI Gene record for a gene symbol in one organism',
      path: '/gene/symbol/{symbol}/taxon/{taxonId}',
      params: {
        symbol: { description: 'Gene symbol, e.g. TP53' },
        taxonId: { default: 9606, description: 'NCBI taxonomy id or name of the organism (default 9606, human)' }
      },
      rows: 'reports',
      fields: GENE_FIELDS,
      example: { symbol: 'TP53', taxonId: 9606 },
      relations: GENE_RELATIONS
    },
    {
      name: 'orthologs',
      description: 'An orthologous gene in another organism (NCBI Orthologs; includes the query gene itself)',
      path: '/gene/id/{ncbiGeneId}/orthologs',
      params: {
        ncbiGeneId: { description: 'NCBI Gene ID, e.g. 7157' }
      },
      rows: 'reports',
      fields: GENE_FIELDS,
      paginate: { limit: 'page_size', max: 1000 },
      example: { ncbiGeneId: '7157' },
      relations: [
        { alias: 'taxonomy', description: 'The organism of this ortholog', entity: 'taxonomy', localKey: 'taxonId', foreignKey: 'taxonId', type: 'hasOne' },
        { alias: 'proteins', description: 'Reviewed UniProtKB entries for this ortholog', catalog: 'uniprot', entity: 'proteins', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasMany', where: { reviewed: true } }
      ]
    },
    {
      name: 'taxonomy',
      description: 'One node of the NCBI Taxonomy',
      path: '/taxonomy/taxon/{taxonId}',
      params: {
        taxonId: { description: 'NCBI taxonomy id or scientific/common name, e.g. 9606 or human' }
      },
      rows: (body) => ((body && body.taxonomy_nodes) || []).filter((n) => n.taxonomy),
      fields: {
        taxonId: 'taxonomy.tax_id',
        scientificName: 'taxonomy.organism_name',
        commonName: 'taxonomy.genbank_common_name',
        blastName: 'taxonomy.blast_name',
        rank: (r) => (r.taxonomy && r.taxonomy.rank ? String(r.taxonomy.rank).toLowerCase() : null),
        parentTaxonId: (r) => {
          const lineage = (r.taxonomy && r.taxonomy.lineage) || []
          return lineage.length ? lineage[lineage.length - 1] : null
        },
        lineage: 'taxonomy.lineage',
        childTaxonIds: 'taxonomy.children',
        geneCount: (r) => {
          const c = ((r.taxonomy && r.taxonomy.counts) || []).find((x) => x.type === 'COUNT_TYPE_GENE')
          return c ? c.count : null
        },
        assemblyCount: (r) => {
          const c = ((r.taxonomy && r.taxonomy.counts) || []).find((x) => x.type === 'COUNT_TYPE_ASSEMBLY')
          return c ? c.count : null
        }
      },
      example: { taxonId: 9606 },
      relations: [
        { alias: 'parent', description: 'Parent taxon', entity: 'taxonomy', localKey: 'parentTaxonId', foreignKey: 'taxonId', type: 'hasOne' },
        { alias: 'uniprot', description: 'The same taxon in UniProt (protein counts)', catalog: 'uniprot', entity: 'taxonomy', localKey: 'taxonId', foreignKey: 'taxonId', type: 'hasOne' }
      ]
    }
  ]
}
