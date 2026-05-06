'use strict'

/**
 * BorrCyc – metabolic pathway database for Borrelia burgdorferi.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/BBURG
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-borrcyc',
  label: 'BorrCyc – Borrelia burgdorferi (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Borrelia burgdorferi (Lyme disease pathogen). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'BBURG'
  },
  entities: require('./biocyc-entities')
}
