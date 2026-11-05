'use strict'

/**
 * openFDA — the US Food and Drug Administration's open data: structured
 * product labels (SPL), adverse event reports (FAERS) and recalls.
 * API docs: https://open.fda.gov/apis/
 *
 * No key needed for up to 240 requests/minute and 1 000/day per IP; a free
 * key (https://open.fda.gov/apis/authentication/) raises that to 120 000/day.
 * openFDA answers 404 when a search matches nothing, which reads as no rows.
 *
 * FDA's own disclaimer applies: reports are unvalidated, and an adverse event
 * report does not establish that the drug caused the event.
 */

// openFDA returns a single result unless asked for more; these defaults apply
// when the caller gives no limit (an explicit limit always wins).
const DEFAULT_LABELS = 10
const DEFAULT_REPORTS = 25

// openFDA search syntax: field:"value".  Quotes inside the value would end
// the phrase early, so they are dropped.
const phrase = (value) => `"${String(value).replace(/"/g, '')}"`
const first = (path) => `${path}[0]`
const text = (key) => (r) => (Array.isArray(r[key]) ? r[key].join('\n') : (r[key] || null))

const LABEL_FIELDS = {
  setId: 'set_id',
  splId: 'id',
  effectiveTime: 'effective_time',
  brandName: first('openfda.brand_name'),
  genericName: first('openfda.generic_name'),
  manufacturer: first('openfda.manufacturer_name'),
  productType: first('openfda.product_type'),
  routes: 'openfda.route',
  substances: 'openfda.substance_name',
  rxcui: first('openfda.rxcui'),
  rxcuis: 'openfda.rxcui',
  pharmacologicClasses: 'openfda.pharm_class_epc',
  mechanisms: 'openfda.pharm_class_moa',
  boxedWarning: text('boxed_warning'),
  indications: text('indications_and_usage'),
  contraindications: text('contraindications'),
  warnings: text('warnings_and_cautions'),
  adverseReactions: text('adverse_reactions'),
  dosage: text('dosage_and_administration')
}

const LABEL_RELATIONS = [
  { alias: 'rxnorm', description: 'The RxNorm concept of this product', catalog: 'rxnorm', entity: 'concept', localKey: 'rxcui', foreignKey: 'rxcui', type: 'hasOne' },
  { alias: 'adverseEvents', description: 'Most frequently reported adverse reactions for this generic name (FAERS)', entity: 'adverseEventCounts', localKey: 'genericName', foreignKey: 'drugName', type: 'hasMany' },
  { alias: 'chembl', description: 'ChEMBL compounds matching the generic name', catalog: 'chembl', entity: 'molecules', localKey: 'genericName', foreignKey: 'name', type: 'hasMany' }
]

const PAGINATE = { limit: 'limit', offset: 'skip', max: 1000 }

