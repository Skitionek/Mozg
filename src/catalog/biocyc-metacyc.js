'use strict'

/**
 * MetaCyc – reference database of experimentally elucidated metabolic pathways
 * from more than 3,400 organisms.
 *
 * Tier: FREE (no credentials required for public read access)
 * Reference: https://metacyc.org
 *
 * All entities (genes, compounds, reactions, pathways, proteins, rna,
 * organisms) share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-metacyc',
  label: 'MetaCyc (BioCyc – Free)',
  description: 'Reference database of experimentally elucidated metabolic pathways from over 3,400 organisms. Freely accessible without credentials.',
  driver: 'biocyc',
  connection: {
    database: 'META'
  },
  entities: require('./biocyc-entities')
}
