'use strict'

/**
 * Progressive JSON streaming endpoint.
 *
 * Inspired by https://overreacted.io/progressive-json/#inlining
 *
 * The response is a newline-separated stream of JSON chunks.  Each chunk is
 * either the initial envelope or a placeholder resolution:
 *
 *   {"count":3,"data":"$1"}
 *   [dollar1] [{"id":1,"name":"Alice","posts":"$2"},{"id":2,"name":"Bob","posts":"$3"},{"id":3,"name":"Charlie","posts":"$4"}]
 *   [dollar2] [{"id":10,"title":"Post A"}]
 *   [dollar3] []
 *   [dollar4] [{"id":11,"title":"Post B"}]
 *
 * In the actual stream the [dollarN] prefix is written as: slash-star space $N space star-slash
 * One ref = one data-source query round-trip:
 *   $1 is always the main entity query (the full rows array).
 *   $2…$N are individual per-row relation queries.
 * Strings of the form "$N" (where N is a positive integer) are placeholders.
 * Each subsequent line whose prefix matches that pattern resolves the
 * placeholder.  All placeholder lines are valid JSON after stripping the prefix.
 *
 * When no relations are requested, or the main query returns no rows, the
 * data is emitted in a single envelope line without placeholders.
 *
 * Protocol
 * --------
 *   POST /stream
 *   Content-Type: application/json
 *   Body: QueryInput (same shape as the `query` GraphQL variable)
 *
 * Response headers
 *   Content-Type: text/plain; charset=utf-8
 *   Transfer-Encoding: chunked
 */

const connector = require('./database/connector')
const { fetchRelation: fetchRelationRows, connectionForCatalog } = require('./database/relations')
const { redactCredentials } = require('./errors')

/**
 * Fetch the data for a single relation of a single parent row.
 *
 * Delegates to the shared resolver so the streaming path and the ordinary
 * query path agree on relation semantics, while still going through
 * `connector.executeQuery` so every driver is supported.
 */
async function fetchRelation (connection, row, rel) {
  const target = rel.catalog ? connectionForCatalog(rel.catalog) : connection
  return fetchRelationRows((input) => connector.executeQuery(input), target, row, rel)
}

/**
 * Execute a query and stream the results to `res` using progressive JSON
 * inlining.
 *
 * @param {object} input  - QueryInput (same shape accepted by the /graphql query field)
 * @param {import('node:http').ServerResponse} res
 */
async function streamQuery (input, res) {
  let nextId = 1
  const next = () => `$${nextId++}`

  // Phase 1 – fetch main entity rows without relations so the envelope can
  // be streamed as soon as the first database round-trip completes.  This runs
  // before any header is written: a failure here still reaches the caller as a
  // real HTTP status rather than a 200 whose body merely mentions an error.
  const { data: rows, count } = await connector.executeQuery({ ...input, relations: undefined })

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache'
  })

  try {
    const relations = input.relations || []

    // When there are no relations (or no rows) we emit a single envelope line
    // with the full data inlined – no placeholders needed.
    if (relations.length === 0 || rows.length === 0) {
      res.write(JSON.stringify({ count, data: rows }) + '\n')
      res.end()
      return
    }

    // One placeholder for the whole data array (one data-source query = one ref).
    const dataRef = next()

    // Pre-assign placeholder ids for every (row × relation) pair before writing
    // anything, so that the data line can embed the correct refs.
    // relIds[rowIndex][relIndex] = placeholder string
    const relIds = rows.map(() => relations.map(() => next()))

    // Stream the envelope immediately so the client knows the total count and
    // the placeholder for the rows array.
    res.write(JSON.stringify({ count, data: dataRef }) + '\n')

    // Stream the rows array as the resolution of dataRef, embedding the
    // pre-assigned relation placeholder strings in each row.
    const rowsWithPlaceholders = rows.map((row, i) => {
      const rowData = { ...row }
      for (let j = 0; j < relations.length; j++) {
        rowData[relations[j].alias || relations[j].entity] = relIds[i][j]
      }
      return rowData
    })
    res.write(`/* ${dataRef} */ ${JSON.stringify(rowsWithPlaceholders)}\n`)

    // Phase 2 – fetch all relations concurrently.  Each relation result is
    // streamed as soon as it resolves, so faster relations appear earlier in
    // the stream regardless of row order.
    const tasks = []
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < relations.length; j++) {
        const placeholder = relIds[i][j]
        const row = rows[i]
        const rel = relations[j]

        tasks.push(
          fetchRelation(input.connection, row, rel)
            .then((value) => {
              res.write(`/* ${placeholder} */ ${JSON.stringify(value)}\n`)
            })
            .catch((err) => {
              res.write(`/* ${placeholder} */ ${JSON.stringify({ error: redactCredentials(err.message) })}\n`)
            })
        )
      }
    }

    await Promise.all(tasks)
  } catch (err) {
    // The status line is already on the wire by this point, so a late failure
    // can only be reported as a JSON object on the stream itself.
    res.write(JSON.stringify({ error: redactCredentials(err.message) }) + '\n')
  } finally {
    res.end()
  }
}

// An unbounded body lets one request exhaust memory; /stream only ever
// receives a QueryInput, which is small.
const MAX_BODY_BYTES = 1024 * 1024

// `getDriver` rejects an unrecognised driver name — that is the caller's
// mistake, not a server fault, so it should not read as a 500.
function statusForError (err) {
  return /^Unknown driver:/.test(err.message) ? 400 : 500
}

/**
 * HTTP request handler for `POST /stream`.
 *
 * Reads the full request body as JSON (QueryInput), then delegates to
 * streamQuery.  Writes a 400 or 500 error response when the request body
 * cannot be parsed or when streamQuery throws before the response has started.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handleStreamRequest (req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' })
    res.end(JSON.stringify({ error: 'Method not allowed – use POST' }))
    return
  }

  let body = ''
  let bodyBytes = 0
  let rejected = false

  req.on('data', (chunk) => {
    if (rejected) return

    bodyBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    if (bodyBytes > MAX_BODY_BYTES) {
      rejected = true
      // Destroying the request straight away can tear down the socket before
      // the 413 response finishes writing to it; wait for the response to
      // flush, then stop the client from sending any more of the oversized body.
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes` }))
      res.once('finish', () => { if (typeof req.destroy === 'function') req.destroy() })
      return
    }

    body += chunk
  })

  req.on('end', () => {
    if (rejected) return

    let input
    try {
      input = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body must be valid JSON (QueryInput)' }))
      return
    }

    if (!input || typeof input !== 'object' || !input.connection || !input.from) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request body must include connection and from fields' }))
      return
    }

    streamQuery(input, res).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(statusForError(err), { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: redactCredentials(err.message) }))
      } else {
        res.end()
      }
    })
  })
}

module.exports = { streamQuery, handleStreamRequest, fetchRelation }
