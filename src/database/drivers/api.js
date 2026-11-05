'use strict'

/**
 * Declarative HTTP API driver.
 *
 * Public life-science APIs share almost nothing beyond HTTP: identifiers go in
 * the path for one (`/uniprotkb/P04637`) and in the query string for the next
 * (`?geneProductId=P04637`); records arrive bare, under `results`, under
 * `_embedded.terms`, or keyed by the identifier you asked for; pagination is
 * `size`, `limit`, `rows`, `pageSize` or nothing at all.  A generic REST
 * driver that guesses at those conventions gets most of them wrong, so this
 * driver guesses nothing.  Each catalog entry describes its entities — the
 * request to make, where the records are in the response, and which fields
 * to keep under which names — and this driver executes that description.
 *
 * `where` keys are the entity's named parameters.  That is what lets the
 * generic relation resolver join across sources: a relation sets the target
 * entity's parameter (say `uniprotAccession`) from a field on the parent row,
 * and the target's description decides whether that becomes a path segment,
 * a query parameter or a GraphQL variable.
 *
 * Entity description (see src/catalog/README.md for the full reference):
 *
 *   {
 *     name: 'protein',                       // used as `from`
 *     description: '…',
 *     path: '/uniprotkb/{accession}',        // {placeholders} are required params
 *     method: 'GET',                         // or POST
 *     params: { query: { description, default, required, name, transform } },
 *     query: { format: 'json' } | (params) => ({ … }),     // query string
 *     body: (params) => ({ … }),             // POST body (JSON)
 *     graphql: { query: '…', variables: (params) => ({ … }) },
 *     format: 'json' | 'tsv' | 'text' | 'xml',
 *     parse: (text, params) => records,      // for text formats
 *     rows: 'results' | (body, params) => records,
 *     fields: { accession: 'primaryAccession', symbol: 'genes[0].geneName.value', … }
 *             | (record, params) => ({ … }),
 *     paginate: { limit: 'size', offset: 'offset', page: 'page', pageBase: 0, max: 500 },
 *     emptyStatus: [404],                    // statuses that mean "no records"
 *     resolve: async (params, ctx) => records | { records, serverOffset },  // multi-step lookups
 *     example: { accession: 'P04637' },
 *     relations: [ … ]
 *   }
 */

const http = require('../http')
const { findEntity, pathParams, entityColumns, sourceForConnection } = require('../sources')

// ── Small path language for field mapping ───────────────────────────────────
//
//   'a.b.c'            nested property
//   'a[0].b'           array index
//   'a[].b'            map over an array (one level, flattened)
//   'a.b|c.d'          first non-empty of several paths

function getPath (value, path) {
  if (path.includes('|')) {
    for (const alt of path.split('|')) {
      const v = getPath(value, alt.trim())
      if (v != null && !(Array.isArray(v) && v.length === 0) && v !== '') return v
    }
    return null
  }

  const tokens = []
  for (const part of path.split('.')) {
    const m = part.match(/^([^[\]]*)((?:\[\d*\])*)$/)
    if (!m) {
      tokens.push({ key: part })
      continue
    }
    if (m[1]) tokens.push({ key: m[1] })
    for (const idx of m[2].matchAll(/\[(\d*)\]/g)) {
      tokens.push(idx[1] === '' ? { each: true } : { index: Number(idx[1]) })
    }
  }

  const walk = (current, i) => {
    if (i === tokens.length) return current
    if (current == null) return null
    const tok = tokens[i]
    if (tok.each) {
      if (!Array.isArray(current)) return null
      return current.flatMap((item) => {
        const v = walk(item, i + 1)
        return v == null ? [] : v
      })
    }
    if (tok.index != null) return Array.isArray(current) ? walk(current[tok.index], i + 1) : null
    if (Array.isArray(current) && !/^\d+$/.test(tok.key)) return null
    return walk(Object.hasOwn(current, tok.key) ? current[tok.key] : null, i + 1)
  }

  const out = walk(value, 0)
  return out === undefined ? null : out
}

function mapRecord (record, fields, params) {
  if (!fields) return { ...record }
  if (typeof fields === 'function') return fields(record, params) || {}
  const out = {}
  for (const [name, spec] of Object.entries(fields)) {
    let value
    if (typeof spec === 'function') value = spec(record, params)
    else if (spec === true) value = record == null ? null : record[name]
    else value = getPath(record, spec)
    out[name] = value === undefined ? null : value
  }
  return out
}

