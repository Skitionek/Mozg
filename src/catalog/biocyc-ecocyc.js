'use strict';

/**
 * EcoCyc – comprehensive genome and metabolic-pathway database for
 * Escherichia coli K-12 MG1655.
 *
 * Tier: FREE / Tier 1 (NIH-funded; no credentials required for public access)
 * Reference: https://ecocyc.org
 *
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-ecocyc',
  label: 'EcoCyc – E. coli K-12 (BioCyc – Free / Tier 1)',
  description: 'Genome and metabolic pathway database for Escherichia coli K-12 MG1655. NIH-funded and freely accessible without credentials.',
  driver: 'biocyc',
  connection: {
    database: 'ECOLI',
  },
  entities: require('./biocyc-entities'),
};
