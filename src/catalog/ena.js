'use strict'

/**
 * ENA — the European Nucleotide Archive (EMBL-EBI): raw sequencing reads,
 * assemblies and annotated sequences, organised into studies (projects),
 * samples, experiments and runs.  Part of the INSDC with GenBank and DDBJ, so
 * SRA/DRA accessions (SRR…, DRR…) resolve here too.
 * API docs: https://www.ebi.ac.uk/ena/portal/api/doc
 *
 * The Portal API answers `result=<type>&query=<filter>&fields=<list>`; every
 * entity below fixes the result type and field list and builds the filter
 * from named parameters.  Without a limit ENA returns every match, so search
 * entities default to 100 rows; pass `limit` for more.
 */

// ENA filter values are double-quoted; a quote inside one would end it early.
const quoted = (value) => `"${String(value).replace(/"/g, '')}"`
const blankToNull = (key) => (r) => (r[key] === '' || r[key] == null ? null : r[key])
const number = (key) => (r) => (r[key] === '' || r[key] == null ? null : Number(r[key]))

const DEFAULT_LIMIT = 100

const STUDY_FIELDS = {
  studyAccession: 'study_accession',
  secondaryStudyAccession: blankToNull('secondary_study_accession'),
  title: 'study_title',
  description: blankToNull('study_description'),
  taxonId: number('tax_id'),
  organism: blankToNull('scientific_name'),
  center: blankToNull('center_name'),
  geoAccession: blankToNull('geo_accession'),
  firstPublic: 'first_public'
}
const STUDY_RETURN = 'study_accession,secondary_study_accession,study_title,study_description,tax_id,scientific_name,center_name,geo_accession,first_public'

const STUDY_RELATIONS = [
  { alias: 'runs', description: 'Sequencing runs deposited under this study', entity: 'runs', localKey: 'studyAccession', foreignKey: 'accession', type: 'hasMany' },
  { alias: 'taxonomy', description: 'Taxonomy of the study organism', catalog: 'uniprot', entity: 'taxonomy', obo: 'ncbitaxon', type: 'hasOne' }
]

const RUN_FIELDS = {
  runAccession: 'run_accession',
  experimentAccession: 'experiment_accession',
  sampleAccession: 'sample_accession',
  studyAccession: 'study_accession',
  taxonId: number('tax_id'),
  organism: 'scientific_name',
  platform: 'instrument_platform',
  instrument: 'instrument_model',
  libraryStrategy: 'library_strategy',
  librarySource: 'library_source',
  libraryLayout: 'library_layout',
  readCount: number('read_count'),
  baseCount: number('base_count'),
  fastqFtp: (r) => (r.fastq_ftp ? String(r.fastq_ftp).split(';').filter(Boolean) : []),
  firstPublic: 'first_public'
}
const RUN_RETURN = 'run_accession,experiment_accession,sample_accession,study_accession,tax_id,scientific_name,instrument_platform,instrument_model,library_strategy,library_source,library_layout,read_count,base_count,fastq_ftp,first_public'

