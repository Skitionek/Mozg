'use strict'

/**
 * NHGRI-EBI GWAS Catalog — curated SNP–trait associations from published
 * genome-wide association studies.
 * API docs: https://www.ebi.ac.uk/gwas/rest/docs/api-v2  (v1 is retired and answers 410)
 *
 * Trait ids come back as EFO/MONDO with an underscore; Mozg returns the colon
 * CURIE (EFO:0004611) and accepts either form in `diseaseId`.
 */

const toCurie = (id) => (id == null ? null : String(id).replace(/^([A-Za-z][A-Za-z0-9]*)_/, '$1:'))
const toUnderscore = (id) => String(id).trim().replace(':', '_')

const ASSOCIATION_FIELDS = {
  associationId: 'association_id',
  rsId: 'snp_allele[0].rs_id',
  riskAllele: 'snp_allele[0].effect_allele',
  // p_value underflows to 0 for the strongest hits; mantissa × 10^exponent does not
  pValue: 'p_value',
  pValueMantissa: 'pvalue_mantissa',
  pValueExponent: 'pvalue_exponent',
  pValueDescription: (r) => r.pvalue_description || null,
  oddsRatio: 'or_per_copy_num',
  beta: (r) => (r.beta && r.beta !== '-' ? r.beta : null),
  confidenceInterval: (r) => r.range || null,
  riskFrequency: (r) => (r.risk_frequency && r.risk_frequency !== 'NR' ? Number(r.risk_frequency) : null),
  diseaseId: (r) => toCurie(r.efo_traits && r.efo_traits[0] && r.efo_traits[0].efo_id),
  diseaseIds: (r) => (r.efo_traits || []).map((t) => toCurie(t.efo_id)),
  traits: 'efo_traits[].efo_trait',
  reportedTraits: 'reported_trait',
  mappedGenes: 'mapped_genes',
  location: 'locations[0]',
  studyId: 'accession_id',
  pmid: (r) => (r.pubmed_id != null ? String(r.pubmed_id) : null),
  firstAuthor: 'first_author'
}

