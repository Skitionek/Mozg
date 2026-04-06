'use strict';

/**
 * ZFIN – Zebrafish Information Network.
 * Reference: https://zfin.org/
 * API docs:  https://zfin.org/action/api
 *
 * No credentials required. All data freely available under CC BY 4.0.
 *
 * ZFIN ID format: ZDB-GENE-000112-37 (gene), ZDB-ALT-000009-1 (allele),
 *  ZDB-ANAT-010921-100 (anatomy), ZDB-EXP-041102-1 (experiment)
 *
 * Key endpoints:
 *  - /marker/search?name={name}           – search gene/marker by name
 *  - /gene/{zdbId}                        – gene detail by ZFIN ID
 *  - /gene/{zdbId}/expression             – expression data
 *  - /gene/{zdbId}/phenotype              – phenotype data
 *  - /gene/{zdbId}/diseases               – human disease models
 *  - /gene/{zdbId}/orthologs              – orthologues
 *  - /anatomy/{zdbId}                     – anatomy term detail
 *
 * Relationship map:
 *  - /gene/{id}             →  /gene/{id}/expression  (ZFIN gene ID, hasMany)
 *  - /gene/{id}             →  /gene/{id}/phenotype   (ZFIN gene ID, hasMany)
 *  - /gene/{id}             →  /gene/{id}/orthologs   (ZFIN gene ID, hasMany)
 */
module.exports = {
  name: 'zfin',
  label: 'ZFIN – Zebrafish Information Network (REST)',
  description: 'Zebrafish Information Network — curated zebrafish (Danio rerio) genetic and genomic data including genes, alleles, expression patterns, phenotypes, anatomy and human disease models. IDs follow ZDB-GENE/ZDB-ALT/ZDB-ANAT prefixes.',
  driver: 'rest',
  connection: {
    database: 'https://zfin.org/action/api',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Search: /marker/search?name=tp53
      name: '/marker/search',
      columns: ['zdbId', 'abbreviation', 'name', 'markerType', 'organism', 'chromosome', 'startPosition', 'endPosition'],
      relations: [
        { entity: '/gene', foreignKey: 'zdbId', type: 'belongsTo', alias: 'geneDetail' },
      ],
    },
    {
      // Gene detail: /gene/ZDB-GENE-000112-37
      name: '/gene',
      columns: ['zdbId', 'symbol', 'name', 'markerType', 'chromosome', 'genomeAssembly', 'ncbiGene', 'uniprotId', 'function', 'references'],
      relations: [
        { entity: '/gene/expression', foreignKey: 'zdbId', type: 'hasMany', alias: 'expression' },
        { entity: '/gene/phenotype', foreignKey: 'zdbId', type: 'hasMany', alias: 'phenotype' },
        { entity: '/gene/orthologs', foreignKey: 'zdbId', type: 'hasMany', alias: 'orthologs' },
      ],
    },
    {
      // Expression: /gene/ZDB-GENE-000112-37/expression
      name: '/gene/expression',
      columns: ['gene', 'start', 'end', 'anatomyTerms', 'expressionPattern', 'assay', 'publication'],
      relations: [],
    },
    {
      // Phenotype: /gene/ZDB-GENE-000112-37/phenotype
      name: '/gene/phenotype',
      columns: ['gene', 'allele', 'zygosity', 'anatomyTerms', 'qualityTerms', 'phenotypeStatement', 'publication'],
      relations: [],
    },
    {
      // Orthologues: /gene/ZDB-GENE-000112-37/orthologs
      name: '/gene/orthologs',
      columns: ['zebrafishGeneId', 'zebrafishGeneSymbol', 'orthologGeneId', 'orthologSymbol', 'orthologOrg', 'supportedBy'],
      relations: [
        { entity: '/api/v1.0/chado/gene', foreignKey: 'zdbId', type: 'hasMany', alias: 'flybaseOrthologs', catalog: 'flybase' },
        { entity: '/rest/widget/gene', foreignKey: 'zdbId', type: 'hasMany', alias: 'wormbaseOrthologs', catalog: 'wormbase' },
      ],
    },
    {
      // Anatomy terms: /anatomy/ZDB-ANAT-010921-100
      name: '/anatomy',
      columns: ['zdbId', 'name', 'abbreviation', 'start', 'end', 'parent', 'children', 'aliases'],
      relations: [],
    },
  ],
};
