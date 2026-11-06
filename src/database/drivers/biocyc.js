'use strict'

/**
 * BioCyc / Pathway Tools web-service connector.
 *
 * Uses the documented Pathway Tools web services
 * (https://biocyc.org/web-services.shtml):
 *
 *   apixml?fn=get-class-all-instances&id=ORG:Class&detail=low
 *
 * which returns every instance of a class with its common name, synonyms
 * and references to related frames (a pathway's reactions, a gene's
 * products).  The driver used to call `/ORG/class-instances?o=…`, an
 * endpoint BioCyc no longer serves (it answers 400 with an HTML page).
 *
 * Connection:
 *   database  organism database code, e.g. "ECOLI", "META", "HUMAN"
 *   host      optional; defaults to websvc.biocyc.org, or a local Pathway
 *             Tools server (scheme "http", port e.g. 1555)
 *   user / password  BioCyc account.  Anonymous access covers little: most
 *             databases, and anything beyond a small quota, need an account.
 *
 * Rows: { _id: frame id, name: common name, types: parent classes, synonyms,
 * <other fields with '-' → '_'> }.  Fields that reference other frames hold
 * frame ids, which is what relations follow: a relation's `foreignKey` names
 * the parent field holding the related frames' ids (`reaction_list`,
 * `product`), and `entity` names their class.
 */

const http = require('../http')

const CLASS_MAP = {
  genes: 'Genes',
  compounds: 'Compounds',
  reactions: 'Reactions',
  pathways: 'Pathways',
  proteins: 'Proteins',
  rna: 'RNAs',
  organisms: 'Organisms'
}

// A class listing is one large document, and BioCyc rations anonymous
// requests, so the listing a query already fetched is reused briefly.
const LISTING_TTL_MS = 5 * 60_000
const listingCache = new Map()
const sessionCache = new Map()

function baseUrl (config) {
  if (config.host) {
    const scheme = config.scheme || 'http'
    const port = config.port ? `:${config.port}` : ''
    return `${scheme}://${config.host}${port}`
  }
  return 'https://websvc.biocyc.org'
}

async function authenticate (config) {
  if (!config.user || !config.password) return null
  const key = `${baseUrl(config)}|${config.user}`
  if (sessionCache.has(key)) return sessionCache.get(key)

  const res = await globalThis.fetch(`${baseUrl(config)}/credentials/login/`, {
    method: 'POST',
    body: new URLSearchParams({ email: config.user, password: config.password }),
    redirect: 'manual'
  })
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0] || null
  if (!cookie) throw new Error(`BioCyc login failed for ${config.user} (HTTP ${res.status})`)
  sessionCache.set(key, cookie)
  return cookie
}

async function biocycGet (path, config) {
  const cookie = await authenticate(config)
  const headers = { Accept: 'application/xml' }
  if (cookie) headers.Cookie = cookie
  let response
  try {
    response = await http.request(`${baseUrl(config)}${path}`, {
      headers,
      format: 'xml',
      rateLimit: { requestsPerSecond: 1, maxConcurrent: 1 },
      allowStatus: [307]
    })
  } catch (err) {
    // BioCyc fronts its services with a browser check when it sees too many
    // anonymous requests; the page means nothing to a caller, so say what it is.
    if (err.status === 403 && /Checking your browser|pow-challenge/i.test(err.body || err.message)) {
      throw new Error('BioCyc refused the request with an anti-bot browser check — sign in with a BioCyc account (connection.user / connection.password) or retry later', { cause: err })
    }
    throw err
  }
  const { body, status } = response
  if (status === 307) {
    throw new Error('BioCyc requires an account for this request — pass your BioCyc login as connection.user / connection.password (https://biocyc.org/account.shtml)')
  }
  if (/^\s*<!DOCTYPE html/i.test(body)) throw new Error(`BioCyc answered with an HTML page instead of data for ${path}`)
  return body
}

function asArray (v) {
  return v == null ? [] : Array.isArray(v) ? v : [v]
}

/** One frame element of an apixml response → a flat row. */
function frameToRow (node) {
  const row = { _id: node['@_frameid'] || node['@_ID'] }
  for (const [key, raw] of Object.entries(node)) {
    if (key.startsWith('@_')) continue
    const values = asArray(raw).flatMap((item) => {
      if (item == null) return []
      if (typeof item !== 'object') return [item]
      if (Object.hasOwn(item, '#text')) return [item['#text']]
      // A container of references: <reaction-list><Reaction frameid=…/>…
      const refs = Object.entries(item).filter(([k]) => !k.startsWith('@_')).flatMap(([, v]) => asArray(v))
        .map((ref) => ref && ref['@_frameid']).filter(Boolean)
      if (refs.length) return refs
      return item['@_frameid'] ? [item['@_frameid']] : []
    })
    const field = key.replace(/-/g, '_')
    row[field] = values.length === 1 && !/(_list|^synonym|^parent|^types)$/.test(field) ? values[0] : values
  }
  row.name = row.common_name ?? row._id
  row.types = row.parent ?? row.types ?? []
  return row
}

