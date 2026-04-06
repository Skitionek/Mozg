'use strict';

/**
 * KEGG – Kyoto Encyclopedia of Genes and Genomes.
 * Reference: https://www.kegg.jp/
 * API docs:  https://www.kegg.jp/kegg/rest/keggapi.html
 *
 * No credentials required for academic use (non-commercial).
 * Rate limit: 3 req/sec recommended.
 *
 * Uses the dedicated `kegg` driver which converts KEGG's text/plain responses
 * (tab-delimited and flat-file formats) to JSON automatically.
 *
 * Key operations:
 *  - /list/{database}         – list all entries in a database
 *    databases: pathway, brite, module, ko, genome, hsa, eco, … (organism codes)
 *  - /find/{database}/{query} – keyword search
 *  - /get/{entry}             – fetch full entry (flat-file format)
 *  - /link/{target}/{source}  – find cross-links between databases
 *  - /info/{database}         – database statistics
 *
 * For /find, /get and /link the search term / entry ID / source ID must be
 * passed via `where: { _pathSuffix: "…" }` — it becomes an extra URL path
 * segment so KEGG receives the correct request.
 *
 * Examples:
 *  List pathways:     from "/list/pathway"
 *  Search compound:   from "/find/compound"  where: { _pathSuffix: "glucose" }
 *  Fetch entry:       from "/get"            where: { _pathSuffix: "C00031" }
 *  Link gene→pathway: from "/link/pathway"   where: { _pathSuffix: "hsa:7157" }
 *
 * Relationship map:
 *  - /list/pathway  →  /get   (entry_id → _pathSuffix, belongsTo full record)
 *  - /list/compound →  /link/pathway  (entry_id → _pathSuffix, hasMany pathways)
 */
module.exports = {
  name: 'kegg',
  label: 'KEGG (REST)',
  description: 'Kyoto Encyclopedia of Genes and Genomes — biological systems database with pathway maps, BRITE hierarchies, modules and cross-organism gene/compound data. Pass where._pathSuffix for /find, /get and /link queries.',
  driver: 'kegg',
  connection: {
    database: 'https://rest.kegg.jp',
  },
  entities: [
    {
      name: '/list/pathway',
      columns: ['entry_id', 'name'],
      relations: [
        { entity: '/get', foreignKey: 'entry_id', type: 'belongsTo', alias: 'entry' },
      ],
    },
    {
      name: '/list/compound',
      columns: ['entry_id', 'name'],
      relations: [
        { entity: '/link/pathway', foreignKey: 'entry_id', type: 'hasMany', alias: 'pathways' },
      ],
    },
    {
      name: '/list/reaction',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      name: '/list/enzyme',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      name: '/list/drug',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      name: '/list/glycan',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      // Use where: { _pathSuffix: "glucose" } to search compound by keyword
      name: '/find/compound',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      // Use where: { _pathSuffix: "acetyl" } to search reaction by keyword
      name: '/find/reaction',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      // Use where: { _pathSuffix: "K00001" } to search KO entries by keyword
      name: '/find/ko',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      // Fetch full flat-file record: where: { _pathSuffix: "C00031" }
      name: '/get',
      columns: ['entry', 'name', 'formula', 'mass', 'mol_weight', 'pathway', 'enzyme', 'dblinks', 'atom', 'bond'],
      relations: [],
    },
    {
      // Cross-links: where: { _pathSuffix: "hsa:7157" } → pathways for TP53
      name: '/link/pathway',
      columns: ['source_id', 'target_id'],
      relations: [],
    },
    {
      // Cross-links: where: { _pathSuffix: "hsa:7157" } → KO entries for TP53
      name: '/link/ko',
      columns: ['source_id', 'target_id'],
      relations: [],
    },
    {
      // Database statistics: where: { _pathSuffix: "compound" }
      name: '/info',
      columns: ['entry_id', 'name'],
      relations: [],
    },
  ],
};

