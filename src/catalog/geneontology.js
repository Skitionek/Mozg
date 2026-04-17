'use strict';

/**
 * Gene Ontology (GO) – controlled vocabulary for gene product attributes.
 * Reference: https://geneontology.org/
 * API docs:  https://api.geneontology.org/api/
 *
 * No credentials required. The GOC API provides JSON REST endpoints for
 * GO terms (biological_process, molecular_function, cellular_component)
 * and gene/protein annotations.
 *
 * Key where parameters:
 *  - /search/entity: q (required), category, start, rows, highlight_class
 *  - /ontology/term/{id}: GO identifier (e.g. GO:0008150)
 *  - /ontology/term/{id}/children: GO identifier
 *  - /bioentity/function/{id}: GO identifier, rows, start, evidence
 *  - /bioentity/gene/{id}/function: CURIE (e.g. UniProtKB:P04637)
 *
 * Example queries:
 *  Search GO terms: from "/search/entity" where: { q: "apoptosis", category: "ontology_class", rows: "10" }
 *  Fetch GO term:   from "/ontology/term/GO:0006915"
 *  Genes for term:  from "/bioentity/function/GO:0006915" where: { rows: "25" }
 *
 * Relationship map:
 *  - /search/entity  →  /ontology/term/{id}  (id → id, belongsTo full record)
 *  - /ontology/term/{id}  →  /ontology/term/{id}/children  (id, hasMany children)
 *  - /search/entity  →  /esummary.fcgi  (id → id, hasMany NCBI records, catalog: ncbi)
 *  - /ontology/term/{id}  →  /terms  (label → search, hasMany ChEBI compounds, catalog: chebi)
 */
module.exports = {
  name: 'geneontology',
  label: 'Gene Ontology (REST)',
  description: 'Gene Ontology Consortium controlled vocabulary for biological processes, molecular functions and cellular components. Use where.q to search terms. Use GO:XXXXXXX identifiers for term lookups and gene annotation queries.',
  driver: 'rest',
  connection: {
    database: 'https://api.geneontology.org/api',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Full-text search: where: { q: "apoptosis", category: "ontology_class", rows: "10" }
      // category options: ontology_class, bioentity, annotation, general
      name: '/search/entity',
      columns: ['id', 'label', 'category', 'definition', 'synonym', 'taxon', 'highlight'],
      relations: [
        { entity: '/ontology/term', foreignKey: 'id', type: 'belongsTo', alias: 'term' },
      ],
    },
    {
      // Fetch a specific GO term: from "/ontology/term" where: { _pathSuffix: "GO:0006915" }
      name: '/ontology/term',
      columns: ['id', 'label', 'definition', 'synonyms', 'namespace', 'is_obsolete', 'replaced_by', 'consider', 'alt_id', 'xrefs', 'subsets'],
      relations: [
        { entity: '/ontology/term/children', foreignKey: 'id', type: 'hasMany', alias: 'children' },
        { entity: '/bioentity/function', foreignKey: 'id', type: 'hasMany', alias: 'annotatedGenes' },
        { entity: '/terms', foreignKey: 'label', type: 'hasMany', alias: 'chebiCompounds', catalog: 'chebi' },
      ],
    },
    {
      // Children of a GO term: from "/ontology/term/children" where: { _pathSuffix: "GO:0006915" }
      name: '/ontology/term/children',
      columns: ['id', 'label', 'definition', 'synonyms', 'namespace'],
      relations: [],
    },
    {
      // Genes/proteins annotated with a GO term: from "/bioentity/function" where: { _pathSuffix: "GO:0006915", rows: "25" }
      name: '/bioentity/function',
      columns: ['id', 'label', 'taxon', 'taxon_label', 'qualifier', 'evidence', 'reference', 'assigned_by'],
      relations: [
        { entity: '/uniprotkb/search', foreignKey: 'id', type: 'hasMany', alias: 'uniprotEntries', catalog: 'uniprot' },
      ],
    },
    {
      // GO annotations for a specific gene: from "/bioentity/gene/function" where: { _pathSuffix: "UniProtKB:P04637" }
      name: '/bioentity/gene/function',
      columns: ['id', 'label', 'qualifier', 'evidence', 'reference', 'term', 'term_label', 'assigned_by'],
      relations: [
        { entity: '/ontology/term', foreignKey: 'term', type: 'belongsTo', alias: 'goTerm' },
      ],
    },
  ],
};
