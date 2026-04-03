'use strict';

/**
 * Progressive JSON streaming endpoint.
 *
 * Inspired by https://overreacted.io/progressive-json/#inlining
 *
 * The response is a newline-separated stream of JSON chunks.  Each chunk is
 * either the initial envelope or a placeholder resolution:
 *
 *   {"count":3,"data":["$1","$2","$3"]}
 *   [dollar1] {"id":1,"name":"Alice","posts":"$4"}
 *   [dollar2] {"id":2,"name":"Bob","posts":"$5"}
 *   [dollar3] {"id":3,"name":"Charlie","posts":"$6"}
 *   [dollar4] [{"id":10,"title":"Post A"}]
 *   [dollar5] []
 *   [dollar6] [{"id":11,"title":"Post B"}]
 *
 * In the actual stream the [dollarN] prefix is written as: slash-star space $N space star-slash
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

const connector = require('./database/connector');

/**
 * Fetch the data for a single relation of a single parent row.
 *
 * Mirrors the hasMany / hasOne / belongsTo logic that lives inside the
 * per-driver loadRelations helpers, but operates through the public
 * executeQuery API so it works with every driver.
 *
 * Nested relations are resolved synchronously (non-progressively) inside
 * executeQuery – they do not get their own stream placeholders.
 */
async function fetchRelation(connection, row, rel) {
  const {
    entity,
    localKey = 'id',
    foreignKey,
    type = 'hasMany',
    select,
    where,
    relations: nested,
  } = rel;

  if (type === 'hasMany' || type === 'hasOne') {
    const parentId = row[localKey];
    if (parentId == null) return type === 'hasMany' ? [] : null;

    const { data } = await connector.executeQuery({
      connection,
      from: entity,
      select,
      where: { ...(where || {}), [foreignKey]: parentId },
      relations: nested,
    });
    return type === 'hasMany' ? data : (data[0] ?? null);
  }

  if (type === 'belongsTo') {
    const fkVal = row[foreignKey];
    if (fkVal == null) return null;

    const { data } = await connector.executeQuery({
      connection,
      from: entity,
      select,
      where: { ...(where || {}), id: fkVal },
      relations: nested,
    });
    return data[0] ?? null;
  }

  return null;
}

/**
 * Execute a query and stream the results to `res` using progressive JSON
 * inlining.
 *
 * @param {object} input  - QueryInput (same shape accepted by the /graphql query field)
 * @param {import('node:http').ServerResponse} res
 */
async function streamQuery(input, res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  });

  let nextId = 1;
  const next = () => `$${nextId++}`;

  try {
    // Phase 1 – fetch main entity rows without relations so the envelope can
    // be streamed as soon as the first database round-trip completes.
    const { data: rows, count } = await connector.executeQuery({ ...input, relations: undefined });

    const relations = input.relations || [];

    // When there are no relations (or no rows) we emit a single envelope line
    // with the full data inlined – no placeholders needed.
    if (relations.length === 0 || rows.length === 0) {
      res.write(JSON.stringify({ count, data: rows }) + '\n');
      res.end();
      return;
    }

    // Assign a placeholder id to every row in the result set.
    const rowIds = rows.map(() => next());

    // Stream the envelope immediately so the client knows the total count and
    // the overall shape of the data array.
    res.write(JSON.stringify({ count, data: rowIds }) + '\n');

    // Pre-assign placeholder ids for every (row × relation) pair.  We do this
    // before writing any row lines so that each row line can inline the correct
    // relation placeholder strings.
    // relIds[rowIndex][relIndex] = placeholder string
    const relIds = rows.map(() => relations.map(() => next()));

    // Stream each row immediately (we already have all rows from phase 1),
    // embedding the pre-assigned relation placeholder strings.
    for (let i = 0; i < rows.length; i++) {
      const rowData = { ...rows[i] };
      for (let j = 0; j < relations.length; j++) {
        const rel = relations[j];
        rowData[rel.alias || rel.entity] = relIds[i][j];
      }
      res.write(`/* ${rowIds[i]} */ ${JSON.stringify(rowData)}\n`);
    }

    // Phase 2 – fetch all relations concurrently.  Each relation result is
    // streamed as soon as it resolves, so faster relations appear earlier in
    // the stream regardless of row order.
    const tasks = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < relations.length; j++) {
        const placeholder = relIds[i][j];
        const row = rows[i];
        const rel = relations[j];

        tasks.push(
          fetchRelation(input.connection, row, rel)
            .then((value) => {
              res.write(`/* ${placeholder} */ ${JSON.stringify(value)}\n`);
            })
            .catch((err) => {
              res.write(`/* ${placeholder} */ ${JSON.stringify({ error: err.message })}\n`);
            }),
        );
      }
    }

    await Promise.all(tasks);
  } catch (err) {
    // If headers have already been written we cannot change the status code,
    // so we emit the error as a JSON object on the stream itself.
    res.write(JSON.stringify({ error: err.message }) + '\n');
  } finally {
    res.end();
  }
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
function handleStreamRequest(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
    res.end(JSON.stringify({ error: 'Method not allowed – use POST' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body must be valid JSON (QueryInput)' }));
      return;
    }

    streamQuery(input, res).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    });
  });
}

module.exports = { streamQuery, handleStreamRequest, fetchRelation };
