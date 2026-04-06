'use strict';

/**
 * DDBJ – DNA Data Bank of Japan, the sole nucleotide archive in Asia.
 * Reference: https://www.ddbj.nig.ac.jp/
 * API docs:  https://ddbj.nig.ac.jp/search/api/v1
 *
 * No credentials required for public data access.
 * DDBJ is a member of the INSDC (International Nucleotide Sequence Database
 * Collaboration) together with NCBI GenBank and EMBL-EBI ENA and shares
 * identical data with both.
 *
 * The DDBJ Search API (Elasticsearch-backed) provides JSON responses.
 *
 * Key where parameters for /search/sequence:
 *  - q:      search keywords
 *  - from:   offset (0-based)
 *  - size:   results per page
 *
 * Key where parameters for /search/bioproject or /search/biosample:
 *  - q:     free-text query
 *  - from:  offset
 *  - size:  page size
 *
 * Relationship map:
 *  - /search/sequence  →  /search/bioproject  (bioproject_accession, belongsTo)
 *  - /search/bioproject →  /search/biosample  (biosample_accession, hasMany)
 */
module.exports = {
  name: 'ddbj',
  label: 'DDBJ (REST)',
  description: 'DNA Data Bank of Japan — INSDC member archive of nucleotide sequences, BioProjects and BioSamples. Data is synchronised with NCBI GenBank and EMBL-EBI ENA. Use q= for free-text search in where params.',
  driver: 'rest',
  connection: {
    database: 'https://ddbj.nig.ac.jp/search/api/v1',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Use where: { q: "BRCA1", size: "20" }
      name: '/search/sequence',
      columns: ['accession', 'title', 'organism', 'taxon_id', 'sequence_length', 'mol_type', 'division', 'bioproject_accession', 'biosample_accession', 'submission_date', 'last_modified_date'],
      relations: [
        { entity: '/search/bioproject', foreignKey: 'bioproject_accession', type: 'belongsTo', alias: 'bioproject' },
      ],
    },
    {
      // Use where: { q: "human genome", size: "20" }
      name: '/search/bioproject',
      columns: ['accession', 'title', 'description', 'organism', 'taxon_id', 'submission_date', 'last_modified_date'],
      relations: [
        { entity: '/search/biosample', foreignKey: 'accession', type: 'hasMany', alias: 'biosamples' },
      ],
    },
    {
      // Use where: { q: "liver tissue", size: "20" }
      name: '/search/biosample',
      columns: ['accession', 'title', 'organism', 'taxon_id', 'tissue_type', 'cell_type', 'dev_stage', 'submission_date'],
      relations: [],
    },
  ],
};
