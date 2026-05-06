'use strict'

/**
 * VibrioCyc – metabolic pathway database for Vibrio cholerae.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/VIBCYC
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-vibriocyc',
  label: 'VibrioCyc – Vibrio cholerae (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Vibrio cholerae (cholera pathogen). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'VIBCYC'
  },
  entities: require('./biocyc-entities')
}
