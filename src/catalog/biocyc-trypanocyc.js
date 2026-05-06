'use strict'

/**
 * TrypanoCyc – metabolic pathway database for Trypanosoma brucei.
 *
 * Tier: 1 (extensively curated; BioCyc subscription required)
 * Reference: https://biocyc.org/TRYPANO
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-trypanocyc',
  label: 'TrypanoCyc – Trypanosoma brucei (BioCyc Tier 1)',
  description: 'Metabolic pathway database for Trypanosoma brucei (sleeping sickness pathogen). Tier 1: extensively curated. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'TRYPANO'
  },
  entities: require('./biocyc-entities')
}
