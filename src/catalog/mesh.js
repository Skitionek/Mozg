'use strict'

/**
 * MeSH — NLM's Medical Subject Headings, the controlled vocabulary PubMed
 * indexes articles with, via the MeSH RDF Linked Data API.
 * API docs: https://hhs.github.io/meshrdf/ (lookup service: https://id.nlm.nih.gov/mesh/swagger/ui)
 */

const MESH_URI = 'http://id.nlm.nih.gov/mesh/'

const localId = (uri) => (uri == null ? null : String(uri).replace(MESH_URI, ''))
const literal = (value) => (value && typeof value === 'object' ? value['@value'] : value) || null
const list = (value) => (value == null ? [] : [].concat(value))

const DESCRIPTOR_RELATIONS = [
  { alias: 'articles', description: 'PubMed citations indexed with this heading', catalog: 'pubmed', entity: 'articles', localKey: 'pubmedTerm', foreignKey: 'term', type: 'hasMany' },
  { alias: 'ontologyTerms', description: 'Matching terms in other biomedical ontologies (EBI OLS)', catalog: 'ols', entity: 'search', localKey: 'name', foreignKey: 'q', type: 'hasMany' }
]

module.exports = {
  name: 'mesh',
  label: 'MeSH – Medical Subject Headings',
  description: 'NLM controlled vocabulary used to index MEDLINE/PubMed: descriptors with tree numbers, scope notes and entry terms (synonyms), searchable by label and linked to the PubMed articles indexed with them.',
  category: 'Function & ontologies',
  homepage: 'https://www.nlm.nih.gov/mesh/',
  docs: 'https://hhs.github.io/meshrdf/',
  license: 'Public domain (NLM); see https://www.nlm.nih.gov/databases/download/terms_and_conditions_mesh.html',
  driver: 'api',
  connection: {
    database: 'https://id.nlm.nih.gov/mesh',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 2 },
  entities: [
    {
      name: 'descriptors',
      description: 'A MeSH descriptor whose label matches the search',
      path: '/lookup/descriptor',
      params: {
        label: { required: true, description: 'Text to match against descriptor labels, e.g. breast neoplasm' },
        match: { default: 'contains', description: 'exact, contains (default), startswith' }
      },
      paginate: { limit: 'limit', max: 50 },
      fields: {
        meshId: (r) => localId(r.resource),
        name: 'label'
      },
      example: { label: 'breast neoplasm' },
      relations: [
        { alias: 'descriptor', description: 'The full descriptor record', entity: 'descriptor', obo: 'mesh', type: 'hasOne' }
      ]
    },
    {
      name: 'descriptor',
      description: 'One MeSH descriptor with its tree numbers, scope note and entry terms',
      params: {
        meshId: { required: true, description: 'Descriptor UI, e.g. D009369' }
      },
      resolve: async (params, ctx) => {
        const meshId = String(params.meshId).trim()
        const record = await ctx.request(`/${encodeURIComponent(meshId)}.json`)
        if (!record || !record.identifier) return []

        const [details, concept] = await Promise.all([
          ctx.request('/lookup/details', { query: { descriptor: meshId } }),
          record.preferredConcept ? ctx.request(`/${encodeURIComponent(localId(record.preferredConcept))}.json`) : null
        ])
        return [{ record, details: details || {}, concept: concept || {} }]
      },
      fields: {
        meshId: 'record.identifier',
        name: (r) => literal(r.record.label),
        type: (r) => localId(r.record['@type']).replace('vocab#', ''),
        treeNumbers: (r) => list(r.record.treeNumber).map(localId),
        scopeNote: (r) => literal(r.concept.scopeNote),
        synonyms: (r) => (r.details.terms || []).filter((t) => !t.preferred).map((t) => t.label),
        allowedQualifiers: (r) => (r.details.qualifiers || []).map((q) => q.label),
        seeAlso: (r) => (r.details.seealso || []).map((s) => s.label || localId(s.resource)),
        annotation: (r) => literal(r.record.annotation),
        dateIntroduced: 'record.dateIntroduced',
        lastUpdated: 'record.lastUpdated',
        pubmedTerm: (r) => {
          const name = literal(r.record.label)
          return name ? `"${name}"[MeSH Terms]` : null
        }
      },
      example: { meshId: 'D009369' },
      relations: DESCRIPTOR_RELATIONS
    }
  ]
}
