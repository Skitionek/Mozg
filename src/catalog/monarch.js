'use strict'

const { GENE_CURIE_KEYS, ONTOLOGY_KEYS } = require('../database/obo')

/**
 * Monarch Initiative — a knowledge graph integrating genes, diseases,
 * phenotypes and model organisms across species (HPO annotations, OMIM,
 * Orphanet, ClinGen, MGI, ZFIN, …), with Biolink-typed associations.
 * API docs: https://api-v3.monarchinitiative.org/v3/docs
 *
 * Entities are addressed by CURIE (MONDO:0007254, HGNC:11998, HP:0001250,
 * MGI:98834).  Association queries match the given id *and its ontology
 * descendants* unless `direct: true`.
 */

const strip = (prefix) => (v) => (v == null ? null : String(v).replace(prefix, ''))
const biolink = strip(/^biolink:/)
const infores = strip(/^infores:/)

const isDisease = (category) => category === 'biolink:Disease'
const isGene = (category) => category === 'biolink:Gene'
const pick = (pred) => (id) => (id && pred(id) ? id : null)
const hgnc = pick((id) => id.startsWith('HGNC:'))
const hpo = pick((id) => id.startsWith('HP:'))

/** Accept "GeneToPhenotypicFeatureAssociation" or "biolink:…", one or several. */
function categories (value) {
  if (value == null) return []
  const list = Array.isArray(value) ? value : String(value).split(',')
  return list.map((c) => c.trim()).filter(Boolean).map((c) => (c.startsWith('biolink:') ? c : `biolink:${c}`))
}

/**
 * Fetch associations with the caller's offset and limit applied server-side
 * (Monarch caps a page at 500).  Built by hand because a filter can repeat
 * (`category=a&category=b`), which a single query-string value cannot express.
 */
async function fetchAssociations (ctx, { subject, object, category, predicate, direct }) {
  if (!subject && !object) throw new Error('monarch/associations needs a subject or an object')
  const qs = new URLSearchParams()
  if (subject) qs.append('subject', subject)
  if (object) qs.append('object', object)
  for (const c of categories(category)) qs.append('category', c)
  if (predicate) qs.append('predicate', String(predicate).startsWith('biolink:') ? predicate : `biolink:${predicate}`)
  if (direct != null) qs.append('direct', String(Boolean(direct)))
  qs.append('limit', String(Math.min(ctx.limit != null ? ctx.limit : 20, 500)))
  qs.append('offset', String(ctx.offset || 0))
  const body = await ctx.request(`/association?${qs}`)
  // Monarch applied the offset itself, so the driver must not skip it again.
  return { records: (body && body.items) || [], serverOffset: ctx.offset || 0 }
}

const ASSOCIATION_FIELDS = {
  subject: 'subject',
  subjectLabel: 'subject_label',
  subjectCategory: (r) => biolink(r.subject_category),
  predicate: (r) => biolink(r.predicate),
  object: 'object',
  objectLabel: 'object_label',
  objectCategory: (r) => biolink(r.object_category),
  category: (r) => biolink(r.category),
  negated: 'negated',
  frequency: 'frequency_qualifier',
  onset: 'onset_qualifier',
  primarySource: (r) => infores(r.primary_knowledge_source),
  publications: 'publications',
  evidenceCount: 'evidence_count',
  organism: 'subject_taxon_label',
  originalSubject: 'original_subject',
  originalObject: 'original_object',
  // Canonical ids of whichever side carries them, for joining to other sources
  diseaseId: (r) => (isDisease(r.object_category) ? r.object : isDisease(r.subject_category) ? r.subject : null),
  geneId: (r) => (isGene(r.subject_category) ? r.subject : isGene(r.object_category) ? r.object : null),
  hgncId: (r) => hgnc(r.subject) || hgnc(r.object),
  hpoId: (r) => hpo(r.object) || hpo(r.subject)
}

