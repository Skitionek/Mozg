'use strict';

/**
 * ListCyc – metabolic pathway database for Listeria monocytogenes.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/LISTCYC
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-listcyc',
  label: 'ListCyc – Listeria monocytogenes (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Listeria monocytogenes (food-borne pathogen). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'LISTCYC',
  },
  entities: require('./biocyc-entities'),
};