module.exports = {
  name: 'openfda',
  label: 'openFDA',
  description: 'US FDA open data: structured drug labels (indications, boxed warnings, adverse reactions), adverse event reports from FAERS, and drug recalls.',
  category: 'Chemistry & drugs',
  homepage: 'https://open.fda.gov',
  docs: 'https://open.fda.gov/apis/',
  license: 'CC0 1.0 (public domain); see https://open.fda.gov/terms/',
  driver: 'api',
  connection: {
    database: 'https://api.fda.gov',
    headers: { Accept: 'application/json' }
  },
  auth: { param: 'api_key', required: false, signup: 'https://open.fda.gov/apis/authentication/' },
  rateLimit: { requestsPerSecond: 3, maxConcurrent: 2 },
  rateLimitWithKey: { requestsPerSecond: 4, maxConcurrent: 4 },
  entities: [
    {
      name: 'labels',
      description: 'FDA structured product labels for a drug, by generic or brand name',
      path: '/drug/label.json',
      params: {
        genericName: { description: 'Generic (non-proprietary) name, e.g. imatinib' },
        brandName: { description: 'Brand name, e.g. Gleevec' }
      },
      query: (p) => {
        const terms = []
        if (p.genericName) terms.push(`openfda.generic_name:${phrase(p.genericName)}`)
        if (p.brandName) terms.push(`openfda.brand_name:${phrase(p.brandName)}`)
        if (terms.length === 0) throw new Error('openfda/labels needs genericName or brandName')
        return { search: terms.join(' AND '), limit: DEFAULT_LABELS }
      },
      rows: 'results',
      fields: LABEL_FIELDS,
      paginate: PAGINATE,
      example: { genericName: 'imatinib' },
      relations: LABEL_RELATIONS
    },
    {
      name: 'labelsForRxcui',
      description: 'FDA structured product labels listing an RxNorm concept',
      path: '/drug/label.json',
      params: {
        rxcui: { name: 'search', transform: 'openfda.rxcui:"{value}"', description: 'RxNorm product concept id, e.g. 403878 (imatinib 100 MG Oral Tablet)' }
      },
      query: { limit: DEFAULT_LABELS },
      rows: 'results',
      fields: LABEL_FIELDS,
      paginate: PAGINATE,
      example: { rxcui: '403878' },
      relations: LABEL_RELATIONS
    },
    {
      name: 'adverseEvents',
      description: 'Individual adverse event reports (FAERS) that list a drug as suspect or concomitant',
      path: '/drug/event.json',
      params: {
        drugName: { description: 'Drug name as reported or as normalized by openFDA, e.g. imatinib' },
        serious: { description: 'true for serious reports only' }
      },
      query: (p) => {
        if (!p.drugName) throw new Error('openfda/adverseEvents needs drugName')
        const name = phrase(p.drugName)
        let search = `(patient.drug.openfda.generic_name:${name} OR patient.drug.medicinalproduct:${name})`
        if (p.serious != null) search += ` AND serious:${String(p.serious) === 'true' ? 1 : 2}`
        return { search, limit: DEFAULT_REPORTS }
      },
      rows: 'results',
      fields: {
        safetyReportId: 'safetyreportid',
        receiveDate: 'receivedate',
        serious: (r) => (r.serious == null ? null : String(r.serious) === '1'),
        death: (r) => String(r.seriousnessdeath) === '1',
        country: 'occurcountry|primarysourcecountry',
        reporterQualification: 'primarysource.qualification',
        patientSex: (r) => ({ 1: 'male', 2: 'female' }[r.patient && r.patient.patientsex] || null),
        patientAge: (r) => (r.patient && r.patient.patientonsetage != null ? Number(r.patient.patientonsetage) : null),
        reactions: 'patient.reaction[].reactionmeddrapt',
        drugs: 'patient.drug[].medicinalproduct'
      },
      paginate: PAGINATE,
      example: { drugName: 'imatinib' },
      relations: []
    },
    {
      name: 'adverseEventCounts',
      description: 'Reported adverse reactions for a drug, most frequent first (FAERS counts by MedDRA preferred term)',
      path: '/drug/event.json',
      params: {
        drugName: { name: 'search', transform: (v) => `patient.drug.openfda.generic_name:${phrase(v)}`, description: 'Generic drug name, e.g. imatinib' }
      },
      query: { count: 'patient.reaction.reactionmeddrapt.exact' },
      rows: 'results',
      fields: {
        reaction: 'term',
        count: 'count'
      },
      paginate: { limit: 'limit', max: 1000 },
      example: { drugName: 'imatinib' },
      relations: []
    },
    {
      name: 'recalls',
      description: 'Drug recall enforcement reports whose product description mentions a term',
      path: '/drug/enforcement.json',
      params: {
        product: { name: 'search', transform: (v) => `product_description:${phrase(v)}`, description: 'Word or phrase in the product description, e.g. metformin' }
      },
      query: { limit: DEFAULT_REPORTS },
      rows: 'results',
      fields: {
        recallNumber: 'recall_number',
        status: 'status',
        classification: 'classification',
        reason: 'reason_for_recall',
        product: 'product_description',
        firm: 'recalling_firm',
        initiationDate: 'recall_initiation_date',
        reportDate: 'report_date',
        distribution: 'distribution_pattern',
        country: 'country'
      },
      paginate: PAGINATE,
      example: { product: 'metformin' },
      relations: []
    }
  ]
}
