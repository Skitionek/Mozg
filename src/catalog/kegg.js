'use strict';

/**
 * KEGG – Kyoto Encyclopedia of Genes and Genomes.
 * Reference: https://www.kegg.jp/
 * API docs:  https://www.kegg.jp/kegg/rest/keggapi.html
 *
 * No credentials required for academic use (non-commercial).
 * Rate limit: 3 req/sec recommended.
 *
 * ⚠️  KEGG REST API returns text/plain (tab-separated or flat-file format),
 * NOT JSON. The REST driver expects JSON responses, so full integration
 * requires a pre-processing layer. The entities below document the endpoints
 * and the fields present in the text responses.
 *
 * Key operations:
 *  - /list/{database}         – list all entries in a database
 *    databases: pathway, brite, module, ko, genome, hsa, eco, … (organism codes)
 *  - /find/{database}/{query} – keyword search
 *  - /get/{entry}             – fetch entry (flat-file or KGML for pathway maps)
 *  - /link/{target}/{source}  – find cross-links between databases
 *
 * Example: /list/pathway  → lists all reference pathways
 *          /find/compound/glucose → searches compound database
 *          /link/pathway/hsa:7157 → find pathways for TP53
 *
 * Relationship map:
 *  - /list/pathway  →  /get/{entry}   (pathway entry id → full record)
 *  - /list/compound →  /link/pathway  (compound→pathway cross-link)
 */
module.exports = {
  name: 'kegg',
  label: 'KEGG (REST)',
  description: 'Kyoto Encyclopedia of Genes and Genomes — biological systems database with pathway maps, BRITE hierarchies, modules and cross-organism gene/compound data. Note: API returns text/plain; JSON conversion may be needed.',
  driver: 'rest',
  connection: {
    database: 'https://rest.kegg.jp',
  },
  entities: [
    {
      // Returns tab-delimited list: "hsa:7157\tTP53, TRP53"
      name: '/list/pathway',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      name: '/list/compound',
      columns: ['entry_id', 'name'],
      relations: [],
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
      // Use where: { } – path: /find/compound/{query}
      name: '/find/compound',
      columns: ['entry_id', 'name'],
      relations: [],
    },
    {
      name: '/find/reaction',
      columns: ['entry_id', 'name'],
      relations: [],
    },
  ],
};
