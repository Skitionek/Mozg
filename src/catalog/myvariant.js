'use strict'

/**
 * MyVariant.info — aggregated variant annotation (BioThings): ClinVar,
 * dbSNP, CADD, gnomAD, dbNSFP (AlphaMissense, PolyPhen, SIFT…), SnpEff and
 * more, keyed by HGVS genomic id.
 * API docs: https://docs.myvariant.info/en/latest/doc/variant_annotation_service.html
 *
 * Variant ids are HGVS genomic strings on hg19 by default
 * (chr17:g.7578406C>T); pass `assembly: "hg38"` to use hg38 coordinates.
 */

// Annotation sections requested from the API — the full documents carry
// hundreds of dbNSFP scores per transcript, far more than these fields use.
const FIELDS = [
  'dbsnp.rsid', 'chrom', 'vcf', 'hg19', 'hg38',
  'clinvar.rsid', 'clinvar.variant_id', 'clinvar.gene', 'clinvar.type', 'clinvar.hg38', 'clinvar.hgvs.protein',
  'clinvar.rcv.clinical_significance', 'clinvar.rcv.conditions.name',
  'cadd.phred', 'cadd.consequence', 'cadd.gene.gene_id', 'cadd.gene.genename',
  'snpeff.ann.effect', 'snpeff.ann.putative_impact', 'snpeff.ann.genename', 'snpeff.ann.hgvs_p',
  'dbnsfp.genename', 'dbnsfp.ensembl.geneid', 'dbnsfp.hgvsp', 'dbnsfp.alphamissense.rankscore', 'dbnsfp.alphamissense.pred',
  'gnomad_exome.af.af', 'gnomad_genome.af.af'
].join(',')

// BioThings returns a single object where a list has one element.
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
const first = (v) => list(v)[0] ?? null
const unique = (values) => [...new Set(values.filter((v) => v != null && v !== ''))]

const VARIANT_FIELDS = {
  hgvs: '_id',
  rsId: 'dbsnp.rsid|clinvar.rsid',
  chromosome: 'chrom',
  position: (r) => (r.vcf && r.vcf.position != null ? Number(r.vcf.position) : null),
  ref: 'vcf.ref',
  alt: 'vcf.alt',
  hg38Position: 'hg38.start|clinvar.hg38.start',
  symbol: (r) => (r.clinvar && r.clinvar.gene && first(r.clinvar.gene).symbol) || first(r.dbnsfp && r.dbnsfp.genename) || (r.cadd && first(r.cadd.gene) && first(r.cadd.gene).genename) || null,
  ncbiGeneId: (r) => {
    const g = r.clinvar && first(r.clinvar.gene)
    return g && g.id != null ? String(g.id) : null
  },
  ensemblGeneId: (r) => (r.cadd && first(r.cadd.gene) && first(r.cadd.gene).gene_id) || first(r.dbnsfp && r.dbnsfp.ensembl && r.dbnsfp.ensembl.geneid) || null,
  clinvarId: (r) => (r.clinvar && r.clinvar.variant_id != null ? String(r.clinvar.variant_id) : null),
  clinicalSignificance: (r) => unique(list(r.clinvar && r.clinvar.rcv).map((x) => x.clinical_significance)),
  conditions: (r) => unique(list(r.clinvar && r.clinvar.rcv).flatMap((x) => list(x.conditions).map((c) => c.name)))
    .filter((name) => !/^not (provided|specified)$/i.test(name)),
  variantType: 'clinvar.type',
  consequence: (r) => (r.cadd && first(r.cadd.consequence)) || (r.snpeff && first(r.snpeff.ann) && first(r.snpeff.ann).effect) || null,
  impact: (r) => (r.snpeff && first(r.snpeff.ann) && first(r.snpeff.ann).putative_impact) || null,
  // ClinVar lists the canonical (LRG / MANE) transcript first; dbNSFP's order is arbitrary across isoforms
  proteinChange: (r) => {
    const clinvar = first(r.clinvar && r.clinvar.hgvs && r.clinvar.hgvs.protein)
    if (clinvar) return String(clinvar).replace(/^[^:]+:/, '')
    return list(r.dbnsfp && r.dbnsfp.hgvsp).find((p) => /^p\.[A-Z][a-z]{2}/.test(p)) || first(r.dbnsfp && r.dbnsfp.hgvsp)
  },
  caddPhred: 'cadd.phred',
  alphaMissenseRankscore: 'dbnsfp.alphamissense.rankscore',
  gnomadExomeAf: 'gnomad_exome.af.af',
  gnomadGenomeAf: 'gnomad_genome.af.af'
}

