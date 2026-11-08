'use strict'

/**
 * Elasticsearch / OpenSearch driver.
 *
 * `from` names an index, and a query searches it:
 *
 *   where    exact-match filters ({ user_id: 3, name: "Carl" }) — compared
 *            against the field's keyword form when the mapping has one, so
 *            analysed text fields still match whole values
 *   limit    → size, offset → from, orderBy → sort (keyword form for text)
 *   select   → _source filtering
 *   relations  hasMany / hasOne / belongsTo via one batched `terms` query each
 *
 * Reserved where keys:
 *   _body   a raw search request body (JSON string), sent as-is
 *   q / _q  a Lucene query string (query_string)
 *
 * A `from` that names an API endpoint (`_cat/indices`, `users/_doc/1`) is
 * fetched with GET, other where keys becoming URL parameters, as before.
 *
 * Connection: database = cluster base URL (http://localhost:9200);
 * user + password → Basic auth, user alone → Bearer token.
 */

const http = require('../http')
const { LruCache } = require('../../cache')

const MAX_WINDOW = 10_000 // index.max_result_window default
const MAPPING_TTL_MS = 60_000

function buildAuth (connection) {
  const { user, password } = connection
  if (!user) return {}
  if (!password) return { Authorization: `Bearer ${user}` }
  const encoded = Buffer.from(`${user}:${password}`).toString('base64')
  return { Authorization: `Basic ${encoded}` }
}

function baseUrl (connection) {
  return (connection.database || '').replace(/\/$/, '')
}

async function request (connection, path, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
    ...(connection.headers && typeof connection.headers === 'object' ? connection.headers : {}),
    ...buildAuth(connection)
  }
  if (body != null) headers['Content-Type'] = 'application/json'
  const { body: json } = await http.request(`${baseUrl(connection)}${path}`, {
    method,
    headers,
    body: typeof body === 'string' ? body : (body != null ? JSON.stringify(body) : undefined)
  })
  return json
}

/** Rows from a search response: each hit's _source, plus _id and _score. */
function hitsToRows (response) {
  if (response && response.hits && Array.isArray(response.hits.hits)) {
    return response.hits.hits.map((h) => ({ _id: h._id, _score: h._score, ...h._source }))
  }
  if (Array.isArray(response)) return response
  return response == null ? [] : [response]
}

// ── Mappings ────────────────────────────────────────────────────────────────

const mappingCache = new LruCache({ max: 200, ttlMs: MAPPING_TTL_MS })

/** Flatten an index mapping into { field: { type, keyword } }. */
function flattenProperties (properties, prefix = '') {
  const out = {}
  for (const [name, spec] of Object.entries(properties || {})) {
    const path = prefix + name
    if (spec.properties) Object.assign(out, flattenProperties(spec.properties, `${path}.`))
    const keyword = spec.fields && Object.entries(spec.fields).find(([, f]) => f.type === 'keyword')
    out[path] = { type: spec.type || 'object', keyword: keyword ? `${path}.${keyword[0]}` : null }
  }
  return out
}

async function getFields (connection, index) {
  const key = `${baseUrl(connection)}|${index}|${connection.user || ''}`
  const hit = mappingCache.get(key)
  if (hit) return hit
  const json = await request(connection, `/${encodeURIComponent(index)}/_mapping`)
  const fields = {}
  for (const idx of Object.values(json || {})) {
    Object.assign(fields, flattenProperties(idx.mappings && idx.mappings.properties))
  }
  mappingCache.set(key, fields)
  return fields
}

/** The field name to use for exact matching and sorting. */
function exactField (fields, name) {
  const f = fields[name]
  if (f && f.type === 'text') return f.keyword || name
  return name
}

function exactClause (fields, name, value) {
  const field = exactField(fields, name)
  return Array.isArray(value) ? { terms: { [field]: value } } : { term: { [field]: value } }
}

// ── Query ───────────────────────────────────────────────────────────────────

