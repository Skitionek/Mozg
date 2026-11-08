'use strict'

const { introspectFromCatalog } = require('../catalog-schema')
const http = require('../http')
const { getPath } = require('./api')

const UNWRAP_KEYS = ['data', 'results', 'items', 'records', 'list', 'entries']

/** JSONPlaceholder / json-server paging and sorting parameters. */
const PAGING = { limit: '_limit', offset: '_start', sort: '_sort', order: '_order' }

/**
 * Settings a catalog entry declares for its API, applied whether a query
 * names the source or spells out the same base URL:
 *   paging   query parameter names for limit / offset / sort / order; a name
 *            set to null is done here instead (PokéAPI answers 403 to any
 *            parameter it does not know)
 *   unwrap   extra envelope keys holding the rows (MusicBrainz: `artists`)
 *   headers  default request headers (the caller's win)
 * and, beside the connection, `rateLimit` ({ requestsPerSecond,
 * maxConcurrent }) as `api` entries declare it.
 */
function sourceSettings (connection) {
  const { getCatalog, findCatalogsByDatabase } = require('../../catalog')
  const named = connection.source ? getCatalog(connection.source)[0] : null
  const entry = named || findCatalogsByDatabase(connection.database).find((e) => e.driver === 'rest')
  const declared = (entry && entry.connection) || {}
  const pick = (key) => connection[key] !== undefined ? connection[key] : declared[key]
  return {
    paging: { ...PAGING, ...(pick('paging') || {}) },
    unwrap: [...UNWRAP_KEYS, ...(pick('unwrap') || [])],
    headers: { ...(declared.headers || {}), ...(connection.headers && typeof connection.headers === 'object' ? connection.headers : {}) },
    rateLimit: entry ? entry.rateLimit : undefined
  }
}

/**
 * Build the Authorization / API-key header or query-param for the request.
 */
function buildAuth (connection, url) {
  const { user, password, apiKeyParam } = connection

  if (!user) return { url, headers: {} }

  // If apiKeyParam is set, place the key as a query parameter
  if (apiKeyParam) {
    const u = new URL(url)
    u.searchParams.set(apiKeyParam, user)
    return { url: u.toString(), headers: {} }
  }

  // user set but no password → Bearer token
  if (!password) {
    return { url, headers: { Authorization: `Bearer ${user}` } }
  }

  // user + password → Basic auth
  const encoded = Buffer.from(`${user}:${password}`).toString('base64')
  return { url, headers: { Authorization: `Basic ${encoded}` } }
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

/**
 * Normalise a parsed JSON response into an array.
 * Unwraps common envelope keys; wraps scalars/objects.
 */
function normalise (response, unwrap = UNWRAP_KEYS) {
  if (Array.isArray(response)) return response

  if (response && typeof response === 'object') {
    for (const key of unwrap) {
      if (Object.prototype.hasOwnProperty.call(response, key) && Array.isArray(response[key])) {
        return response[key]
      }
    }
    // One record in an envelope (`{data: {...}}` from Jikan and the Art
    // Institute); a record that merely has such a field carries its own id.
    const key = unwrap.find((k) => Object.hasOwn(response, k))
    if (key && !Object.hasOwn(response, 'id') && isPlainObject(response[key])) return [response[key]]
    return [response]
  }

  return [response]
}

/**
 * Apply select field filtering to an array of rows.
 */
function applySelect (rows, select) {
  if (!select || select.length === 0) return rows
  return rows.map((row) => {
    const filtered = {}
    for (const field of select) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        filtered[field] = row[field]
      }
    }
    return filtered
  })
}

/**
 * Fetch a URL and return a normalised array of rows, through the shared HTTP
 * client (timeouts, retries on transient failures, per-host throttling).
 */
async function fetchAndNormalise (url, headers, settings = {}) {
  try {
    const { body } = await http.request(url, { headers, rateLimit: settings.rateLimit })
    return normalise(body, settings.unwrap)
  } catch (err) {
    throw new Error(`REST fetch failed: ${err.message}`, { cause: err })
  }
}

function sortRows (rows, field, direction) {
  const sign = String(direction || 'asc').toLowerCase() === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = a[field]
    const y = b[field]
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sign
  })
}