const ASSOCIATION_RELATIONS = [
  { alias: 'subjectEntity', description: 'The subject node', entity: 'entity', localKey: 'subject', obo: '*', foreignKey: 'id', type: 'hasOne' },
  { alias: 'objectEntity', description: 'The object node', entity: 'entity', localKey: 'object', obo: '*', foreignKey: 'id', type: 'hasOne' },
  { alias: 'disease', description: 'Open Targets disease record for the disease side', catalog: 'opentargets', entity: 'disease', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasOne' },
  { alias: 'phenotype', description: 'HPO term for the phenotype side', catalog: 'hpo', entity: 'term', obo: 'hp', type: 'hasOne' },
  { alias: 'hgnc', description: 'HGNC record for a human gene side', catalog: 'hgnc', entity: 'gene', obo: 'hgnc', type: 'hasOne' }
]

const PHENOTYPE_CATEGORY = (id) => (/^(HGNC|NCBIGene|MGI|RGD|ZFIN|FB|WB|SGD|Xenbase):/.test(id)
  ? 'biolink:GeneToPhenotypicFeatureAssociation'
  : 'biolink:DiseaseToPhenotypicFeatureAssociation')

const GENE_DISEASE_CATEGORIES = ['biolink:CausalGeneToDiseaseAssociation', 'biolink:CorrelatedGeneToDiseaseAssociation']

module.exports = {
  name: 'monarch',
  label: 'Monarch Initiative',
  description: 'Cross-species knowledge graph of genes, diseases, phenotypes and models: HPO disease–phenotype annotations, causal and correlated gene–disease links, orthologs and model-organism phenotypes, all as Biolink associations.',
  category: 'Disease & variants',
  homepage: 'https://monarchinitiative.org',
  docs: 'https://api-v3.monarchinitiative.org/v3/docs',
  license: 'CC BY 4.0 (aggregated sources carry their own terms)',
  driver: 'api',
  connection: {
    database: 'https://api-v3.monarchinitiative.org/v3/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  entities: [
    {
      name: 'entity',
      obo: { id: [...GENE_CURIE_KEYS, ...ONTOLOGY_KEYS, 'ncbigene', 'omim', 'orpha'] },
      description: 'A gene, disease, phenotype or other node by CURIE',
      path: '/entity/{id}',
      params: {
        id: { description: 'CURIE, e.g. MONDO:0007254, HGNC:11998, HP:0001250, MGI:98834' }
      },
      fields: {
        id: 'id',
        category: (r) => biolink(r.category),
        name: 'name',
        fullName: 'full_name',
        symbol: 'symbol',
        description: 'description',
        taxonId: (r) => (r.in_taxon ? Number(String(r.in_taxon).replace('NCBITaxon:', '')) : null),
        organism: 'in_taxon_label',
        synonyms: 'synonym',
        xrefs: 'xref',
        diseaseId: (r) => (isDisease(r.category) ? r.id : null),
        geneId: (r) => (isGene(r.category) ? r.id : null),
        hgncId: (r) => hgnc(r.id),
        hpoId: (r) => hpo(r.id),
        ensemblGeneId: (r) => ((r.xref || []).find((x) => x.startsWith('ENSEMBL:')) || '').replace('ENSEMBL:', '') || null,
        causalGenes: 'causal_gene[].id',
        causesDiseases: 'causes_disease[].id',
        inheritance: 'inheritance.name',
        phenotypeCount: 'has_phenotype_count',
        descendantCount: 'has_descendant_count',
        parentIds: 'node_hierarchy.super_classes[].id',
        associationCounts: (r) => Object.fromEntries((r.association_counts || []).map((c) => [c.label, c.count]))
      },
      example: { id: 'MONDO:0007254' },
      relations: [
        { alias: 'phenotypes', description: 'Phenotypes annotated to this disease or gene', entity: 'phenotypes', localKey: 'id', obo: '*', foreignKey: 'id', type: 'hasMany' },
        { alias: 'genes', description: 'Genes causally linked or correlated with this disease', entity: 'diseaseGenes', localKey: 'diseaseId', obo: '*', foreignKey: 'diseaseId', type: 'hasMany' },
        { alias: 'diseases', description: 'Diseases this gene causes or is correlated with', entity: 'geneDiseases', localKey: 'geneId', foreignKey: 'geneId', type: 'hasMany' },
        { alias: 'associations', description: 'Every association with this node as subject', entity: 'associations', localKey: 'id', obo: '*', foreignKey: 'subject', type: 'hasMany' },
        { alias: 'openTargets', description: 'Open Targets disease record (targets, drugs)', catalog: 'opentargets', entity: 'disease', localKey: 'diseaseId', obo: '*', foreignKey: 'diseaseId', type: 'hasOne' },
        { alias: 'hgnc', description: 'HGNC record for a human gene', catalog: 'hgnc', entity: 'gene', obo: 'hgnc', type: 'hasOne' },
        { alias: 'gene', description: 'Ensembl gene record', catalog: 'ensembl', entity: 'gene', obo: 'ensembl', type: 'hasOne' },
        { alias: 'hpo', description: 'HPO term record for a phenotype', catalog: 'hpo', entity: 'term', obo: 'hp', type: 'hasOne' }
      ]
    },
    {
      name: 'associations',
      obo: { subject: [...GENE_CURIE_KEYS, ...ONTOLOGY_KEYS, 'ncbigene', 'omim', 'orpha'], object: [...GENE_CURIE_KEYS, ...ONTOLOGY_KEYS, 'ncbigene', 'omim', 'orpha'] },
      description: 'Biolink associations from a subject and/or to an object, optionally of given categories',
      path: '/association',
      params: {
        subject: { in: 'body', description: 'Subject CURIE, e.g. HGNC:11998 (matches descendants unless direct)' },
        object: { in: 'body', description: 'Object CURIE, e.g. MONDO:0007254' },
        category: { in: 'body', description: 'Association category or comma-separated list, e.g. GeneToPhenotypicFeatureAssociation' },
        predicate: { in: 'body', description: 'Biolink predicate, e.g. causes, has_phenotype' },
        direct: { in: 'body', description: 'true to match only the given ids, not their descendants' }
      },
      resolve: (p, ctx) => fetchAssociations(ctx, p),
      fields: ASSOCIATION_FIELDS,
      example: { subject: 'HGNC:11998', category: 'GeneToPhenotypicFeatureAssociation' },
      relations: ASSOCIATION_RELATIONS
    },
    {
      name: 'phenotypes',
      obo: { id: [...GENE_CURIE_KEYS, ...ONTOLOGY_KEYS, 'ncbigene', 'omim', 'orpha'] },
      description: 'Phenotypes (HPO and model-organism) annotated to a disease or gene',
      path: '/association',
      params: {
        id: { in: 'body', required: true, description: 'Disease or gene CURIE, e.g. MONDO:0007947 (Marfan syndrome), HGNC:11998' }
      },
      resolve: (p, ctx) => fetchAssociations(ctx, { subject: p.id, category: PHENOTYPE_CATEGORY(p.id) }),
      fields: ASSOCIATION_FIELDS,
      example: { id: 'MONDO:0007947' },
      relations: ASSOCIATION_RELATIONS
    },
    {
      name: 'diseaseGenes',
      description: 'Genes causally linked to (or correlated with) a disease or its subtypes',
      path: '/association',
      params: {
        diseaseId: { in: 'body', required: true, description: 'Disease CURIE, e.g. MONDO:0007947' },
        direct: { in: 'body', description: 'true to exclude genes for subtypes of the disease' }
      },
      resolve: (p, ctx) => fetchAssociations(ctx, { object: p.diseaseId, category: GENE_DISEASE_CATEGORIES, direct: p.direct }),
      fields: ASSOCIATION_FIELDS,
      example: { diseaseId: 'MONDO:0007947' },
      relations: ASSOCIATION_RELATIONS
    },
    {
      name: 'geneDiseases',
      obo: { geneId: [...GENE_CURIE_KEYS, 'ncbigene'] },
      description: 'Diseases a gene causes or is correlated with',
      path: '/association',
      params: {
        geneId: { in: 'body', required: true, description: 'Gene CURIE, e.g. HGNC:11998, NCBIGene:7157, MGI:98834' }
      },
      resolve: (p, ctx) => fetchAssociations(ctx, { subject: p.geneId, category: GENE_DISEASE_CATEGORIES }),
      fields: ASSOCIATION_FIELDS,
      example: { geneId: 'HGNC:11998' },
      relations: ASSOCIATION_RELATIONS
    },
    {
      name: 'search',
      description: 'Free-text search across Monarch nodes',
      path: '/search',
      params: {
        q: { required: true, description: 'Search text, e.g. marfan' },
        category: { transform: (v) => (String(v).startsWith('biolink:') ? v : `biolink:${v}`), description: 'Node category, e.g. Disease, Gene, PhenotypicFeature' }
      },
      rows: 'items',
      fields: {
        id: 'id',
        category: (r) => biolink(r.category),
        name: 'name',
        symbol: 'symbol',
        description: 'description',
        organism: 'in_taxon_label',
        diseaseId: (r) => (isDisease(r.category) ? r.id : null),
        geneId: (r) => (isGene(r.category) ? r.id : null),
        hgncId: (r) => hgnc(r.id),
        hpoId: (r) => hpo(r.id)
      },
      paginate: { limit: 'limit', offset: 'offset', max: 500 },
      example: { q: 'marfan', category: 'Disease' },
      relations: [
        { alias: 'entity', description: 'The full node record', entity: 'entity', localKey: 'id', foreignKey: 'id', type: 'hasOne' }
      ]
    }
  ]
}
