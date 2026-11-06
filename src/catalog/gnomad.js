'use strict'

/**
 * gnomAD — the Genome Aggregation Database: allele frequencies from 800k+
 * exomes and genomes, and per-gene constraint (pLI, LOEUF, missense Z).
 * API: GraphQL at https://gnomad.broadinstitute.org/api (browser backend,
 * rate-limited — keep fan-out small).
 *
 * Variant ids are chrom-pos-ref-alt on the dataset's reference genome
 * (GRCh38 for gnomad_r4/gnomad_r3, GRCh37 for gnomad_r2_1).
 */

const DEFAULT_DATASET = 'gnomad_r4'

const VARIANT_SELECTION = `
  variant_id reference_genome chrom pos ref alt rsids caid
  exome { ac an af homozygote_count filters }
  genome { ac an af homozygote_count filters }
  transcript_consequences { gene_symbol gene_id transcript_id major_consequence hgvsc hgvsp is_canonical lof }
`

const canonical = (r) => {
  const tcs = r.transcript_consequences || []
  return tcs.find((t) => t.is_canonical) || tcs[0] || {}
}
const sum = (...values) => (values.every((v) => v == null) ? null : values.reduce((a, v) => a + (v || 0), 0))

const VARIANT_FIELDS = {
  variantId: 'variant_id',
  rsId: 'rsids[0]',
  referenceGenome: 'reference_genome',
  chromosome: 'chrom',
  position: 'pos',
  ref: 'ref',
  alt: 'alt',
  clingenAlleleId: 'caid',
  exomeAf: 'exome.af',
  exomeAc: 'exome.ac',
  exomeAn: 'exome.an',
  genomeAf: 'genome.af',
  genomeAc: 'genome.ac',
  genomeAn: 'genome.an',
  // Combined exome + genome frequency, as the gnomAD browser reports it
  af: (r) => {
    const ac = sum(r.exome && r.exome.ac, r.genome && r.genome.ac)
    const an = sum(r.exome && r.exome.an, r.genome && r.genome.an)
    return ac != null && an ? ac / an : null
  },
  homozygoteCount: (r) => sum(r.exome && r.exome.homozygote_count, r.genome && r.genome.homozygote_count),
  filters: (r) => [...new Set([...((r.exome && r.exome.filters) || []), ...((r.genome && r.genome.filters) || [])])],
  ensemblGeneId: (r) => canonical(r).gene_id || null,
  symbol: (r) => canonical(r).gene_symbol || null,
  transcriptId: (r) => canonical(r).transcript_id || null,
  consequence: (r) => canonical(r).major_consequence || null,
  hgvsc: (r) => canonical(r).hgvsc || null,
  hgvsp: (r) => canonical(r).hgvsp || null,
  lof: (r) => canonical(r).lof || null
}

const VARIANT_RELATIONS = [
  { alias: 'geneConstraint', description: 'Constraint of the gene the variant falls in', entity: 'geneConstraint', obo: 'ensembl', type: 'hasOne' },
  { alias: 'gene', description: 'Ensembl gene record', catalog: 'ensembl', entity: 'gene', obo: 'ensembl', type: 'hasOne' },
  { alias: 'annotation', description: 'MyVariant.info annotation (ClinVar, CADD, AlphaMissense)', catalog: 'myvariant', entity: 'variantByRsId', obo: 'dbsnp', type: 'hasMany' },
  { alias: 'gwasAssociations', description: 'GWAS Catalog trait associations', catalog: 'gwas', entity: 'associationsForVariant', obo: 'dbsnp', type: 'hasMany' }
]

async function graphql (ctx, query, variables) {
  const body = await ctx.request('', { method: 'POST', body: { query, variables } })
  const errors = body && Array.isArray(body.errors) && body.errors.length ? body.errors.map((e) => e.message).join('; ') : null
  if (errors && !(body && body.data)) throw new Error(`gnomad/${ctx.entity.name}: ${errors}`)
  return (body && body.data) || {}
}

const DATASET_PARAM = { in: 'body', default: DEFAULT_DATASET, description: 'gnomad_r4 (default, GRCh38), gnomad_r3 (GRCh38 genomes) or gnomad_r2_1 (GRCh37)' }