async function executeQuery (input) {
  const {
    connection,
    from,
    select,
    where,
    relations,
    limit,
    offset,
    orderBy,
    orderDirection
  } = input

  const base = (connection.database || '').replace(/\/$/, '')
  const path = from.startsWith('/') ? from : `/${from}`

  const rawUrl = new URL(`${base}${path}`)

  // Add where filters as query params
  if (where && typeof where === 'object') {
    for (const [k, v] of Object.entries(where)) {
      rawUrl.searchParams.set(k, String(v))
    }
  }

  // Paging and sorting, under the parameter names the API uses.  Without an
  // offset parameter the server is asked for everything up to the end of the
  // page; without a sort parameter, for everything, since only a sorted
  // whole can be paged.
  const settings = sourceSettings(connection)
  const { paging } = settings
  const start = offset || 0
  const serverSorts = Boolean(orderBy && paging.sort)
  const serverPages = !orderBy || serverSorts
  const serverSkips = Boolean(serverPages && start > 0 && paging.offset)
  if (serverPages && limit != null && paging.limit) {
    rawUrl.searchParams.set(paging.limit, String(serverSkips ? limit : start + limit))
  }
  if (serverSkips) rawUrl.searchParams.set(paging.offset, String(start))
  if (serverSorts) {
    rawUrl.searchParams.set(paging.sort, String(orderBy))
    if (paging.order) rawUrl.searchParams.set(paging.order, String(orderDirection || 'asc'))
  }

  const { url: authedUrl, headers: authHeaders } = buildAuth(connection, rawUrl.toString())
  const headers = { Accept: 'application/json', ...settings.headers, ...authHeaders }

  let rows = await fetchAndNormalise(authedUrl, headers, settings)

  // Many APIs ignore paging and sorting parameters.  Sorting here is harmless
  // when the server already did it; more rows than `limit` means the server
  // ignored paging, so page here too.
  if (orderBy) rows = sortRows(rows, orderBy, orderDirection)
  const ignoredPaging = limit != null && rows.length > limit
  const skip = serverSkips && !ignoredPaging ? 0 : start
  if (skip > 0 || ignoredPaging) rows = rows.slice(skip, limit != null ? skip + limit : undefined)

  rows = applySelect(rows, select)

  // Load relations
  if (relations && relations.length > 0) {
    await loadRelations({ connection, base, headers, settings }, rows, relations)
  }

  return { data: rows, count: rows.length }
}

/**
 * The URL of a related record named by a value on the parent row: an
 * absolute URL as-is (SWAPI, Ghibli and Rick and Morty link records that
 * way), otherwise `{base}/{entity}/{value}`.  URLs found in data are only
 * followed on the connection's own origin, so an API response cannot steer
 * the server at another host.  A URL of the whole collection names no record
 * (Ghibli puts `/people/` where it has no list) and gives null.
 */
function recordUrl (base, entityPath, value) {
  const text = String(value)
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text)
    const collection = new URL(`${base}${entityPath}`)
    if (url.origin !== collection.origin) {
      throw new Error(`refusing to follow ${url.origin}: not this connection's origin`)
    }
    const trim = (path) => path.replace(/\/+$/, '')
    return trim(url.pathname) === trim(collection.pathname) && !url.search ? null : text
  }
  return `${base}${entityPath}/${encodeURIComponent(text)}`
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimited (items, limit, fn) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** A field of the row, or a path into it (`owner.login`, `types[].type.url`). */
function valueAt (row, key) {
  if (row == null || key == null) return null
  return Object.hasOwn(row, key) ? row[key] : getPath(row, key)
}

