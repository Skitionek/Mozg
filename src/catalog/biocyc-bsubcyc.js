'use strict'

/**
 * BsubCyc – metabolic pathway database for Bacillus subtilis 168.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/BSUB
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-bsubcyc',
  label: 'BsubCyc – Bacillus subtilis 168 (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Bacillus subtilis 168 (model Gram-positive bacterium). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'BSUB'
  },
  entities: require('./biocyc-entities')
}
