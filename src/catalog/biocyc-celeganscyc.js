'use strict'

/**
 * CelegansCyc – metabolic pathway database for Caenorhabditis elegans.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/CELEGANS
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-celeganscyc',
  label: 'CelegansCyc – Caenorhabditis elegans (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Caenorhabditis elegans (model nematode). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'CELEGANS'
  },
  entities: require('./biocyc-entities')
}
