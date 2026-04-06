'use strict';

/**
 * FlyBase – Drosophila genetics and genomics database.
 * Reference: https://flybase.org/
 * API docs:  https://api.flybase.org/docs
 *
 * No credentials required. All data freely available under CC BY 4.0.
 *
 * FlyBase ID format: FBgn0000490 (gene), FBal0000001 (allele),
 *  FBtp0000001 (transgenic construct), FBsn0000001 (stock)
 *
 * Key endpoints:
 *  - /api/v1.0/chado/gene?gene_id={id}       – gene detail record
 *  - /api/v1.0/chado/allele?allele_id={id}   – allele record
 *  - /api/v1.0/gene/summaries?ids={id}       – concise gene summaries
 *  - /api/v1.0/gene/ontology?gene_id={id}    – GO terms for gene
 *  - /api/v1.0/gene/orthologs?gene_id={id}   – orthologues
 *  - /api/v1.0/sequence/{id}                 – sequence data
 *
 * Relationship map:
 *  - /api/v1.0/chado/gene  →  /api/v1.0/chado/allele   (FBgn ID, hasMany alleles)
 *  - /api/v1.0/chado/gene  →  /api/v1.0/gene/ontology  (gene_id, hasMany GO terms)
 */
module.exports = {
  name: 'flybase',
  label: 'FlyBase (REST)',
  description: 'FlyBase Drosophila genetics and genomics database. Covers genes, alleles, transgenic constructs, stocks, phenotypes and orthologues for Drosophila melanogaster and related species. IDs follow FBgn/FBal prefixes.',
  driver: 'rest',
  connection: {
    database: 'https://api.flybase.org',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Gene detail: /api/v1.0/chado/gene?gene_id=FBgn0000490
      name: '/api/v1.0/chado/gene',
      columns: ['gene_id', 'gene_symbol', 'gene_fullname', 'gene_synonyms', 'organism', 'chromosome', 'location', 'annotation_id', 'feature_type', 'description'],
      relations: [
        { entity: '/api/v1.0/chado/allele', foreignKey: 'gene_id', type: 'hasMany', alias: 'alleles' },
        { entity: '/api/v1.0/gene/ontology', foreignKey: 'gene_id', type: 'hasMany', alias: 'goTerms' },
      ],
    },
    {
      // Allele detail: /api/v1.0/chado/allele?allele_id=FBal0000001
      name: '/api/v1.0/chado/allele',
      columns: ['allele_id', 'allele_symbol', 'gene_id', 'gene_symbol', 'allele_class', 'phenotypes', 'insertions', 'associated_transgenic_products'],
      relations: [],
    },
    {
      // Gene summaries: /api/v1.0/gene/summaries?ids=FBgn0000490
      name: '/api/v1.0/gene/summaries',
      columns: ['id', 'symbol', 'name', 'summary', 'gene_type', 'organism'],
      relations: [],
    },
    {
      // GO terms: /api/v1.0/gene/ontology?gene_id=FBgn0000490
      name: '/api/v1.0/gene/ontology',
      columns: ['gene_id', 'go_id', 'go_term', 'go_aspect', 'evidence_code', 'references'],
      relations: [],
    },
    {
      // Orthologues: /api/v1.0/gene/orthologs?gene_id=FBgn0000490
      name: '/api/v1.0/gene/orthologs',
      columns: ['gene_id', 'gene_symbol', 'ortholog_id', 'ortholog_symbol', 'ortholog_organism', 'ortholog_source', 'diopt_score'],
      relations: [
        { entity: '/rest/widget/gene', foreignKey: 'gene_id', type: 'hasMany', alias: 'wormbaseOrthologs', catalog: 'wormbase' },
        { entity: '/gene', foreignKey: 'gene_id', type: 'hasMany', alias: 'zfinOrthologs', catalog: 'zfin' },
      ],
    },
  ],
};
