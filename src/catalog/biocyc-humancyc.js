'use strict';

/**
 * HumanCyc – metabolic pathway database for Homo sapiens.
 *
 * Tier: 1 (extensively curated; BioCyc subscription required)
 * Reference: https://humancyc.org
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-humancyc',
  label: 'HumanCyc – Homo sapiens (BioCyc Tier 1)',
  description: 'Metabolic pathway database for Homo sapiens. Tier 1: extensively curated. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'HUMAN',
  },
  entities: require('./biocyc-entities'),
};