// ── Response parsing ────────────────────────────────────────────────────────

function parseTsv (text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const header = lines[0].split('\t').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split('\t')
    return Object.fromEntries(header.map((h, i) => [h, cells[i] != null ? cells[i] : null]))
  })
}

function parseXml (text) {
  const { XMLParser } = require('fast-xml-parser')
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' }).parse(text)
}

function extractRows (body, entity, params) {
  if (entity.rows) {
    const found = typeof entity.rows === 'function' ? entity.rows(body, params) : getPath(body, entity.rows)
    if (found == null) return []
    return Array.isArray(found) ? found : [found]
  }
  if (body == null) return []
  return Array.isArray(body) ? body : [body]
}

// ── Request construction ────────────────────────────────────────────────────

/**
 * The base URL to call: the catalog's, or a caller-supplied mirror.  A mirror
 * is user input pointing the server at an arbitrary host, so it gets the same
 * SSRF screening as ontology URLs unless the operator has opted in to private
 * mirrors (institutions often run local copies of Ensembl or UniProt).
 */
function baseUrlFor (entry, connection) {
  const catalogBase = String(entry.connection.database).replace(/\/$/, '')
  const requested = connection.database ? String(connection.database).replace(/\/$/, '') : catalogBase
  if (requested !== catalogBase && process.env.MOZG_ALLOW_PRIVATE_MIRRORS !== '1') {
    const { validateOntologyUrl } = require('../../ontology/url-validator')
    validateOntologyUrl(requested)
  }
  return requested
}

/** Encode one path segment, keeping ':' readable (it is legal in a path segment and CURIEs are full of it). */
function encodeSegment (value) {
  return encodeURIComponent(String(value)).replace(/%3A/gi, ':')
}

function applyTransform (spec, value) {
  if (Array.isArray(value)) value = value.join(spec.join || ',')
  if (!spec.transform) return value
  if (typeof spec.transform === 'function') return spec.transform(value)
  return String(spec.transform).replace(/\{value\}/g, String(value))
}

/**
 * Validate `where` against the entity's parameters and fill in defaults.
 * Unknown keys are an error: an API that silently ignores a parameter it does
 * not understand returns unfiltered results, which is far worse than a
 * failed query.
 */
function resolveParams (entry, entity, where) {
  const declared = entity.params || {}
  const inPath = pathParams(entity.path)
  const accepted = new Set([...inPath, ...Object.keys(declared)])
  const given = where && typeof where === 'object' ? where : {}

  const unknown = Object.keys(given).filter((k) => !accepted.has(k))
  if (unknown.length > 0) {
    const list = [...accepted].join(', ') || '(none)'
    throw new Error(`${entry.name}/${entity.name} does not accept ${unknown.map((k) => `"${k}"`).join(', ')}. Accepted parameters: ${list}`)
  }

  const params = {}
  for (const name of accepted) {
    const spec = declared[name] || {}
    let value = Object.hasOwn(given, name) ? given[name] : undefined
    if (value == null && spec.default != null) value = spec.default
    if (value == null) {
      if (inPath.includes(name) || spec.required) {
        throw new Error(`${entry.name}/${entity.name} requires where.${name}` + (entity.example && entity.example[name] != null ? ` (e.g. ${JSON.stringify(entity.example[name])})` : ''))
      }
      continue
    }
    params[name] = value
  }
  return params
}

function apiKeyFor (connection, entry) {
  if (connection.apiKeys && connection.apiKeys[entry.name]) return connection.apiKeys[entry.name]
  // A caller may also pass the key the classic way, as connection.user.
  if (connection.user && entry.auth) return connection.user
  return null
}

