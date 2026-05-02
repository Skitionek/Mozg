'use strict';

/**
 * PDB – RCSB Protein Data Bank, archive of 3D macromolecular structures.
 * Reference: https://www.rcsb.org/
 * API docs:  https://data.rcsb.org
 *
 * No credentials required. All data is freely available.
 *
 * The Data API (data.rcsb.org/rest/v1/core) provides JSON for individual
 * structure entries, polymer entities and polymer instances (chains).
 * PDB IDs are 4-character alphanumeric codes (e.g. 1TUP, 6VXX).
 *
 * Entity IDs within a structure are 1-based integers (1, 2, …).
 * Asymmetric IDs (chain IDs) are single letters (A, B, …).
 *
 * Relationship map:
 *  - /entry/{id}            →  /polymer_entity/{id}/{entity_id}  (hasMany)
 *  - /polymer_entity/{id}/{entity_id}
 *                           →  /polymer_entity_instance/{id}/{asym_id}  (hasMany)
 *
 * For bulk searching use the Search API at https://search.rcsb.org (POST).
 */
module.exports = {
  name: 'pdb',
  label: 'PDB – Protein Data Bank (REST)',
  description: 'RCSB Protein Data Bank archive of experimentally determined 3D structures of biological macromolecules. Free JSON access to entry, polymer entity and chain-level data. PDB IDs are 4-character codes (e.g. 1TUP).',
  driver: 'rest',
  connection: {
    database: 'https://data.rcsb.org/rest/v1/core',
  },
  entities: [
    {
      // Fetch by PDB ID: /entry/1TUP
      name: '/entry/{id}',
      columns: ['entry_id', 'struct', 'exptl', 'cell', 'symmetry', 'diffrn', 'reflns', 'refine', 'pdbx_vrpt_summary', 'rcsb_entry_info', 'rcsb_accession_info'],
      relations: [
        {
          entity: '/polymer_entity/{entry_id}/{entity_id}',
          localKey: 'rcsb_entry_container_identifiers.polymer_entity_ids',
          foreignKey: 'entity_id',
          type: 'hasMany',
          alias: 'polymerEntities',
        },
        { entity: '/uniprotkb/search', foreignKey: 'entry_id', type: 'hasMany', alias: 'uniprotProteins', catalog: 'uniprot' },
        { entity: '/structure/PDB', foreignKey: 'entry_id', type: 'hasMany', alias: 'interproAnnotations', catalog: 'interpro' },
      ],
    },
    {
      // Fetch by entry+entity: /polymer_entity/1TUP/1
      name: '/polymer_entity/{id}/{entity_id}',
      columns: ['entry_id', 'entity_id', 'entity', 'rcsb_polymer_entity', 'rcsb_entity_source_organism', 'rcsb_cluster_membership', 'struct_ref'],
      relations: [
        {
          entity: '/polymer_entity_instance/{entry_id}/{asym_id}',
          localKey: 'rcsb_polymer_entity_container_identifiers.asym_ids',
          foreignKey: 'asym_id',
          type: 'hasMany',
          alias: 'chains',
        },
      ],
    },
    {
      // Fetch by entry+asym: /polymer_entity_instance/1TUP/A
      name: '/polymer_entity_instance/{id}/{asym_id}',
      columns: ['entry_id', 'asym_id', 'auth_asym_id', 'rcsb_polymer_entity_instance_container_identifiers', 'rcsb_polymer_instance_annotation'],
      relations: [],
    },
    {
      // Fetch by PDB ID: /assembly/1TUP/1
      name: '/assembly/{id}/{assembly_id}',
      columns: ['entry_id', 'assembly_id', 'rcsb_assembly_info', 'rcsb_struct_symmetry', 'pdbx_struct_assembly'],
      relations: [
        { entity: '/entry/{id}', foreignKey: 'entry_id', type: 'belongsTo', alias: 'entry' },
      ],
    },
  ],
};
