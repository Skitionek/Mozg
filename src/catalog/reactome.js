'use strict'

const { stripTags } = require('../database/text')

/**
 * Reactome — open, manually curated knowledgebase of biological pathways and
 * reactions (data CC0 1.0; illustrations CC BY 4.0).
 * API docs: https://reactome.org/ContentService/
 *
 * Stable ids look like R-HSA-69620 (human), R-MMU-… (mouse).  Pathway
 * participants are reported as reference entities, so a pathway leads on to
 * the UniProt proteins and ChEBI small molecules it involves.
 */

// Fields shared by every entity that returns Reactome events (pathways and reactions).
const EVENT_FIELDS = {
  reactomeId: 'stId',
  name: 'displayName',
  type: 'schemaClass',
  species: 'speciesName|species[0].displayName',
  isInDisease: 'isInDisease',
  isInferred: 'isInferred',
  hasDiagram: 'hasDiagram',
  doi: 'doi',
  releaseDate: 'releaseDate'
}

const EVENT_RELATIONS = [
  { alias: 'pathway', description: 'The full record of this event: summary, GO process, literature', entity: 'pathway', obo: 'reactome', type: 'hasOne' },
  { alias: 'events', description: 'Sub-pathways and reactions contained in this event, at every depth', entity: 'events', obo: 'reactome', type: 'hasMany' },
  { alias: 'participants', description: 'Proteins, genes and small molecules taking part in this event', entity: 'participants', obo: 'reactome', type: 'hasMany' }
]

