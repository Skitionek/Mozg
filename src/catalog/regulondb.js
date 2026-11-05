'use strict'

/**
 * RegulonDB — the reference database of transcriptional regulation in
 * Escherichia coli K-12: genes, transcription factors, their regulons and the
 * regulatory interactions between them (CCG-UNAM; free for academic use).
 * API: GraphQL at https://regulondb.ccg.unam.mx/graphql
 *
 * RegulonDB ids look like RDBECOLIGNC00050 (gene araC) and RDBECOLITFC00064
 * (the AraC regulon).  A gene's regulators are regulons, so the two join both
 * ways: gene → its regulators → the genes each of those regulates.
 */

const GENE_SELECTION = `
  _id
  gene { _id bnumber name leftEndPosition rightEndPosition strand synonyms
         externalCrossReferences { externalCrossReferenceName objectId } }
  products { name regulonId externalCrossReferences { externalCrossReferenceName objectId } }
  regulation { regulators { _id name function } }
`

const REGULON_SELECTION = `
  _id
  regulator { _id name abbreviatedName synonyms family sensingClass connectivityClass confidenceLevel
              encodedBy { genes { _id name } } }
  summary { genes { total } regulatoryInteractions { total } }
  regulates { genes { _id name function } }
`

const genesQuery = `query ($search: String, $limit: Int) {
  getGenesBy(search: $search, limit: $limit) { data { ${GENE_SELECTION} } }
}`

const regulonsQuery = `query ($search: String, $limit: Int) {
  getRegulonBy(search: $search, limit: $limit) { data { ${REGULON_SELECTION} } }
}`

const xref = (refs, name) => ((refs || []).find((x) => x.externalCrossReferenceName === name) || {}).objectId || null

const GENE_FIELDS = {
  regulondbGeneId: '_id',
  bnumber: 'gene.bnumber',
  symbol: 'gene.name',
  synonyms: 'gene.synonyms',
  leftEnd: 'gene.leftEndPosition',
  rightEnd: 'gene.rightEndPosition',
  strand: 'gene.strand',
  productName: 'products[0].name',
  uniprotAccession: (r) => xref(r.products && r.products[0] && r.products[0].externalCrossReferences, 'UNIPROT'),
  stringId: (r) => xref(r.gene && r.gene.externalCrossReferences, 'STRING'),
  ecocycId: (r) => xref(r.gene && r.gene.externalCrossReferences, 'ECOCYC'),
  regulonId: 'products[0].regulonId',
  regulatorNames: 'regulation.regulators[].name'
}

const GENE_RELATIONS = [
  { alias: 'regulators', description: 'Transcription factors regulating this gene, with their effect', entity: 'geneRegulators', localKey: 'regulondbGeneId', foreignKey: 'regulondbGeneId', type: 'hasMany' },
  { alias: 'regulon', description: 'The regulon this gene\'s product heads, when it is a transcription factor', entity: 'regulon', localKey: 'regulonId', foreignKey: 'regulonId', type: 'hasOne' },
  { alias: 'protein', description: 'The UniProt entry of the gene product', catalog: 'uniprot', entity: 'protein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' }
]

const REGULON_FIELDS = {
  regulonId: '_id',
  name: 'regulator.name',
  abbreviatedName: 'regulator.abbreviatedName',
  synonyms: 'regulator.synonyms',
  family: 'regulator.family',
  sensingClass: 'regulator.sensingClass',
  connectivityClass: 'regulator.connectivityClass',
  confidenceLevel: 'regulator.confidenceLevel',
  encodingGeneId: 'regulator.encodedBy.genes[0]._id',
  encodingGeneSymbol: 'regulator.encodedBy.genes[0].name',
  regulatedGeneCount: 'summary.genes.total',
  regulatoryInteractionCount: 'summary.regulatoryInteractions.total'
}

const REGULON_RELATIONS = [
  { alias: 'regulatedGenes', description: 'Genes this regulator regulates, with its effect on each', entity: 'regulatedGenes', localKey: 'regulonId', foreignKey: 'regulonId', type: 'hasMany' },
  { alias: 'encodingGene', description: 'The gene encoding this transcription factor', entity: 'gene', localKey: 'encodingGeneId', foreignKey: 'regulondbGeneId', type: 'hasOne' }
]

// getGenesBy / getRegulonBy are fuzzy searches; an id lookup keeps only the exact match.
const exactId = (path, param) => (body, params) => (path(body) || []).filter((r) => r._id === params[param])

