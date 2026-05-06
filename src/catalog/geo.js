'use strict'

/**
 * GEO – NCBI Gene Expression Omnibus.
 * Reference: https://www.ncbi.nlm.nih.gov/geo/
 * API docs:  https://www.ncbi.nlm.nih.gov/books/NBK25497/
 *
 * No credentials required. An api_key raises the rate limit to 10 req/sec.
 * Uses NCBI E-utilities with db=gds (GEO DataSets) or db=geo (GEO Profiles).
 * All requests should include retmode=json.
 *
 * GEO accession formats:
 *  - GSE123456  – GEO Series (experiment)
 *  - GSM123456  – GEO Sample
 *  - GDS123456  – GEO DataSet (curated)
 *  - GPL123456  – GEO Platform
 *
 * Example search: where: { db: "gds", term: "breast cancer", retmode: "json", retmax: "20" }
 * Example fetch:  where: { db: "gds", id: "200000001", retmode: "json" }
 *
 * Relationship map:
 *  - /esearch.fcgi  →  /esummary.fcgi  (idlist → id, hasMany)
 */
module.exports = {
  name: 'geo',
  label: 'GEO – Gene Expression Omnibus (REST)',
  description: 'NCBI Gene Expression Omnibus — public repository of high-throughput functional genomic data (microarray, RNA-seq, ChIP-seq). Use db=gds and retmode=json in where params. Accessions: GSE (series), GSM (sample), GDS (dataset), GPL (platform).',
  driver: 'rest',
  connection: {
    database: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
  },
  entities: [
    {
      // Use where: { db: "gds", term: "…", retmode: "json" }
      name: '/esearch.fcgi',
      columns: ['count', 'retmax', 'retstart', 'idlist', 'translationset', 'querytranslation'],
      relations: [
        { entity: '/esummary.fcgi', foreignKey: 'idlist', type: 'hasMany', alias: 'datasets' }
      ]
    },
    {
      // Use where: { db: "gds", id: "<uid>", retmode: "json" }
      name: '/esummary.fcgi',
      columns: ['result', 'uids'],
      relations: [
        { entity: '/esearch.fcgi', foreignKey: 'pubmed_id', type: 'hasOne', alias: 'pubmedArticle', catalog: 'pubmed' }
      ]
    },
    {
      // Use where: { dbfrom: "gds", db: "sra", id: "<uid>", retmode: "json" }
      name: '/elink.fcgi',
      columns: ['linksets'],
      relations: []
    }
  ]
}