module.exports = {
  name: 'reactome',
  label: 'Reactome',
  description: 'Open-source, manually curated pathway knowledgebase covering metabolism, signalling, gene expression and disease for human and 15+ model organisms. Stable ids look like R-HSA-69620.',
  category: 'Interactions & pathways',
  homepage: 'https://reactome.org',
  docs: 'https://reactome.org/ContentService/',
  license: 'CC0 1.0',
  driver: 'api',
  connection: {
    database: 'https://reactome.org/ContentService',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'pathwaysForProtein',
      description: 'Lowest-level Reactome pathways a UniProt protein takes part in',
      path: '/data/mapping/UniProt/{uniprotAccession}/pathways',
      params: {
        uniprotAccession: { description: 'UniProtKB accession, e.g. P04637' },
        species: { description: 'Restrict to a species: taxon id (9606) or name (Homo sapiens)' }
      },
      fields: EVENT_FIELDS,
      example: { uniprotAccession: 'P04637' },
      relations: EVENT_RELATIONS
    },
    {
      name: 'pathway',
      description: 'One Reactome pathway or reaction by stable id, with its summary, GO process and literature',
      path: '/data/query/{reactomeId}',
      params: {
        reactomeId: { description: 'Reactome stable id, e.g. R-HSA-69620' }
      },
      fields: {
        ...EVENT_FIELDS,
        summary: (r) => stripTags(r.summation && r.summation[0] && r.summation[0].text),
        goId: (r) => (r.goBiologicalProcess && r.goBiologicalProcess.accession ? `GO:${r.goBiologicalProcess.accession}` : null),
        goName: 'goBiologicalProcess.name',
        pmids: (r) => (r.literatureReference || []).map((ref) => ref.pubMedIdentifier).filter((id) => id != null).map(String),
        subEventIds: 'hasEvent[].stId',
        parentIds: (r) => (r.eventOf || []).map((e) => (typeof e === 'object' ? e.stId : null)).filter(Boolean),
        reviewStatus: 'reviewStatus.displayName',
        lastUpdated: 'lastUpdatedDate'
      },
      example: { reactomeId: 'R-HSA-69620' },
      relations: [
        { alias: 'events', description: 'Sub-pathways and reactions contained in this pathway, at every depth', entity: 'events', obo: 'reactome', type: 'hasMany' },
        { alias: 'participants', description: 'Proteins, genes and small molecules taking part in this pathway', entity: 'participants', obo: 'reactome', type: 'hasMany' },
        { alias: 'goTerm', description: 'The GO biological process this pathway corresponds to (QuickGO)', catalog: 'quickgo', entity: 'term', obo: 'go', type: 'hasOne' }
      ]
    },
    {
      name: 'events',
      description: 'Every sub-pathway and reaction contained in a pathway, flattened across all depths',
      path: '/data/pathway/{reactomeId}/containedEvents',
      params: {
        reactomeId: { description: 'Reactome stable id of the containing pathway, e.g. R-HSA-69620' },
        type: { in: 'filter', field: 'type', description: 'Keep only one event class: Pathway, Reaction, BlackBoxEvent, Polymerisation, Depolymerisation' }
      },
      fields: EVENT_FIELDS,
      example: { reactomeId: 'R-HSA-69620' },
      relations: [
        { alias: 'participants', description: 'Proteins, genes and small molecules taking part in this event', entity: 'participants', obo: 'reactome', type: 'hasMany' }
      ]
    },
    {
      name: 'participants',
      description: 'Reference entities (UniProt proteins, ChEBI molecules, Ensembl genes, …) taking part in a pathway or reaction',
      path: '/data/participants/{reactomeId}/referenceEntities',
      params: {
        reactomeId: { description: 'Reactome stable id of a pathway or reaction, e.g. R-HSA-69620' },
        database: { in: 'filter', field: 'database', description: 'Keep only one reference database: UniProt, ChEBI, ENSEMBL, …' }
      },
      fields: {
        database: 'databaseName',
        identifier: 'identifier',
        name: 'name[0]|displayName',
        type: 'schemaClass',
        moleculeType: 'moleculeType',
        geneNames: 'geneName',
        formula: 'formula',
        uniprotAccession: (r) => (r.databaseName === 'UniProt' ? String(r.identifier).replace(/-\d+$/, '') : null),
        chebiId: (r) => (r.databaseName === 'ChEBI' ? `CHEBI:${r.identifier}` : null),
        ensemblId: (r) => (r.databaseName === 'ENSEMBL' ? r.identifier : null)
      },
      example: { reactomeId: 'R-HSA-69620' },
      relations: [
        { alias: 'protein', description: 'The UniProt entry, for protein participants', catalog: 'uniprot', entity: 'protein', obo: 'uniprot', type: 'hasOne' },
        { alias: 'compound', description: 'The ChEBI entry, for small-molecule participants', catalog: 'chebi', entity: 'compound', obo: 'chebi', type: 'hasOne' }
      ]
    },
    {
      name: 'topPathways',
      description: 'Top-level pathways (Reactome\'s main categories) of one species',
      path: '/data/pathways/top/{species}',
      params: {
        species: { default: 'Homo sapiens', description: 'Species name or taxon id, e.g. Homo sapiens or 9606' }
      },
      fields: EVENT_FIELDS,
      example: { species: 'Homo sapiens' },
      relations: EVENT_RELATIONS
    },
    {
      name: 'search',
      description: 'Free-text search over Reactome pathways, reactions and entities',
      path: '/search/query',
      params: {
        query: { required: true, description: 'Search text, e.g. apoptosis' },
        species: { description: 'Species name, e.g. Homo sapiens' },
        types: { description: 'Restrict to result types: Pathway, Reaction, Protein, Complex, …' }
      },
      query: { cluster: 'true' },
      rows: 'results[].entries[]',
      fields: {
        reactomeId: 'stId',
        name: (r) => stripTags(r.name),
        type: 'exactType',
        species: 'species[0]',
        isInDisease: 'isDisease',
        summary: (r) => stripTags(r.summation)
      },
      paginate: { limit: 'rows', offset: 'start', max: 100 },
      emptyStatus: [404],
      example: { query: 'apoptosis', species: 'Homo sapiens', types: 'Pathway' },
      relations: [
        { alias: 'pathway', description: 'The full record of this event', entity: 'pathway', obo: 'reactome', type: 'hasOne' }
      ]
    }
  ]
}
