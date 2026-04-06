'use strict';

/**
 * HMDB – Human Metabolome Database.
 * Reference: https://hmdb.ca/
 * API docs:  https://hmdb.ca/api
 *
 * No credentials required. All data freely available under CC0.
 *
 * HMDB REST API base: https://hmdb.ca
 * Metabolite accession format: HMDB0000001 (7-digit zero-padded)
 *
 * Key endpoints:
 *  - /metabolites.json?page={n}          – paginated metabolite list
 *  - /metabolites/{accession}.json       – single metabolite record
 *  - /metabolites/search.json            – search (where: { query: "glucose" })
 *  - /proteins.json?page={n}             – protein list
 *  - /proteins/{accession}.json          – single protein record
 *
 * Key where parameters for search: query, page
 *
 * Relationship map:
 *  - /metabolites/{acc}  →  /proteins/{accession}  (protein associations, hasMany)
 */
module.exports = {
  name: 'hmdb',
  label: 'HMDB – Human Metabolome Database (REST)',
  description: 'Human Metabolome Database — comprehensive resource for metabolite biology including chemical data, enzymes, pathways and disease associations for 200 000+ metabolites. Accessions follow the HMDB0000001 format. No auth required.',
  driver: 'rest',
  connection: {
    database: 'https://hmdb.ca',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Paginated list: /metabolites.json?page=1
      name: '/metabolites.json',
      columns: ['accession', 'name', 'description', 'chemical_formula', 'average_molecular_weight', 'monisotopic_molecular_weight', 'iupac_name', 'traditional_iupac', 'smiles', 'inchi', 'inchikey', 'state', 'super_class', 'class', 'sub_class', 'status'],
      relations: [],
    },
    {
      // Search: /metabolites/search.json?query=glucose
      name: '/metabolites/search.json',
      columns: ['accession', 'name', 'chemical_formula', 'average_molecular_weight', 'smiles', 'inchikey'],
      relations: [],
    },
    {
      // Paginated list: /proteins.json?page=1
      name: '/proteins.json',
      columns: ['accession', 'name', 'uniprot_id', 'gene_name', 'protein_type', 'general_function', 'pathways'],
      relations: [],
    },
    {
      // Paginated list: /diseases.json?page=1
      name: '/diseases.json',
      columns: ['name', 'omim_id', 'references'],
      relations: [],
    },
  ],
};
