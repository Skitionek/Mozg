'use strict'

/**
 * PRIDE Archive — the ProteomeXchange repository for mass-spectrometry
 * proteomics datasets.
 * API docs: https://www.ebi.ac.uk/pride/ws/archive/v3/webjars/swagger-ui/index.html
 *
 * Search results and project records describe the same dataset in two
 * shapes: search flattens controlled-vocabulary terms to plain names, while
 * the project record keeps them as { accession, name } objects.  Both are
 * mapped to plain name lists here.
 */

const upper = (v) => (v == null ? v : String(v).toUpperCase())

// A list of CV params or of plain strings → plain names.
const names = (path) => (r) => {
  const list = r[path]
  if (!Array.isArray(list)) return []
  return list.map((x) => (x && typeof x === 'object' ? x.name || x.value : x)).filter(Boolean)
}

const people = (path) => (r) => {
  const list = r[path]
  if (!Array.isArray(list)) return []
  return list.map((p) => (p && typeof p === 'object' ? [p.firstName, p.lastName].filter(Boolean).join(' ') : p)).filter(Boolean)
}

const PROJECT_FIELDS = {
  projectAccession: 'accession',
  title: 'title',
  description: 'projectDescription',
  keywords: 'keywords',
  organisms: names('organisms'),
  organismParts: (r) => names('organismParts')(r).concat(names('organismsPart')(r)),
  diseases: names('diseases'),
  instruments: names('instruments'),
  experimentTypes: names('experimentTypes'),
  quantificationMethods: names('quantificationMethods'),
  submitters: people('submitters'),
  labPIs: people('labPIs'),
  submissionType: 'submissionType',
  submissionDate: 'submissionDate',
  publicationDate: 'publicationDate',
  doi: (r) => r.doi || null,
  pmids: (r) => (r.references || []).map((ref) => ref && ref.pubmedID).filter(Boolean).map(String),
  pmid: (r) => {
    const ref = (r.references || []).find((x) => x && x.pubmedID)
    return ref ? String(ref.pubmedID) : null
  }
}

const PROJECT_RELATIONS = [
  { alias: 'files', description: 'Files deposited with the dataset', entity: 'files', obo: 'pride.project', type: 'hasMany' },
  { alias: 'publication', description: 'The dataset\'s first referenced publication', catalog: 'europepmc', entity: 'article', obo: 'pubmed', type: 'hasOne' }
]

module.exports = {
  name: 'pride',
  label: 'PRIDE Archive',
  description: 'PRIDE Archive, the largest ProteomeXchange repository: public mass-spectrometry proteomics datasets with their organisms, tissues, diseases, instruments, publications and files.',
  category: 'Expression & samples',
  homepage: 'https://www.ebi.ac.uk/pride/',
  docs: 'https://www.ebi.ac.uk/pride/ws/archive/v3/webjars/swagger-ui/index.html',
  license: 'EMBL-EBI terms of use; datasets carry their own licences',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/pride/ws/archive/v3',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 4, maxConcurrent: 2 },
  timeoutMs: 45_000,
  entities: [
    {
      name: 'projects',
      obo: { projectAccession: 'pride.project' },
      description: 'Datasets matching a keyword (gene, protein, disease, tissue, technique…), newest first',
      path: '/search/projects',
      params: {
        keyword: { description: 'Search text, e.g. TP53 or phosphoproteomics' },
        sortField: { description: 'Field to sort by on the server, e.g. submissionDate (default) or downloadCount' }
      },
      query: (params) => ({ keyword: params.keyword, sortFields: params.sortField, pageSize: 25, page: 0 }),
      fields: PROJECT_FIELDS,
      paginate: { limit: 'pageSize', page: 'page', pageBase: 0, max: 100 },
      example: { keyword: 'TP53' },
      relations: PROJECT_RELATIONS
    },
    {
      name: 'project',
      obo: { projectAccession: 'pride.project' },
      description: 'One PRIDE / ProteomeXchange dataset',
      path: '/projects/{projectAccession}',
      params: {
        projectAccession: { description: 'ProteomeXchange accession, e.g. PXD000001', transform: upper }
      },
      fields: PROJECT_FIELDS,
      example: { projectAccession: 'PXD000001' },
      relations: PROJECT_RELATIONS
    },
    {
      name: 'files',
      obo: { projectAccession: 'pride.project' },
      description: 'Files of a dataset (raw, peak lists, results, search engine output) with download locations',
      path: '/projects/{projectAccession}/files',
      params: {
        projectAccession: { description: 'ProteomeXchange accession, e.g. PXD000001', transform: upper }
      },
      query: { pageSize: 100, page: 0 },
      fields: {
        projectAccession: 'projectAccessions[0]',
        fileName: 'fileName',
        category: 'fileCategory.value',
        sizeBytes: 'fileSizeBytes',
        ftpUrl: (r) => {
          const loc = (r.publicFileLocations || []).find((l) => /ftp/i.test(l.name))
          return loc ? loc.value : null
        },
        asperaUrl: (r) => {
          const loc = (r.publicFileLocations || []).find((l) => /aspera/i.test(l.name))
          return loc ? loc.value : null
        },
        publicationDate: (r) => (r.publicationDate ? String(r.publicationDate).slice(0, 10) : null),
        downloads: 'totalDownloads'
      },
      paginate: { limit: 'pageSize', page: 'page', pageBase: 0, max: 100 },
      example: { projectAccession: 'PXD000001' },
      relations: []
    }
  ]
}
