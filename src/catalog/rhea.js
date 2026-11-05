'use strict'

/**
 * Rhea — expert-curated knowledgebase of biochemical and transport reactions,
 * described with ChEBI compounds and linked to UniProt enzymes (CC BY 4.0).
 * API docs: https://www.rhea-db.org/help/rest-api
 *
 * The search endpoint returns TSV with the columns asked for; every entity
 * here asks for the same set, so rows always carry the same fields.  Query
 * syntax: uniprot:P00533, CHEBI:15422, RHEA:10596, ec:2.7.10.1 or free text.
 */

const COLUMNS = 'rhea-id,equation,chebi-id,chebi,ec,uniprot,pubmed,go'

const list = (value) => (value == null || value === '' ? [] : String(value).split(';').map((s) => s.trim()).filter(Boolean))

const REACTION_FIELDS = {
  rheaId: 'Reaction identifier',
  equation: 'Equation',
  chebiIds: (r) => list(r['ChEBI identifier']),
  participants: (r) => list(r['ChEBI name']),
  ecNumbers: (r) => list(r['EC number']).map((ec) => ec.replace(/^EC:/, '')),
  enzymeCount: (r) => (r.Enzymes ? Number(r.Enzymes) : 0),
  pmids: (r) => list(r.PubMed),
  goIds: (r) => list(r['Gene Ontology']).map((go) => go.split(' ')[0]).filter((go) => go.startsWith('GO:'))
}

const REACTION_RELATIONS = [
  { alias: 'participants', description: 'ChEBI compounds taking part in the reaction', entity: 'participants', localKey: 'rheaId', foreignKey: 'rheaId', type: 'hasMany' }
]

const searchEntity = (overrides) => ({
  format: 'tsv',
  fields: REACTION_FIELDS,
  paginate: { limit: 'limit', offset: 'offset', max: 1000 },
  relations: REACTION_RELATIONS,
  ...overrides
})

// Rhea accepts "RHEA:10596" and "10596"; normalise so the query is always the prefixed form.
const rheaQuery = (id) => (/^rhea:/i.test(String(id)) ? `RHEA:${String(id).slice(5)}` : `RHEA:${id}`)

module.exports = {
  name: 'rhea',
  label: 'Rhea',
  description: 'Expert-curated knowledgebase of biochemical and transport reactions, each described with ChEBI compounds, EC numbers and the UniProt enzymes that catalyse it. Ids look like RHEA:10596.',
  category: 'Interactions & pathways',
  homepage: 'https://www.rhea-db.org',
  docs: 'https://www.rhea-db.org/help/rest-api',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://www.rhea-db.org',
    headers: { Accept: 'text/tab-separated-values, text/plain' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  entities: [
    searchEntity({
      name: 'reactions',
      description: 'Reactions catalysed by a UniProt enzyme',
      path: '/rhea',
      params: {
        uniprotAccession: { required: true, description: 'UniProtKB accession of the enzyme, e.g. P00533' }
      },
      query: (params) => ({ query: `uniprot:${params.uniprotAccession}`, format: 'tsv', columns: COLUMNS }),
      example: { uniprotAccession: 'P00533' }
    }),
    searchEntity({
      name: 'reaction',
      description: 'One Rhea reaction by id',
      path: '/rhea',
      params: {
        rheaId: { required: true, description: 'Rhea id, e.g. RHEA:10596 (or 10596)' }
      },
      query: (params) => ({ query: rheaQuery(params.rheaId), format: 'tsv', columns: COLUMNS }),
      example: { rheaId: 'RHEA:10596' }
    }),
    searchEntity({
      name: 'reactionsForCompound',
      description: 'Reactions in which a ChEBI compound takes part',
      path: '/rhea',
      params: {
        chebiId: { required: true, description: 'ChEBI id, e.g. CHEBI:15422 (ATP)' }
      },
      query: (params) => ({ query: `CHEBI:${String(params.chebiId).replace(/^chebi:/i, '')}`, format: 'tsv', columns: COLUMNS }),
      example: { chebiId: 'CHEBI:15422' }
    }),
    searchEntity({
      name: 'search',
      description: 'Reactions matching a Rhea query: free text, EC number (ec:2.7.10.1), GO term, …',
      path: '/rhea',
      params: {
        query: { required: true, description: 'Rhea query, e.g. glucose, ec:2.7.10.1 or uniprot:P00533' }
      },
      query: (params) => ({ query: params.query, format: 'tsv', columns: COLUMNS }),
      example: { query: 'ec:2.7.10.1' }
    }),
    {
      name: 'participants',
      description: 'The ChEBI compounds of one reaction, one row each',
      path: '/rhea',
      format: 'tsv',
      params: {
        rheaId: { required: true, description: 'Rhea id, e.g. RHEA:10596' }
      },
      query: (params) => ({ query: rheaQuery(params.rheaId), format: 'tsv', columns: 'rhea-id,chebi-id,chebi' }),
      rows: (records) => records.flatMap((r) => {
        const ids = list(r['ChEBI identifier'])
        const labels = list(r['ChEBI name'])
        return ids.map((id, i) => ({ rheaId: r['Reaction identifier'], chebiId: id, name: labels[i] || null }))
      }),
      fields: {
        rheaId: 'rheaId',
        chebiId: 'chebiId',
        name: 'name'
      },
      example: { rheaId: 'RHEA:10596' },
      relations: [
        { alias: 'compound', description: 'The ChEBI entry of the participant', catalog: 'chebi', entity: 'compound', localKey: 'chebiId', foreignKey: 'chebiId', type: 'hasOne' }
      ]
    }
  ]
}
