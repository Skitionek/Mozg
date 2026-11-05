'use strict'

/**
 * PubMed — 37M+ citations for biomedical literature from MEDLINE, life-science
 * journals and online books, via NCBI E-utilities.
 * API docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 *
 * Shares NCBI's rate limit (3 req/s, 10 with apiKeys: { pubmed: "…" }).
 * Abstracts, MeSH terms and citation graphs come from Europe PMC via the
 * `europepmc`, `citedBy` and `references` relations.
 */

const { eutils } = require('./ncbi')

const { EUTILS, esearch, esummary, elink, wanted, idList } = eutils

const articleId = (doc, type) => {
  const id = (doc.articleids || []).find((a) => a.idtype === type)
  return id ? id.value : null
}

const ARTICLE_FIELDS = {
  pmid: 'uid',
  title: 'title',
  journal: 'fulljournalname',
  journalAbbreviation: 'source',
  pubDate: 'pubdate',
  volume: 'volume',
  issue: 'issue',
  pages: 'pages',
  authors: 'authors[].name',
  firstAuthor: 'sortfirstauthor',
  lastAuthor: 'lastauthor',
  doi: (doc) => articleId(doc, 'doi'),
  pmcid: (doc) => articleId(doc, 'pmc'),
  pubTypes: 'pubtype',
  language: 'lang[0]',
  pmcCitationCount: 'pmcrefcount'
}

const ARTICLE_RELATIONS = [
  { alias: 'europepmc', description: 'The same article in Europe PMC: abstract, MeSH terms, keywords, citation count', catalog: 'europepmc', entity: 'article', localKey: 'pmid', foreignKey: 'pmid', type: 'hasOne' },
  { alias: 'citedBy', description: 'Articles citing this one (Europe PMC)', catalog: 'europepmc', entity: 'citations', localKey: 'pmid', foreignKey: 'pmid', type: 'hasMany' },
  { alias: 'references', description: 'Articles this one cites (Europe PMC)', catalog: 'europepmc', entity: 'references', localKey: 'pmid', foreignKey: 'pmid', type: 'hasMany' }
]

module.exports = {
  name: 'pubmed',
  label: 'PubMed',
  description: 'Biomedical literature citations from MEDLINE, life-science journals and online books (37M+ records), searchable with PubMed query syntax. Linked to Europe PMC for abstracts and citation graphs, and to NCBI Gene for gene-centric literature.',
  category: 'Literature',
  homepage: 'https://pubmed.ncbi.nlm.nih.gov/',
  docs: 'https://www.ncbi.nlm.nih.gov/books/NBK25499/',
  license: 'Citation data free to use; abstracts may be copyrighted by their publishers',
  driver: 'api',
  ...EUTILS,
  entities: [
    {
      name: 'article',
      description: 'The PubMed citation for one PMID (or several)',
      params: {
        pmid: { required: true, description: 'PubMed id, e.g. 31452104, or a list of them' }
      },
      resolve: (params, ctx) => esummary(ctx, 'pubmed', idList(params.pmid)),
      fields: ARTICLE_FIELDS,
      example: { pmid: '31452104' },
      relations: ARTICLE_RELATIONS
    },
    {
      name: 'articles',
      description: 'PubMed citations matching a query, in PubMed\'s order',
      params: {
        term: { required: true, description: 'PubMed query, e.g. "TP53[tiab] AND apoptosis" — https://pubmed.ncbi.nlm.nih.gov/help/#search-tags' },
        sort: { description: 'Entrez order by default (most recent first, stable across pages); or relevance (best match — PubMed may reorder it between calls, so pages can overlap), pub_date, Author, JournalName' },
        minDate: { description: 'Earliest publication date, YYYY or YYYY/MM/DD' },
        maxDate: { description: 'Latest publication date, YYYY or YYYY/MM/DD' }
      },
      resolve: async (params, ctx) => {
        let term = params.term
        if (params.minDate || params.maxDate) {
          term = `(${term}) AND ("${params.minDate || '1800'}"[dp] : "${params.maxDate || '3000'}"[dp])`
        }
        return esummary(ctx, 'pubmed', await esearch(ctx, 'pubmed', term, { sort: params.sort }))
      },
      fields: ARTICLE_FIELDS,
      example: { term: 'TP53 AND apoptosis AND review[pt]' },
      relations: ARTICLE_RELATIONS
    },
    {
      name: 'articlesForGene',
      description: 'PubMed citations NCBI Gene links to a gene (GeneRIFs and curated references), most recent first',
      params: {
        ncbiGeneId: { required: true, description: 'NCBI Gene ID, e.g. 7157' }
      },
      resolve: async (params, ctx) => {
        const [set] = await elink(ctx, 'gene', 'pubmed', idList(params.ncbiGeneId).join(','), 'gene_pubmed')
        // elink returns links unordered; higher PMIDs are newer, so take the newest.
        const pmids = ((set && set.ids) || []).map(Number).sort((a, b) => b - a).slice(0, wanted(ctx))
        return esummary(ctx, 'pubmed', pmids)
      },
      fields: ARTICLE_FIELDS,
      example: { ncbiGeneId: '7157' },
      relations: ARTICLE_RELATIONS
    }
  ]
}
