'use strict'

/**
 * Open Targets Platform — systematic target–disease evidence for drug
 * discovery: genetic associations, somatic mutations, known drugs, animal
 * models, literature, plus target tractability and safety.
 * API docs: https://platform-docs.opentargets.org/data-access/graphql-api
 *
 * The API is GraphQL.  Single-record lookups use the driver's `graphql` hook;
 * association lists use `resolve` so the caller's limit/offset become the
 * GraphQL page size instead of being trimmed from a fixed-size page.
 *
 * Open Targets writes ontology ids with an underscore (MONDO_0007254); Mozg's
 * convention is the colon CURIE (MONDO:0007254).  Both are accepted on the
 * way in and the colon form is returned.
 */

// MONDO:0007254 → MONDO_0007254 (and pass through ids already in OT form)
const toOtId = (id) => String(id).trim().replace(':', '_')
// MONDO_0007254 → MONDO:0007254
const toCurie = (id) => (id == null ? null : String(id).replace(/^([A-Za-z][A-Za-z0-9]*)_/, '$1:'))

const DEFAULT_PAGE = 25

/** Run a GraphQL query through the throttled client; fail loudly on GraphQL errors. */
async function graphql (ctx, query, variables) {
  const body = await ctx.request('/graphql', { method: 'POST', body: { query, variables } })
  const errors = body && Array.isArray(body.errors) && body.errors.length ? body.errors.map((e) => e.message).join('; ') : null
  if (errors && !(body && body.data)) throw new Error(`opentargets/${ctx.entity.name}: ${errors}`)
  return (body && body.data) || {}
}

/** Page size that covers the caller's offset + limit (the driver trims the offset client-side). */
const pageSize = (ctx) => (ctx.limit != null ? ctx.limit : DEFAULT_PAGE) + (ctx.offset || 0)

const scoresById = (list) => Object.fromEntries((list || []).map((s) => [s.id, s.score]))

// ── Field sets ──────────────────────────────────────────────────────────────

const TARGET_QUERY = `query target($ensemblId: String!) {
  target(ensemblId: $ensemblId) {
    id approvedSymbol approvedName biotype functionDescriptions
    genomicLocation { chromosome start end strand }
    canonicalTranscript { id }
    symbolSynonyms { label }
    proteinIds { id source }
    dbXrefs { id source }
    subcellularLocations { location }
    targetClass { label }
    tractability { label modality value }
    geneticConstraint { constraintType oe oeUpper }
    isEssential
  }
}`

const TARGET_FIELDS = {
  ensemblGeneId: 'id',
  symbol: 'approvedSymbol',
  name: 'approvedName',
  biotype: 'biotype',
  function: 'functionDescriptions[0]',
  chromosome: 'genomicLocation.chromosome',
  start: 'genomicLocation.start',
  end: 'genomicLocation.end',
  strand: 'genomicLocation.strand',
  canonicalTranscript: 'canonicalTranscript.id',
  synonyms: (r) => [...new Set((r.symbolSynonyms || []).map((s) => s.label))],
  uniprotAccession: (r) => ((r.proteinIds || []).find((p) => p.source === 'uniprot_swissprot') || {}).id || null,
  hgncId: (r) => {
    const x = (r.dbXrefs || []).find((d) => d.source === 'HGNC')
    return x ? `HGNC:${x.id}` : null
  },
  chemblTargetIds: (r) => (r.dbXrefs || []).filter((d) => d.source === 'ChEMBL').map((d) => d.id),
  subcellularLocations: (r) => [...new Set((r.subcellularLocations || []).map((l) => l.location))],
  targetClass: 'targetClass[].label',
  // Tractability buckets that hold, as "modality: label" (SM small molecule, AB antibody, PR PROTAC, OC other)
  tractability: (r) => (r.tractability || []).filter((t) => t.value).map((t) => `${t.modality}: ${t.label}`),
  // LOEUF — upper bound of the loss-of-function observed/expected ratio (gnomAD); low means intolerant
  loeuf: (r) => ((r.geneticConstraint || []).find((c) => c.constraintType === 'lof') || {}).oeUpper ?? null,
  isEssential: 'isEssential'
}

const DISEASE_QUERY = `query disease($efoId: String!) {
  disease(efoId: $efoId) {
    id name description dbXRefs isTherapeuticArea
    synonyms { relation terms }
    therapeuticAreas { id name }
    parents { id name }
  }
}`

