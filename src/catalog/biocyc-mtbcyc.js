'use strict'

/**
 * MtbcCyc – metabolic pathway database for Mycobacterium tuberculosis.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/MTBC
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-mtbcyc',
  label: 'MtbcCyc – Mycobacterium tuberculosis (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Mycobacterium tuberculosis (tuberculosis pathogen). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'MTBC'
  },
  entities: require('./biocyc-entities')
}