module.exports = {
  name: 'ena',
  label: 'ENA – European Nucleotide Archive',
  description: 'EMBL-EBI archive of raw sequencing reads, assemblies and annotated nucleotide sequences, organised as studies, samples, experiments and runs (INSDC member, mirrors SRA/DDBJ).',
  category: 'Genes & genomes',
  homepage: 'https://www.ebi.ac.uk/ena/browser/',
  docs: 'https://www.ebi.ac.uk/ena/portal/api/doc',
  license: 'Open (INSDC policy: no restrictions on use)',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/ena/portal/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  query: { format: 'json' },
  entities: [
    {
      name: 'study',
      obo: { studyAccession: 'bioproject' },
      description: 'One study (project) by accession — primary (PRJEB…, PRJNA…) or secondary (ERP…, SRP…)',
      path: '/search',
      params: {
        studyAccession: { description: 'Study accession, e.g. PRJEB1787 or ERP001736' }
      },
      query: (p) => ({
        result: 'study',
        fields: STUDY_RETURN,
        query: `study_accession=${quoted(p.studyAccession)} OR secondary_study_accession=${quoted(p.studyAccession)}`
      }),
      fields: STUDY_FIELDS,
      example: { studyAccession: 'PRJEB1787' },
      relations: STUDY_RELATIONS
    },
    {
      name: 'studies',
      obo: { studyAccession: 'bioproject' },
      description: 'Studies for an organism (including its sub-taxa) and/or with a title matching a word',
      path: '/search',
      params: {
        taxonId: { description: 'NCBI taxonomy id; includes descendant taxa, e.g. 9606' },
        title: { description: 'Word or phrase in the study title, e.g. glioblastoma' },
        query: { description: 'Raw ENA filter, ANDed with the above — https://www.ebi.ac.uk/ena/browser/advanced-search' }
      },
      query: (p) => {
        const terms = []
        if (p.taxonId) terms.push(`tax_tree(${Number(p.taxonId)})`)
        if (p.title) terms.push(`study_title=${quoted(`*${p.title}*`)}`)
        if (p.query) terms.push(`(${p.query})`)
        if (terms.length === 0) throw new Error('ena/studies needs taxonId, title or query')
        return { result: 'study', fields: STUDY_RETURN, query: terms.join(' AND '), limit: DEFAULT_LIMIT }
      },
      fields: STUDY_FIELDS,
      paginate: { limit: 'limit', offset: 'offset' },
      example: { taxonId: 9606, title: 'glioblastoma' },
      relations: STUDY_RELATIONS
    },
    {
      name: 'runs',
      obo: { studyAccession: 'bioproject', sampleAccession: 'biosample' },
      description: 'Sequencing runs under a study, sample, experiment or run accession, with read counts and FASTQ locations',
      path: '/filereport',
      params: {
        accession: { description: 'Study, sample, experiment or run accession, e.g. PRJEB1787, SAMEA2591098, ERR164408' }
      },
      query: (p) => ({ accession: p.accession, result: 'read_run', fields: RUN_RETURN, limit: DEFAULT_LIMIT }),
      fields: RUN_FIELDS,
      paginate: { limit: 'limit', offset: 'offset' },
      example: { accession: 'SAMEA2591098' },
      relations: [
        { alias: 'sample', description: 'The BioSamples record of the sequenced sample', catalog: 'biosamples', entity: 'sample', obo: 'biosample', type: 'hasOne' },
        { alias: 'study', description: 'The study the run belongs to', entity: 'study', obo: 'bioproject', type: 'hasOne' },
        { alias: 'taxonomy', description: 'Taxonomy of the sequenced organism', catalog: 'uniprot', entity: 'taxonomy', obo: 'ncbitaxon', type: 'hasOne' }
      ]
    },
    {
      name: 'sequence',
      obo: { studyAccession: 'bioproject', sampleAccession: 'biosample' },
      description: 'One annotated nucleotide sequence (EMBL/GenBank/DDBJ record) by accession',
      path: '/search',
      params: {
        accession: { description: 'Sequence accession, e.g. MN908947 (SARS-CoV-2 Wuhan-Hu-1)' }
      },
      query: (p) => ({
        result: 'sequence',
        fields: 'accession,description,tax_id,scientific_name,base_count,mol_type,topology,study_accession,sample_accession,first_public,last_updated',
        query: `accession=${quoted(String(p.accession).replace(/\.\d+$/, ''))}`
      }),
      fields: {
        accession: 'accession',
        description: 'description',
        taxonId: number('tax_id'),
        organism: 'scientific_name',
        length: number('base_count'),
        moleculeType: 'mol_type',
        topology: 'topology',
        studyAccession: blankToNull('study_accession'),
        sampleAccession: blankToNull('sample_accession'),
        firstPublic: 'first_public',
        lastUpdated: 'last_updated'
      },
      example: { accession: 'MN908947' },
      relations: [
        { alias: 'taxonomy', description: 'Taxonomy of the source organism', catalog: 'uniprot', entity: 'taxonomy', obo: 'ncbitaxon', type: 'hasOne' },
        { alias: 'genbank', description: 'The same record in NCBI GenBank', catalog: 'genbank', entity: 'sequence', localKey: 'accession', foreignKey: 'accession', type: 'hasOne' },
        { alias: 'sample', description: 'The BioSamples record of the source sample', catalog: 'biosamples', entity: 'sample', obo: 'biosample', type: 'hasOne' },
        { alias: 'study', description: 'The study the sequence was submitted under', entity: 'study', obo: 'bioproject', type: 'hasOne' }
      ]
    }
  ]
}
