'use strict'

/**
 * NCBI E-utilities — generic access to every Entrez database (gene, pubmed,
 * nuccore, protein, clinvar, gds, taxonomy, …).
 * API docs: https://www.ncbi.nlm.nih.gov/books/NBK25497/
 *
 * The dedicated entries (pubmed, genbank, geo, clinvar) give friendlier
 * fields for the common databases; this one reaches the rest.  Entrez works
 * in two steps — esearch finds UIDs, esummary describes them — so entities
 * here use `resolve` to chain the two.
 *
 * NCBI allows 3 requests/second per IP without an API key and 10 with one:
 * pass apiKeys: { ncbi: "…" } (get one at https://www.ncbi.nlm.nih.gov/account/settings/).
 */

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

// Shared by every entry that talks to E-utilities (pubmed, genbank, geo,
// clinvar): one host, one rate limit, one key mechanism.
const EUTILS = {
  connection: { database: BASE },
  rateLimit: { requestsPerSecond: 3, maxConcurrent: 2 },
  rateLimitWithKey: { requestsPerSecond: 10, maxConcurrent: 4 },
  auth: { param: 'api_key', required: false, signup: 'https://www.ncbi.nlm.nih.gov/account/settings/' },
  query: { tool: 'mozg' }
}

// esummary takes ids on the URL; NCBI asks for POST beyond ~200, so batch instead.
const SUMMARY_BATCH = 200
// Entrez caps retmax at 10 000 for most databases.
const MAX_RETMAX = 10_000
// Used when the caller (typically a relation) gives no limit.
const DEFAULT_COUNT = 20

/**
 * How many UIDs to ask for.  The driver trims `offset` client-side after
 * resolve returns, so ask for offset + limit from the start of the list.
 */
function wanted (ctx, fallback = DEFAULT_COUNT) {
  const n = ctx.limit != null ? ctx.limit + (ctx.offset || 0) : fallback
  return Math.max(0, Math.min(n, MAX_RETMAX))
}

function idList (value) {
  return [].concat(value == null ? [] : value)
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean)
}

/** esearch → UIDs, in the order Entrez ranks them. */
async function esearch (ctx, db, term, { sort, retmax } = {}) {
  const count = retmax != null ? retmax : wanted(ctx)
  if (count === 0) return []
  const body = await ctx.request('/esearch.fcgi', { query: { db, term, sort, retmode: 'json', retmax: count } })
  const result = body && body.esearchresult
  if (!result) return []
  if (result.ERROR) throw new Error(`NCBI esearch (${db}): ${result.ERROR}`)
  return result.idlist || []
}

/** esummary → one document summary per UID, in the order given. */
async function esummary (ctx, db, ids) {
  const uids = idList(ids)
  const out = []
  for (let i = 0; i < uids.length; i += SUMMARY_BATCH) {
    const batch = uids.slice(i, i + SUMMARY_BATCH)
    const body = await ctx.request('/esummary.fcgi', { query: { db, id: batch.join(','), retmode: 'json' } })
    const result = body && body.result
    if (!result) {
      if (body && body.error) throw new Error(`NCBI esummary (${db}): ${body.error}`)
      continue
    }
    for (const uid of result.uids || []) {
      const doc = result[uid]
      if (doc && !doc.error) out.push(doc)
    }
  }
  return out
}

/** elink → UIDs in `db` linked from `id` in `dbfrom`. */
async function elink (ctx, dbfrom, db, id, linkname) {
  const body = await ctx.request('/elink.fcgi', { query: { dbfrom, db, id, linkname, retmode: 'json' } })
  const sets = (body && body.linksets) || []
  return sets.flatMap((set) => (set.linksetdbs || [])
    .filter((l) => !linkname || l.linkname === linkname)
    .map((l) => ({ linkname: l.linkname, ids: l.links || [] })))
}

const docsumTitle = (doc) => doc.title || doc.name || doc.caption || doc.description || doc.accession || null

