'use strict';

/**
 * DrosoCyc – metabolic pathway database for Drosophila melanogaster.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/DROME
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-drosocyc',
  label: 'DrosoCyc – Drosophila melanogaster (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Drosophila melanogaster (fruit fly model organism). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'DROME',
  },
  entities: require('./biocyc-entities'),
};
