'use strict';

/**
 * ZFIN – Zebrafish Information Network.
 *
 * ZFIN retired its legacy public JSON endpoints under https://zfin.org/action/api
 * and the current HTML search flow is CAPTCHA-protected. To keep a working
 * zebrafish catalog available, Mozg now exposes a compatibility catalog backed
 * by the maintained Ensembl REST API for Danio rerio.
 *
 * Reference: https://rest.ensembl.org/documentation
 *
 * Notes:
 *  - Replace the final path segment in /xrefs/symbol/danio_rerio/tp53 with a
 *    different zebrafish gene symbol to search another marker.
 *  - /lookup/id/{id} accepts Ensembl stable IDs such as ENSDARG00000035559.
 */
module.exports = {
  name: 'zfin',
  label: 'ZFIN – zebrafish genes (compatibility via Ensembl REST)',
  description: 'Zebrafish gene lookup compatibility catalog. ZFIN retired its legacy /action/api JSON endpoints, so Mozg now uses Ensembl REST for Danio rerio gene identifiers, details and cross-references.',
  driver: 'rest',
  connection: {
    database: 'https://rest.ensembl.org',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  },
  entities: [
    {
      // Example zebrafish lookup: /xrefs/symbol/danio_rerio/tp53
      name: '/xrefs/symbol/danio_rerio/tp53',
      columns: ['id', 'type'],
      relations: [
        { entity: '/lookup/id', foreignKey: 'id', type: 'belongsTo', alias: 'geneDetail' },
        { entity: '/xrefs/id', foreignKey: 'id', type: 'hasMany', alias: 'crossReferences' },
      ],
    },
    {
      // Stable ID lookup: /lookup/id/ENSDARG00000035559
      name: '/lookup/id',
      columns: ['id', 'display_name', 'species', 'object_type', 'biotype', 'description', 'start', 'end', 'strand', 'seq_region_name', 'assembly_name', 'canonical_transcript'],
      relations: [
        { entity: '/xrefs/id', foreignKey: 'id', type: 'hasMany', alias: 'crossReferences' },
      ],
    },
    {
      // Cross-database references: /xrefs/id/ENSDARG00000035559
      name: '/xrefs/id',
      columns: ['primary_id', 'display_id', 'dbname', 'db_display_name', 'description', 'info_type', 'info_text', 'synonyms'],
      relations: [],
    },
  ],
};
