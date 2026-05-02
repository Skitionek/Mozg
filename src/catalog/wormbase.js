"use strict";

/**
 * WormBase – C. elegans and related nematode biology database.
 * Reference: https://wormbase.org/
 * API docs:  https://wormbase.org/about/userguide/API_REST
 *
 * No credentials required. All data freely available.
 *
 * WormBase serves its machine-friendly REST API from https://rest.wormbase.org.
 * The main https://wormbase.org host is Cloudflare-protected and responds with
 * 403 to server-side fetches, so catalog queries must use the REST host below.
 *
 * WormBase ID format: WBGene00000001 (gene), WBVar00000001 (variation),
 *  WBPhenotype0000001 (phenotype)
 *
 * Key endpoints (object REST API):
 *  - /rest/widget/gene/{id}/overview       – gene overview
 *  - /rest/widget/gene/{id}/expression     – expression data
 *  - /rest/widget/gene/{id}/phenotype      – phenotype data
 *  - /rest/widget/gene/{id}/homology       – ortholog/paralog data
 *  - /rest/widget/variation/{id}/overview  – variation overview
 *
 * These are object endpoints, so direct queries should pass a stable ID via
 * `where: { id: "WBGene00006763" }` (or a WBVar... variation ID).
 *
 * Relationship map:
 *  - /rest/widget/gene/{id}/overview   →  /rest/widget/gene/{id}/phenotype   (gene ID, hasMany)
 *  - /rest/widget/gene/{id}/overview   →  /rest/widget/gene/{id}/expression  (gene ID, hasMany)
 */
module.exports = {
  name: "wormbase",
  label: "WormBase (REST)",
  description:
    "WormBase biology database for Caenorhabditis elegans and related nematodes. Covers genes, variations, phenotypes, expression patterns and orthologues. IDs follow WBGene/WBVar/WBPhenotype prefixes.",
  driver: "rest",
  connection: {
    database: "https://rest.wormbase.org",
    headers: {
      Accept: "application/json",
    },
  },
  entities: [
    {
      // Gene overview: /rest/widget/gene/WBGene00006763/overview
      // Use where: { id: 'WBGene00006763' }
      name: "/rest/widget/gene/{id}/overview",
      columns: ["name", "class", "uri", "fields"],
      relations: [
        {
          entity: "/rest/widget/gene/{id}/phenotype",
          foreignKey: "name",
          type: "hasMany",
          alias: "phenotypes",
        },
        {
          entity: "/rest/widget/gene/{id}/expression",
          foreignKey: "name",
          type: "hasMany",
          alias: "expression",
        },
        {
          entity: "/api/v1.0/chado/gene",
          foreignKey: "name",
          type: "hasMany",
          alias: "flybaseOrthologs",
          catalog: "flybase",
        },
        {
          entity: "/gene",
          foreignKey: "name",
          type: "hasMany",
          alias: "zfinOrthologs",
          catalog: "zfin",
        },
      ],
    },
    {
      // Gene phenotype data: /rest/widget/gene/WBGene00006763/phenotype
      // Use where: { id: 'WBGene00006763' }
      name: "/rest/widget/gene/{id}/phenotype",
      columns: ["name", "class", "uri", "fields"],
      relations: [],
    },
    {
      // Gene expression data: /rest/widget/gene/WBGene00006763/expression
      // Use where: { id: 'WBGene00006763' }
      name: "/rest/widget/gene/{id}/expression",
      columns: ["name", "class", "uri", "fields"],
      relations: [],
    },
    {
      // Variation overview: /rest/widget/variation/WBVar00000001/overview
      // Use where: { id: 'WBVar00000001' }
      name: "/rest/widget/variation/{id}/overview",
      columns: ["name", "class", "uri", "fields"],
      relations: [],
    },
  ],
};
