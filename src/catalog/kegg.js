'use strict'

/**
 * KEGG – Kyoto Encyclopedia of Genes and Genomes.
 * Reference: https://www.kegg.jp/
 * API docs:  https://www.kegg.jp/kegg/rest/keggapi.html
 *
 * No credentials required for academic use (non-commercial).
 * Rate limit: 3 req/sec (enforced by the kegg driver).
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
 *  - /conv/{target}/{source}  – convert KEGG ids to/from outside databases
 *  - /info/{database}         – database statistics
 *
 * For /find, /get, /link and /conv the search term / entry ID / source ID
 * must be passed via `where: { _pathSuffix: "…" }` — it becomes an extra URL
 * path segment so KEGG receives the correct request.
 *
 * Examples:
 *  List pathways:     from "/list/pathway"
 *  Search compound:   from "/find/compound"  where: { _pathSuffix: "glucose" }
 *  Fetch entry:       from "/get"            where: { _pathSuffix: "C00031" }
 *  Link gene→pathway: from "/link/pathway"   where: { _pathSuffix: "hsa:7157" }
 *  KEGG → ChEBI:      from "/conv/chebi"     where: { _pathSuffix: "C00031" }
 *
 * Relations.  Every KEGG lookup takes one id as a path segment, so a
 * same-source relation reads the id from the parent row's `foreignKey` field
 * (the kegg driver) — `localKey` names the same field so the generic
 * resolver (streaming, include) reads it from the same place.  /link and
 * /conv rows put the id they point at in `target_id` / `name` respectively.
 *
 * The one link out of KEGG is ChEBI: /conv/chebi rows carry ids like
 * "chebi:4167", which the chebi source accepts as they are.  KEGG's other
 * conversions (up:P04637, ncbi-geneid:7157) keep their KEGG prefix, which the
 * UniProt and NCBI Gene sources do not accept, so they are not wired up.
 */

const ENTRY_RELATION = { entity: '/get', foreignKey: 'entry_id', localKey: 'entry_id', type: 'belongsTo', ownerKey: '_pathSuffix', alias: 'entry' }