const DISEASE_FIELDS = {
  diseaseId: (r) => toCurie(r.id),
  name: 'name',
  description: 'description',
  synonyms: (r) => ((r.synonyms || []).find((s) => s.relation === 'hasExactSynonym') || {}).terms || [],
  dbXrefs: 'dbXRefs',
  therapeuticAreas: 'therapeuticAreas[].name',
  parentIds: (r) => (r.parents || []).map((p) => toCurie(p.id)),
  isTherapeuticArea: 'isTherapeuticArea'
}

const DRUG_QUERY = `query drug($chemblId: String!) {
  drug(chemblId: $chemblId) {
    id name drugType maximumClinicalStage description
    tradeNames { label }
    synonyms { label }
    crossReferences { source ids }
    mechanismsOfAction { rows { mechanismOfAction actionType targets { id approvedSymbol } } }
    indications { count }
    drugWarnings { warningType }
  }
}`

const DRUG_FIELDS = {
  chemblId: 'id',
  name: 'name',
  drugType: 'drugType',
  maxClinicalStage: 'maximumClinicalStage',
  description: 'description',
  tradeNames: (r) => [...new Set((r.tradeNames || []).map((t) => t.label))],
  synonyms: (r) => [...new Set((r.synonyms || []).map((t) => t.label))],
  mechanismsOfAction: 'mechanismsOfAction.rows[].mechanismOfAction',
  actionTypes: (r) => [...new Set(((r.mechanismsOfAction && r.mechanismsOfAction.rows) || []).map((m) => m.actionType).filter(Boolean))],
  targetEnsemblGeneIds: (r) => [...new Set(((r.mechanismsOfAction && r.mechanismsOfAction.rows) || []).flatMap((m) => (m.targets || []).map((t) => t.id)))],
  targetSymbols: (r) => [...new Set(((r.mechanismsOfAction && r.mechanismsOfAction.rows) || []).flatMap((m) => (m.targets || []).map((t) => t.approvedSymbol)))],
  indicationCount: 'indications.count',
  warnings: (r) => [...new Set((r.drugWarnings || []).map((w) => w.warningType))],
  drugbankIds: (r) => ((r.crossReferences || []).find((x) => x.source === 'drugbank') || {}).ids || []
}

// ── Relations ───────────────────────────────────────────────────────────────

