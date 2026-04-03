'use strict';

/**
 * Rfam – public RNA families database maintained by the Wellcome Sanger Institute.
 * Reference: https://rfam.org/help/database
 *
 * The credentials below are the publicly documented read-only credentials.
 * Note: the public MySQL server uses port 4497 (not the standard 3306).
 *
 * Relationship map:
 *  - family → full_region  (rfam_acc, hasMany)
 *  - full_region → family  (rfam_acc, belongsTo)
 *  - full_region → rfamseq (rfamseq_acc, belongsTo)
 */
module.exports = {
  name: 'rfam',
  label: 'Rfam (MySQL)',
  description: 'Public EBI database of RNA families with covariance models, seed alignments and genome annotations.',
  driver: 'mysql',
  connection: {
    host: 'mysql-rfam-public.ebi.ac.uk',
    port: 4497,
    database: 'Rfam',
    user: 'rfamro',
    password: '',
  },
  entities: [
    {
      name: 'family',
      columns: ['rfam_acc', 'rfam_id', 'description', 'author', 'type', 'gathering_cutoff', 'noise_cutoff', 'number_of_species', 'number_3d_structures', 'created', 'updated'],
      relations: [
        { entity: 'full_region', foreignKey: 'rfam_acc', localKey: 'rfam_acc', type: 'hasMany', alias: 'regions' },
      ],
    },
    {
      name: 'full_region',
      columns: ['rfam_acc', 'rfamseq_acc', 'seq_start', 'seq_end', 'score', 'e_value', 'is_significant', 'type'],
      relations: [
        { entity: 'family', foreignKey: 'rfam_acc', localKey: 'rfam_acc', type: 'belongsTo', alias: 'family' },
        { entity: 'rfamseq', foreignKey: 'rfamseq_acc', localKey: 'rfamseq_acc', type: 'belongsTo', alias: 'sequence' },
      ],
    },
    {
      name: 'rfamseq',
      columns: ['rfamseq_acc', 'description', 'length', 'ncbi_id', 'mol_type', 'source'],
      relations: [
        { entity: 'full_region', foreignKey: 'rfamseq_acc', localKey: 'rfamseq_acc', type: 'hasMany', alias: 'regions' },
      ],
    },
  ],
};