function parseListing (xml) {
  const { XMLParser } = require('fast-xml-parser')
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: true }).parse(xml)
  const root = doc['ptools-xml'] || {}
  const rows = []
  for (const [tag, nodes] of Object.entries(root)) {
    if (tag === 'metadata' || tag.startsWith('@_')) continue
    for (const node of asArray(nodes)) if (node && typeof node === 'object') rows.push(frameToRow(node))
  }
  return rows
}

async function listClass (config, className) {
  const key = `${baseUrl(config)}|${config.database}|${className}|${config.user || ''}`
  const hit = listingCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.rows

  const id = encodeURIComponent(`${config.database}:${className}`)
  const rows = parseListing(await biocycGet(`/apixml?fn=get-class-all-instances&id=${id}&detail=low`, config))
  listingCache.set(key, { rows, expires: Date.now() + LISTING_TTL_MS })
  return rows
}

function classFor (entity) {
  return CLASS_MAP[String(entity).toLowerCase()] || entity
}

function matchesWhere (row, where) {
  return Object.entries(where || {}).every(([k, v]) => [].concat(row[k] ?? row[k.toLowerCase()] ?? []).map(String).includes(String(v)))
}

function project (rows, select) {
  if (!select || select.length === 0) return rows
  return rows.map((row) => Object.fromEntries(select.filter((f) => Object.hasOwn(row, f)).map((f) => [f, row[f]])))
}

async function executeQuery (input) {
  const { connection, from, where, select, limit, offset, orderBy, orderDirection, relations } = input
  if (!connection.database) throw new Error('BioCyc needs connection.database: an organism database code such as ECOLI')

  let rows = (await listClass(connection, classFor(from))).filter((row) => matchesWhere(row, where))

  if (orderBy) {
    const sign = (orderDirection || 'asc').toLowerCase() === 'desc' ? -1 : 1
    rows = [...rows].sort((a, b) => String(a[orderBy] ?? '').localeCompare(String(b[orderBy] ?? '')) * sign)
  }
  rows = rows.slice(offset || 0, limit != null ? (offset || 0) + limit : undefined)
  // Copies, so relations attached below never land in the shared listing.
  rows = rows.map((row) => ({ ...row }))

  for (const rel of relations || []) {
    if (rel.catalog) {
      const { resolveCrossCatalogRelation } = require('../relations')
      const connector = require('../connector')
      await resolveCrossCatalogRelation(connector.executeQuery, rows, rel)
      continue
    }
    const resultKey = rel.alias || rel.entity
    try {
      // One listing of the related class serves every parent row.
      const byId = new Map((await listClass(connection, classFor(rel.entity))).map((r) => [r._id, r]))
      for (const row of rows) {
        let related = [].concat(row[rel.foreignKey] || []).map((id) => byId.get(id)).filter(Boolean)
        if (rel.limit != null) related = related.slice(0, rel.limit)
        row[resultKey] = rel.type === 'hasMany' || rel.type == null ? project(related, rel.select) : (project(related, rel.select)[0] ?? null)
      }
    } catch (err) {
      const errObj = { error: `relation fetch failed for ${rel.entity}: ${err.message}` }
      rows.forEach((r) => { r[resultKey] = errObj })
    }
  }

  return { data: project(rows, select), count: rows.length }
}

const BASE_COLUMNS = ['_id', 'name', 'types', 'synonym', 'common_name']
const EXTRA_COLUMNS = {
  genes: ['product', 'left_end_position', 'right_end_position', 'transcription_direction'],
  compounds: ['molecular_weight', 'formula', 'inchi'],
  reactions: ['ec_number', 'enzymatic_reaction'],
  pathways: ['reaction_list', 'taxonomic_range']
}

async function introspect (_connection) {
  // Every PGDB shares the Pathway Tools schema; describe it without a request.
  return {
    tables: Object.keys(CLASS_MAP).map((name) => ({
      name,
      columns: [...BASE_COLUMNS, ...(EXTRA_COLUMNS[name] || [])].map((column) => ({
        name: column,
        type: 'String',
        nullable: column !== '_id',
        defaultValue: null,
        isPrimaryKey: column === '_id'
      }))
    }))
  }
}

module.exports = { executeQuery, introspect, parseListing }
