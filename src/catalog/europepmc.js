'use strict'

/**
 * Europe PMC — 45M+ life-science abstracts (all of PubMed plus preprints,
 * patents and agricultural literature) and 10M+ full-text articles, with
 * citation graphs and MeSH indexing.
 * API docs: https://europepmc.org/RestfulWebService
 */

const yesNo = (v) => (v === 'Y' ? true : v === 'N' ? false : null)

// Full ("core") search results.
const ARTICLE_FIELDS = {
  id: 'id',
  source: 'source',
  pmid: 'pmid',
  pmcid: 'pmcid',
  doi: 'doi',
  title: 'title',
  authors: 'authorString',
  journal: 'journalInfo.journal.title|journalTitle',
  journalAbbreviation: 'journalInfo.journal.isoabbreviation|journalInfo.journal.medlineAbbreviation',
  pubYear: (r) => (r.pubYear != null ? Number(r.pubYear) : null),
  pubDate: 'firstPublicationDate',
  abstract: 'abstractText',
  pubTypes: 'pubTypeList.pubType',
  meshTerms: 'meshHeadingList.meshHeading[].descriptorName',
  keywords: 'keywordList.keyword',
  citedByCount: 'citedByCount',
  isOpenAccess: (r) => yesNo(r.isOpenAccess),
  hasFullText: (r) => yesNo(r.inEPMC)
}

const ARTICLE_RELATIONS = [
  { alias: 'pubmed', description: 'The PubMed citation record', catalog: 'pubmed', entity: 'article', obo: 'pubmed', type: 'hasOne' },
  { alias: 'citedBy', description: 'Articles citing this one', entity: 'citations', obo: 'pubmed', type: 'hasMany' },
  { alias: 'references', description: 'Articles this one cites', entity: 'references', obo: 'pubmed', type: 'hasMany' }
]

// Citation and reference list items: a lighter shape than a search hit.
const CITATION_FIELDS = {
  id: 'id',
  source: 'source',
  pmid: (r) => (r.source === 'MED' && r.id ? String(r.id) : null),
  title: 'title',
  authors: 'authorString',
  journal: 'journalAbbreviation',
  pubYear: (r) => (r.pubYear != null ? Number(r.pubYear) : null),
  volume: 'volume',
  issue: 'issue',
  pages: 'pageInfo',
  citedByCount: 'citedByCount'
}

const CITATION_RELATIONS = [
  { alias: 'article', description: 'The full Europe PMC record (abstract, MeSH, DOI)', entity: 'article', obo: 'pubmed', type: 'hasOne' },
  { alias: 'pubmed', description: 'The PubMed citation record', catalog: 'pubmed', entity: 'article', obo: 'pubmed', type: 'hasOne' }
]

module.exports = {
  name: 'europepmc',
  label: 'Europe PMC',
  description: 'Life-science literature search over 45M+ abstracts (PubMed, preprints, patents, Agricola) and 10M+ full-text articles, with abstracts, MeSH terms, open-access status and the citation graph (who cites whom).',
  category: 'Literature',
  homepage: 'https://europepmc.org',
  docs: 'https://europepmc.org/RestfulWebService',
  license: 'Metadata free to use; article text under each article\'s own licence',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/europepmc/webservices/rest',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'articles',
      description: 'Articles matching a Europe PMC query',
      path: '/search',
      params: {
        query: { required: true, description: 'Europe PMC query, e.g. "TP53 AND OPEN_ACCESS:y" — https://europepmc.org/searchsyntax' },
        sort: { description: 'e.g. "CITED desc", "P_PDATE_D desc"; relevance by default' }
      },
      query: (params) => ({ query: params.query, sort: params.sort, format: 'json', resultType: 'core' }),
      rows: 'resultList.result',
      fields: ARTICLE_FIELDS,
      paginate: { limit: 'pageSize', max: 1000 },
      example: { query: 'TP53 AND apoptosis AND SRC:MED' },
      relations: ARTICLE_RELATIONS
    },
    {
      name: 'article',
      description: 'One article by PubMed id',
      path: '/search',
      params: {
        pmid: { required: true, description: 'PubMed id, e.g. 31452104' }
      },
      query: (params) => ({ query: `EXT_ID:${params.pmid} AND SRC:MED`, format: 'json', resultType: 'core' }),
      rows: 'resultList.result',
      fields: ARTICLE_FIELDS,
      example: { pmid: '31452104' },
      relations: ARTICLE_RELATIONS
    },
    {
      name: 'citations',
      description: 'An article citing the given one',
      path: '/MED/{pmid}/citations',
      params: {
        pmid: { description: 'PubMed id of the cited article, e.g. 31452104' }
      },
      query: { format: 'json' },
      rows: 'citationList.citation',
      fields: CITATION_FIELDS,
      paginate: { limit: 'pageSize', page: 'page', pageBase: 1, max: 1000 },
      example: { pmid: '31452104' },
      relations: CITATION_RELATIONS
    },
    {
      name: 'references',
      description: 'An article cited by the given one (its reference list)',
      path: '/MED/{pmid}/references',
      params: {
        pmid: { description: 'PubMed id of the citing article, e.g. 31452104' }
      },
      query: { format: 'json' },
      rows: 'referenceList.reference',
      fields: CITATION_FIELDS,
      paginate: { limit: 'pageSize', page: 'page', pageBase: 1, max: 1000 },
      example: { pmid: '31452104' },
      relations: CITATION_RELATIONS
    }
  ]
}
