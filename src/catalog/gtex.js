'use strict'

/**
 * GTEx — the Genotype-Tissue Expression project: RNA-seq expression and
 * expression QTLs across ~50 human tissues from ~1 000 post-mortem donors.
 * API docs: https://gtexportal.org/api/v2/redoc
 *
 * GTEx keys everything by a *versioned* GENCODE id (ENSG00000141510.18), and
 * the version depends on the release: gtex_v10 uses GENCODE v39, gtex_v8 uses
 * v26.  Callers pass the ordinary unversioned Ensembl id; the entities below
 * look the versioned id up first.
 */

const GENCODE_VERSION = { gtex_v10: 'v39', gtex_v8: 'v26' }
const unversioned = (id) => (id ? String(id).replace(/\.\d+$/, '') : null)

async function gencodeIdFor (ctx, ensemblGeneId, datasetId) {
  const body = await ctx.request('/reference/gene', {
    query: {
      geneId: unversioned(ensemblGeneId),
      gencodeVersion: GENCODE_VERSION[datasetId] || 'v39',
      genomeBuild: 'GRCh38/hg38'
    }
  })
  const genes = (body && body.data) || []
  const hit = genes.find((g) => unversioned(g.gencodeId) === unversioned(ensemblGeneId)) || genes[0]
  return hit ? hit.gencodeId : null
}

const DATASET_PARAM = { in: 'query', default: 'gtex_v10', description: 'GTEx release: gtex_v10 (default) or gtex_v8' }
const TISSUE_FILTER = { in: 'filter', field: 'tissue', description: 'Only this tissue, e.g. Liver, Whole_Blood, Brain_Cortex (see the tissues entity)' }

const GENE_FIELDS = {
  ensemblGeneId: (r) => unversioned(r.gencodeId),
  gencodeId: 'gencodeId',
  symbol: 'geneSymbol',
  name: (r) => (r.description ? String(r.description).replace(/\s*\[Source:[^\]]*\]\s*$/, '') : null),
  ncbiGeneId: (r) => (r.entrezGeneId != null ? String(r.entrezGeneId) : null),
  geneType: 'geneType',
  chromosome: 'chromosome',
  start: 'start',
  end: 'end',
  strand: 'strand',
  tss: 'tss',
  gencodeVersion: 'gencodeVersion'
}

module.exports = {
  name: 'gtex',
  label: 'GTEx Portal',
  description: 'Genotype-Tissue Expression: median gene expression (TPM) and single-tissue eQTLs across ~50 human tissues from ~1 000 donors. Queried by unversioned Ensembl gene id; the GENCODE version is resolved per release.',
  category: 'Expression & samples',
  homepage: 'https://gtexportal.org',
  docs: 'https://gtexportal.org/api/v2/redoc',
  license: 'Open access (dbGaP-protected individual-level data is not exposed by this API)',
  driver: 'api',
  connection: {
    database: 'https://gtexportal.org/api/v2',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 2 },
  timeoutMs: 45_000,
  entities: [
    {
      name: 'gene',
      description: 'GTEx/GENCODE reference record for a gene',
      path: '/reference/gene',
      params: {
        ensemblGeneId: { in: 'query', required: true, description: 'Ensembl gene id (unversioned) or gene symbol, e.g. ENSG00000141510 or TP53' },
        datasetId: DATASET_PARAM
      },
      query: (params) => ({
        geneId: unversioned(params.ensemblGeneId),
        gencodeVersion: GENCODE_VERSION[params.datasetId] || 'v39',
        genomeBuild: 'GRCh38/hg38'
      }),
      rows: 'data',
      fields: GENE_FIELDS,
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: [
        { alias: 'expression', description: 'Median expression per tissue', entity: 'expression', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
        { alias: 'eqtls', description: 'Significant single-tissue eQTLs', entity: 'eqtls', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
        { alias: 'ensembl', description: 'Ensembl gene record', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' }
      ]
    },
    {
      name: 'expression',
      description: 'Median expression (TPM) of a gene in each GTEx tissue',
      params: {
        ensemblGeneId: { in: 'query', required: true, description: 'Ensembl gene id, e.g. ENSG00000141510' },
        datasetId: DATASET_PARAM,
        tissue: TISSUE_FILTER
      },
      resolve: async (params, ctx) => {
        const gencodeId = await gencodeIdFor(ctx, params.ensemblGeneId, params.datasetId)
        if (!gencodeId) return []
        const body = await ctx.request('/expression/medianGeneExpression', {
          query: { gencodeId, datasetId: params.datasetId }
        })
        return (body && body.data) || []
      },
      fields: {
        ensemblGeneId: (r) => unversioned(r.gencodeId),
        symbol: 'geneSymbol',
        tissue: 'tissueSiteDetailId',
        uberonId: 'ontologyId',
        medianTpm: 'median',
        unit: 'unit',
        datasetId: 'datasetId'
      },
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: [
        { alias: 'tissueDetail', description: 'Sampling details for this tissue', entity: 'tissues', localKey: 'tissue', foreignKey: 'tissue', type: 'hasOne' }
      ]
    },
    {
      name: 'eqtls',
      description: 'Significant single-tissue cis-eQTLs for a gene',
      params: {
        ensemblGeneId: { in: 'query', required: true, description: 'Ensembl gene id, e.g. ENSG00000141510' },
        datasetId: DATASET_PARAM,
        tissue: TISSUE_FILTER
      },
      resolve: async (params, ctx) => {
        const gencodeId = await gencodeIdFor(ctx, params.ensemblGeneId, params.datasetId)
        if (!gencodeId) return []
        const body = await ctx.request('/association/singleTissueEqtl', {
          query: { gencodeId, datasetId: params.datasetId, itemsPerPage: 1000 }
        })
        return (body && body.data) || []
      },
      fields: {
        ensemblGeneId: (r) => unversioned(r.gencodeId),
        symbol: 'geneSymbol',
        rsId: 'snpId',
        variantId: 'variantId',
        chromosome: 'chromosome',
        position: 'pos',
        tissue: 'tissueSiteDetailId',
        uberonId: 'ontologyId',
        pValue: 'pValue',
        normalizedEffectSize: 'nes',
        datasetId: 'datasetId'
      },
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: [
        { alias: 'variant', description: 'Ensembl record for the eQTL variant', catalog: 'ensembl', entity: 'variant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasOne' },
        { alias: 'gwasAssociations', description: 'GWAS Catalog associations for the eQTL variant', catalog: 'gwas', entity: 'associationsForVariant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' }
      ]
    },
    {
      name: 'tissues',
      description: 'GTEx tissues with sample counts and UBERON mappings',
      path: '/dataset/tissueSiteDetail',
      params: {
        datasetId: DATASET_PARAM,
        tissue: TISSUE_FILTER
      },
      query: (params) => ({ datasetId: params.datasetId }),
      rows: 'data',
      fields: {
        tissue: 'tissueSiteDetailId',
        name: 'tissueSiteDetail',
        tissueSite: 'tissueSite',
        abbreviation: 'tissueSiteDetailAbbr',
        uberonId: 'ontologyId',
        samplingSite: 'samplingSite',
        rnaSeqSampleCount: 'rnaSeqSampleSummary.totalCount',
        eqtlSampleCount: 'eqtlSampleSummary.totalCount',
        expressedGeneCount: 'expressedGeneCount',
        eGeneCount: 'eGeneCount',
        datasetId: 'datasetId'
      },
      example: {},
      relations: []
    }
  ]
}
