'use strict';

/**
 * ChEBI – Chemical Entities of Biological Interest.
 * Reference: https://www.ebi.ac.uk/chebi/
 * OLS4 API:  https://www.ebi.ac.uk/ols4/api/ontologies/chebi
 *
 * No credentials required. The OLS4 (Ontology Lookup Service) provides a
 * uniform JSON REST API for all EBI ontologies including ChEBI.
 *
 * Key where parameters:
 *  - /terms:         search, size, page
 *  - /terms/{id}:    exact term lookup by IRI or short form (e.g. CHEBI:15422)
 *  - /children:      parentRestriction (HIERARCHICAL|DIRECT), size, page
 *  - /descendants:   parentRestriction, size, page
 *
 * Example queries:
 *  Search compounds: from "/terms"  where: { search: "glucose", size: "10" }
 *  Fetch entry:      from "/terms"  where: { search: "CHEBI:17234" }
 *
 * Relationship map:
 *  - /terms  →  /terms/{id}  (iri → iri, belongsTo full record)
 *  - /terms  →  /uniprotkb/search  (label → query, hasMany proteins, catalog: uniprot)
 *  - /terms  →  /list/compound  (label → _pathSuffix, hasMany KEGG compounds, catalog: kegg)
 */
module.exports = {
  name: 'chebi',
  label: 'ChEBI (REST)',
  description: 'Chemical Entities of Biological Interest — ontology and database of molecular entities with roles in biology and chemistry. Accessed via the EMBL-EBI OLS4 Ontology Lookup Service. Use where.search to find compounds.',
  driver: 'rest',
  connection: {
    database: 'https://www.ebi.ac.uk/ols4/api/ontologies/chebi',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Search/list ChEBI terms: where: { search: "aspirin", size: "20", page: "0" }
      name: '/terms',
      columns: ['iri', 'label', 'description', 'short_form', 'obo_id', 'is_obsolete', 'term_replaced_by', 'annotation'],
      relations: [
        { entity: '/uniprotkb/search', foreignKey: 'label', type: 'hasMany', alias: 'proteins', catalog: 'uniprot' },
        { entity: '/find/compound', foreignKey: 'label', type: 'hasMany', alias: 'keggCompounds', catalog: 'kegg' },
      ],
    },
    {
      // Individual term record by IRI or short form
      name: '/terms/{id}',
      columns: ['iri', 'label', 'description', 'short_form', 'obo_id', 'synonyms', 'annotation', 'is_obsolete'],
      relations: [
        { entity: '/children', foreignKey: 'short_form', type: 'hasMany', alias: 'children' },
      ],
    },
    {
      // Direct children of a term: where: { short_form: "CHEBI:17234", parentRestriction: "DIRECT" }
      name: '/children',
      columns: ['iri', 'label', 'short_form', 'obo_id', 'is_obsolete'],
      relations: [],
    },
    {
      // All descendants: where: { short_form: "CHEBI:17234" }
      name: '/descendants',
      columns: ['iri', 'label', 'short_form', 'obo_id', 'is_obsolete'],
      relations: [],
    },
  ],
};