function buildRequest (entry, entity, params, { limit, offset, connection }) {
  const base = baseUrlFor(entry, connection)
  const declared = entity.params || {}

  let path = entity.path || ''
  for (const name of pathParams(entity.path)) {
    path = path.replace(`{${name}}`, encodeSegment(applyTransform(declared[name] || {}, params[name])))
  }
  const url = new URL(base + path)

  const query = {
    ...(entry.query || {}),
    ...(typeof entity.query === 'function' ? entity.query(params) : (entity.query || {}))
  }
  // Parameters become query-string entries unless the entity computes its own
  // query string, or sends them in a body (GraphQL variables, POST JSON).
  if (typeof entity.query !== 'function' && !entity.graphql && !entity.body) {
    for (const [name, spec] of Object.entries(declared)) {
      if (pathParams(entity.path).includes(name) || params[name] == null) continue
      if ((spec.in || 'query') !== 'query') continue
      query[spec.name || name] = applyTransform(spec, params[name])
    }
  }

  // Pagination: ask the server for what we need where it can be told, and
  // trim client-side whatever it could not be told.
  const pg = entity.paginate || {}
  let serverOffset = 0
  if (limit != null || offset) {
    const want = (limit != null ? limit : (pg.default || 25)) + (offset || 0)
    if (pg.offset && limit != null) {
      query[pg.offset] = offset || 0
      serverOffset = offset || 0
      if (pg.limit) query[pg.limit] = Math.min(limit, pg.max || limit)
    } else if (pg.page && limit != null && (offset || 0) % limit === 0) {
      query[pg.page] = (pg.pageBase || 0) + (offset || 0) / limit
      serverOffset = offset || 0
      if (pg.limit) query[pg.limit] = Math.min(limit, pg.max || limit)
    } else if (pg.limit) {
      query[pg.limit] = Math.min(want, pg.max || want)
    }
  }

  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v))
  }

  const headers = { ...(entry.connection.headers || {}), ...(connection.headers || {}), ...(entity.headers || {}) }
  const key = apiKeyFor(connection, entry)
  const auth = entry.auth || {}
  if (auth.required && !key) {
    throw new Error(`Source "${entry.name}" requires an API key — pass apiKeys: { "${entry.name}": "…" }` + (auth.signup ? ` (register at ${auth.signup})` : ''))
  }
  if (key && auth.param) url.searchParams.set(auth.param, key)
  if (key && auth.header) headers[auth.header] = (auth.prefix || '') + key

  let method = (entity.method || 'GET').toUpperCase()
  let body
  if (entity.graphql) {
    method = 'POST'
    body = { query: entity.graphql.query, variables: entity.graphql.variables ? entity.graphql.variables(params) : params }
  } else if (entity.body) {
    body = typeof entity.body === 'function' ? entity.body(params) : entity.body
  }

  return {
    url: url.toString(),
    serverOffset,
    options: {
      method,
      headers,
      body,
      format: entity.format === 'tsv' || entity.format === 'text' || entity.format === 'xml' ? 'text' : 'json',
      rateLimit: key && entry.rateLimitWithKey ? entry.rateLimitWithKey : entry.rateLimit,
      secretParams: auth.param ? [auth.param] : [],
      allowStatus: entity.emptyStatus || entry.emptyStatus || [404],
      timeoutMs: entity.timeoutMs || entry.timeoutMs
    }
  }
}

function decodeBody (body, entity, params) {
  if (entity.format === 'tsv') return entity.parse ? entity.parse(body, params) : parseTsv(body)
  if (entity.format === 'xml') return entity.parse ? entity.parse(parseXml(body), params) : parseXml(body)
  if (entity.format === 'text') {
    if (!entity.parse) throw new Error('format "text" needs a parse(text) function')
    return entity.parse(body, params)
  }
  return body
}

function graphqlErrors (body) {
  if (!body || !Array.isArray(body.errors) || body.errors.length === 0) return null
  return body.errors.map((e) => e.message || JSON.stringify(e)).join('; ')
}

// ── Query execution ─────────────────────────────────────────────────────────

function resolveSource (connection) {
  const entry = sourceForConnection(connection)
  if (!entry) {
    throw new Error('The api driver needs a catalog source: pass `source: "<name>"` (see the catalog query), or a connection whose database is a catalog name or base URL')
  }
  if (entry.driver !== 'api') throw new Error(`Catalog entry "${entry.name}" uses the ${entry.driver} driver, not api`)
  return entry
}

/**
 * Fetch the raw records for one entity request (before field mapping).
 * Exported for the verification tooling.
 */
