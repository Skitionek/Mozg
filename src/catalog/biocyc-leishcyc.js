'use strict';

/**
 * LeishCyc – metabolic pathway database for Leishmania major Friedlin.
 *
 * Tier: 1 (extensively curated; BioCyc subscription required)
 * Reference: https://biocyc.org/LEISHCYC
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-leishcyc',
  label: 'LeishCyc – Leishmania major (BioCyc Tier 1)',
  description: 'Metabolic pathway database for Leishmania major Friedlin (leishmaniasis pathogen). Tier 1: extensively curated. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'LEISHCYC',
  },
  entities: require('./biocyc-entities'),
};