function isEndpointPath (from) {
  return /(^|\/)_/.test(from.replace(/^\//, ''))
}

async function search (connection, index, { where, select, limit, offset, orderBy, orderDirection }) {
  const raw = where && where._body
  let body
  if (raw) {
    body = typeof raw === 'string' ? JSON.parse(raw) : raw
  } else {
    const fields = await getFields(connection, index)
    const filter = []
    const must = []
    for (const [k, v] of Object.entries(where || {})) {
      if (k === 'q' || k === '_q') must.push({ query_string: { query: String(v) } })
      else filter.push(exactClause(fields, k, v))
    }
    body = { query: filter.length || must.length ? { bool: { filter, must } } : { match_all: {} } }
    if (orderBy) {
      body.sort = [{ [exactField(fields, orderBy)]: { order: (orderDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc', unmapped_type: 'keyword' } }]
    }
  }
  if (select && select.length > 0) body._source = select
  body.size = Math.min(limit != null ? limit : (body.size ?? 10), MAX_WINDOW)
  if (offset) body.from = offset

  return hitsToRows(await request(connection, `/${encodeURIComponent(index)}/_search`, { method: 'POST', body }))
}

async function executeQuery (input) {
  const { connection, from, select, where, relations, limit, offset } = input
  const index = from.replace(/^\//, '')

  let rows
  if (isEndpointPath(index)) {
    // An explicit API endpoint: GET it, other where keys as URL parameters.
    const url = new URL(`${baseUrl(connection)}/${index}`)
    for (const [k, v] of Object.entries(where || {})) url.searchParams.set(k, String(v))
    if (limit != null) url.searchParams.set('size', String(limit))
    if (offset != null) url.searchParams.set('from', String(offset))
    rows = hitsToRows(await request(connection, url.pathname + url.search))
    if (select && select.length > 0) {
      rows = rows.map((row) => Object.fromEntries(select.filter((f) => Object.hasOwn(row, f)).map((f) => [f, row[f]])))
    }
  } else {
    rows = await search(connection, index, input)
  }

  if (relations && relations.length > 0 && rows.length > 0) {
    await loadRelations(connection, rows, relations)
  }

  return { data: rows, count: rows.length }
}

async function loadRelations (connection, rows, relations) {
  for (const rel of relations) {
    // A relation naming another catalog entry has no index here to join
    // against; the connector resolves it against that entry's connection.
    if (rel.catalog) {
      const { resolveCrossCatalogRelation } = require('../relations')
      const connector = require('../connector')
      await resolveCrossCatalogRelation(connector.executeQuery, rows, rel)
      continue
    }

    const { entity, localKey = '_id', foreignKey, ownerKey = '_id', alias, type = 'hasMany', select, where, limit, relations: nested } = rel
    const resultKey = alias || entity

    try {
      const isBelongsTo = type === 'belongsTo'
      const sourceKey = isBelongsTo ? foreignKey : localKey
      const targetKey = isBelongsTo ? ownerKey : foreignKey
      const ids = [...new Set(rows.map((r) => r[sourceKey]).filter((v) => v != null))]
      if (!ids.length) {
        rows.forEach((r) => { r[resultKey] = type === 'hasMany' ? [] : null })
        continue
      }

      const fields = select && select.length > 0 && !select.includes(targetKey) ? [targetKey, ...select] : select
      let relRows
      if (targetKey === '_id') {
        const res = await request(connection, `/${encodeURIComponent(entity)}/_mget`, { method: 'POST', body: { ids: ids.map(String) } })
        relRows = (res.docs || []).filter((d) => d.found).map((d) => ({ _id: d._id, ...d._source }))
      } else {
        relRows = await search(connection, entity, { where: { ...(where || {}), [targetKey]: ids }, select: fields, limit: MAX_WINDOW })
      }
      if (nested && nested.length > 0) await loadRelations(connection, relRows, nested)

      const grouped = new Map()
      for (const r of relRows) {
        const k = String(r[targetKey])
        if (!grouped.has(k)) grouped.set(k, [])
        grouped.get(k).push(r)
      }
      for (const row of rows) {
        const matches = grouped.get(String(row[sourceKey])) || []
        row[resultKey] = type === 'hasMany' ? (limit != null ? matches.slice(0, limit) : matches) : (matches[0] ?? null)
      }
    } catch (err) {
      const errObj = { error: `relation fetch failed for ${entity}: ${err.message}` }
      rows.forEach((r) => { r[resultKey] = errObj })
    }
  }
}

async function introspect (connection) {
  const indices = await request(connection, '/_cat/indices?format=json')
  const names = (Array.isArray(indices) ? indices : [])
    .map((i) => i.index)
    .filter((name) => name && !name.startsWith('.'))
    .sort()

  const tables = []
  for (const name of names) {
    const fields = await getFields(connection, name)
    tables.push({
      name,
      columns: [
        { name: '_id', type: 'keyword', nullable: false, defaultValue: null, isPrimaryKey: true },
        ...Object.entries(fields)
          .filter(([, f]) => f.type !== 'object')
          .map(([field, f]) => ({ name: field, type: f.type, nullable: true, defaultValue: null, isPrimaryKey: false }))
      ]
    })
  }
  return { tables }
}

module.exports = { executeQuery, introspect, flattenProperties }
