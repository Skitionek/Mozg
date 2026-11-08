'use strict'

/**
 * The data behind the documentation site's "Model" page: how the catalog's
 * databases connect their entities through shared identifier spaces and
 * ontologies.
 *
 * Mozg joins by *OBO key*: "same key + same value = same thing" (see
 * src/database/obo.js).  A key is the identifier space of an ontology
 * (MONDO, GO, HP, ChEBI) or of a database (UniProt, Ensembl).  An entity
 * carries a key when one of its fields returns it or one of its parameters
 * accepts it; two entities that carry the same key can be joined.  So the
 * keys form the shared layer, and each database's entities hang off it.
 *
 * This is computed from the live catalog, not drawn by hand, so the page
 * cannot drift from what Mozg does.  `node scripts/model-graph.js` prints a
 * summary.
 */

const { getCatalog } = require('../src/catalog')
const obo = require('../src/database/obo')
const { entityParams, entityColumns } = require('../src/database/sources')

/** At most this many databases are drawn at once: the chart palette has eight categorical slots. */
const MAX_SOURCES = 8

/**
 * Starting points, each a short story the reader can follow in the picture.
 * Source names are checked against the catalog by the tests.
 */
const PRESETS = [
  {
    id: 'diseases',
    label: 'Disease and phenotype ontologies',
    description: 'The Human Phenotype Ontology, ClinVar and the Ontology Lookup Service all carry the disease ontologies (MONDO, DOID, EFO, NCIT, HP), so they can be joined on them.',
    sources: ['hpo', 'ols', 'clinvar']
  },
  {
    id: 'genes',
    label: 'Genes, transcripts and proteins',
    description: 'Ensembl, HGNC and UniProt each keep their own identifier for a gene.  Those are different keys, so they only meet where one entity carries several.',
    sources: ['hgnc', 'ensembl', 'uniprot', 'reactome']
  },
  {
    id: 'chemistry',
    label: 'Chemistry and function',
    description: 'ChEBI and the Gene Ontology are the shared vocabulary between the chemistry, reaction and annotation databases.',
    sources: ['chebi', 'rhea', 'geneontology', 'quickgo', 'lipidmaps']
  }
]

/** The keys an entity returns (fields) and accepts (parameters), each sorted. */
function entityKeysOf (entity) {
  const returns = new Set()
  const accepts = new Set()
  // entityColumns, not entity.columns: nearly every catalog entity declares `fields` instead.
  for (const field of entityColumns(entity)) {
    for (const key of obo.fieldKeys(entity, field)) returns.add(key)
  }
  for (const param of entityParams(entity)) {
    for (const key of obo.paramKeys(entity, param.name)) accepts.add(key)
  }
  return { returns: [...returns].sort(), accepts: [...accepts].sort() }
}

/**
 * @param {object[]} [entries]  catalog entries; the life-science (`api`) sources of the live catalog by default
 */
function buildModelGraph (entries = getCatalog().filter((e) => e.driver === 'api')) {
  const entities = []
  const known = new Set()
  for (const entry of entries) for (const entity of entry.entities) known.add(`${entry.name}/${entity.name}`)

  const keySources = new Map()
  const relations = []
  for (const entry of entries) {
    for (const entity of entry.entities) {
      const id = `${entry.name}/${entity.name}`
      const { returns, accepts } = entityKeysOf(entity)
      entities.push({
        id,
        source: entry.name,
        name: entity.name,
        description: entity.description || null,
        returns,
        accepts
      })
      for (const key of new Set([...returns, ...accepts])) {
        if (!keySources.has(key)) keySources.set(key, new Set())
        keySources.get(key).add(entry.name)
      }
      for (const relation of entity.relations || []) {
        const to = `${relation.catalog || entry.name}/${relation.entity}`
        if (known.has(to) && to !== id) {
          relations.push({ from: id, to, type: relation.type || 'hasMany', key: relation.obo || null })
        }
      }
    }
  }

  const keys = [...keySources]
    .map(([id, sources]) => {
      const spec = obo.KEYS[id] || {}
      return {
        id,
        label: spec.label || id,
        prefix: spec.prefix || id.toUpperCase(),
        // An ontology, as the project itself defines it (obo.ONTOLOGY_KEYS), as opposed to the identifier space of a database.
        ontology: obo.ONTOLOGY_KEYS.includes(id),
        sources: sources.size
      }
    })
    .sort((a, b) => b.sources - a.sources || a.id.localeCompare(b.id))

  const sources = entries
    .map((entry) => ({
      name: entry.name,
      label: entry.label || entry.name,
      category: entry.category || 'Other',
      description: entry.description || null,
      entities: entry.entities.length
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  return { maxSources: MAX_SOURCES, presets: PRESETS, sources, keys, entities, relations }
}

/**
 * The identifier spaces that two or more of the given databases carry, and
 * which entities carry each: the same table the page's script draws as a graph,
 * for a reader without JavaScript.
 * @returns {Array<{ key: object, databases: Array<{ source: string, entities: string[] }> }>}
 */
function sharedKeyTable (graph, sourceNames) {
  const chosen = new Set(sourceNames)
  const byKey = new Map()
  for (const entity of graph.entities) {
    if (!chosen.has(entity.source)) continue
    for (const keyId of new Set([...entity.returns, ...entity.accepts])) {
      if (!byKey.has(keyId)) byKey.set(keyId, new Map())
      const bySource = byKey.get(keyId)
      if (!bySource.has(entity.source)) bySource.set(entity.source, [])
      bySource.get(entity.source).push(entity.name)
    }
  }
  const keyById = new Map(graph.keys.map((k) => [k.id, k]))
  return [...byKey]
    .filter(([, bySource]) => bySource.size >= 2)
    .map(([keyId, bySource]) => ({
      key: keyById.get(keyId),
      databases: [...bySource].map(([source, entities]) => ({ source, entities }))
    }))
    .sort((a, b) => b.databases.length - a.databases.length || a.key.id.localeCompare(b.key.id))
}

module.exports = { buildModelGraph, sharedKeyTable, entityKeysOf, PRESETS, MAX_SOURCES }

if (require.main === module) {
  const graph = buildModelGraph()
  const shared = graph.keys.filter((k) => k.sources >= 2)
  console.log(`${graph.sources.length} sources, ${graph.entities.length} entities, ${graph.keys.length} identifier spaces (${shared.length} shared by two or more databases), ${graph.relations.length} relations`)
  console.log(`embedded size: ${(JSON.stringify(graph).length / 1024).toFixed(0)} KB`)
  for (const key of shared.slice(0, 12)) console.log(`  ${key.id.padEnd(12)} ${String(key.sources).padStart(2)} databases  ${key.ontology ? 'ontology' : '        '}  ${key.label}`)
}
