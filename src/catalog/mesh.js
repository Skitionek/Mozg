'use strict';

/**
 * MeSH – Medical Subject Headings controlled vocabulary.
 * Reference: https://www.nlm.nih.gov/mesh/
 * API docs:  https://id.nlm.nih.gov/mesh/
 *
 * No credentials required. NLM provides a Linked Data API returning JSON-LD
 * for MeSH descriptors, qualifiers, supplementary concept records and tree
 * numbers. A lookup endpoint offers plain JSON label search.
 *
 * Key where parameters:
 *  - /lookup/descriptor: label, match (contains|exact|startswith|word), limit, year, callback=false
 *  - /lookup/supplementary: label, match, rdftype (scr_chemical|scr_disease|scr_organism|scr_protocol), limit
 *  - /lookup/combine: descriptor, qualifier, limit
 *
 * Example queries:
 *  Search descriptors: from "/lookup/descriptor" where: { label: "Glucose", match: "contains", limit: "10", callback: "false" }
 *  Search chemicals:   from "/lookup/supplementary" where: { label: "aspirin", rdftype: "scr_chemical", match: "contains", limit: "10" }
 *  Search diseases:    from "/lookup/supplementary" where: { label: "cancer", rdftype: "scr_disease", match: "contains", limit: "10" }
 *
 * Relationship map:
 *  - /lookup/descriptor   →  /esearch.fcgi  (ui → term, hasMany PubMed articles, catalog: ncbi)
 *  - /lookup/supplementary  →  /terms  (name → search, hasMany ChEBI compounds, catalog: chebi)
 *  - /lookup/descriptor   →  /uniprotkb/search  (name → query, hasMany UniProt proteins, catalog: uniprot)
 */
module.exports = {
  name: 'mesh',
  label: 'MeSH (REST)',
  description: 'Medical Subject Headings — NLM controlled vocabulary for indexing articles in MEDLINE/PubMed. Includes topical descriptors, supplementary concept records (chemicals, diseases, organisms) and hierarchical tree numbers. Use where.label to search.',
  driver: 'rest',
  connection: {
    database: 'https://id.nlm.nih.gov/mesh',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Search MeSH topical descriptors: where: { label: "Glucose", match: "contains", limit: "10", callback: "false" }
      // match options: contains, exact, startswith, word
      name: '/lookup/descriptor',
      columns: ['ui', 'name', 'note'],
      relations: [
        { entity: '/esearch.fcgi', foreignKey: 'ui', type: 'hasMany', alias: 'pubmedArticles', catalog: 'ncbi' },
        { entity: '/uniprotkb/search', foreignKey: 'name', type: 'hasMany', alias: 'uniprotProteins', catalog: 'uniprot' },
      ],
    },
    {
      // Search supplementary concept records: where: { label: "aspirin", rdftype: "scr_chemical", match: "contains", limit: "10" }
      // rdftype options: scr_chemical, scr_disease, scr_organism, scr_protocol
      name: '/lookup/supplementary',
      columns: ['ui', 'name', 'note', 'rdfType'],
      relations: [
        { entity: '/terms', foreignKey: 'name', type: 'hasMany', alias: 'chebiCompounds', catalog: 'chebi' },
        { entity: '/lookup/descriptor', foreignKey: 'name', type: 'belongsTo', alias: 'mappedDescriptor' },
      ],
    },
    {
      // Qualify descriptor by subheading: where: { descriptor: "D001249", qualifier: "Q000494", limit: "10" }
      name: '/lookup/combine',
      columns: ['ui', 'name'],
      relations: [],
    },
  ],
};
