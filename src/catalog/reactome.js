'use strict';

/**
 * Reactome – open-source biological pathway knowledgebase.
 * Reference: https://reactome.org/
 * API docs:  https://reactome.org/ContentService/
 *
 * No credentials required. All data freely available under CC BY 4.0.
 *
 * Key endpoints:
 *  - /data/diseases            – list all disease annotations
 *  - /data/pathways/top/{species} – top-level pathways for a species
 *  - /data/query/{stableId}    – any Reactome entity by stable ID
 *  - /data/pathway/{pathwayId}/containedEvents – sub-events of a pathway
 *  - /data/participants/{pathwayId}/referenceEntities – physical entities
 *  - /data/entity/{id}/otherForms – post-translational modifications
 *  - /search/query             – free-text search
 *
 * Species examples: 'Homo sapiens', '9606', 'Mus musculus'
 * Stable ID format: R-HSA-123456 (human), R-MMU-123456 (mouse)
 *
 * Relationship map:
 *  - /data/pathways/top/{species} → /data/pathway/{id}/containedEvents (hasMany)
 *  - /data/pathway/{id}/containedEvents → /data/participants/{id}/referenceEntities (hasMany)
 */
module.exports = {
  name: 'reactome',
  label: 'Reactome (REST)',
  description: 'Open-source, manually curated biological pathway knowledgebase covering metabolism, signal transduction, gene expression and disease for Homo sapiens and 9 other species. Stable IDs follow the format R-HSA-NNNNNN.',
  driver: 'rest',
  connection: {
    database: 'https://reactome.org/ContentService',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      name: '/data/diseases',
      columns: ['stableId', 'displayName', 'className', 'identifier', 'url', 'name'],
      relations: [],
    },
    {
      // Use path segment for species: /data/pathways/top/Homo sapiens
      name: '/data/pathways/top/Homo sapiens',
      columns: ['stableId', 'displayName', 'speciesName', 'isInferred', 'isInDisease', 'className', 'schemaClass'],
      relations: [
        { entity: '/data/pathway', foreignKey: 'stableId', type: 'hasMany', alias: 'containedEvents' },
      ],
    },
    {
      // Fetch any Reactome entity: /data/query/R-HSA-1640170
      name: '/data/query',
      columns: ['stableId', 'displayName', 'className', 'schemaClass', 'speciesName', 'isInferred', 'isInDisease', 'summation', 'literatureReference'],
      relations: [],
    },
    {
      name: '/search/query',
      columns: ['found', 'results', 'facets', 'suggester', 'spellcheck'],
      relations: [],
    },
    {
      // Use where: { } and path: /data/species/all
      name: '/data/species/all',
      columns: ['stableId', 'displayName', 'taxId', 'abbreviation'],
      relations: [],
    },
  ],
};
