'use strict'

const { introspectFromCatalog } = require('../catalog-schema')
const http = require('../http')

const UNWRAP_KEYS = ['data', 'results', 'items', 'records', 'list', 'entries']

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

/**
 * Normalise a parsed JSON response into an array.
 * Unwraps common envelope keys; wraps scalars/objects.
 */
function normalise (response) {
  if (Array.isArray(response)) return response

  if (response && typeof response === 'object') {
    for (const key of UNWRAP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(response, key) && Array.isArray(response[key])) {
        return response[key]
      }
    }
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
async function fetchAndNormalise (url, headers) {
  try {
    const { body } = await http.request(url, { headers })
    return normalise(body)
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

  // JSONPlaceholder-style pagination and sorting
  if (limit != null) rawUrl.searchParams.set('_limit', String(limit))
  if (offset != null) rawUrl.searchParams.set('_start', String(offset))
  if (orderBy) {
    rawUrl.searchParams.set('_sort', String(orderBy))
    rawUrl.searchParams.set('_order', String(orderDirection || 'asc'))
  }

  const { url: authedUrl, headers: authHeaders } = buildAuth(connection, rawUrl.toString())

  // Merge extra headers from connection
  const extraHeaders =
    connection.headers && typeof connection.headers === 'object'
      ? connection.headers
      : {}

  const headers = { Accept: 'application/json', ...extraHeaders, ...authHeaders }

  let rows = await fetchAndNormalise(authedUrl, headers)

  // Most APIs ignore JSONPlaceholder's paging and sorting parameters.  Sorting
  // here is harmless when the server already did it; more rows than `limit`
  // means the server ignored paging, so page here too.
  if (orderBy) rows = sortRows(rows, orderBy, orderDirection)
  if (limit != null && rows.length > limit) rows = rows.slice(offset || 0, (offset || 0) + limit)

  rows = applySelect(rows, select)

  // Load relations
  if (relations && relations.length > 0) {
    await loadRelations({ connection, base, headers }, rows, relations)
  }

  return { data: rows, count: rows.length }
}

/**
 * The URL of a related record named by a value on the parent row: an
 * absolute URL as-is (SWAPI, Ghibli and Rick and Morty link records that
 * way), otherwise `{base}/{entity}/{value}`.  URLs found in data are only
 * followed on the connection's own origin, so an API response cannot steer
 * the server at another host.
 */
function recordUrl (base, entityPath, value) {
  const text = String(value)
  if (/^https?:\/\//i.test(text)) {
    if (new URL(text).origin !== new URL(base).origin) {
      throw new Error(`refusing to follow ${new URL(text).origin}: not this connection's origin`)
    }
    return text
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

/**
 * Relations, as RelationInput documents them:
 *   belongsTo         the parent's `foreignKey` value identifies the record
 *                     (an id → /entity/{id}, or a URL to fetch)
 *   hasMany / hasOne  related records whose `foreignKey` equals the parent's
 *                     `localKey` → /entity?{foreignKey}={value}; or, when the
 *                     parent's `foreignKey` field holds a list of ids or URLs
 *                     (SpaceX `launches`), those records
 * Lookups for different rows run a few at a time.
 */
async function loadRelations (ctx, rows, relations) {
  if (!rows.length) return
  const { connection, base, headers } = ctx

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
    const entityPath = entity.startsWith('/') ? entity : `/${entity}`

    await mapLimited(rows, 4, async (row) => {
      try {
        let related
        const refs = row[foreignKey]
        if (type === 'belongsTo') {
          if (refs == null) { row[resultKey] = null; return }
          related = await fetchAndNormalise(buildAuth(connection, recordUrl(base, entityPath, refs)).url, headers)
        } else if (Array.isArray(refs)) {
          related = (await Promise.all(refs.filter((r) => r != null).map((r) => fetchAndNormalise(buildAuth(connection, recordUrl(base, entityPath, r)).url, headers)))).flat()
        } else {
          const parentValue = row[localKey]
          if (parentValue == null) { row[resultKey] = type === 'hasMany' ? [] : null; return }
          const url = new URL(`${base}${entityPath}`)
          for (const [k, v] of Object.entries(where || {})) url.searchParams.set(k, String(v))
          url.searchParams.set(foreignKey, String(parentValue))
          related = await fetchAndNormalise(buildAuth(connection, url.toString()).url, headers)
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
