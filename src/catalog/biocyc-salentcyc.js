'use strict';

/**
 * SalentCyc – metabolic pathway database for Salmonella enterica.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/SALENT
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-salentcyc',
  label: 'SalentCyc – Salmonella enterica (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Salmonella enterica (food-borne pathogen). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'SALENT',
  },
  entities: require('./biocyc-entities'),
};