const TO_TARGET = { alias: 'target', description: 'Open Targets target record', entity: 'target', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' }
const TO_DISEASE = { alias: 'disease', description: 'Open Targets disease record', entity: 'disease', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasOne' }
const TO_DRUG = { alias: 'drug', description: 'Open Targets drug record', entity: 'drug', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasOne' }
const TO_CHEMBL = { alias: 'molecule', description: 'ChEMBL molecule (structure, properties)', catalog: 'chembl', entity: 'molecule', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasOne' }

module.exports = {
  name: 'opentargets',
  label: 'Open Targets Platform',
  description: 'Target–disease associations scored from genetics, somatic mutations, known drugs, expression, animal models and literature; target tractability and safety; drugs with mechanisms and indications. Disease ids are MONDO/EFO CURIEs.',
  category: 'Disease & variants',
  homepage: 'https://platform.opentargets.org',
  docs: 'https://platform-docs.opentargets.org/data-access/graphql-api',
  license: 'CC0 1.0',
  driver: 'api',
  connection: {
    database: 'https://api.platform.opentargets.org/api/v4',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  entities: [
    {
      name: 'target',
      description: 'A drug target (gene) with tractability, constraint and location',
      path: '/graphql',
      params: {
        ensemblGeneId: { in: 'body', required: true, description: 'Ensembl gene id, e.g. ENSG00000141510' }
      },
      graphql: { query: TARGET_QUERY, variables: (p) => ({ ensemblId: p.ensemblGeneId }) },
      rows: 'data.target',
      fields: TARGET_FIELDS,
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: [
        { alias: 'diseases', description: 'Diseases associated with this target, strongest first', entity: 'targetDiseases', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
        { alias: 'drugs', description: 'Drugs and clinical candidates acting on this target', entity: 'targetDrugs', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
        { alias: 'constraint', description: 'gnomAD loss-of-function and missense constraint', catalog: 'gnomad', entity: 'geneConstraint', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
        { alias: 'gwasAssociations', description: 'GWAS Catalog associations mapped to this gene', catalog: 'gwas', entity: 'associationsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
        { alias: 'civic', description: 'CIViC clinical-interpretation summary for this gene', catalog: 'civic', entity: 'gene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasOne' },
        { alias: 'gene', description: 'The Ensembl gene record', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
        { alias: 'protein', description: 'The reviewed UniProt entry', catalog: 'uniprot', entity: 'protein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' },
        { alias: 'hgnc', description: 'HGNC nomenclature record', catalog: 'hgnc', entity: 'gene', localKey: 'hgncId', foreignKey: 'hgncId', type: 'hasOne' },
        { alias: 'expression', description: 'GTEx median expression per tissue', catalog: 'gtex', entity: 'expression', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
        { alias: 'clinvarVariants', description: 'ClinVar variants in this gene', catalog: 'clinvar', entity: 'variantsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' }
      ]
    },
    {
      name: 'targetDiseases',
      description: 'Diseases associated with a target, by overall association score (0–1)',
      path: '/graphql',
      params: {
        ensemblGeneId: { in: 'body', required: true, description: 'Ensembl gene id, e.g. ENSG00000141510' },
        indirect: { in: 'body', description: 'true to include associations propagated from descendant diseases' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($id: String!, $size: Int!, $indirect: Boolean) {
          target(ensemblId: $id) {
            id approvedSymbol
            associatedDiseases(page: { index: 0, size: $size }, enableIndirect: $indirect) {
              rows { score datatypeScores { id score } disease { id name therapeuticAreas { name } } }
            }
          }
        }`, { id: p.ensemblGeneId, size: pageSize(ctx), indirect: p.indirect != null ? Boolean(p.indirect) : undefined })
        if (!data.target) return []
        return data.target.associatedDiseases.rows.map((row) => ({ ...row, target: { id: data.target.id, approvedSymbol: data.target.approvedSymbol } }))
      },
      fields: {
        ensemblGeneId: 'target.id',
        symbol: 'target.approvedSymbol',
        diseaseId: (r) => toCurie(r.disease && r.disease.id),
        diseaseName: 'disease.name',
        score: 'score',
        datatypeScores: (r) => scoresById(r.datatypeScores),
        therapeuticAreas: 'disease.therapeuticAreas[].name'
      },
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: [TO_DISEASE, TO_TARGET]
    },
    {
      name: 'targetDrugs',
      description: 'Drugs and clinical candidates whose mechanism acts on a target, with their indications',
      path: '/graphql',
      params: {
        ensemblGeneId: { in: 'body', required: true, description: 'Ensembl gene id, e.g. ENSG00000146648 (EGFR)' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($id: String!) {
          target(ensemblId: $id) {
            id approvedSymbol
            drugAndClinicalCandidates {
              rows {
                maxClinicalStage
                drug { id name drugType mechanismsOfAction { rows { mechanismOfAction } } }
                diseases { diseaseFromSource disease { id name } }
              }
            }
          }
        }`, { id: p.ensemblGeneId })
        if (!data.target) return []
        return data.target.drugAndClinicalCandidates.rows.map((row) => ({ ...row, target: { id: data.target.id, approvedSymbol: data.target.approvedSymbol } }))
      },
      fields: {
        ensemblGeneId: 'target.id',
        symbol: 'target.approvedSymbol',
        chemblId: 'drug.id',
        drugName: 'drug.name',
        drugType: 'drug.drugType',
        maxClinicalStage: 'maxClinicalStage',
        mechanismsOfAction: 'drug.mechanismsOfAction.rows[].mechanismOfAction',
        diseaseIds: (r) => (r.diseases || []).filter((d) => d.disease).map((d) => toCurie(d.disease.id)),
        diseaseNames: (r) => (r.diseases || []).map((d) => (d.disease ? d.disease.name : d.diseaseFromSource))
      },
      example: { ensemblGeneId: 'ENSG00000146648' },
      relations: [TO_DRUG, TO_CHEMBL]
    },
    {
      name: 'disease',
      description: 'A disease or phenotype from the Open Targets disease ontology (MONDO/EFO based)',
      path: '/graphql',
      params: {
        diseaseId: { in: 'body', required: true, description: 'Disease CURIE, e.g. MONDO:0007254 (an underscore form is accepted too)' }
      },
      graphql: { query: DISEASE_QUERY, variables: (p) => ({ efoId: toOtId(p.diseaseId) }) },
      rows: 'data.disease',
      fields: DISEASE_FIELDS,
      example: { diseaseId: 'MONDO:0007254' },
      relations: [
        { alias: 'targets', description: 'Targets associated with this disease, strongest first', entity: 'diseaseTargets', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasMany' },
        { alias: 'drugs', description: 'Drugs and clinical candidates for this disease', entity: 'diseaseDrugs', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasMany' },
        { alias: 'phenotypes', description: 'HPO phenotypes annotated to this disease', entity: 'diseasePhenotypes', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasMany' },
        { alias: 'monarch', description: 'Monarch Initiative entity (genes, phenotypes, models)', catalog: 'monarch', entity: 'entity', localKey: 'diseaseId', foreignKey: 'id', type: 'hasOne' },
        { alias: 'trials', description: 'ClinicalTrials.gov studies for this condition', catalog: 'clinicaltrials', entity: 'studies', localKey: 'name', foreignKey: 'condition', type: 'hasMany' }
      ]
    },
    {
      name: 'diseaseTargets',
      description: 'Targets associated with a disease, by overall association score (0–1)',
      path: '/graphql',
      params: {
        diseaseId: { in: 'body', required: true, description: 'Disease CURIE, e.g. MONDO:0007254' },
        indirect: { in: 'body', description: 'true (the Open Targets default) to include evidence from descendant diseases; false for direct evidence only' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($id: String!, $size: Int!, $indirect: Boolean) {
          disease(efoId: $id) {
            id name
            associatedTargets(page: { index: 0, size: $size }, enableIndirect: $indirect) {
              rows { score datatypeScores { id score } target { id approvedSymbol approvedName } }
            }
          }
        }`, { id: toOtId(p.diseaseId), size: pageSize(ctx), indirect: p.indirect != null ? Boolean(p.indirect) : undefined })
        if (!data.disease) return []
        return data.disease.associatedTargets.rows.map((row) => ({ ...row, disease: { id: data.disease.id, name: data.disease.name } }))
      },
      fields: {
        diseaseId: (r) => toCurie(r.disease.id),
        diseaseName: 'disease.name',
        ensemblGeneId: 'target.id',
        symbol: 'target.approvedSymbol',
        name: 'target.approvedName',
        score: 'score',
        datatypeScores: (r) => scoresById(r.datatypeScores)
      },
      example: { diseaseId: 'MONDO:0007254' },
      relations: [
        TO_TARGET,
        { alias: 'gene', description: 'The Ensembl gene record', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
        { alias: 'proteins', description: 'UniProt entries for this gene', catalog: 'uniprot', entity: 'proteins', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany', where: { reviewed: true } }
      ]
    },
    {
      name: 'diseaseDrugs',
      description: 'Drugs and clinical candidates studied or approved for a disease',
      path: '/graphql',
      params: {
        diseaseId: { in: 'body', required: true, description: 'Disease CURIE, e.g. MONDO:0007254' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($id: String!) {
          disease(efoId: $id) {
            id name
            drugAndClinicalCandidates { rows { maxClinicalStage drug { id name drugType } } }
          }
        }`, { id: toOtId(p.diseaseId) })
        if (!data.disease) return []
        return data.disease.drugAndClinicalCandidates.rows.map((row) => ({ ...row, disease: { id: data.disease.id, name: data.disease.name } }))
      },
      fields: {
        diseaseId: (r) => toCurie(r.disease.id),
        diseaseName: 'disease.name',
        chemblId: 'drug.id',
        drugName: 'drug.name',
        drugType: 'drug.drugType',
        maxClinicalStage: 'maxClinicalStage'
      },
      example: { diseaseId: 'MONDO:0007254' },
      relations: [TO_DRUG, TO_CHEMBL]
    },
    {
      name: 'diseasePhenotypes',
      description: 'HPO phenotypes annotated to a disease',
      path: '/graphql',
      params: {
        diseaseId: { in: 'body', required: true, description: 'Disease CURIE, e.g. MONDO:0018875 (Li-Fraumeni syndrome)' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($id: String!, $size: Int!) {
          disease(efoId: $id) {
            id
            phenotypes(page: { index: 0, size: $size }) {
              rows { phenotypeHPO { id name } evidence { frequency evidenceType } }
            }
          }
        }`, { id: toOtId(p.diseaseId), size: pageSize(ctx) })
        if (!data.disease) return []
        return data.disease.phenotypes.rows.map((row) => ({ ...row, diseaseId: data.disease.id }))
      },
      fields: {
        diseaseId: (r) => toCurie(r.diseaseId),
        hpoId: (r) => toCurie(r.phenotypeHPO && r.phenotypeHPO.id),
        name: 'phenotypeHPO.name',
        frequencies: (r) => [...new Set((r.evidence || []).map((e) => e.frequency).filter(Boolean).map(toCurie))],
        evidenceTypes: (r) => [...new Set((r.evidence || []).map((e) => e.evidenceType).filter(Boolean))]
      },
      example: { diseaseId: 'MONDO:0018875' },
      relations: [
        { alias: 'term', description: 'The HPO term', catalog: 'hpo', entity: 'term', localKey: 'hpoId', foreignKey: 'hpoId', type: 'hasOne' }
      ]
    },
    {
      name: 'drug',
      description: 'A drug or clinical candidate with mechanisms of action and targets',
      path: '/graphql',
      params: {
        chemblId: { in: 'body', required: true, description: 'ChEMBL molecule id, e.g. CHEMBL25 (aspirin)' }
      },
      graphql: { query: DRUG_QUERY, variables: (p) => ({ chemblId: p.chemblId }) },
      rows: 'data.drug',
      fields: DRUG_FIELDS,
      example: { chemblId: 'CHEMBL25' },
      relations: [
        { alias: 'indications', description: 'Diseases this drug is approved for or in trials for', entity: 'drugIndications', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasMany' },
        { alias: 'trials', description: 'ClinicalTrials.gov studies with this drug as an intervention', catalog: 'clinicaltrials', entity: 'studies', localKey: 'name', foreignKey: 'intervention', type: 'hasMany' },
        TO_CHEMBL
      ]
    },
    {
      name: 'drugIndications',
      description: 'Diseases a drug is approved for or under investigation for, with the furthest clinical stage reached',
      path: '/graphql',
      params: {
        chemblId: { in: 'body', required: true, description: 'ChEMBL molecule id, e.g. CHEMBL1201585 (trastuzumab)' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($id: String!) {
          drug(chemblId: $id) {
            id name
            indications { rows { maxClinicalStage disease { id name } } }
          }
        }`, { id: p.chemblId })
        if (!data.drug) return []
        return data.drug.indications.rows.map((row) => ({ ...row, drug: { id: data.drug.id, name: data.drug.name } }))
      },
      fields: {
        chemblId: 'drug.id',
        drugName: 'drug.name',
        diseaseId: (r) => toCurie(r.disease && r.disease.id),
        diseaseName: 'disease.name',
        maxClinicalStage: 'maxClinicalStage'
      },
      example: { chemblId: 'CHEMBL1201585' },
      relations: [TO_DISEASE]
    },
    {
      name: 'search',
      description: 'Free-text search across targets, diseases and drugs',
      path: '/graphql',
      params: {
        q: { in: 'body', required: true, description: 'Search text, e.g. "breast cancer" or "TP53"' },
        entity: { in: 'body', description: 'Restrict to target, disease or drug' }
      },
      resolve: async (p, ctx) => {
        const data = await graphql(ctx, `query($q: String!, $entities: [String!], $size: Int!) {
          search(queryString: $q, entityNames: $entities, page: { index: 0, size: $size }) {
            hits { id entity name description }
          }
        }`, { q: p.q, entities: p.entity ? [p.entity] : ['target', 'disease', 'drug'], size: pageSize(ctx) })
        return (data.search && data.search.hits) || []
      },
      fields: {
        id: (r) => (r.entity === 'disease' ? toCurie(r.id) : r.id),
        entity: 'entity',
        name: 'name',
        description: 'description',
        ensemblGeneId: (r) => (r.entity === 'target' ? r.id : null),
        diseaseId: (r) => (r.entity === 'disease' ? toCurie(r.id) : null),
        chemblId: (r) => (r.entity === 'drug' ? r.id : null)
      },
      example: { q: 'breast cancer', entity: 'disease' },
      relations: [TO_TARGET, TO_DISEASE, TO_DRUG]
    }
  ]
}