async function fetchRecords (entry, entity, params, { limit, offset, connection }) {
  if (entity.resolve) {
    const ctx = {
      entry,
      entity,
      limit,
      offset,
      base: baseUrlFor(entry, connection),
      request: (pathOrUrl, options = {}) => {
        const base = baseUrlFor(entry, connection)
        const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : base + pathOrUrl
        const key = apiKeyFor(connection, entry)
        const target = new URL(url)
        for (const [k, v] of Object.entries({ ...(entry.query || {}), ...(options.query || {}) })) {
          if (v != null) target.searchParams.set(k, String(v))
        }
        if (key && entry.auth && entry.auth.param) target.searchParams.set(entry.auth.param, key)
        return http.request(target.toString(), {
          headers: { ...(entry.connection.headers || {}), ...(options.headers || {}) },
          rateLimit: key && entry.rateLimitWithKey ? entry.rateLimitWithKey : entry.rateLimit,
          secretParams: entry.auth && entry.auth.param ? [entry.auth.param] : [],
          allowStatus: entity.emptyStatus || entry.emptyStatus || [404],
          ...options
        }).then((r) => r.body)
      }
    }
    if (entry.auth && entry.auth.required && !apiKeyFor(connection, entry)) {
      throw new Error(`Source "${entry.name}" requires an API key — pass apiKeys: { "${entry.name}": "…" }`)
    }
    // A resolve hook returns the records, or { records, serverOffset } when it
    // already skipped `offset` records upstream (so they are not skipped twice).
    const result = await entity.resolve(params, ctx)
    if (result && !Array.isArray(result) && Array.isArray(result.records)) {
      return { records: result.records, serverOffset: result.serverOffset || 0 }
    }
    return { records: result || [], serverOffset: 0 }
  }

  const req = buildRequest(entry, entity, params, { limit, offset, connection })
  const { body, status } = await http.request(req.url, req.options)
  if (body == null || (req.options.allowStatus.includes(status) && status >= 400)) {
    return { records: [], serverOffset: req.serverOffset }
  }

  const decoded = decodeBody(body, entity, params)
  if (entity.graphql) {
    const errors = graphqlErrors(decoded)
    if (errors && !getPath(decoded, 'data')) throw new Error(`${entry.name}/${entity.name}: ${errors}`)
  }
  return { records: extractRows(decoded, entity, params), serverOffset: req.serverOffset }
}

function sortRows (rows, orderBy, direction) {
  if (!orderBy) return rows
  const sign = direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = a[orderBy]
    const y = b[orderBy]
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
    return String(x).localeCompare(String(y)) * sign
  })
}

async function executeQuery (input) {
  const { connection, from, select, where, relations, limit, offset, orderBy, orderDirection, raw } = input
  const entry = resolveSource(connection)
  const entity = findEntity(entry, from)
  const params = resolveParams(entry, entity, where)

  const { records, serverOffset } = await fetchRecords(entry, entity, params, { limit, offset, connection })

  let rows = records.map((record) => (raw ? { ...record } : mapRecord(record, entity.fields, params)))

  // Client-side filters declared by the entity (parameters the API itself cannot apply).
  for (const [name, spec] of Object.entries(entity.params || {})) {
    if (spec.in === 'filter' && params[name] != null) {
      const field = spec.field || name
      const wanted = String(params[name]).toLowerCase()
      rows = rows.filter((row) => [].concat(row[field]).some((v) => v != null && String(v).toLowerCase() === wanted))
    }
  }

  rows = sortRows(rows, orderBy, orderDirection)

  const skip = Math.max(0, (offset || 0) - serverOffset)
  if (skip || limit != null) rows = rows.slice(skip, limit != null ? skip + limit : undefined)

  if (select && select.length > 0) {
    rows = rows.map((row) => Object.fromEntries(select.filter((f) => Object.hasOwn(row, f)).map((f) => [f, row[f]])))
  }

  if (relations && relations.length > 0 && rows.length > 0) {
    // Lazily required: the connector requires the registry, which requires this.
    const { executeQuery: run } = require('../connector')
    const { fetchRelation } = require('../relations')
    await Promise.all(relations.map((rel) => Promise.all(rows.map(async (row) => {
      const key = rel.alias || rel.entity
      try {
        row[key] = await fetchRelation(run, connection, row, rel)
      } catch (err) {
        row[key] = { error: `relation ${key} failed: ${err.message}` }
      }
    }))))
  }

  return { data: rows, count: rows.length }
}

async function introspect (connection) {
  const entry = resolveSource(connection)
  return {
    tables: entry.entities.map((entity) => ({
      name: entity.name,
      columns: entityColumns(entity).map((column) => ({
        name: column,
        type: 'unknown',
        nullable: true,
        defaultValue: null,
        isPrimaryKey: false
      }))
    }))
  }
}

module.exports = { executeQuery, introspect, fetchRecords, getPath, mapRecord, parseTsv, resolveParams, buildRequest }
