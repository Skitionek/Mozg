'use strict'

/**
 * BioSamples (EMBL-EBI) — descriptions of the biological samples behind
 * sequencing, proteomics, metabolomics and imaging data: organism, tissue,
 * cell type, disease and free-form attributes, many annotated with ontology
 * terms.  Holds every INSDC sample (SAMEA…, SAMN…, SAMD…).
 * API docs: https://www.ebi.ac.uk/biosamples/docs/references/api/overview
 *
 * A sample's attributes ("characteristics") are an open dictionary of
 * name → [{ text, unit, ontologyTerms }].  The common ones are lifted into
 * fields; all of them are kept as `attributes` (name → text).
 */

const characteristic = (...names) => (r) => {
  const c = r.characteristics || {}
  for (const name of names) {
    const values = c[name]
    if (values && values.length) return values.map((v) => v.text).join('; ')
  }
  return null
}

// "http://www.ebi.ac.uk/efo/EFO_0000519" → "EFO:0000519"
const curieFromIri = (iri) => {
  const m = String(iri).match(/([A-Za-z]+)_(\w+)$/)
  return m ? `${m[1].toUpperCase()}:${m[2]}` : null
}

const SAMPLE_FIELDS = {
  accession: 'accession',
  name: 'name',
  taxonId: (r) => (r.taxId == null ? null : Number(r.taxId)),
  organism: characteristic('organism', 'Organism'),
  sex: characteristic('sex', 'Sex', 'gender'),
  tissue: characteristic('tissue', 'organism part', 'Organism Part', 'tissue_type'),
  cellType: characteristic('cell type', 'cell_type', 'Cell Type'),
  cellLine: characteristic('cell line', 'cell_line', 'Cell Line'),
  disease: characteristic('disease', 'Disease', 'disease state'),
  diseaseId: (r) => {
    const values = (r.characteristics || {}).disease || []
    const iri = values.flatMap((v) => v.ontologyTerms || [])[0]
    return iri ? curieFromIri(iri) : null
  },
  attributes: (r) => Object.fromEntries(Object.entries(r.characteristics || {})
    .map(([name, values]) => [name, (values || []).map((v) => (v.unit ? `${v.text} ${v.unit}` : v.text)).join('; ')])),
  sraAccession: 'sraAccession',
  status: 'status',
  released: 'release',
  updated: 'update',
  externalUrls: 'externalReferences[].url'
}

const SAMPLE_RELATIONS = [
  { alias: 'runs', description: 'Sequencing runs of this sample in ENA', catalog: 'ena', entity: 'runs', localKey: 'accession', foreignKey: 'accession', type: 'hasMany' },
  { alias: 'taxonomy', description: 'Taxonomy of the sample organism', catalog: 'uniprot', entity: 'taxonomy', localKey: 'taxonId', foreignKey: 'taxonId', type: 'hasOne' },
  { alias: 'disease', description: 'Open Targets record of the annotated disease', catalog: 'opentargets', entity: 'disease', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasOne' }
]

module.exports = {
  name: 'biosamples',
  label: 'BioSamples',
  description: 'EMBL-EBI registry of the biological samples behind archived omics data: organism, tissue, cell type, disease and free-form attributes, often ontology-annotated. Includes every INSDC (ENA/SRA/DDBJ) sample.',
  category: 'Expression & samples',
  homepage: 'https://www.ebi.ac.uk/biosamples/',
  docs: 'https://www.ebi.ac.uk/biosamples/docs/references/api/overview',
  license: 'Open; submitters\' terms may apply to individual records',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/biosamples',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 4 },
  entities: [
    {
      name: 'sample',
      description: 'One sample by BioSamples accession',
      path: '/samples/{accession}',
      params: {
        accession: { description: 'BioSamples accession, e.g. SAMEA2591098 or SAMN… / SAMD…' }
      },
      fields: SAMPLE_FIELDS,
      example: { accession: 'SAMD00005163' },
      relations: SAMPLE_RELATIONS
    },
    {
      name: 'samples',
      description: 'Samples matching free text, optionally for one organism',
      path: '/samples',
      params: {
        text: { description: 'Free text matched against all sample attributes, e.g. glioblastoma' },
        organism: { name: 'filter', transform: 'attr:organism:{value}', description: 'Organism name, e.g. Homo sapiens' }
      },
      rows: '_embedded.samples',
      fields: SAMPLE_FIELDS,
      paginate: { limit: 'size', page: 'page', pageBase: 0, max: 200 },
      example: { text: 'glioblastoma', organism: 'Homo sapiens' },
      relations: SAMPLE_RELATIONS
    }
  ]
}
