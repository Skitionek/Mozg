'use strict';

/**
 * STRING – protein-protein interaction database.
 * Reference: https://string-db.org/
 * API docs:  https://string-db.org/cgi/help?sessionId=&subpage=api
 *
 * No credentials required for research/academic use.
 * Rate limit: 1 req/sec recommended (higher sustained use requires API key).
 *
 * Species are identified by NCBI taxonomy IDs (e.g. 9606 for Homo sapiens).
 * Proteins can be queried using gene symbols, UniProt IDs or STRING IDs.
 *
 * Key where parameters:
 *  - identifiers: protein name or comma-separated list
 *  - species:     NCBI taxon ID (default 9606)
 *  - required_score: min interaction score 0–1000 (default 400)
 *  - network_type: functional|physical
 *  - caller_identity: your app/email (recommended)
 *
 * Relationship map:
 *  - /get_string_ids  →  /network        (stringId → identifiers, hasMany interactions)
 *  - /network         →  /interaction_partners  (stringId, hasMany partners)
 *  - /get_string_ids  →  /enrichment     (stringId list, functional enrichment)
 */
module.exports = {
  name: 'string-db',
  label: 'STRING (REST)',
  description: 'STRING protein-protein interaction database covering 14 000+ organisms. Provides functional and physical interaction networks with confidence scores, interaction partners and functional enrichment. Use species=9606 for human.',
  driver: 'rest',
  connection: {
    database: 'https://string-db.org/api/json',
  },
  entities: [
    {
      // Map gene names to STRING IDs: /get_string_ids?identifiers=TP53&species=9606
      name: '/get_string_ids',
      columns: ['stringId', 'ncbiTaxonId', 'taxonName', 'preferredName', 'annotation'],
      relations: [
        { entity: '/interaction_partners', foreignKey: 'stringId', type: 'hasMany', alias: 'interactionPartners' },
        { entity: '/enrichment', foreignKey: 'stringId', type: 'hasMany', alias: 'enrichment' },
      ],
    },
    {
      // Interaction network: /network?identifiers=TP53%0dBRCA1&species=9606
      name: '/network',
      columns: ['stringId_A', 'stringId_B', 'preferredName_A', 'preferredName_B', 'ncbiTaxonId', 'score', 'nscore', 'fscore', 'pscore', 'ascore', 'escore', 'dscore', 'tscore'],
      relations: [],
    },
    {
      // Interaction partners of a single protein: /interaction_partners?identifiers=TP53&species=9606
      name: '/interaction_partners',
      columns: ['stringId_A', 'stringId_B', 'preferredName_A', 'preferredName_B', 'ncbiTaxonId', 'score', 'nscore', 'fscore', 'pscore', 'ascore', 'escore', 'dscore', 'tscore'],
      relations: [],
    },
    {
      // Functional enrichment: /enrichment?identifiers=TP53%0dBRCA1&species=9606
      name: '/enrichment',
      columns: ['category', 'term', 'number_of_genes', 'number_of_genes_in_background', 'ncbiTaxonId', 'inputGenes', 'preferredNames', 'p_value', 'fdr', 'description'],
      relations: [],
    },
    {
      // PPI enrichment stats: /ppi_enrichment?identifiers=TP53%0dBRCA1&species=9606
      name: '/ppi_enrichment',
      columns: ['number_of_nodes', 'number_of_edges', 'average_node_degree', 'local_clustering_coefficient', 'expected_number_of_edges', 'p_value'],
      relations: [],
    },
  ],
};