module.exports = {
  name: 'ncbi',
  label: 'NCBI E-utilities',
  description: 'Generic access to every NCBI Entrez database (gene, protein, nuccore, pubmed, clinvar, gds, taxonomy, assembly, biosample, …): search with Entrez query syntax, then fetch document summaries and cross-database links.',
  category: 'Genes & genomes',
  homepage: 'https://www.ncbi.nlm.nih.gov/',
  docs: 'https://www.ncbi.nlm.nih.gov/books/NBK25497/',
  license: 'Public domain (US Government work); some records carry their own terms',
  driver: 'api',
  ...EUTILS,
  entities: [
    {
      name: 'databases',
      description: 'An Entrez database that can be searched',
      resolve: async (_params, ctx) => {
        const body = await ctx.request('/einfo.fcgi', { query: { retmode: 'json' } })
        return ((body && body.einforesult && body.einforesult.dblist) || []).map((db) => ({ db }))
      },
      fields: { db: 'db' },
      example: {},
      relations: []
    },
    {
      name: 'search',
      description: 'The UID of one record matching an Entrez query',
      params: {
        db: { required: true, description: 'Entrez database, e.g. gene, pubmed, protein, nuccore, clinvar, gds' },
        term: { required: true, description: 'Entrez query, e.g. TP53[sym] AND human[orgn]' },
        sort: { description: 'Database-specific sort order, e.g. relevance or pub_date for pubmed' }
      },
      resolve: async (params, ctx) => (await esearch(ctx, params.db, params.term, { sort: params.sort }))
        .map((id) => ({ db: params.db, id, hit: `${params.db}:${id}` })),
      fields: { db: 'db', id: 'id', hit: 'hit' },
      example: { db: 'gene', term: 'TP53[sym] AND human[orgn]' },
      relations: [
        { alias: 'summary', description: 'The document summary of this record (fields vary by database)', entity: 'summaryOfSearchHit', localKey: 'hit', foreignKey: 'hit', type: 'hasOne' }
      ]
    },
    {
      name: 'summary',
      description: 'The Entrez document summary of one or more records (fields vary by database)',
      params: {
        db: { required: true, description: 'Entrez database' },
        id: { required: true, description: 'UID or accession, or a list of them' }
      },
      resolve: async (params, ctx) => (await esummary(ctx, params.db, params.id))
        .map((doc) => ({ db: params.db, doc })),
      columns: ['db', 'id', 'title', 'docsum'],
      fields: (r) => ({ db: r.db, id: r.doc.uid, title: docsumTitle(r.doc), docsum: r.doc }),
      example: { db: 'gene', id: '7157' },
      relations: []
    },
    {
      name: 'records',
      description: 'Document summaries of the records matching an Entrez query (search and summary in one)',
      params: {
        db: { required: true, description: 'Entrez database' },
        term: { required: true, description: 'Entrez query' },
        sort: { description: 'Database-specific sort order' }
      },
      resolve: async (params, ctx) => (await esummary(ctx, params.db, await esearch(ctx, params.db, params.term, { sort: params.sort })))
        .map((doc) => ({ db: params.db, doc })),
      columns: ['db', 'id', 'title', 'docsum'],
      fields: (r) => ({ db: r.db, id: r.doc.uid, title: docsumTitle(r.doc), docsum: r.doc }),
      example: { db: 'protein', term: 'TP53[gene] AND human[orgn] AND refseq[filter]' },
      relations: []
    },
    {
      name: 'summaryOfSearchHit',
      description: 'The document summary of a "db:uid" hit as returned by search or links — lets a relation summarise without knowing the database in advance',
      params: {
        hit: { required: true, description: 'Database-qualified UID, e.g. gene:7157' }
      },
      resolve: async (params, ctx) => {
        const [db, ...rest] = String(params.hit).split(':')
        const id = rest.join(':')
        if (!db || !id) throw new Error(`ncbi/summaryOfSearchHit expects "db:uid", got "${params.hit}"`)
        return (await esummary(ctx, db, id)).map((doc) => ({ db, doc }))
      },
      columns: ['db', 'id', 'title', 'docsum'],
      fields: (r) => ({ db: r.db, id: r.doc.uid, title: docsumTitle(r.doc), docsum: r.doc }),
      example: { hit: 'gene:7157' },
      relations: []
    },
    {
      name: 'links',
      description: 'A record in one Entrez database linked from a record in another (elink)',
      params: {
        dbfrom: { required: true, description: 'Database of the source record, e.g. gene' },
        db: { required: true, description: 'Database to find links in, e.g. pubmed, protein, clinvar' },
        id: { required: true, description: 'UID of the source record' },
        linkname: { description: 'Restrict to one link type, e.g. gene_pubmed' }
      },
      resolve: async (params, ctx) => (await elink(ctx, params.dbfrom, params.db, idList(params.id).join(','), params.linkname))
        .flatMap((set) => set.ids.map((linkedId) => ({ dbfrom: params.dbfrom, id: String(params.id), db: params.db, linkname: set.linkname, linkedId, linkedHit: `${params.db}:${linkedId}` }))),
      fields: { dbfrom: 'dbfrom', id: 'id', db: 'db', linkname: 'linkname', linkedId: 'linkedId', linkedHit: 'linkedHit' },
      example: { dbfrom: 'gene', db: 'protein', id: '7157', linkname: 'gene_protein_refseq' },
      relations: [
        { alias: 'summary', description: 'Document summary of the linked record', entity: 'summaryOfSearchHit', localKey: 'linkedHit', foreignKey: 'hit', type: 'hasOne' }
      ]
    }
  ]
}

// Helpers for the other E-utilities entries; non-enumerable so they stay out
// of the catalog entry's data.
Object.defineProperty(module.exports, 'eutils', {
  value: { EUTILS, esearch, esummary, elink, wanted, idList, DEFAULT_COUNT },
  enumerable: false
})
