'use strict'

/**
 * CIViC — Clinical Interpretation of Variants in Cancer: community-curated,
 * literature-backed evidence on what cancer variants mean for diagnosis,
 * prognosis and response to therapy.
 * API: GraphQL at https://civicdb.org/api/graphql — https://griffithlab.github.io/civic-v2/
 *
 * Evidence is attached to molecular profiles (a variant, or a combination of
 * variants).  Only ACCEPTED (curator-approved) evidence is returned.
 */

const MAX_PAGE = 500

// An absent filter must be left out of `variables`, not sent as null: CIViC reads
// an explicit null as "match items whose value is null".
async function graphql (ctx, query, variables) {
  const body = await ctx.request('/graphql', { method: 'POST', body: { query, variables } })
  const errors = body && Array.isArray(body.errors) && body.errors.length ? body.errors.map((e) => e.message).join('; ') : null
  if (errors && !(body && body.data)) throw new Error(`civic/${ctx.entity.name}: ${errors}`)
  return (body && body.data) || {}
}

// Connections are cursor-paginated; fetch enough from the start to cover offset + limit.
const pageSize = (ctx, fallback = 50) => Math.min((ctx.limit != null ? ctx.limit : fallback) + (ctx.offset || 0), MAX_PAGE)

const EVIDENCE_SELECTION = `
  id name evidenceType evidenceLevel evidenceDirection significance evidenceRating variantOrigin description
  disease { name doid }
  therapies { name ncitId }
  molecularProfile { id name }
  source { citationId sourceType }
`

const EVIDENCE_FIELDS = {
  evidenceId: 'id',
  name: 'name',
  molecularProfile: 'molecularProfile.name',
  molecularProfileId: 'molecularProfile.id',
  evidenceType: 'evidenceType',
  evidenceLevel: 'evidenceLevel',
  evidenceDirection: 'evidenceDirection',
  significance: 'significance',
  rating: 'evidenceRating',
  variantOrigin: 'variantOrigin',
  description: 'description',
  disease: 'disease.name',
  doid: (r) => (r.disease && r.disease.doid ? `DOID:${r.disease.doid}` : null),
  therapies: 'therapies[].name',
  therapyNcitIds: 'therapies[].ncitId',
  pmid: (r) => (r.source && r.source.sourceType === 'PUBMED' ? String(r.source.citationId) : null),
  sourceType: 'source.sourceType',
  url: (r) => `https://civicdb.org/evidence/${r.id}`
}

const EVIDENCE_RELATIONS = [
  { alias: 'publication', description: 'The supporting publication (Europe PMC)', catalog: 'europepmc', entity: 'article', localKey: 'pmid', foreignKey: 'pmid', type: 'hasOne' }
]

const VARIANT_SELECTION = `
  id name
  ... on GeneVariant {
    alleleRegistryId clinvarIds hgvsDescriptions maneSelectTranscript variantAliases
    singleVariantMolecularProfileId
    variantTypes { name }
    coordinates { chromosome start stop referenceBases variantBases referenceBuild }
  }
`

const VARIANT_FIELDS = {
  civicVariantId: 'id',
  name: 'name',
  symbol: 'symbol',
  clingenAlleleId: 'alleleRegistryId',
  clinvarId: 'clinvarIds[0]',
  clinvarIds: 'clinvarIds',
  rsId: (r) => ((r.variantAliases || []).find((a) => /^rs\d+$/i.test(a)) || '').toLowerCase() || null,
  aliases: 'variantAliases',
  hgvs: 'hgvsDescriptions',
  proteinChange: (r) => ((r.hgvsDescriptions || []).find((h) => /^NP_[^:]+:p\./.test(h)) || '').replace(/^[^:]+:/, '') || null,
  maneSelectTranscript: 'maneSelectTranscript',
  variantTypes: 'variantTypes[].name',
  // MyVariant.info id (HGVS genomic, GRCh37) for single-nucleotide variants.  Built
  // from the coordinates: CIViC's own myVariantInfo field calls out to MyVariant
  // per variant and makes listing a gene's variants ~80× slower.
  myvariantHgvs: (r) => {
    const c = r.coordinates || {}
    return c.referenceBuild === 'GRCH37' && c.chromosome && c.start != null && c.start === c.stop &&
      /^[ACGT]$/.test(c.referenceBases || '') && /^[ACGT]$/.test(c.variantBases || '')
      ? `chr${c.chromosome}:g.${c.start}${c.referenceBases}>${c.variantBases}`
      : null
  },
  chromosome: 'coordinates.chromosome',
  start: 'coordinates.start',
  end: 'coordinates.stop',
  ref: 'coordinates.referenceBases',
  alt: 'coordinates.variantBases',
  referenceBuild: 'coordinates.referenceBuild',
  molecularProfileId: 'singleVariantMolecularProfileId',
  url: (r) => `https://civicdb.org/variants/${r.id}`
}

