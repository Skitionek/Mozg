'use strict'

/**
 * STRING — known and predicted protein–protein associations, with evidence
 * channels scored separately, and functional enrichment of protein sets.
 * API docs: https://string-db.org/help/api/
 *
 * STRING asks API clients to identify themselves (caller_identity) and to
 * wait about a second between requests.  Identifiers may be gene symbols,
 * UniProt accessions or STRING ids; species is an NCBI taxonomy id.
 */

// STRING separates identifiers with carriage returns; accept arrays or
// comma/whitespace-separated strings and normalise.
const identifierList = (value) => String(value).split(/[\s,]+/).filter(Boolean).join('\r')

const SCORES = {
  score: 'score',
  experimentalScore: 'escore',
  databaseScore: 'dscore',
  textminingScore: 'tscore',
  coexpressionScore: 'ascore',
  neighborhoodScore: 'nscore',
  fusionScore: 'fscore',
  cooccurrenceScore: 'pscore'
}

// Interaction rows: A is the queried protein for partners, either side for networks.
const INTERACTION_FIELDS = {
  stringId: 'stringId_A',
  symbol: 'preferredName_A',
  partnerStringId: 'stringId_B',
  partnerSymbol: 'preferredName_B',
  taxonId: (r) => (r.ncbiTaxonId != null ? Number(r.ncbiTaxonId) : null),
  ...SCORES
}

// "Not found" arrives as a 404 or as a single { Error } record.
const records = (body) => (Array.isArray(body) ? body.filter((r) => r && !r.Error) : [])

const TAXON = { description: 'NCBI taxonomy id of the species, e.g. 9606 (human), 10090 (mouse)', default: 9606 }