/** Split `items` into runs of at most `size`. */
function chunks (items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Parent keys sent in one request when a relation is `batch`. */
const BATCH_SIZE = 50

/**
 * Fetch a hasMany / hasOne relation for all rows in a few requests, by
 * repeating the filter: `/posts?userId=1&userId=2&…`.  Only for a relation
 * that says `batch: true`, i.e. whose API is known to take the filter that way
 * (json-server and so JSONPlaceholder do; most APIs take one value).
 *
 * Returns false, leaving the rows untouched, when it cannot be sure of the
 * answer — fewer than two distinct keys to fetch, a failed request, or a
 * record whose key was not asked for (the API ignored the filter) — so the
 * caller falls back to one request per row and the result is never wrong.
 */
async function loadBatchedFilter (ctx, rows, rel, { base, entityPath, withWhere, fetchRows, isScalar }) {
  const { localKey = 'id', foreignKey, type = 'hasMany', select, limit, relations: nested } = rel
  const resultKey = rel.alias || rel.entity
  const wanted = [...new Set(rows.map((row) => row[localKey]).filter(isScalar).map(String))]
  if (wanted.length < 2) return false

  let related
  try {
    related = []
    for (const keys of chunks(wanted, BATCH_SIZE)) {
      const url = withWhere(`${base}${entityPath}`)
      for (const key of keys) url.searchParams.append(foreignKey, key)
      related.push(...await fetchRows(url.toString()))
    }
    if (related.some((record) => !wanted.includes(String(valueAt(record, foreignKey))))) return false
  } catch {
    return false
  }

  const groups = new Map()
  for (const record of related) {
    const key = String(valueAt(record, foreignKey))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  // Group, then trim: `select` may leave out the very field the grouping used.
  // (loadRelations reports a nested failure on the row it concerns.)
  for (const row of rows) {
    const parentValue = row[localKey]
    let group = isScalar(parentValue) ? (groups.get(String(parentValue)) || []) : []
    if (type === 'hasMany' && limit != null) group = group.slice(0, limit)
    group = applySelect(structuredClone(group), select)
    if (nested && nested.length > 0 && group.length > 0) await loadRelations(ctx, group, nested)
    row[resultKey] = type === 'hasMany' ? group : (group[0] ?? null)
  }
  return true
}

/**
 * Relations, as RelationInput documents them:
 *   belongsTo         the parent's `foreignKey` value identifies the record
 *                     (an id → /entity/{id}, or a URL to fetch; of a list,
 *                     the first)
 *   hasMany / hasOne  related records whose `foreignKey` equals the parent's
 *                     `localKey` → /entity?{foreignKey}={value}; or, when the
 *                     parent's `foreignKey` field holds a list of ids or URLs
 *                     (SpaceX `launches`), those records
 * `foreignKey` may be a path into the parent (`location.url`,
 * `types[].type.url`): the parent then names the records itself.  An entity
 * path with `{field}` placeholders is filled from the parent and fetched as
 * is (Fake Store: `/carts/user/{id}`).
 * Lookups for different rows run a few at a time, and rows that name the same
 * record fetch it once.  A hasMany / hasOne relation that says `batch: true`
 * fetches for all rows at once (see loadBatchedFilter).
 */
async function loadRelations (ctx, rows, relations) {
  if (!rows.length) return
  const { connection, base, headers, settings } = ctx
  const fetchUncached = (url) => fetchAndNormalise(buildAuth(connection, url).url, headers, settings)

  for (const rel of relations) {
    // A relation naming another catalog entry is resolved against that
    // entry's own connection, by the connector.
    if (rel.catalog) {
      const { resolveCrossCatalogRelation } = require('../relations')
      const connector = require('../connector')
      await resolveCrossCatalogRelation(connector.executeQuery, rows, rel)
      continue
    }

    const {
      entity,
      localKey = 'id',
      foreignKey,
      alias,
      type = 'hasMany',
      select,
      where,
      limit,
      relations: nested
    } = rel

    const resultKey = alias || entity

    // Rows that name the same record (fifty posts by five authors) fetch it
    // once.  Each use gets its own copy: nested relations write into rows.
    const fetched = new Map()
    const fetchRows = (url) => {
      if (!fetched.has(url)) fetched.set(url, fetchUncached(url))
      return fetched.get(url).then((rows) => structuredClone(rows))
    }
    const entityPath = entity.startsWith('/') ? entity : `/${entity}`
    const placeholders = [...entityPath.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1])
    const withWhere = (url) => {
      const u = new URL(url)
      for (const [k, v] of Object.entries(where || {})) u.searchParams.set(k, String(v))
      return u
    }
    const isScalar = (v) => v != null && v !== '' && typeof v !== 'object'

    if (rel.batch && placeholders.length === 0 && type !== 'belongsTo' && !/[.[]/.test(foreignKey)) {
      if (await loadBatchedFilter(ctx, rows, rel, { base, entityPath, withWhere, fetchRows, isScalar })) continue
    }

    await mapLimited(rows, 4, async (row) => {
      const none = () => { row[resultKey] = type === 'hasMany' ? [] : null }
      try {
        let related
        if (placeholders.length > 0) {
          const values = Object.fromEntries(placeholders.map((p) => [p, valueAt(row, p)]))
          if (!Object.values(values).every(isScalar)) return none()
          const path = entityPath.replace(/\{([^{}]+)\}/g, (_, p) => encodeURIComponent(String(values[p])))
          related = await fetchRows(withWhere(`${base}${path}`).toString())
        } else {
          const refs = valueAt(row, foreignKey)
          const named = !Object.hasOwn(row, foreignKey) && /[.[]/.test(foreignKey)
          if (Array.isArray(refs)) {
            const urls = refs.filter(isScalar).map((r) => recordUrl(base, entityPath, r)).filter(Boolean)
            const cap = type !== 'hasMany' ? 1 : limit
            const wanted = cap != null ? urls.slice(0, cap) : urls
            related = (await Promise.all(wanted.map(fetchRows))).flat()
          } else if (type === 'belongsTo' || named) {
            const url = isScalar(refs) && recordUrl(base, entityPath, refs)
            if (!url) return none()
            related = await fetchRows(url)
          } else {
            const parentValue = row[localKey]
            if (!isScalar(parentValue)) return none()
            const url = withWhere(`${base}${entityPath}`)
            url.searchParams.set(foreignKey, String(parentValue))
            related = await fetchRows(url.toString())
          }
        }

        if (type === 'hasMany' && limit != null) related = related.slice(0, limit)
        related = applySelect(related, select)
        if (nested && nested.length > 0) await loadRelations(ctx, related, nested)
        row[resultKey] = type === 'hasMany' ? related : (related[0] ?? null)
      } catch (err) {
        // Return a partial result: primary row is preserved; the failed relation
        // is represented as an error object so the client can see what went wrong
        // without losing the rest of the query result.
        row[resultKey] = { error: `relation fetch failed: ${err.message}` }
      }
    })
  }
}

async function introspect (connection) {
  return introspectFromCatalog(connection)
}

module.exports = { executeQuery, introspect }
