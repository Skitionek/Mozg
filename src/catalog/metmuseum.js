'use strict';

/**
 * Metropolitan Museum of Art – open access collection API.
 * Reference: https://metmuseum.github.io/
 *
 * No credentials required. CORS-enabled.
 *
 * Key endpoints:
 *  - /departments – list of all departments (returns {departments: [...]})
 *  - /objects – list of all object IDs with optional filters
 *    (returns {total, objectIDs: [...]})
 *  - /objects/{objectID} – full record for one object
 *
 * Relationship map:
 *  - /objects  → /departments  (departmentId FK, belongsTo)
 *  - /departments have many /objects (departmentId, hasMany; use
 *    /objects?departmentIds={departmentId} to filter)
 */
module.exports = {
  name: 'metmuseum',
  label: 'Met Museum (REST)',
  description: 'Open access collection API for the Metropolitan Museum of Art with objects, departments and search.',
  driver: 'rest',
  connection: {
    database: 'https://collectionapi.metmuseum.org/public/collection/v1',
  },
  entities: [
    {
      name: '/departments',
      columns: ['departmentId', 'displayName'],
      relations: [
        { entity: '/objects', foreignKey: 'departmentId', type: 'hasMany', alias: 'objects' },
      ],
    },
    {
      name: '/objects',
      columns: ['objectID', 'isHighlight', 'accessionNumber', 'accessionYear', 'isPublicDomain', 'primaryImage', 'department', 'objectType', 'title', 'artistDisplayName', 'artistNationality', 'objectDate', 'medium', 'dimensions', 'country', 'period', 'culture', 'departmentId'],
      relations: [
        { entity: '/departments', foreignKey: 'departmentId', type: 'belongsTo', alias: 'department' },
      ],
    },
  ],
};
