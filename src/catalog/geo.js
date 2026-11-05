'use strict'

/**
 * GEO — NCBI Gene Expression Omnibus: functional genomics datasets (series,
 * curated datasets, platforms and samples), via NCBI E-utilities (db=gds).
 * API docs: https://www.ncbi.nlm.nih.gov/geo/info/geo_paccess.html
 *
 * Shares NCBI's rate limit (3 req/s, 10 with apiKeys: { geo: "…" }).
 */

const { eutils } = require('./ncbi')

const { EUTILS, esearch, esummary } = eutils

const prefixed = (prefix, value) => (value ? `${prefix}${value}` : null)

const DATASET_FIELDS = {
  accession: 'accession',
  title: 'title',
  summary: 'summary',
  organism: 'taxon',
  type: 'gdstype',
  entryType: 'entrytype',
  platform: (r) => prefixed('GPL', String(r.gpl || '').split(';')[0]),
  series: (r) => prefixed('GSE', String(r.gse || '').split(';')[0]),
  sampleCount: 'n_samples',
  publicationDate: 'pdat',
  pmids: (r) => (r.pubmedids || []).map(String),
  bioproject: 'bioproject',
  supplementaryFiles: 'suppfile',
  ftpLink: 'ftplink'
}

const DATASET_RELATIONS = [
  { alias: 'publications', description: 'PubMed citations describing this dataset', catalog: 'pubmed', entity: 'article', localKey: 'pmids', foreignKey: 'pmid', type: 'hasMany' }
]

module.exports = {
  name: 'geo',
  label: 'GEO – Gene Expression Omnibus',
  description: 'NCBI Gene Expression Omnibus: microarray and sequencing-based functional genomics series (GSE), curated datasets (GDS), platforms and samples, searchable with Entrez query syntax and linked to their publications.',
  category: 'Expression & samples',
  homepage: 'https://www.ncbi.nlm.nih.gov/geo/',
  docs: 'https://www.ncbi.nlm.nih.gov/geo/info/geo_paccess.html',
  license: 'Free to use; submitters may hold rights to some data (NCBI policy)',
  driver: 'api',
  ...EUTILS,
  entities: [
    {
      name: 'datasets',
      description: 'GEO records (series, datasets, platforms, samples) matching a query',
      params: {
        term: { required: true, description: 'Entrez GDS query, e.g. "TP53 AND gse[ETYP] AND Homo sapiens[ORGN]" — https://www.ncbi.nlm.nih.gov/geo/info/qqtutorial.html' },
        entryType: { description: 'Restrict to gse, gds, gpl or gsm' }
      },
      resolve: async (params, ctx) => {
        const term = params.entryType ? `(${params.term}) AND ${params.entryType}[ETYP]` : params.term
        return esummary(ctx, 'gds', await esearch(ctx, 'gds', term))
      },
      fields: DATASET_FIELDS,
      example: { term: 'TP53 AND Homo sapiens[ORGN]', entryType: 'gse' },
      relations: DATASET_RELATIONS
    },
    {
      name: 'dataset',
      description: 'One GEO record by accession (GSE, GDS, GPL or GSM)',
      params: {
        accession: { required: true, description: 'GEO accession, e.g. GSE2034' }
      },
      resolve: async (params, ctx) => {
        // An accession search also matches the record's samples and platforms;
        // keep only the record that carries the accession itself.
        const wantedAccession = String(params.accession).toUpperCase()
        const ids = await esearch(ctx, 'gds', `${wantedAccession}[ACCN]`, { retmax: 50 })
        return (await esummary(ctx, 'gds', ids)).filter((doc) => String(doc.accession).toUpperCase() === wantedAccession)
      },
      fields: DATASET_FIELDS,
      example: { accession: 'GSE2034' },
      relations: DATASET_RELATIONS
    }
  ]
}