module.exports = {
  name: 'string-db',
  label: 'STRING',
  description: 'STRING protein–protein association networks for 12,000+ organisms: physical and functional interactions scored per evidence channel (experiments, databases, co-expression, text mining…), plus functional enrichment of gene sets.',
  category: 'Interactions & pathways',
  homepage: 'https://string-db.org',
  docs: 'https://string-db.org/help/api/',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://string-db.org/api/json',
    headers: { Accept: 'application/json' }
  },
  query: { caller_identity: 'mozg' },
  rateLimit: { requestsPerSecond: 1, maxConcurrent: 1 },
  entities: [
    {
      name: 'ids',
      description: 'Resolve a protein name, gene symbol or UniProt accession to its STRING identity',
      path: '/get_string_ids',
      params: {
        identifier: { name: 'identifiers', description: 'Gene symbol, protein name or UniProt accession, e.g. TP53' },
        taxonId: TAXON
      },
      query: (params) => ({ identifiers: params.identifier, species: params.taxonId, limit: 1 }),
      rows: records,
      fields: {
        stringId: 'stringId',
        symbol: 'preferredName',
        taxonId: 'ncbiTaxonId',
        organism: 'taxonName',
        annotation: 'annotation',
        query: 'queryItem'
      },
      example: { identifier: 'TP53', taxonId: 9606 },
      relations: [
        { alias: 'partners', description: 'Highest-scoring interaction partners', entity: 'partners', localKey: 'stringId', foreignKey: 'identifier', type: 'hasMany' },
        { alias: 'protein', description: 'The reviewed UniProtKB entry cross-referenced to this STRING protein', catalog: 'uniprot', entity: 'proteins', localKey: 'stringId', foreignKey: 'stringId', where: { reviewed: true }, type: 'hasOne' }
      ]
    },
    {
      name: 'partners',
      description: 'Interaction partners of one protein, best-scoring first (STRING returns the top 10 unless limit is given)',
      path: '/interaction_partners',
      params: {
        identifier: { description: 'Gene symbol, UniProt accession or STRING id, e.g. TP53' },
        taxonId: TAXON,
        requiredScore: { description: 'Minimum combined score, 0–1000 (STRING default 400)' },
        networkType: { description: 'functional (default) or physical' }
      },
      query: (params) => ({
        identifiers: params.identifier,
        species: params.taxonId,
        required_score: params.requiredScore,
        network_type: params.networkType
      }),
      rows: records,
      fields: INTERACTION_FIELDS,
      paginate: { limit: 'limit' },
      example: { identifier: 'TP53', taxonId: 9606 },
      relations: [
        { alias: 'partner', description: 'The reviewed UniProtKB entry for the partner protein', catalog: 'uniprot', entity: 'proteins', localKey: 'partnerStringId', foreignKey: 'stringId', where: { reviewed: true }, type: 'hasOne' }
      ]
    },
    {
      name: 'network',
      description: 'All interactions among a set of proteins',
      path: '/network',
      params: {
        identifiers: { description: 'Two or more symbols / accessions / STRING ids, as a list or comma-separated, e.g. ["TP53", "MDM2", "CDKN1A"]', join: ',' },
        taxonId: TAXON,
        requiredScore: { description: 'Minimum combined score, 0–1000' },
        networkType: { description: 'functional (default) or physical' }
      },
      query: (params) => ({
        identifiers: identifierList(params.identifiers),
        species: params.taxonId,
        required_score: params.requiredScore,
        network_type: params.networkType
      }),
      rows: records,
      fields: INTERACTION_FIELDS,
      example: { identifiers: ['TP53', 'MDM2', 'CDKN1A'], taxonId: 9606 },
      relations: []
    },
    {
      name: 'enrichment',
      description: 'Functional enrichment (GO, KEGG, Reactome, Pfam, …) of a set of proteins',
      path: '/enrichment',
      params: {
        identifiers: { description: 'Protein set as a list or comma-separated, e.g. ["TP53", "MDM2", "CDKN1A", "BAX"]', join: ',' },
        taxonId: TAXON
      },
      query: (params) => ({ identifiers: identifierList(params.identifiers), species: params.taxonId }),
      rows: records,
      fields: {
        category: 'category',
        term: 'term',
        description: 'description',
        geneCount: 'number_of_genes',
        backgroundGeneCount: 'number_of_genes_in_background',
        pValue: 'p_value',
        fdr: 'fdr',
        genes: 'preferredNames',
        taxonId: 'ncbiTaxonId',
        goId: (r) => (/^GO:\d+$/.test(r.term) ? r.term : null),
        reactomeId: (r) => (/^HSA-\d+$/.test(r.term) ? `R-${r.term}` : (/^R-[A-Z]{3}-\d+$/.test(r.term) ? r.term : null))
      },
      example: { identifiers: ['TP53', 'MDM2', 'CDKN1A', 'BAX'], taxonId: 9606 },
      relations: [
        { alias: 'goTerm', description: 'The enriched GO term (QuickGO), for GO categories', catalog: 'quickgo', entity: 'term', localKey: 'goId', foreignKey: 'goId', type: 'hasOne' }
      ]
    },
    {
      name: 'ppiEnrichment',
      description: 'Whether a protein set has more interactions among itself than expected by chance',
      path: '/ppi_enrichment',
      params: {
        identifiers: { description: 'Protein set as a list or comma-separated', join: ',' },
        taxonId: TAXON,
        requiredScore: { description: 'Minimum combined score, 0–1000' }
      },
      query: (params) => ({ identifiers: identifierList(params.identifiers), species: params.taxonId, required_score: params.requiredScore }),
      rows: records,
      fields: {
        nodeCount: 'number_of_nodes',
        edgeCount: 'number_of_edges',
        expectedEdgeCount: 'expected_number_of_edges',
        averageNodeDegree: 'average_node_degree',
        clusteringCoefficient: 'local_clustering_coefficient',
        pValue: 'p_value'
      },
      example: { identifiers: ['TP53', 'MDM2', 'CDKN1A'], taxonId: 9606 },
      relations: []
    }
  ]
}
