'use strict';

// Common entity definitions shared by every BioCyc organism database catalog
// entry.  The schema is identical across all PGDBs; only connection.database
// (the organism code) and the catalog metadata differ between entries.
//
// Relationship notes (all resolved client-side by the biocyc driver):
//  - genes     → proteins  via the 'product' AV field
//  - pathways  → reactions via the 'reaction_list' AV field

module.exports = [
  {
    name: 'genes',
    columns: ['_id', 'name', 'types', 'left_end_position', 'right_end_position', 'transcription_direction'],
    relations: [
      { entity: 'proteins', foreignKey: 'product', type: 'hasMany', alias: 'products' },
    ],
  },
  {
    name: 'compounds',
    columns: ['_id', 'name', 'types', 'molecular_weight', 'formula', 'inchi'],
    relations: [],
  },
  {
    name: 'reactions',
    columns: ['_id', 'name', 'types', 'ec_number', 'enzymatic_reaction'],
    relations: [],
  },
  {
    name: 'pathways',
    columns: ['_id', 'name', 'types', 'taxonomic_range', 'reaction_list'],
    relations: [
      { entity: 'reactions', foreignKey: 'reaction_list', type: 'hasMany', alias: 'reactions' },
    ],
  },
  {
    name: 'proteins',
    columns: ['_id', 'name', 'types'],
    relations: [],
  },
  {
    name: 'rna',
    columns: ['_id', 'name', 'types'],
    relations: [],
  },
  {
    name: 'organisms',
    columns: ['_id', 'name', 'types'],
    relations: [],
  },
];
