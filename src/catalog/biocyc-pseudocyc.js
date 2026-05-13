'use strict'

/**
 * PseudoCyc – metabolic pathway database for Pseudomonas aeruginosa PAO1.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/PSEUDO
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-pseudocyc',
  label: 'PseudoCyc – Pseudomonas aeruginosa PAO1 (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Pseudomonas aeruginosa PAO1 (opportunistic pathogen). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'PSEUDO'
  },
  entities: require('./biocyc-entities')
}
