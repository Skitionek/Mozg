'use strict';

/**
 * WormBase – C. elegans and related nematode biology database.
 * Reference: https://wormbase.org/
 * API docs:  https://wormbase.org/about/userguide/API_REST
 *
 * No credentials required. All data freely available.
 *
 * WormBase REST API returns JSON when format=json is passed as a where param
 * or when the Accept header is set to application/json.
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
 * Key where parameters:
 *  - content-type: application/json  (or pass in headers)
 *
 * Relationship map:
 *  - /rest/widget/gene/{id}/overview   →  /rest/widget/gene/{id}/phenotype   (gene ID, hasMany)
 *  - /rest/widget/gene/{id}/overview   →  /rest/widget/gene/{id}/expression  (gene ID, hasMany)
 */
module.exports = {
  name: 'wormbase',
  label: 'WormBase (REST)',
  description: 'WormBase biology database for Caenorhabditis elegans and related nematodes. Covers genes, variations, phenotypes, expression patterns and orthologues. IDs follow WBGene/WBVar/WBPhenotype prefixes.',
  driver: 'rest',
  connection: {
    database: 'https://wormbase.org',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Gene overview: /rest/widget/gene/WBGene00000001/overview
      name: '/rest/widget/gene',
      columns: ['name', 'common_name', 'object', 'locus_name', 'gene_class', 'taxonomy', 'description', 'concise_description', 'status'],
      relations: [
        { entity: '/rest/widget/gene/phenotype', foreignKey: 'name', type: 'hasMany', alias: 'phenotypes' },
        { entity: '/rest/widget/gene/expression', foreignKey: 'name', type: 'hasMany', alias: 'expression' },
        { entity: '/api/v1.0/chado/gene', foreignKey: 'name', type: 'hasMany', alias: 'flybaseOrthologs', catalog: 'flybase' },
        { entity: '/gene', foreignKey: 'name', type: 'hasMany', alias: 'zfinOrthologs', catalog: 'zfin' },
      ],
    },
    {
      // Gene phenotype data: /rest/widget/gene/WBGene00000001/phenotype
      name: '/rest/widget/gene/phenotype',
      columns: ['phenotype', 'phenotype_id', 'evidence', 'allele', 'rnai', 'transgene', 'references'],
      relations: [],
    },
    {
      // Gene expression data: /rest/widget/gene/WBGene00000001/expression
      name: '/rest/widget/gene/expression',
      columns: ['anatomy_terms', 'life_stage', 'expression_pattern', 'subcellular_localization', 'references'],
      relations: [],
    },
    {
      // Variation overview: /rest/widget/variation/WBVar00000001/overview
      name: '/rest/widget/variation',
      columns: ['name', 'object', 'allele_type', 'gene', 'location', 'molecular_change', 'amino_acid_change', 'phenotypes'],
      relations: [],
    },
  ],
};
