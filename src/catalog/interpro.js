'use strict';

/**
 * InterPro – protein families, domains and functional sites database.
 * Reference: https://www.ebi.ac.uk/interpro/
 * API docs:  https://www.ebi.ac.uk/interpro/api/doc/
 *
 * No credentials required. All data freely available.
 *
 * InterPro accessions: IPR000001 (9-digit zero-padded integer with IPR prefix)
 * UniProtKB accession: P00533 (Swiss-Prot) or A0A000XXX (TrEMBL)
 * PDB ID: 1TUP (4-character)
 *
 * Key where parameters:
 *  - page_size: number of results per page (max 200)
 *  - cursor:    pagination cursor from previous response
 *  - search:    keyword search
 *  - type:      entry type filter (family, domain, homologous_superfamily, …)
 *
 * Relationship map:
 *  - /entry/InterPro  →  /protein/UniProt  (accession → entry accession, hasMany)
 *  - /protein/UniProt →  /entry/InterPro   (protein accession → accession, hasMany)
 *  - /protein/UniProt →  /structure/PDB    (protein → PDB structures, hasMany)
 */
module.exports = {
  name: 'interpro',
  label: 'InterPro (REST)',
  description: 'EBI InterPro protein families, domains and functional sites. Integrates 13 member databases (Pfam, PANTHER, PRINTS, HAMAP, …). Free JSON API. Accessions: IPR000001 (entries), P00533/A0A000 (UniProt), 1TUP (PDB).',
  driver: 'rest',
  connection: {
    database: 'https://www.ebi.ac.uk/interpro/api',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // All entries: /entry/all/?format=json
      name: '/entry/all',
      columns: ['accession', 'name', 'type', 'integrated', 'member_databases', 'go_terms', 'description', 'literature', 'overlaps_with'],
      relations: [
        { entity: '/protein/UniProt', foreignKey: 'accession', type: 'hasMany', alias: 'proteins' },
      ],
    },
    {
      // Entries from a specific member database: /entry/pfam
      name: '/entry/pfam',
      columns: ['accession', 'name', 'type', 'integrated', 'short_name', 'source_database'],
      relations: [
        { entity: '/protein/UniProt', foreignKey: 'accession', type: 'hasMany', alias: 'proteins' },
      ],
    },
    {
      // Proteins with InterPro annotations: /protein/UniProt/
      name: '/protein/UniProt',
      columns: ['accession', 'name', 'source_organism', 'length', 'sequence', 'in_alphafold', 'is_reviewed', 'ida_id'],
      relations: [
        { entity: '/entry/all', foreignKey: 'accession', type: 'hasMany', alias: 'entries' },
        { entity: '/structure/PDB', foreignKey: 'accession', type: 'hasMany', alias: 'structures' },
        { entity: '/uniprotkb/search', foreignKey: 'accession', type: 'belongsTo', alias: 'uniprotEntry', catalog: 'uniprot' },
      ],
    },
    {
      // Structures with InterPro annotations: /structure/PDB/
      name: '/structure/PDB',
      columns: ['accession', 'name', 'experiment_type', 'release_date', 'chains'],
      relations: [
        { entity: '/entry', foreignKey: 'accession', type: 'belongsTo', alias: 'pdbEntry', catalog: 'pdb' },
      ],
    },
    {
      // Taxonomy nodes with InterPro annotations: /taxonomy/uniprot/
      name: '/taxonomy/uniprot',
      columns: ['accession', 'name', 'rank', 'lineage', 'children', 'proteins', 'entries'],
      relations: [
        { entity: '/protein/UniProt', foreignKey: 'taxId', type: 'hasMany', alias: 'proteins' },
      ],
    },
  ],
};
