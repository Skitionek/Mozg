'use strict'

/**
 * ClinicalTrials.gov — the U.S. National Library of Medicine registry of
 * clinical studies worldwide (500k+ studies).
 * API docs: https://clinicaltrials.gov/data-api/api
 *
 * Only the record sections the fields below use are requested; pass
 * `raw: true` to see them unmapped.
 */

// Sections requested from the API (a full record, with results, can run to megabytes).
const SECTIONS = [
  'protocolSection.identificationModule',
  'protocolSection.statusModule',
  'protocolSection.sponsorCollaboratorsModule.leadSponsor',
  'protocolSection.descriptionModule.briefSummary',
  'protocolSection.conditionsModule',
  'protocolSection.designModule',
  'protocolSection.armsInterventionsModule.interventions',
  'protocolSection.referencesModule.references',
  'protocolSection.contactsLocationsModule.locations.country',
  'derivedSection.conditionBrowseModule.meshes',
  'derivedSection.interventionBrowseModule.meshes',
  'hasResults'
].join(',')

const unique = (values) => [...new Set((values || []).filter((v) => v != null && v !== ''))]

const STUDY_FIELDS = {
  nctId: 'protocolSection.identificationModule.nctId',
  title: 'protocolSection.identificationModule.briefTitle',
  officialTitle: 'protocolSection.identificationModule.officialTitle',
  acronym: 'protocolSection.identificationModule.acronym',
  status: 'protocolSection.statusModule.overallStatus',
  whyStopped: 'protocolSection.statusModule.whyStopped',
  studyType: 'protocolSection.designModule.studyType',
  phases: 'protocolSection.designModule.phases',
  enrollment: 'protocolSection.designModule.enrollmentInfo.count',
  startDate: 'protocolSection.statusModule.startDateStruct.date',
  primaryCompletionDate: 'protocolSection.statusModule.primaryCompletionDateStruct.date',
  completionDate: 'protocolSection.statusModule.completionDateStruct.date',
  lastUpdated: 'protocolSection.statusModule.lastUpdatePostDateStruct.date',
  conditions: 'protocolSection.conditionsModule.conditions',
  conditionMeshIds: 'derivedSection.conditionBrowseModule.meshes[].id',
  interventions: (r) => unique(((r.protocolSection && r.protocolSection.armsInterventionsModule && r.protocolSection.armsInterventionsModule.interventions) || []).map((i) => i.name)),
  interventionTypes: (r) => unique(((r.protocolSection && r.protocolSection.armsInterventionsModule && r.protocolSection.armsInterventionsModule.interventions) || []).map((i) => i.type)),
  interventionMeshIds: 'derivedSection.interventionBrowseModule.meshes[].id',
  sponsor: 'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
  sponsorClass: 'protocolSection.sponsorCollaboratorsModule.leadSponsor.class',
  summary: 'protocolSection.descriptionModule.briefSummary',
  countries: (r) => unique(((r.protocolSection && r.protocolSection.contactsLocationsModule && r.protocolSection.contactsLocationsModule.locations) || []).map((l) => l.country)),
  pmids: (r) => unique(((r.protocolSection && r.protocolSection.referencesModule && r.protocolSection.referencesModule.references) || []).map((ref) => ref.pmid)),
  hasResults: 'hasResults',
  url: (r) => {
    const id = r.protocolSection && r.protocolSection.identificationModule && r.protocolSection.identificationModule.nctId
    return id ? `https://clinicaltrials.gov/study/${id}` : null
  }
}

const STUDY_RELATIONS = [
  { alias: 'publications', description: 'Europe PMC articles that mention this trial id', catalog: 'europepmc', entity: 'articles', localKey: 'nctId', foreignKey: 'query', type: 'hasMany' }
]

module.exports = {
  name: 'clinicaltrials',
  label: 'ClinicalTrials.gov',
  description: 'Registry of 500k+ clinical studies worldwide: conditions, interventions, phase, status, enrolment, sponsors, locations and linked publications.',
  category: 'Clinical',
  homepage: 'https://clinicaltrials.gov',
  docs: 'https://clinicaltrials.gov/data-api/api',
  license: 'Public domain (U.S. NLM); see https://clinicaltrials.gov/about-site/terms-conditions',
  driver: 'api',
  connection: {
    database: 'https://clinicaltrials.gov/api/v2',
    headers: { Accept: 'application/json' }
  },
  // NLM asks for no more than ~50 requests per minute per client.
  rateLimit: { requestsPerSecond: 0.8, maxConcurrent: 2 },
  entities: [
    {
      name: 'studies',
      description: 'Studies matching a condition, intervention and/or free text, most relevant first',
      path: '/studies',
      params: {
        condition: { name: 'query.cond', description: 'Condition or disease, e.g. breast cancer' },
        intervention: { name: 'query.intr', description: 'Intervention or treatment, e.g. trastuzumab' },
        term: { name: 'query.term', description: 'Free text across the record, e.g. TP53' },
        sponsor: { name: 'query.spons', description: 'Sponsor or collaborator name' },
        status: { name: 'filter.overallStatus', description: 'Comma-separated statuses, e.g. RECRUITING,ACTIVE_NOT_RECRUITING' }
      },
      query: (p) => {
        if (!p.condition && !p.intervention && !p.term && !p.sponsor) {
          throw new Error('clinicaltrials/studies needs at least one of condition, intervention, term or sponsor')
        }
        return {
          fields: SECTIONS,
          'query.cond': p.condition,
          'query.intr': p.intervention,
          'query.term': p.term,
          'query.spons': p.sponsor,
          'filter.overallStatus': p.status,
          countTotal: 'false'
        }
      },
      rows: 'studies',
      fields: STUDY_FIELDS,
      // Cursor-paginated (pageToken): no offset, so Mozg fetches offset + limit and trims.
      paginate: { limit: 'pageSize', max: 1000 },
      example: { condition: 'breast cancer', intervention: 'trastuzumab' },
      relations: STUDY_RELATIONS
    },
    {
      name: 'study',
      description: 'One study by NCT id',
      path: '/studies/{nctId}',
      params: {
        nctId: { description: 'ClinicalTrials.gov id, e.g. NCT04267848' }
      },
      query: { fields: SECTIONS },
      fields: STUDY_FIELDS,
      example: { nctId: 'NCT04267848' },
      relations: STUDY_RELATIONS
    }
  ]
}