const VARIANT_RELATIONS = [
  { alias: 'evidence', description: 'Accepted clinical evidence for this variant', entity: 'evidenceForVariant', localKey: 'civicVariantId', foreignKey: 'civicVariantId', type: 'hasMany' },
  { alias: 'annotation', description: 'MyVariant.info annotation (ClinVar, CADD, gnomAD)', catalog: 'myvariant', entity: 'variant', localKey: 'myvariantHgvs', foreignKey: 'hgvs', type: 'hasOne' },
  { alias: 'clinvar', description: 'The ClinVar variation record', catalog: 'clinvar', entity: 'variant', localKey: 'clinvarId', foreignKey: 'clinvarId', type: 'hasOne' },
  { alias: 'gwasAssociations', description: 'GWAS Catalog trait associations', catalog: 'gwas', entity: 'associationsForVariant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' }
]

module.exports = {
  name: 'civic',
  label: 'CIViC',
  description: 'Clinical Interpretation of Variants in Cancer: expert-curated, literature-backed evidence on the diagnostic, prognostic and predictive (drug response) meaning of cancer variants.',
  category: 'Disease & variants',
  homepage: 'https://civicdb.org',
  docs: 'https://griffithlab.github.io/civic-v2/',
  license: 'CC0 1.0',
  driver: 'api',
  connection: {
    database: 'https://civicdb.org/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 3, maxConcurrent: 2 },
  entities: [
    {
      name: 'gene',
      description: 'A gene summary: description, aliases and curated clinical significance counts',
      path: '/graphql',
      params: {
        symbol: { in: 'body', required: true, description: 'Gene symbol, e.g. BRAF' }
      },
      graphql: {
        query: `query gene($symbol: String!) {
          gene(entrezSymbol: $symbol) {
            id name entrezId fullName description link featureAliases
            clinicalSignificanceCounts { type significance count }
            variants(first: 1) { totalCount }
          }
        }`,
        variables: (p) => ({ symbol: p.symbol })
      },
      rows: 'data.gene',
      fields: {
        civicGeneId: 'id',
        symbol: 'name',
        name: 'fullName',
        ncbiGeneId: (r) => (r.entrezId != null ? String(r.entrezId) : null),
        description: 'description',
        aliases: 'featureAliases',
        variantCount: 'variants.totalCount',
        // Assertion counts by type and significance, e.g. { "PREDICTIVE/SENSITIVITYRESPONSE": 4 }
        significanceCounts: (r) => Object.fromEntries((r.clinicalSignificanceCounts || []).map((c) => [`${c.type}/${c.significance}`, c.count])),
        url: (r) => (r.link ? `https://civicdb.org${r.link}` : null)
      },
      example: { symbol: 'BRAF' },
      relations: [
        { alias: 'variants', description: 'Variants curated for this gene', entity: 'variantsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
        { alias: 'evidence', description: 'Accepted clinical evidence across the gene\'s molecular profiles', entity: 'evidenceForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
        { alias: 'hgnc', description: 'HGNC nomenclature record', catalog: 'hgnc', entity: 'geneBySymbol', localKey: 'symbol', foreignKey: 'symbol', type: 'hasOne' },
        { alias: 'ncbiGene', description: 'NCBI Gene record', catalog: 'ncbi-gene', entity: 'gene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasOne' }
      ]
    },
    {
      name: 'variantsForGene',
      description: 'Variants curated in CIViC for a gene, optionally by name',
      path: '/graphql',
      params: {
        symbol: { in: 'body', required: true, description: 'Gene symbol, e.g. BRAF' },
        name: { in: 'body', description: 'Variant name to match, e.g. V600E' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($symbol: String!, $first: Int!, $name: String) {
          gene(entrezSymbol: $symbol) { name variants(first: $first, name: $name) { nodes { ${VARIANT_SELECTION} } } }
        }`, { symbol: p.symbol, first: pageSize(ctx), name: p.name || undefined })
        if (!data.gene) return []
        return data.gene.variants.nodes.map((v) => ({ ...v, symbol: data.gene.name }))
      },
      fields: VARIANT_FIELDS,
      example: { symbol: 'BRAF', name: 'V600E' },
      relations: VARIANT_RELATIONS
    },
    {
      name: 'variant',
      description: 'One CIViC variant by id',
      path: '/graphql',
      params: {
        civicVariantId: { in: 'body', required: true, description: 'CIViC variant id, e.g. 12 (BRAF V600E)' }
      },
      graphql: {
        query: `query variant($id: Int!) { variant(id: $id) { ${VARIANT_SELECTION} feature { name } } }`,
        variables: (p) => ({ id: Number(p.civicVariantId) })
      },
      rows: (body) => (body && body.data && body.data.variant ? [{ ...body.data.variant, symbol: body.data.variant.feature && body.data.variant.feature.name }] : []),
      fields: VARIANT_FIELDS,
      example: { civicVariantId: 12 },
      relations: VARIANT_RELATIONS
    },
    {
      name: 'evidenceForVariant',
      description: 'Accepted clinical evidence items for a variant, best-rated first',
      path: '/graphql',
      params: {
        civicVariantId: { in: 'body', required: true, description: 'CIViC variant id, e.g. 12 (BRAF V600E)' },
        evidenceType: { in: 'body', description: 'PREDICTIVE, DIAGNOSTIC, PROGNOSTIC, PREDISPOSING, ONCOGENIC or FUNCTIONAL' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($id: Int!, $first: Int!, $type: EvidenceType) {
          evidenceItems(variantId: $id, first: $first, status: ACCEPTED, evidenceType: $type, sortBy: { column: EVIDENCE_RATING, direction: DESC }) {
            nodes { ${EVIDENCE_SELECTION} }
          }
        }`, { id: Number(p.civicVariantId), first: pageSize(ctx), type: p.evidenceType || undefined })
        return (data.evidenceItems && data.evidenceItems.nodes) || []
      },
      fields: EVIDENCE_FIELDS,
      example: { civicVariantId: 12 },
      relations: EVIDENCE_RELATIONS
    },
    {
      name: 'evidenceForGene',
      description: 'Accepted clinical evidence items for every molecular profile of a gene, best-rated first',
      path: '/graphql',
      params: {
        symbol: { in: 'body', required: true, description: 'Gene symbol, e.g. BRAF' },
        evidenceType: { in: 'body', description: 'PREDICTIVE, DIAGNOSTIC, PROGNOSTIC, PREDISPOSING, ONCOGENIC or FUNCTIONAL' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($name: String!, $first: Int!, $type: EvidenceType) {
          evidenceItems(molecularProfileName: $name, first: $first, status: ACCEPTED, evidenceType: $type, sortBy: { column: EVIDENCE_RATING, direction: DESC }) {
            nodes { ${EVIDENCE_SELECTION} }
          }
        }`, { name: p.symbol, first: pageSize(ctx), type: p.evidenceType || undefined })
        // The API matches profile names by substring; keep profiles that name this gene as a word.
        const word = new RegExp(`(^|[^A-Za-z0-9])${String(p.symbol).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i')
        return ((data.evidenceItems && data.evidenceItems.nodes) || []).filter((e) => e.molecularProfile && word.test(e.molecularProfile.name))
      },
      fields: EVIDENCE_FIELDS,
      example: { symbol: 'BRAF' },
      relations: EVIDENCE_RELATIONS
    }
  ]
}
