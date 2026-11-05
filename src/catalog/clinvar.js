'use strict'

/**
 * ClinVar — NCBI's archive of human genetic variants and their relationship
 * to disease, with germline, somatic-oncogenicity and clinical-impact
 * classifications, via NCBI E-utilities (db=clinvar).
 * API docs: https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/
 *
 * Shares NCBI's rate limit (3 req/s, 10 with apiKeys: { clinvar: "…" }).
 */

const { eutils } = require('./ncbi')

const { EUTILS, esearch, esummary, idList } = eutils

// ClinVar's own filter properties for the germline classification.
const SIGNIFICANCE = {
  pathogenic: 'clinsig_pathogenic',
  likely_pathogenic: 'clinsig_likely_pathogenic',
  uncertain_significance: 'clinsig_vus',
  likely_benign: 'clinsig_likely_benign',
  benign: 'clinsig_benign',
  conflicting: 'clinsig_has_conflicts'
}

function significanceFilter (value) {
  const key = String(value).toLowerCase().replace(/[\s-]+/g, '_')
  const prop = SIGNIFICANCE[key]
  if (!prop) throw new Error(`clinvar: significance must be one of ${Object.keys(SIGNIFICANCE).join(', ')}`)
  return `${prop}[prop]`
}

/** Accept the numeric variation id or a VCV accession (VCV000012347[.84]). */
function variationUid (value) {
  const m = String(value).trim().match(/^VCV0*(\d+)(?:\.\d+)?$/i)
  return m ? m[1] : String(value).trim()
}

const xref = (doc, source) => {
  for (const v of doc.variation_set || []) {
    const x = (v.variation_xrefs || []).find((r) => r.db_source === source)
    if (x) return x.db_id
  }
  return null
}

const location = (doc, key) => {
  for (const v of doc.variation_set || []) {
    const loc = (v.variation_loc || []).find((l) => l.assembly_name === 'GRCh38' && l.status === 'current')
    if (loc && loc[key] !== '') return loc[key]
  }
  return null
}

const traits = (classification) => ((classification && classification.trait_set) || [])

const VARIANT_FIELDS = {
  clinvarId: 'uid',
  accession: 'accession_version|accession',
  title: 'title',
  variantType: 'obj_type',
  hgvs: 'variation_set[0].variation_name',
  cdnaChange: 'variation_set[0].cdna_change',
  proteinChange: 'protein_change',
  molecularConsequences: 'molecular_consequence_list',
  symbol: 'genes[0].symbol',
  ncbiGeneId: 'genes[0].geneid',
  genes: 'genes[].symbol',
  rsId: (doc) => {
    const id = xref(doc, 'dbSNP')
    return id ? `rs${id}` : null
  },
  chromosome: (doc) => location(doc, 'chr'),
  start: (doc) => {
    const v = location(doc, 'start')
    return v != null ? Number(v) : null
  },
  stop: (doc) => {
    const v = location(doc, 'stop')
    return v != null ? Number(v) : null
  },
  cytoband: (doc) => location(doc, 'band'),
  germlineClassification: 'germline_classification.description',
  reviewStatus: 'germline_classification.review_status',
  lastEvaluated: 'germline_classification.last_evaluated',
  conditions: (doc) => traits(doc.germline_classification).map((t) => t.trait_name),
  conditionIds: (doc) => traits(doc.germline_classification)
    .flatMap((t) => (t.trait_xrefs || []).filter((x) => x.db_source === 'MONDO').map((x) => x.db_id)),
  oncogenicityClassification: 'oncogenicity_classification.description',
  clinicalImpactClassification: 'clinical_impact_classification.description',
  submissionCount: (doc) => ((doc.supporting_submissions && doc.supporting_submissions.scv) || []).length
}

const VARIANT_RELATIONS = [
  { alias: 'gene', description: 'The NCBI Gene record of the (first) affected gene', catalog: 'ncbi-gene', entity: 'gene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasOne' },
  { alias: 'myvariant', description: 'Aggregated annotation for this variant (MyVariant.info: CADD, gnomAD frequencies, dbNSFP)', catalog: 'myvariant', entity: 'variantByRsId', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' },
  { alias: 'ensemblVariant', description: 'Ensembl variation record: alleles, frequencies, consequences', catalog: 'ensembl', entity: 'variant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasOne' },
  { alias: 'gwasAssociations', description: 'GWAS Catalog associations for this variant', catalog: 'gwas', entity: 'associationsForVariant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' }
]

module.exports = {
  name: 'clinvar',
  label: 'ClinVar',
  description: 'NCBI archive of human genetic variants and their relationship to disease: germline pathogenicity, somatic oncogenicity and clinical-impact classifications with review status, conditions, HGVS and genomic location (GRCh38).',
  category: 'Disease & variants',
  homepage: 'https://www.ncbi.nlm.nih.gov/clinvar/',
  docs: 'https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/',
  license: 'Public domain (US Government work); submitters retain credit',
  driver: 'api',
  ...EUTILS,
  entities: [
    {
      name: 'variant',
      description: 'One ClinVar variation record (or several)',
      params: {
        clinvarId: { required: true, description: 'Variation id (e.g. 12347) or VCV accession (e.g. VCV000012347), or a list of them' }
      },
      resolve: (params, ctx) => esummary(ctx, 'clinvar', idList(params.clinvarId).map(variationUid)),
      fields: VARIANT_FIELDS,
      example: { clinvarId: '12347' },
      relations: VARIANT_RELATIONS
    },
    {
      name: 'variantsForGene',
      description: 'ClinVar variants in a gene, optionally restricted to one germline classification',
      params: {
        symbol: { required: true, description: 'Human gene symbol, e.g. TP53' },
        significance: { description: `Germline classification: ${Object.keys(SIGNIFICANCE).join(', ')}` }
      },
      resolve: async (params, ctx) => {
        let term = `${params.symbol}[gene]`
        if (params.significance) term += ` AND ${significanceFilter(params.significance)}`
        return esummary(ctx, 'clinvar', await esearch(ctx, 'clinvar', term))
      },
      fields: VARIANT_FIELDS,
      example: { symbol: 'TP53', significance: 'pathogenic' },
      relations: VARIANT_RELATIONS
    },
    {
      name: 'variants',
      description: 'ClinVar variants matching an Entrez query',
      params: {
        term: { required: true, description: 'ClinVar query, e.g. "BRCA1[gene] AND clinsig_pathogenic[prop] AND single_gene[prop]" — https://www.ncbi.nlm.nih.gov/clinvar/docs/help/' }
      },
      resolve: async (params, ctx) => esummary(ctx, 'clinvar', await esearch(ctx, 'clinvar', params.term)),
      fields: VARIANT_FIELDS,
      example: { term: 'BRCA1[gene] AND clinsig_pathogenic[prop]' },
      relations: VARIANT_RELATIONS
    }
  ]
}