const VARIANT_RELATIONS = [
  { alias: 'gwasAssociations', description: 'GWAS Catalog trait associations for this variant', catalog: 'gwas', entity: 'associationsForVariant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' },
  { alias: 'ensemblVariant', description: 'Ensembl variation record', catalog: 'ensembl', entity: 'variant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasOne' },
  { alias: 'gene', description: 'Ensembl gene the variant falls in', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'clinvar', description: 'The ClinVar variation record', catalog: 'clinvar', entity: 'variant', localKey: 'clinvarId', foreignKey: 'clinvarId', type: 'hasOne' },
  { alias: 'civic', description: 'CIViC clinical-interpretation summary for the gene', catalog: 'civic', entity: 'gene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasOne' }
]

module.exports = {
  name: 'myvariant',
  label: 'MyVariant.info',
  description: 'Aggregated variant annotation from ClinVar, dbSNP, CADD, gnomAD, dbNSFP (AlphaMissense, PolyPhen, SIFT) and SnpEff, keyed by HGVS genomic id or dbSNP rsid.',
  category: 'Disease & variants',
  homepage: 'https://myvariant.info',
  docs: 'https://docs.myvariant.info',
  license: 'Aggregated sources carry their own licences (see each section\'s _license)',
  driver: 'api',
  connection: {
    database: 'https://myvariant.info/v1',
    headers: { Accept: 'application/json' }
  },
  // BioThings asks for at most ~1000 requests per user per minute without batching.
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'variant',
      description: 'Annotation of one variant by HGVS genomic id',
      path: '/variant/{hgvs}',
      params: {
        hgvs: { description: 'HGVS genomic id, e.g. chr17:g.7578406C>T (hg19) — or hg38 coordinates with assembly: "hg38"' },
        assembly: { description: 'hg19 (default) or hg38' }
      },
      query: (p) => ({ fields: FIELDS, assembly: p.assembly }),
      fields: VARIANT_FIELDS,
      example: { hgvs: 'chr17:g.7578406C>T' },
      relations: VARIANT_RELATIONS
    },
    {
      name: 'variantByRsId',
      description: 'Annotations of every allele recorded under a dbSNP id',
      path: '/query',
      params: {
        rsId: { required: true, description: 'dbSNP id, e.g. rs28934578' },
        assembly: { description: 'hg19 (default) or hg38' }
      },
      query: (p) => ({ q: `dbsnp.rsid:${p.rsId}`, fields: FIELDS, assembly: p.assembly }),
      rows: 'hits',
      fields: VARIANT_FIELDS,
      paginate: { limit: 'size', offset: 'from', max: 1000 },
      example: { rsId: 'rs28934578' },
      relations: VARIANT_RELATIONS
    },
    {
      name: 'variants',
      description: 'Variants matching a MyVariant query, e.g. pathogenic ClinVar variants in a gene',
      path: '/query',
      params: {
        q: { required: true, description: 'Query string — https://docs.myvariant.info/en/latest/doc/variant_query_service.html, e.g. clinvar.gene.symbol:TP53 AND clinvar.rcv.clinical_significance:Pathogenic' },
        assembly: { description: 'hg19 (default) or hg38' }
      },
      query: (p) => ({ q: p.q, fields: FIELDS, assembly: p.assembly }),
      rows: 'hits',
      fields: VARIANT_FIELDS,
      paginate: { limit: 'size', offset: 'from', max: 1000 },
      example: { q: 'clinvar.gene.symbol:TP53 AND clinvar.rcv.clinical_significance:Pathogenic' },
      relations: VARIANT_RELATIONS
    }
  ]
}
