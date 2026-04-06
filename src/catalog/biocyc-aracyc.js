'use strict';

/**
 * AraCyc – metabolic pathway database for Arabidopsis thaliana Columbia.
 *
 * Tier: 1 (extensively curated; BioCyc subscription required)
 * Reference: https://www.arabidopsis.org/biocyc/index.jsp
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-aracyc',
  label: 'AraCyc – Arabidopsis thaliana (BioCyc Tier 1)',
  description: 'Metabolic pathway database for Arabidopsis thaliana Columbia. Tier 1: extensively curated. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'ARACYC',
  },
  entities: require('./biocyc-entities'),
};
