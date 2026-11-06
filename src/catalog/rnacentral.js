'use strict'

/**
 * RNAcentral — a comprehensive database of non-coding RNA sequences, merging
 * 50+ expert databases (miRBase, Rfam, GtRNAdb, LNCipedia, HGNC, Ensembl…).
 * API docs: https://rnacentral.org/api
 *
 * An RNA has a universal id (`URS000075C808`) and species-specific ids
 * (`URS000075C808_9606`).  The `rna` entity accepts either; cross-references
 * are kept per universal id and filtered to the species when one is given.
 *
 * This replaces the earlier entry for RNAcentral's public PostgreSQL
 * database, whose read-only account no longer has access to its schema.
 */

const EBI_SEARCH = 'https://www.ebi.ac.uk/ebisearch/ws/rest/rnacentral'

const universalId = (id) => String(id).replace(/_\d+$/, '')
const taxonOf = (id) => {
  const m = String(id).match(/_(\d+)$/)
  return m ? Number(m[1]) : null
}
const first = (v) => (Array.isArray(v) ? (v[0] != null ? v[0] : null) : (v != null ? v : null))

module.exports = {
  name: 'rnacentral',
  label: 'RNAcentral',
  description: 'RNAcentral: non-coding RNA sequences (miRNA, lncRNA, rRNA, tRNA, snoRNA, …) integrated from 50+ expert databases, with species-specific identifiers and cross-references.',
  category: 'Proteins & structures',
  homepage: 'https://rnacentral.org',
  docs: 'https://rnacentral.org/api',
  license: 'CC0 1.0',
  driver: 'api',
  connection: {
    database: 'https://rnacentral.org/api/v1',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 4, maxConcurrent: 2 },
  timeoutMs: 60_000,
  entities: [
    {
      name: 'rna',
      description: 'One non-coding RNA by RNAcentral id (universal or species-specific)',
      path: '/rna/{rnacentralId}/',
      params: {
        rnacentralId: { description: 'RNAcentral id, e.g. URS000075C808_9606 (HOTAIR, human) or URS000075C808' }
      },
      fields: {
        rnacentralId: 'rnacentral_id',
        description: 'description',
        shortDescription: 'short_description',
        rnaType: 'rna_type',
        length: 'length',
        organism: 'species',
        taxonId: (r) => (r.taxid != null ? r.taxid : taxonOf(r.rnacentral_id)),
        databases: (r) => (typeof r.distinct_databases === 'string' ? r.distinct_databases.split(',').filter(Boolean) : []),
        organismCount: 'count_distinct_organisms',
        md5: 'md5',
        sequence: 'sequence'
      },
      example: { rnacentralId: 'URS000075C808_9606' },
      relations: [
        { alias: 'xrefs', description: 'Records for this RNA in the expert databases', entity: 'xrefs', obo: 'rnacentral', type: 'hasMany' },
        { alias: 'taxonomy', description: 'The organism (species-specific ids only)', catalog: 'uniprot', entity: 'taxonomy', obo: 'ncbitaxon', type: 'hasOne' }
      ]
    },
    {
      name: 'xrefs',
      description: 'Cross-references of an RNA to the expert databases (filtered to the species for a species-specific id)',
      path: '/rna/{rnacentralId}/xrefs',
      params: {
        rnacentralId: { description: 'RNAcentral id, e.g. URS000075C808_9606', transform: universalId }
      },
      query: { page_size: 100 },
      rows: (body, params) => {
        const taxon = taxonOf(params.rnacentralId)
        const results = (body && body.results) || []
        return taxon == null ? results : results.filter((r) => r.taxid === taxon)
      },
      fields: {
        rnacentralId: (r) => `${r.upi}_${r.taxid}`,
        database: 'database',
        externalId: 'accession.external_id',
        optionalId: 'accession.optional_id',
        description: 'accession.description',
        rnaType: 'accession.rna_type',
        gene: 'accession.gene',
        product: 'accession.product',
        organism: 'accession.species',
        taxonId: 'taxid',
        ncbiGeneId: (r) => (r.ncbi_gene_id != null ? String(r.ncbi_gene_id) : null),
        hgncId: 'accession.hgnc_id',
        ensemblUrl: 'ensembl_url|accession.ensembl_gene_url',
        expertDbUrl: 'accession.expert_db_url',
        isActive: 'is_active'
      },
      paginate: { limit: 'page_size', max: 100 },
      example: { rnacentralId: 'URS000075C808_9606' },
      relations: [
        { alias: 'rna', description: 'The RNAcentral record', entity: 'rna', obo: 'rnacentral', type: 'hasOne' }
      ]
    },
    {
      name: 'rnas',
      description: 'Search non-coding RNAs by name, gene or description (EBI Search)',
      path: null,
      params: {
        query: { required: true, description: 'Search text, e.g. HOTAIR or MIR21; EBI Search syntax is allowed' },
        taxonId: { description: 'Restrict to one species, e.g. 9606' },
        rnaType: { description: 'Restrict to an RNA type, e.g. miRNA, lncRNA, rRNA' }
      },
      resolve: async (params, ctx) => {
        const terms = [`(${params.query})`]
        if (params.taxonId) terms.push(`TAXONOMY:${params.taxonId}`)
        if (params.rnaType) terms.push(`rna_type:"${params.rnaType}"`)
        const size = Math.min((ctx.limit || 25) + (ctx.offset || 0), 100)
        const body = await ctx.request(EBI_SEARCH, {
          query: { query: terms.join(' AND '), format: 'json', size, start: 0, fields: 'description,rna_type,length,expert_db' }
        })
        return (body && body.entries) || []
      },
      fields: {
        rnacentralId: 'id',
        description: (r) => first(r.fields && r.fields.description),
        rnaType: (r) => first(r.fields && r.fields.rna_type),
        length: (r) => (first(r.fields && r.fields.length) != null ? Number(first(r.fields.length)) : null),
        taxonId: (r) => taxonOf(r.id),
        databases: 'fields.expert_db'
      },
      example: { query: 'HOTAIR', taxonId: 9606 },
      relations: [
        { alias: 'rna', description: 'The full RNAcentral record', entity: 'rna', obo: 'rnacentral', type: 'hasOne' }
      ]
    }
  ]
}
