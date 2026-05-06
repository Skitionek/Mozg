'use strict'

/**
 * YeastCyc – metabolic pathway database for Saccharomyces cerevisiae S288C.
 *
 * Tier: 1 (extensively curated; BioCyc subscription required)
 * Reference: https://yeastcyc.org / https://pathway.yeastgenome.org
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-yeastcyc',
  label: 'YeastCyc – S. cerevisiae (BioCyc Tier 1)',
  description: 'Metabolic pathway database for Saccharomyces cerevisiae S288C. Tier 1: extensively curated. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'YEAST'
  },
  entities: require('./biocyc-entities')
}
