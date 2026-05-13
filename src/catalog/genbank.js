'use strict'

/**
 * GenBank – NCBI annotated nucleotide sequence database.
 * Reference: https://www.ncbi.nlm.nih.gov/genbank/
 * API docs:  https://www.ncbi.nlm.nih.gov/books/NBK25497/
 *
 * No credentials required. Pass an api_key for higher rate limits.
 * All requests must include retmode=json.
 * Pass db=nuccore in where to target the nucleotide sequence database.
 *
 * Sequence accession format: AB123456, NM_001234, NC_000001, etc.
 *
 * Example search: where: { db: "nuccore", term: "BRCA1[Gene Name] AND Homo sapiens[Organism]", retmode: "json" }
 * Example fetch:  where: { db: "nuccore", id: "NG_005905", retmode: "json" }
 *
 * Relationship map:
 *  - /esearch.fcgi  →  /esummary.fcgi  (idlist → id, hasMany)
 *  - /esummary.fcgi →  /elink.fcgi     (UID  → id, hasMany cross-refs)
 */
module.exports = {
  name: 'genbank',
  label: 'GenBank (REST)',
  description: 'NCBI GenBank nucleotide sequence database. Search and retrieve annotated DNA/RNA sequences. Use db=nuccore in where params. Accessions follow the format AB123456 or NM_001234.',
  driver: 'rest',
  connection: {
    database: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
  },
  entities: [
    {
      // Use where: { db: "nuccore", term: "…", retmode: "json" }
      name: '/esearch.fcgi',
      columns: ['count', 'retmax', 'retstart', 'idlist', 'translationset', 'querytranslation'],
      relations: [
        { entity: '/esummary.fcgi', foreignKey: 'idlist', type: 'hasMany', alias: 'summaries' },
        { entity: '/search', foreignKey: 'idlist', type: 'hasMany', alias: 'emblSequences', catalog: 'embl-ebi' },
        { entity: '/search/sequence', foreignKey: 'idlist', type: 'hasMany', alias: 'ddbjSequences', catalog: 'ddbj' }
      ]
    },
    {
      // Use where: { db: "nuccore", id: "<uid>", retmode: "json" }
      name: '/esummary.fcgi',
      columns: ['result', 'uids'],
      relations: []
    },
    {
      // Use where: { dbfrom: "nuccore", db: "pubmed", id: "<uid>", retmode: "json" }
      name: '/elink.fcgi',
      columns: ['linksets'],
      relations: []
    }
  ]
}