module.exports = {
  name: 'gnomad',
  label: 'gnomAD',
  description: 'Genome Aggregation Database: population allele frequencies from 800k+ exomes and genomes, and gene constraint (pLI, LOEUF, missense Z) — how intolerant a gene is to damaging variation.',
  category: 'Disease & variants',
  homepage: 'https://gnomad.broadinstitute.org',
  docs: 'https://gnomad.broadinstitute.org/help',
  license: 'CC0 1.0 (ODC Open Database License for some releases)',
  driver: 'api',
  connection: {
    database: 'https://gnomad.broadinstitute.org/api',
    headers: { Accept: 'application/json' }
  },
  // The browser API is rate-limited per client; one request at a time keeps clear of it.
  rateLimit: { requestsPerSecond: 1, maxConcurrent: 1 },
  entities: [
    {
      name: 'geneConstraint',
      description: 'Loss-of-function, missense and synonymous constraint for a gene',
      path: '',
      params: {
        ensemblGeneId: { in: 'body', required: true, description: 'Ensembl gene id, e.g. ENSG00000141510' },
        referenceGenome: { in: 'body', default: 'GRCh38', description: 'GRCh38 (default) or GRCh37' }
      },
      graphql: {
        query: `query geneConstraint($geneId: String!, $referenceGenome: ReferenceGenomeId!) {
          gene(gene_id: $geneId, reference_genome: $referenceGenome) {
            gene_id symbol name chrom start stop canonical_transcript_id hgnc_id omim_id
            gnomad_constraint {
              exp_lof obs_lof oe_lof oe_lof_lower oe_lof_upper pli lof_z
              exp_mis obs_mis oe_mis oe_mis_upper mis_z
              exp_syn obs_syn oe_syn syn_z flags
            }
          }
        }`,
        variables: (p) => ({ geneId: p.ensemblGeneId, referenceGenome: p.referenceGenome })
      },
      rows: 'data.gene',
      fields: {
        ensemblGeneId: 'gene_id',
        symbol: 'symbol',
        name: 'name',
        hgncId: 'hgnc_id',
        omimId: 'omim_id',
        chromosome: 'chrom',
        start: 'start',
        end: 'stop',
        canonicalTranscript: 'canonical_transcript_id',
        pLI: 'gnomad_constraint.pli',
        // LOEUF: upper bound of the LoF observed/expected ratio; < 0.6 suggests LoF intolerance
        loeuf: 'gnomad_constraint.oe_lof_upper',
        oeLof: 'gnomad_constraint.oe_lof',
        oeLofLower: 'gnomad_constraint.oe_lof_lower',
        lofZ: 'gnomad_constraint.lof_z',
        observedLof: 'gnomad_constraint.obs_lof',
        expectedLof: 'gnomad_constraint.exp_lof',
        oeMis: 'gnomad_constraint.oe_mis',
        oeMisUpper: 'gnomad_constraint.oe_mis_upper',
        misZ: 'gnomad_constraint.mis_z',
        oeSyn: 'gnomad_constraint.oe_syn',
        synZ: 'gnomad_constraint.syn_z',
        flags: 'gnomad_constraint.flags'
      },
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: [
        { alias: 'gene', description: 'Ensembl gene record', catalog: 'ensembl', entity: 'gene', obo: 'ensembl', type: 'hasOne' },
        { alias: 'target', description: 'Open Targets target record', catalog: 'opentargets', entity: 'target', obo: 'ensembl', type: 'hasOne' },
        { alias: 'hgnc', description: 'HGNC nomenclature record', catalog: 'hgnc', entity: 'gene', obo: 'hgnc', type: 'hasOne' }
      ]
    },
    {
      name: 'variant',
      description: 'Allele frequencies and consequence of one variant',
      path: '',
      params: {
        variantId: { in: 'body', required: true, description: 'chrom-pos-ref-alt, e.g. 17-7675088-C-T (GRCh38 for gnomad_r4)' },
        dataset: DATASET_PARAM
      },
      graphql: {
        query: `query variant($variantId: String!, $dataset: DatasetId!) {
          variant(variantId: $variantId, dataset: $dataset) { ${VARIANT_SELECTION} }
        }`,
        variables: (p) => ({ variantId: p.variantId, dataset: p.dataset })
      },
      rows: 'data.variant',
      fields: VARIANT_FIELDS,
      example: { variantId: '17-7675088-C-T' },
      relations: VARIANT_RELATIONS
    },
    {
      name: 'variantsByRsId',
      description: 'Every gnomAD allele recorded under a dbSNP id',
      path: '',
      params: {
        rsId: { in: 'body', required: true, description: 'dbSNP id, e.g. rs28934578' },
        dataset: DATASET_PARAM
      },
      // Two requests however many alleles: a search, then one aliased query for all hits.
      resolve: async (p, ctx) => {
        const found = await graphql(ctx, `query search($query: String!, $dataset: DatasetId!) {
          variant_search(query: $query, dataset: $dataset) { variant_id }
        }`, { query: p.rsId, dataset: p.dataset })
        const ids = (found.variant_search || []).map((v) => v.variant_id).slice(0, 20)
        if (ids.length === 0) return []
        const aliases = ids.map((id, i) => `v${i}: variant(variantId: ${JSON.stringify(id)}, dataset: $dataset) { ${VARIANT_SELECTION} }`)
        const data = await graphql(ctx, `query variants($dataset: DatasetId!) { ${aliases.join('\n')} }`, { dataset: p.dataset })
        return ids.map((_, i) => data[`v${i}`]).filter(Boolean)
      },
      fields: VARIANT_FIELDS,
      example: { rsId: 'rs28934578' },
      relations: VARIANT_RELATIONS
    }
  ]
}
