'use strict'

/**
 * RxNorm (via RxNav) — the US National Library of Medicine's normalized names
 * for clinical drugs: ingredients, strengths, dose forms and brands, linked to
 * the vocabularies pharmacy and EHR systems use, plus drug classes (ATC,
 * mechanism of action, established pharmacologic class) through RxClass.
 * API docs: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html
 *
 * Terms of service: at most 20 requests per second per IP.
 *
 * RxNorm concept ids (`rxcui`) are strings, e.g. "1191" for the ingredient
 * aspirin.  Term types (`tty`): IN ingredient, SCD clinical drug, SBD branded
 * drug, BN brand name, GPCK/BPCK packs.
 */

const CONCEPT_FIELDS = {
  rxcui: 'rxcui',
  name: 'name',
  synonym: (r) => r.synonym || null,
  tty: 'tty',
  suppress: 'suppress'
}

const BASE_RELATIONS = [
  { alias: 'related', description: 'Clinical and branded drugs, brand names and dose forms built on this concept', entity: 'related', localKey: 'rxcui', foreignKey: 'rxcui', type: 'hasMany' },
  { alias: 'classes', description: 'Drug classes this concept belongs to (ATC, MeSH pharmacologic action, FDA EPC/MoA…)', entity: 'classes', localKey: 'rxcui', foreignKey: 'rxcui', type: 'hasMany' }
]

// FDA labels list the RxCUIs of *products* (SCD/SBD), never of ingredients,
// so this relation is only offered where rows can be products.
const PRODUCT_LABELS = { alias: 'productLabels', description: 'FDA drug labels listing this RxNorm product', catalog: 'openfda', entity: 'labelsForRxcui', localKey: 'rxcui', foreignKey: 'rxcui', type: 'hasMany' }

// Ingredient-level concepts are named the way other drug sources name them,
// so they can reach sources keyed by drug name.
const NAME_RELATIONS = [
  { alias: 'labels', description: 'FDA drug labels for this generic name', catalog: 'openfda', entity: 'labels', localKey: 'name', foreignKey: 'genericName', type: 'hasMany' },
  { alias: 'chembl', description: 'ChEMBL compounds matching this drug name', catalog: 'chembl', entity: 'molecules', localKey: 'name', foreignKey: 'name', type: 'hasMany' },
  { alias: 'pubchem', description: 'PubChem compounds with this name', catalog: 'pubchem', entity: 'compoundByName', localKey: 'name', foreignKey: 'name', type: 'hasMany' },
  { alias: 'adverseEvents', description: 'Most frequently reported adverse reactions (FAERS)', catalog: 'openfda', entity: 'adverseEventCounts', localKey: 'name', foreignKey: 'drugName', type: 'hasMany' },
  { alias: 'geneInteractions', description: 'Drug–gene interactions aggregated by DGIdb', catalog: 'dgidb', entity: 'interactionsForDrug', localKey: 'name', foreignKey: 'name', type: 'hasMany' }
]

