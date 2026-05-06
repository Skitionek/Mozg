'use strict'

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
 * Fetch a URL and return a normalised array of rows.
 */
async function fetchAndNormalise (url, headers) {
  const res = await globalThis.fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`REST fetch failed: ${res.status} ${res.statusText} — ${url}`)
  }
  const json = await res.json()
  return normalise(json)
}

async function executeQuery (input) {
  const {
    connection,
    from,
    select,
    where,
    relations,
    limit,
    offset
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

  // JSONPlaceholder-style pagination
  if (limit != null) rawUrl.searchParams.set('_limit', String(limit))
  if (offset != null) rawUrl.searchParams.set('_start', String(offset))

  const { url: authedUrl, headers: authHeaders } = buildAuth(connection, rawUrl.toString())

  // Merge extra headers from connection
  const extraHeaders =
    connection.headers && typeof connection.headers === 'object'
      ? connection.headers
      : {}

  const headers = { Accept: 'application/json', ...extraHeaders, ...authHeaders }

  let rows = await fetchAndNormalise(authedUrl, headers)

  rows = applySelect(rows, select)

  // Load relations
  if (relations && relations.length > 0) {
    await loadRelations(base, headers, rows, relations)
  }

  return { data: rows, count: rows.length }
}

async function loadRelations (base, headers, rows, relations) {
  if (!rows.length) return

  for (const rel of relations) {
    const {
      entity,
      localKey = 'id',
      foreignKey,
      alias,
      type = 'hasMany',
      select,
      relations: nested
    } = rel

    const resultKey = alias || entity
    const entityPath = entity.startsWith('/') ? entity : `/${entity}`

    for (const row of rows) {
      // Use foreignKey field on the parent row as the path segment per the spec:
      // sub-fetch to {base}/{entity}/{parentRow[foreignKey]}
      const pathVal = row[foreignKey] ?? row[localKey]
      if (pathVal == null) {
        row[resultKey] = type === 'hasMany' ? [] : null
        continue
      }

      try {
        const subUrl = `${base}${entityPath}/${pathVal}`
        const subRows = await fetchAndNormalise(subUrl, headers)
        const filtered = applySelect(subRows, select)

        if (nested && nested.length > 0) {
          await loadRelations(base, headers, filtered, nested)
        }

        row[resultKey] = type === 'hasMany' ? filtered : (filtered[0] ?? null)
      } catch (err) {
        // Return a partial result: primary row is preserved; the failed relation
        // is represented as an error object so the client can see what went wrong
        // without losing the rest of the query result.
        row[resultKey] = { error: `relation fetch failed: ${err.message}` }
      }
    }
  }
}

async function introspect (_connection) {
  return { tables: [] }
}

module.exports = { executeQuery, introspect }
