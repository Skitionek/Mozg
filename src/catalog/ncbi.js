'use strict';

/**
 * NCBI E-utilities – programmatic access to all NCBI databases.
 * Reference: https://www.ncbi.nlm.nih.gov/books/NBK25497/
 *
 * No credentials required for basic access. Use api_key for higher rate limits
 * (10 req/sec vs 3 req/sec). Register at https://www.ncbi.nlm.nih.gov/account/.
 *
 * All endpoints require retmode=json to receive JSON responses.
 * The `db` where parameter selects the NCBI database (e.g. pubmed, nuccore,
 * protein, gene, gds, sra, taxonomy, …).
 *
 * Key where parameters:
 *  - einfo:   db (optional, omit to list all databases)
 *  - esearch: db, term (required); retmax, retstart (pagination)
 *  - esummary: db, id (comma-separated UIDs)
 *  - elink:   dbfrom, db, id
 *
 * Relationship map:
 *  - /esearch.fcgi  →  /esummary.fcgi  (idlist → id, hasMany)
 *  - /esearch.fcgi  →  /elink.fcgi     (idlist → id, hasMany)
 */
module.exports = {
  name: 'ncbi',
  label: 'NCBI E-utilities (REST)',
  description: 'Programmatic access to all NCBI databases including PubMed, GenBank, Gene, Taxonomy and more via the E-utilities API. Pass retmode=json and a db param in where to select the target database.',
  driver: 'rest',
  connection: {
    database: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  },
  entities: [
    {
      name: '/einfo.fcgi',
      columns: ['dblist', 'dbinfo'],
      relations: [],
    },
    {
      name: '/esearch.fcgi',
      columns: ['count', 'retmax', 'retstart', 'idlist', 'translationset', 'querytranslation', 'errorlist', 'warninglist'],
      relations: [
        { entity: '/esummary.fcgi', foreignKey: 'idlist', type: 'hasMany', alias: 'summaries' },
      ],
    },
    {
      name: '/esummary.fcgi',
      columns: ['result', 'uids'],
      relations: [
        { entity: '/uniprotkb/search', foreignKey: 'uid', type: 'hasMany', alias: 'relatedProteins', catalog: 'uniprot' },
      ],
    },
    {
      name: '/elink.fcgi',
      columns: ['linksets'],
      relations: [],
    },
  ],
};