module.exports = {
  name: 'rxnorm',
  label: 'RxNorm',
  description: 'NLM normalized names for clinical drugs — ingredients, strengths, dose forms and brands — with drug classes from RxClass (ATC, MeSH, FDA pharmacologic classes).',
  category: 'Chemistry & drugs',
  homepage: 'https://www.nlm.nih.gov/research/umls/rxnorm/',
  docs: 'https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html',
  license: 'Public domain (NLM); some source vocabularies need a UMLS licence for full content',
  driver: 'api',
  connection: {
    database: 'https://rxnav.nlm.nih.gov/REST',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'drug',
      description: 'The RxNorm concept(s) for a drug name — normally the ingredient, e.g. aspirin → rxcui 1191',
      params: {
        name: { description: 'Drug or ingredient name, e.g. aspirin' },
        approximate: { description: 'true to fall back to RxNorm\'s spelling-tolerant match when the exact name is unknown' }
      },
      resolve: async (params, ctx) => {
        const exact = await ctx.request('/rxcui.json', { query: { name: params.name, search: 2 } })
        let ids = (exact && exact.idGroup && exact.idGroup.rxnormId) || []
        if (ids.length === 0 && String(params.approximate) === 'true') {
          const approx = await ctx.request('/approximateTerm.json', { query: { term: params.name, maxEntries: 5 } })
          const candidates = (approx && approx.approximateGroup && approx.approximateGroup.candidate) || []
          ids = [...new Set(candidates.filter((c) => c.source === 'RXNORM').map((c) => c.rxcui))]
        }
        const concepts = await Promise.all(ids.slice(0, 10).map((id) => ctx.request(`/rxcui/${encodeURIComponent(id)}/properties.json`)))
        return concepts.map((c) => c && c.properties).filter(Boolean)
      },
      fields: CONCEPT_FIELDS,
      example: { name: 'aspirin' },
      relations: [...BASE_RELATIONS, ...NAME_RELATIONS]
    },
    {
      name: 'concept',
      description: 'One RxNorm concept by RxCUI',
      path: '/rxcui/{rxcui}/properties.json',
      params: {
        rxcui: { description: 'RxNorm concept id, e.g. 1191' }
      },
      rows: 'properties',
      fields: CONCEPT_FIELDS,
      example: { rxcui: '1191' },
      relations: [...BASE_RELATIONS, ...NAME_RELATIONS, PRODUCT_LABELS]
    },
    {
      name: 'products',
      description: 'Clinical and branded drug products containing a named ingredient or brand (one row per product)',
      path: '/drugs.json',
      params: {
        name: { description: 'Ingredient, brand or drug name, e.g. aspirin' },
        tty: { in: 'filter', field: 'tty', description: 'Keep only this term type, e.g. SCD (clinical drug) or SBD (branded drug)' }
      },
      rows: (body) => ((body && body.drugGroup && body.drugGroup.conceptGroup) || [])
        .flatMap((group) => group.conceptProperties || []),
      fields: CONCEPT_FIELDS,
      example: { name: 'imatinib' },
      relations: [...BASE_RELATIONS, PRODUCT_LABELS]
    },
    {
      name: 'related',
      description: 'Concepts related to an RxCUI, restricted to the given term types',
      path: '/rxcui/{rxcui}/related.json',
      params: {
        rxcui: { description: 'RxNorm concept id, e.g. 1191' },
        tty: { default: 'SCD SBD BN', description: 'Space-separated term types to return (default "SCD SBD BN")' }
      },
      rows: (body) => ((body && body.relatedGroup && body.relatedGroup.conceptGroup) || [])
        .flatMap((group) => group.conceptProperties || []),
      fields: CONCEPT_FIELDS,
      example: { rxcui: '1191', tty: 'BN' },
      relations: [
        { alias: 'classes', description: 'Drug classes of the related concept', entity: 'classes', localKey: 'rxcui', foreignKey: 'rxcui', type: 'hasMany' },
        PRODUCT_LABELS
      ]
    },
    {
      name: 'classes',
      description: 'Drug classes an RxNorm concept belongs to, via RxClass (ATC, MeSH pharmacologic action, FDA established pharmacologic class and mechanism of action, …)',
      path: '/rxclass/class/byRxcui.json',
      params: {
        rxcui: { description: 'RxNorm concept id, e.g. 1191' },
        relaSource: { description: 'Restrict to one class source: ATC, MESH, FDASPL, DAILYMED, MEDRT, VA, …' }
      },
      rows: 'rxclassDrugInfoList.rxclassDrugInfo',
      fields: {
        rxcui: 'minConcept.rxcui',
        drugName: 'minConcept.name',
        classId: 'rxclassMinConceptItem.classId',
        className: 'rxclassMinConceptItem.className',
        classType: 'rxclassMinConceptItem.classType',
        relation: (r) => r.rela || null,
        relaSource: 'relaSource'
      },
      example: { rxcui: '1191', relaSource: 'ATC' },
      relations: []
    }
  ]
}