const ASSOCIATION_RELATIONS = [
  { alias: 'study', description: 'The GWAS study that reported this association', entity: 'study', localKey: 'studyId', foreignKey: 'studyId', type: 'hasOne' },
  { alias: 'variant', description: 'GWAS Catalog record of the lead variant', entity: 'variant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasOne' },
  { alias: 'annotation', description: 'MyVariant.info annotation (ClinVar, CADD, gnomAD frequencies)', catalog: 'myvariant', entity: 'variantByRsId', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' },
  { alias: 'ensemblVariant', description: 'Ensembl variation record (alleles, consequences, mappings)', catalog: 'ensembl', entity: 'variant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasOne' },
  { alias: 'disease', description: 'Open Targets record of the (first) mapped trait', catalog: 'opentargets', entity: 'disease', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasOne' },
  { alias: 'publication', description: 'The publication (Europe PMC)', catalog: 'europepmc', entity: 'article', localKey: 'pmid', foreignKey: 'pmid', type: 'hasOne' }
]

// Strongest associations first; 50 per request unless the caller asks for a limit.
const SORTED = { sort: 'p_value', direction: 'asc', size: 50 }
const PAGINATE = { limit: 'size', page: 'page', pageBase: 0, max: 1000 }

module.exports = {
  name: 'gwas',
  label: 'GWAS Catalog',
  description: 'NHGRI-EBI catalogue of published genome-wide association studies: SNP–trait associations with p-values, effect sizes and risk alleles, mapped to EFO/MONDO traits and genes.',
  category: 'Disease & variants',
  homepage: 'https://www.ebi.ac.uk/gwas',
  docs: 'https://www.ebi.ac.uk/gwas/rest/docs/api-v2',
  license: 'EMBL-EBI terms of use (data freely available)',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/gwas/rest/api/v2',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  entities: [
    {
      name: 'associationsForGene',
      description: 'Associations whose variant maps to a gene, strongest first',
      path: '/associations',
      params: {
        symbol: { name: 'mapped_gene', required: true, description: 'Mapped gene symbol, e.g. APOE' }
      },
      query: SORTED,
      rows: '_embedded.associations',
      fields: ASSOCIATION_FIELDS,
      paginate: PAGINATE,
      example: { symbol: 'APOE' },
      relations: ASSOCIATION_RELATIONS
    },
    {
      name: 'associationsForVariant',
      description: 'Associations reported for a variant, strongest first',
      path: '/associations',
      params: {
        rsId: { name: 'rs_id', required: true, description: 'dbSNP id, e.g. rs7412' }
      },
      query: SORTED,
      rows: '_embedded.associations',
      fields: ASSOCIATION_FIELDS,
      paginate: PAGINATE,
      example: { rsId: 'rs7412' },
      relations: ASSOCIATION_RELATIONS
    },
    {
      name: 'associationsForTrait',
      description: 'Associations mapped to a trait or disease, strongest first',
      path: '/associations',
      params: {
        diseaseId: { name: 'efo_id', required: true, transform: toUnderscore, description: 'Trait CURIE, e.g. MONDO:0007254 or EFO:0004611' }
      },
      query: SORTED,
      rows: '_embedded.associations',
      fields: ASSOCIATION_FIELDS,
      paginate: PAGINATE,
      example: { diseaseId: 'MONDO:0007254' },
      relations: ASSOCIATION_RELATIONS
    },
    {
      name: 'associationsForStudy',
      description: 'Associations reported by one study, strongest first',
      path: '/associations',
      params: {
        studyId: { name: 'accession_id', required: true, description: 'GWAS Catalog study accession, e.g. GCST000001' }
      },
      query: SORTED,
      rows: '_embedded.associations',
      fields: ASSOCIATION_FIELDS,
      paginate: PAGINATE,
      example: { studyId: 'GCST000001' },
      relations: ASSOCIATION_RELATIONS
    },
    {
      name: 'study',
      description: 'A published GWAS: trait, cohort, ancestry and platform',
      path: '/studies/{studyId}',
      params: {
        studyId: { description: 'GWAS Catalog study accession, e.g. GCST000001' }
      },
      fields: {
        studyId: 'accession_id',
        trait: 'disease_trait',
        diseaseId: (r) => toCurie(r.efo_traits && r.efo_traits[0] && r.efo_traits[0].efo_id),
        diseaseIds: (r) => (r.efo_traits || []).map((t) => toCurie(t.efo_id)),
        traits: 'efo_traits[].efo_trait',
        pmid: (r) => (r.pubmed_id != null ? String(r.pubmed_id) : null),
        initialSampleSize: 'initial_sample_size',
        replicationSampleSize: 'replication_sample_size',
        discoveryAncestry: 'discovery_ancestry',
        replicationAncestry: 'replication_ancestry',
        snpCount: 'snp_count',
        platforms: 'platforms',
        genotypingTechnologies: 'genotyping_technologies',
        summaryStatsAvailable: 'full_summary_stats_available',
        summaryStats: (r) => (r.full_summary_stats && r.full_summary_stats !== 'NA' ? r.full_summary_stats : null)
      },
      example: { studyId: 'GCST000001' },
      relations: [
        { alias: 'associations', description: 'Associations this study reported', entity: 'associationsForStudy', localKey: 'studyId', foreignKey: 'studyId', type: 'hasMany' },
        { alias: 'disease', description: 'Open Targets record of the (first) mapped trait', catalog: 'opentargets', entity: 'disease', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasOne' },
        { alias: 'publication', description: 'The publication (Europe PMC)', catalog: 'europepmc', entity: 'article', localKey: 'pmid', foreignKey: 'pmid', type: 'hasOne' }
      ]
    },
    {
      name: 'variant',
      description: 'A variant (SNP) as recorded by the GWAS Catalog: location, consequence and mapped genes',
      path: '/single-nucleotide-polymorphisms/{rsId}',
      params: {
        rsId: { description: 'dbSNP id, e.g. rs7412' }
      },
      fields: {
        rsId: 'rs_id',
        chromosome: 'locations[0].chromosome_name',
        position: 'locations[0].chromosome_position',
        region: 'locations[0].region.name',
        alleles: 'alleles',
        functionalClass: 'functional_class',
        mostSevereConsequence: 'most_severe_consequence',
        mappedGenes: 'mapped_genes',
        merged: (r) => Boolean(r.merged)
      },
      example: { rsId: 'rs7412' },
      relations: [
        { alias: 'associations', description: 'Trait associations reported for this variant', entity: 'associationsForVariant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' },
        { alias: 'annotation', description: 'MyVariant.info annotation (ClinVar, CADD, gnomAD frequencies)', catalog: 'myvariant', entity: 'variantByRsId', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' },
        { alias: 'ensemblVariant', description: 'Ensembl variation record', catalog: 'ensembl', entity: 'variant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasOne' }
      ]
    }
  ]
}