module.exports = {
  name: 'regulondb',
  label: 'RegulonDB',
  description: 'Reference database of transcriptional regulation in Escherichia coli K-12: genes, transcription factors, regulons and regulatory interactions, manually curated from the literature.',
  category: 'Interactions & pathways',
  homepage: 'https://regulondb.ccg.unam.mx',
  docs: 'https://regulondb.ccg.unam.mx/manual/help/graphql',
  license: 'Free for academic use — https://regulondb.ccg.unam.mx/manual/aboutUs/terms-conditions',
  driver: 'api',
  connection: {
    database: 'https://regulondb.ccg.unam.mx',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 3, maxConcurrent: 2 },
  timeoutMs: 60_000,
  entities: [
    {
      name: 'genes',
      description: 'E. coli K-12 genes matching a name, synonym, b-number or text',
      path: '/graphql',
      query: () => ({}), // parameters travel as GraphQL variables, not in the URL
      params: {
        search: { required: true, description: 'Gene name, b-number or text, e.g. araC or b0064' }
      },
      graphql: { query: genesQuery, variables: (params) => ({ search: String(params.search), limit: 100 }) },
      rows: 'data.getGenesBy.data',
      fields: GENE_FIELDS,
      example: { search: 'araC' },
      relations: GENE_RELATIONS
    },
    {
      name: 'gene',
      description: 'One E. coli K-12 gene by RegulonDB id',
      path: '/graphql',
      query: () => ({}), // parameters travel as GraphQL variables, not in the URL
      params: {
        regulondbGeneId: { required: true, description: 'RegulonDB gene id, e.g. RDBECOLIGNC00050' }
      },
      graphql: { query: genesQuery, variables: (params) => ({ search: params.regulondbGeneId, limit: 5 }) },
      rows: exactId((b) => b && b.data && b.data.getGenesBy && b.data.getGenesBy.data, 'regulondbGeneId'),
      fields: GENE_FIELDS,
      example: { regulondbGeneId: 'RDBECOLIGNC00050' },
      relations: GENE_RELATIONS
    },
    {
      name: 'geneRegulators',
      description: 'Transcription factors regulating a gene, and the effect of each',
      path: '/graphql',
      query: () => ({}), // parameters travel as GraphQL variables, not in the URL
      params: {
        regulondbGeneId: { required: true, description: 'RegulonDB gene id, e.g. RDBECOLIGNC00050' }
      },
      graphql: { query: genesQuery, variables: (params) => ({ search: params.regulondbGeneId, limit: 5 }) },
      rows: (body, params) => exactId((b) => b && b.data && b.data.getGenesBy && b.data.getGenesBy.data, 'regulondbGeneId')(body, params)
        .flatMap((g) => (g.regulation && g.regulation.regulators) || []),
      fields: {
        regulonId: '_id',
        name: 'name',
        function: 'function'
      },
      example: { regulondbGeneId: 'RDBECOLIGNC00050' },
      relations: [
        { alias: 'regulon', description: 'The regulator\'s regulon in full', entity: 'regulon', localKey: 'regulonId', foreignKey: 'regulonId', type: 'hasOne' }
      ]
    },
    {
      name: 'regulons',
      description: 'Regulons (a transcription factor and everything it regulates) matching a name or text',
      path: '/graphql',
      query: () => ({}), // parameters travel as GraphQL variables, not in the URL
      params: {
        search: { required: true, description: 'Regulator name or text, e.g. AraC or CRP' }
      },
      graphql: { query: regulonsQuery, variables: (params) => ({ search: String(params.search), limit: 100 }) },
      rows: 'data.getRegulonBy.data',
      fields: REGULON_FIELDS,
      example: { search: 'AraC' },
      relations: REGULON_RELATIONS
    },
    {
      name: 'regulon',
      description: 'One regulon by RegulonDB id',
      path: '/graphql',
      query: () => ({}), // parameters travel as GraphQL variables, not in the URL
      params: {
        regulonId: { required: true, description: 'RegulonDB regulon id, e.g. RDBECOLITFC00064' }
      },
      graphql: { query: regulonsQuery, variables: (params) => ({ search: params.regulonId, limit: 5 }) },
      rows: exactId((b) => b && b.data && b.data.getRegulonBy && b.data.getRegulonBy.data, 'regulonId'),
      fields: REGULON_FIELDS,
      example: { regulonId: 'RDBECOLITFC00064' },
      relations: REGULON_RELATIONS
    },
    {
      name: 'regulatedGenes',
      description: 'Genes a regulon\'s transcription factor regulates, with its effect on each',
      path: '/graphql',
      query: () => ({}), // parameters travel as GraphQL variables, not in the URL
      params: {
        regulonId: { required: true, description: 'RegulonDB regulon id, e.g. RDBECOLITFC00064' },
        function: { in: 'filter', field: 'function', description: 'Keep one effect: activator, repressor or dual' }
      },
      graphql: { query: regulonsQuery, variables: (params) => ({ search: params.regulonId, limit: 5 }) },
      rows: (body, params) => exactId((b) => b && b.data && b.data.getRegulonBy && b.data.getRegulonBy.data, 'regulonId')(body, params)
        .flatMap((r) => (r.regulates && r.regulates.genes) || []),
      fields: {
        regulondbGeneId: '_id',
        symbol: 'name',
        function: 'function'
      },
      example: { regulonId: 'RDBECOLITFC00064' },
      relations: [
        { alias: 'gene', description: 'The regulated gene in full', entity: 'gene', localKey: 'regulondbGeneId', foreignKey: 'regulondbGeneId', type: 'hasOne' }
      ]
    }
  ]
}
