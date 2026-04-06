'use strict';

/**
 * CauloCyc – metabolic pathway database for Caulobacter crescentus.
 *
 * Tier: 2 (computationally predicted + manual curation; BioCyc subscription required)
 * Reference: https://biocyc.org/CAULOBACTER
 *
 * Provide user/password in the connection at query time to authenticate.
 * All entities share the same fixed BioCyc schema.
 */
module.exports = {
  name: 'biocyc-caulocyc',
  label: 'CauloCyc – Caulobacter crescentus (BioCyc Tier 2)',
  description: 'Metabolic pathway database for Caulobacter crescentus (model organism for cell-cycle research). Tier 2: computationally predicted with manual curation. Requires a BioCyc subscription (user/password).',
  driver: 'biocyc',
  connection: {
    database: 'CAULOBACTER',
  },
  entities: require('./biocyc-entities'),
};