module.exports = {
  name: 'kegg',
  label: 'KEGG',
  description: 'Kyoto Encyclopedia of Genes and Genomes — biological systems database with pathway maps, BRITE hierarchies, modules and cross-organism gene/compound data. Pass where._pathSuffix for /find, /get, /link and /conv queries.',
  category: 'Interactions & pathways',
  homepage: 'https://www.kegg.jp',
  docs: 'https://www.kegg.jp/kegg/rest/keggapi.html',
  license: 'Free for academic use; commercial use needs a licence — https://www.kegg.jp/kegg/legal.html',
  driver: 'kegg',
  connection: {
    database: 'https://rest.kegg.jp'
  },
  entities: [
    {
      name: '/list/pathway',
      columns: ['entry_id', 'name'],
      relations: [
        ENTRY_RELATION,
        { entity: '/link/compound', foreignKey: 'entry_id', localKey: 'entry_id', type: 'hasMany', alias: 'compounds' }
      ]
    },
    {
      name: '/list/compound',
      columns: ['entry_id', 'name'],
      relations: [
        ENTRY_RELATION,
        { entity: '/link/pathway', foreignKey: 'entry_id', localKey: 'entry_id', type: 'hasMany', alias: 'pathways' },
        { entity: '/link/reaction', foreignKey: 'entry_id', localKey: 'entry_id', type: 'hasMany', alias: 'reactions' },
        { entity: '/conv/chebi', foreignKey: 'entry_id', localKey: 'entry_id', type: 'hasMany', alias: 'chebi' }
      ]
    },
    {
      name: '/list/reaction',
      columns: ['entry_id', 'name'],
      relations: [
        ENTRY_RELATION,
        { entity: '/link/compound', foreignKey: 'entry_id', localKey: 'entry_id', type: 'hasMany', alias: 'compounds' }
      ]
    },
    {
      name: '/list/enzyme',
      columns: ['entry_id', 'name'],
      relations: [
        ENTRY_RELATION,
        { entity: '/link/reaction', foreignKey: 'entry_id', localKey: 'entry_id', type: 'hasMany', alias: 'reactions' }
      ]
    },
    {
      name: '/list/drug',
      columns: ['entry_id', 'name'],
      relations: [
        ENTRY_RELATION,
        { entity: '/conv/chebi', foreignKey: 'entry_id', localKey: 'entry_id', type: 'hasMany', alias: 'chebi' }
      ]
    },
    {
      name: '/list/glycan',
      columns: ['entry_id', 'name'],
      relations: [ENTRY_RELATION]
    },
    {
      // Use where: { _pathSuffix: "glucose" } to search compound by keyword
      name: '/find/compound',
      columns: ['entry_id', 'name'],
      relations: [
        ENTRY_RELATION,
        { entity: '/conv/chebi', foreignKey: 'entry_id', localKey: 'entry_id', type: 'hasMany', alias: 'chebi' }
      ]
    },
    {
      // Use where: { _pathSuffix: "acetyl" } to search reaction by keyword
      name: '/find/reaction',
      columns: ['entry_id', 'name'],
      relations: [ENTRY_RELATION]
    },
    {
      // Use where: { _pathSuffix: "K00001" } to search KO entries by keyword
      name: '/find/ko',
      columns: ['entry_id', 'name'],
      relations: [ENTRY_RELATION]
    },
    {
      // Fetch full flat-file record: where: { _pathSuffix: "C00031" }
      name: '/get',
      columns: ['entry', 'name', 'formula', 'mass', 'mol_weight', 'pathway', 'enzyme', 'dblinks', 'atom', 'bond'],
      relations: []
    },
    {
      // Cross-links: where: { _pathSuffix: "hsa:7157" } → pathways for TP53
      name: '/link/pathway',
      columns: ['source_id', 'target_id'],
      relations: [
        { entity: '/get', foreignKey: 'target_id', localKey: 'target_id', type: 'belongsTo', ownerKey: '_pathSuffix', alias: 'pathway' }
      ]
    },
    {
      // Cross-links: where: { _pathSuffix: "map00010" } or "R00001" → compounds
      name: '/link/compound',
      columns: ['source_id', 'target_id'],
      relations: [
        { entity: '/get', foreignKey: 'target_id', localKey: 'target_id', type: 'belongsTo', ownerKey: '_pathSuffix', alias: 'compound' },
        { entity: '/conv/chebi', foreignKey: 'target_id', localKey: 'target_id', type: 'hasMany', alias: 'chebi' }
      ]
    },
    {
      // Cross-links: where: { _pathSuffix: "1.1.1.1" } or "C00031" → reactions
      name: '/link/reaction',
      columns: ['source_id', 'target_id'],
      relations: [
        { entity: '/get', foreignKey: 'target_id', localKey: 'target_id', type: 'belongsTo', ownerKey: '_pathSuffix', alias: 'reaction' }
      ]
    },
    {
      // Cross-links: where: { _pathSuffix: "hsa:7157" } → KO entries for TP53
      name: '/link/ko',
      columns: ['source_id', 'target_id'],
      relations: [
        { entity: '/get', foreignKey: 'target_id', localKey: 'target_id', type: 'belongsTo', ownerKey: '_pathSuffix', alias: 'ko' }
      ]
    },
    {
      // KEGG → ChEBI ids: where: { _pathSuffix: "C00031" } (compounds and drugs).
      // The kegg driver parses /conv as entry_id + name, so `name` is the ChEBI id.
      name: '/conv/chebi',
      columns: ['entry_id', 'name'],
      relations: [
        { entity: 'compound', catalog: 'chebi', foreignKey: 'chebiId', localKey: 'name', type: 'hasOne', alias: 'compound' }
      ]
    },
    {
      // Database statistics: where: { _pathSuffix: "compound" }
      name: '/info',
      columns: ['entry_id', 'name'],
      relations: []
    }
  ]
}
