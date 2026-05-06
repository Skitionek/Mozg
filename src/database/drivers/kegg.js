'use strict'

/**
 * KEGG driver – Kyoto Encyclopedia of Genes and Genomes REST API adapter.
 *
 * KEGG (rest.kegg.jp) returns text/plain instead of JSON.  This driver
 * fetches the raw text and converts it to plain JS objects so the rest of
 * Mozg can query it like any other data source.
 *
 * ── URL construction ───────────────────────────────────────────────────────
 * The entity name (from) becomes the URL path.  If `where._pathSuffix` is
 * provided it is appended as an extra path segment (URL-encoded).  This is
 * needed for KEGG operations whose "arguments" are path components, not
 * query-string parameters:
 *
 *   /find/compound  + where._pathSuffix="glucose"  → /find/compound/glucose
 *   /link/pathway   + where._pathSuffix="hsa:7157" → /link/pathway/hsa%3A7157
 *   /get            + where._pathSuffix="C00031"   → /get/C00031
 *
 * All other `where` entries are silently ignored; KEGG does not accept
 * arbitrary query parameters on any of the endpoints above.
 *
 * ── Response formats ───────────────────────────────────────────────────────
 * /list/{db}            TSV (entry_id ⇥ name)   → [{ entry_id, name }]
 * /find/{db}/{query}    TSV (entry_id ⇥ name)   → [{ entry_id, name }]
 * /link/{target}/{src}  TSV (source_id ⇥ target_id) → [{ source_id, target_id }]
 * /get/{entry}          KEGG flat-file          → [{ <parsed fields…> }]
 * /info/{db}            TSV (entry_id ⇥ name)   → [{ entry_id, name }]
 *
 * ── Pagination ─────────────────────────────────────────────────────────────
 * KEGG /list and /link responses are returned in full (no server-side
 * pagination).  The driver slices the result array when `limit`/`offset` are
 * provided so callers still get expected behaviour.
 */

// Separator used when appending continuation lines to the current field value
const CONTINUATION_SEP = '; '

/**
 * Parse a tab-delimited KEGG response into an array of row objects.
 * @param {string} text    raw response body
 * @param {string[]} cols  column names for the two tab-separated fields
 * @returns {object[]}
 */
function parseTsv (text, cols) {
  const rows = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split('\t')
    const row = {}
    for (let i = 0; i < cols.length; i++) {
      row[cols[i]] = parts[i] !== undefined ? parts[i] : null
    }
    rows.push(row)
  }
  return rows
}

/**
 * Parse a KEGG flat-file entry (returned by /get/{entry}).
 *
 * Field records begin at column 0 with an UPPERCASE key followed by
 * whitespace and a value.  Continuation lines are indented.  A single
 * entry terminates at the `///` separator.
 *
 * When a key appears more than once its values are collected into an array.
 *
 * Returns a single-element array so the result is consistent with other
 * parsers (callers always receive an array of rows).
 *
 * @param {string} text  raw flat-file text
 * @returns {object[]}
 */
function parseFlatFile (text) {
  const result = {}
  let currentKey = null

  for (const line of text.split('\n')) {
    if (line.startsWith('///')) break

    // Field line: starts with an UPPERCASE key at column 0
    const fieldMatch = line.match(/^([A-Z_]+)\s+(.*)/)
    if (fieldMatch) {
      currentKey = fieldMatch[1].toLowerCase()
      const value = fieldMatch[2].trim()

      if (Object.prototype.hasOwnProperty.call(result, currentKey)) {
        const existing = result[currentKey]
        if (Array.isArray(existing)) {
          existing.push(value)
        } else {
          result[currentKey] = [existing, value]
        }
      } else {
        result[currentKey] = value
      }
    } else if (currentKey) {
      // Continuation line – append to the current key's value
      const cont = line.trim()
      if (!cont) continue

      const existing = result[currentKey]
      if (Array.isArray(existing)) {
        existing[existing.length - 1] += CONTINUATION_SEP + cont
      } else {
        result[currentKey] = existing + CONTINUATION_SEP + cont
      }
    }
  }

  return [result]
}

/**
 * Choose the right parser based on the first path segment.
 * @param {string} text  raw response body
 * @param {string} path  the request path (e.g. "/find/compound/glucose")
 * @returns {object[]}
 */
function parseResponse (text, path) {
  const family = path.replace(/^\/+/, '').split('/')[0]

  if (family === 'get') {
    return parseFlatFile(text)
  }

  if (family === 'link') {
    return parseTsv(text, ['source_id', 'target_id'])
  }

  // /list, /find, /info → entry_id + name
  return parseTsv(text, ['entry_id', 'name'])
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Filter rows to the requested columns.
 * @param {object[]} rows
 * @param {string[]|undefined} select
 * @returns {object[]}
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

// ── Public API ───────────────────────────────────────────────────────────────

async function executeQuery (input) {
  const {
    connection,
    from,
    select,
    where,
    limit,
    offset
  } = input

  const base = (connection.database || '').replace(/\/$/, '')
  const path = from.startsWith('/') ? from : `/${from}`

  // Append _pathSuffix as a path segment when provided (used for /find, /link, /get)
  let fullPath = path
  if (where && where._pathSuffix != null) {
    fullPath = `${path}/${encodeURIComponent(String(where._pathSuffix))}`
  }

  const url = `${base}${fullPath}`

  const res = await globalThis.fetch(url, {
    headers: { Accept: 'text/plain, */*' }
  })

  if (!res.ok) {
    throw new Error(`KEGG fetch failed: ${res.status} ${res.statusText} — ${url}`)
  }

  const text = await res.text()
  let rows = parseResponse(text, fullPath)

  rows = applySelect(rows, select)

  // Client-side pagination (KEGG returns full lists)
  const start = offset != null ? offset : 0
  const end = limit != null ? start + limit : undefined
  const page = end != null ? rows.slice(start, end) : rows.slice(start)

  return { data: page, count: rows.length }
}

async function introspect (_connection) {
  return { tables: [] }
}

module.exports = { executeQuery, introspect, parseTsv, parseFlatFile, parseResponse }
