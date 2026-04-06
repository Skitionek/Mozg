'use strict';

/**
 * CampyCyc – metabolic pathway database for Campylobacter jejuni.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/CAMPY
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-campycyc',
  label: 'CampyCyc – Campylobacter jejuni (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Campylobacter jejuni (food-borne pathogen, leading cause of bacterial gastroenteritis). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'CAMPY',
  },
  entities: require('./biocyc-entities'),
};
