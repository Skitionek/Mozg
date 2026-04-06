'use strict';

/**
 * PubMed – NCBI biomedical literature database (30+ million citations).
 * Reference: https://pubmed.ncbi.nlm.nih.gov/
 * API docs:  https://www.ncbi.nlm.nih.gov/books/NBK25497/
 *
 * No credentials required. An api_key raises the rate limit to 10 req/sec.
 * All requests must include retmode=json and db=pubmed.
 *
 * Example search: where: { db: "pubmed", term: "cancer immunotherapy", retmode: "json", retmax: "20" }
 * Example fetch:  where: { db: "pubmed", id: "34567890", retmode: "json" }
 *
 * Relationship map:
 *  - /esearch.fcgi  →  /esummary.fcgi  (idlist → id, hasMany)
 *  - /esearch.fcgi  →  /elink.fcgi     (links to related databases, hasMany)
 */
module.exports = {
  name: 'pubmed',
  label: 'PubMed (REST)',
  description: 'NCBI PubMed biomedical literature database with 30+ million citations for biomedical articles from MEDLINE, life science journals and online books. Pass db=pubmed and retmode=json in where params.',
  driver: 'rest',
  connection: {
    database: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  },
  entities: [
    {
      // Use where: { db: "pubmed", term: "…", retmode: "json" }
      name: '/esearch.fcgi',
      columns: ['count', 'retmax', 'retstart', 'idlist', 'translationset', 'querytranslation', 'errorlist'],
      relations: [
        { entity: '/esummary.fcgi', foreignKey: 'idlist', type: 'hasMany', alias: 'articles' },
      ],
    },
    {
      // Use where: { db: "pubmed", id: "<pmid>", retmode: "json" }
      name: '/esummary.fcgi',
      columns: ['result', 'uids'],
      relations: [],
    },
    {
      // Use where: { dbfrom: "pubmed", db: "pmc", id: "<pmid>", retmode: "json" }
      name: '/elink.fcgi',
      columns: ['linksets'],
      relations: [],
    },
  ],
};
