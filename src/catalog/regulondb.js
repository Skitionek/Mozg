'use strict';

/**
 * RegulonDB – bacterial gene regulation database (E. coli K-12).
 * Reference: https://regulondb.ccg.unam.mx/
 * API docs:  https://regulondb.ccg.unam.mx/manual/webservices/webservices.jsp
 *
 * No credentials required for read access.
 * Returns JSON for most endpoints (pass format=JSON or Accept: application/json).
 *
 * RegulonDB contains regulatory networks of E. coli K-12: genes, operons,
 * promoters, transcription factors, transcription units, terminators, and
 * regulatory interactions.
 *
 * Key where parameters (most endpoints accept):
 *  - activeConformation: true|false
 *  - format: JSON
 *  - tool: name of your application (recommended)
 *
 * Example queries:
 *  All genes:        from "/genes"
 *  All operons:      from "/operons"
 *  All TFs:         from "/transcriptionfactors"
 *  Gene interactions: from "/geneinteraction"
 *
 * Relationship map:
 *  - /genes           →  /operons          (operon_id → operon_id, belongsTo operon)
 *  - /genes           →  /esummary.fcgi    (gene_id → id, hasMany NCBI gene records, catalog: ncbi)
 *  - /genes           →  /uniprotkb/search (gene_name → query, hasMany UniProt proteins, catalog: uniprot)
 *  - /operons         →  /promoters        (operon_id, hasMany promoters)
 *  - /transcriptionfactors  →  /tfbs      (tf_id → tf_id, hasMany binding sites)
 */
module.exports = {
  name: 'regulondb',
  label: 'RegulonDB (REST)',
  description: 'RegulonDB — E. coli K-12 transcription regulatory network database. Contains experimentally validated genes, operons, promoters, transcription factors, binding sites, regulatory interactions and sigmulon data. Pass format=JSON in where.',
  driver: 'rest',
  connection: {
    database: 'https://regulondb.ccg.unam.mx/webresources',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // List all genes: where: { format: "JSON" }
      name: '/genes',
      columns: ['gene_id', 'gene_name', 'gene_posleft', 'gene_posright', 'gene_strand', 'gene_sequence', 'operon_id', 'gene_note', 'external_db_id'],
      relations: [
        { entity: '/operons', foreignKey: 'operon_id', type: 'belongsTo', alias: 'operon' },
        { entity: '/esummary.fcgi', foreignKey: 'gene_id', type: 'hasMany', alias: 'ncbiGeneInfo', catalog: 'ncbi' },
        { entity: '/uniprotkb/search', foreignKey: 'gene_name', type: 'hasMany', alias: 'uniprotProteins', catalog: 'uniprot' },
      ],
    },
    {
      // List all operons: where: { format: "JSON" }
      name: '/operons',
      columns: ['operon_id', 'operon_name', 'operon_posleft', 'operon_posright', 'operon_strand', 'operon_effect', 'operon_evidence'],
      relations: [
        { entity: '/promoters', foreignKey: 'operon_id', type: 'hasMany', alias: 'promoters' },
        { entity: '/genes', foreignKey: 'operon_id', type: 'hasMany', alias: 'genes' },
      ],
    },
    {
      // List all promoters: where: { format: "JSON" }
      name: '/promoters',
      columns: ['promoter_id', 'promoter_name', 'promoter_strand', 'pos_1', 'sigma_factor', 'promoter_sequence', 'promoter_note', 'promoter_evidence'],
      relations: [],
    },
    {
      // List all transcription factors: where: { format: "JSON" }
      name: '/transcriptionfactors',
      columns: ['tf_id', 'tf_name', 'tf_type', 'tf_family', 'gene_id', 'gene_name', 'site_length', 'symmetry', 'tf_note'],
      relations: [
        { entity: '/tfbs', foreignKey: 'tf_id', type: 'hasMany', alias: 'bindingSites' },
        { entity: '/uniprotkb/search', foreignKey: 'tf_name', type: 'hasMany', alias: 'uniprotProteins', catalog: 'uniprot' },
      ],
    },
    {
      // Transcription factor binding sites: where: { format: "JSON" }
      name: '/tfbs',
      columns: ['tfbs_id', 'tf_id', 'tf_name', 'tfbs_posleft', 'tfbs_posright', 'tfbs_strand', 'tfbs_sequence', 'tfbs_effect', 'tfbs_evidence'],
      relations: [
        { entity: '/transcriptionfactors', foreignKey: 'tf_id', type: 'belongsTo', alias: 'transcriptionFactor' },
      ],
    },
    {
      // Gene–gene regulatory interactions: where: { format: "JSON" }
      name: '/geneinteraction',
      columns: ['regulator_gene_id', 'regulator_gene_name', 'regulated_gene_id', 'regulated_gene_name', 'effect', 'evidence', 'regulatory_mechanism'],
      relations: [
        { entity: '/genes', foreignKey: 'regulator_gene_id', type: 'belongsTo', alias: 'regulatorGene' },
        { entity: '/genes', foreignKey: 'regulated_gene_id', type: 'belongsTo', alias: 'regulatedGene' },
      ],
    },
    {
      // Network (graph) of regulatory interactions: where: { format: "JSON" }
      name: '/network',
      columns: ['node_id', 'node_name', 'node_type', 'edge_id', 'source_id', 'target_id', 'effect', 'evidence'],
      relations: [],
    },
  ],
};
