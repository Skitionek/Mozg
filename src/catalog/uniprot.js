'use strict';

/**
 * UniProt – universal protein knowledgebase maintained by UniProt Consortium.
 * Reference: https://www.uniprot.org/help/programmatic_access
 * API docs:  https://www.uniprot.org/help/api
 *
 * No credentials required for public data access.
 * Responses default to JSON when format=json is passed or Accept header is set.
 *
 * Key where parameters:
 *  - /uniprotkb/search: query, format=json, fields, size (max 500), cursor
 *  - /uniref/search:    query, format=json, size, cursor
 *  - /uniparc/search:   query, format=json, size, cursor
 *  - /taxonomy/search:  query, format=json, size, cursor
 *
 * Example queries:
 *  Gene name: where: { query: "gene:BRCA1 AND organism_id:9606", format: "json" }
 *  Reviewed:  where: { query: "reviewed:true AND organism_id:9606", format: "json" }
 *
 * Relationship map:
 *  - /uniprotkb/search  →  /taxonomy/search  (organism.taxonId → id, belongsTo)
 *  - /uniprotkb/search  →  /uniref/search    (uniRef90/uniRef50 → query by id)
 */
module.exports = {
  name: 'uniprot',
  label: 'UniProt (REST)',
  description: 'Universal protein knowledgebase with protein sequences, functions, taxonomic data and cross-references. UniProtKB has reviewed (Swiss-Prot) and unreviewed (TrEMBL) sections. Use format=json in where params.',
  driver: 'rest',
  connection: {
    database: 'https://rest.uniprot.org',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Use where: { query: "…", format: "json", size: "25" }
      name: '/uniprotkb/search',
      columns: ['accession', 'id', 'proteinDescription', 'genes', 'organism', 'sequence', 'reviewed', 'annotationScore', 'features', 'keywords'],
      relations: [
        { entity: '/taxonomy', foreignKey: 'taxonId', type: 'belongsTo', alias: 'taxonomy' },
      ],
    },
    {
      // Use where: { query: "…", format: "json", size: "25" }
      name: '/uniref/search',
      columns: ['id', 'name', 'commonTaxon', 'commonTaxonId', 'memberCount', 'updated', 'entryType', 'representativeMember'],
      relations: [],
    },
    {
      // Use where: { query: "…", format: "json", size: "25" }
      name: '/uniparc/search',
      columns: ['uniParcId', 'crossReferenceCount', 'sequenceLength', 'oldestCrossRefCreated', 'mostRecentCrossRefUpdated', 'sequence'],
      relations: [],
    },
    {
      // Use where: { query: "…", format: "json", size: "25" }
      name: '/taxonomy/search',
      columns: ['taxonId', 'scientificName', 'commonName', 'mnemonic', 'rank', 'parentLink', 'childrenLinks', 'statistics'],
      relations: [],
    },
  ],
};
