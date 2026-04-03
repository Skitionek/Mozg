'use strict';

/**
 * Progressive JSON streaming endpoint — /stream
 *
 * Implements the "inlining" pattern described in
 * https://overreacted.io/progressive-json/#inlining
 *
 * Response format
 * ───────────────
 * 1. Skeleton sent immediately:
 *      {"count":"$1","data":"$2"}
 *
 * 2. Count resolved after the base query completes:
 *      /* $1 *\/
 *      42
 *
 * 3. Rows (with relation placeholders) written next:
 *      /* $2 *\/
 *      [{"id":1,"name":"Alice","posts":"$3"},{"id":2,"name":"Bob","posts":"$4"}]
 *
 * 4. Each relation is resolved in parallel; its chunk is written as soon as it
 *    returns (ordering is non-deterministic, which is expected by the protocol):
 *      /* $3 *\/
 *      [{"id":10,"title":"Hello","user_id":1}]
 *      /* $4 *\/
 *      []
 *
 * Clients should maintain a map of placeholder → location in the skeleton and
 * patch each value in as its chunk arrives.
 *
 * NOTE: relations are resolved with N+1 per-row sub-queries.
 * TODO(perf): batch relation queries per relation using whereIn, the same way
 *             the SQLite3 driver's loadRelations does it.
 */

/**
 * Return the placeholder token string for slot n.
 * @param {number} n
 * @returns {string}
 */
function slot(n) {
  return `$${n}`;
}

/**
 * Write a resolved chunk to the response stream.
 * @param {import('node:http').ServerResponse} res
 * @param {number} n - placeholder number
 * @param {unknown} value - resolved value (will be JSON-serialised)
 */
function writeChunk(res, n, value) {
  res.write(`/* $${n} */\n${JSON.stringify(value)}\n`);
}

/**
 * Resolve a single relation for one parent row.
 *
 * @param {Function} executeQuery - query executor (injectable for testing)
 * @param {object} connection - ConnectionInput
 * @param {object} relation   - RelationInput
 * @param {unknown} parentId  - the parent-side key value
 * @returns {Promise<unknown>} resolved relation data
 */
async function resolveRelation(executeQuery, connection, relation, parentId) {
  const {
    entity,
    foreignKey,
    type = 'hasMany',
    select,
    where,
    relations: nested,
  } = relation;

  if (parentId == null) {
    return type === 'hasMany' ? [] : null;
  }

  if (type === 'hasMany' || type === 'hasOne') {
    const result = await executeQuery({
      connection,
      from: entity,
      select,
      where: { ...where, [foreignKey]: parentId },
      relations: nested,
    });
    return type === 'hasMany' ? result.data : (result.data[0] ?? null);
  }

  if (type === 'belongsTo') {
    // parentId here is row[foreignKey] — the FK value pointing at the parent PK
    const result = await executeQuery({
      connection,
      from: entity,
      select,
      where: { ...where, id: parentId },
      relations: nested,
    });
    return result.data[0] ?? null;
  }

  return null;
}

/**
 * Create a progressive-JSON stream handler bound to a given query executor.
 * Exported separately so tests can inject a mock executor.
 *
 * @param {Function} executeQuery
 * @returns {Function} async (req, res) handler
 */
function createStreamHandler(executeQuery) {
  return async function handleStream(req, res) {
    // ── 1. Read and parse request body ──────────────────────────────────────
    let body = '';
    for await (const chunk of req) body += chunk;

    let input;
    try {
      input = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request: invalid JSON body');
      return;
    }

    if (!input || typeof input !== 'object' || !input.connection || !input.from) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request: body must include connection and from fields');
      return;
    }

    // ── 2. Start streaming ──────────────────────────────────────────────────
    res.writeHead(200, {
      'Content-Type': 'application/x-progressive-json; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });

    const relations = input.relations || [];

    // Skeleton — $1 = count, $2 = data array
    res.write(`{"count":"${slot(1)}","data":"${slot(2)}"}\n`);

    // ── 3. Execute base query (no relations) ────────────────────────────────
    let baseResult;
    try {
      baseResult = await executeQuery({ ...input, relations: [] });
    } catch (err) {
      res.write(`/* error */\n${JSON.stringify({ message: err.message })}\n`);
      res.end();
      return;
    }

    const rows = baseResult.data;

    // Resolve $1 — count
    writeChunk(res, 1, rows.length);

    if (relations.length === 0) {
      // No relations: data is already complete
      writeChunk(res, 2, rows);
      res.end();
      return;
    }

    // ── 4. Assign per-(row × relation) placeholders, starting at $3 ────────
    let counter = 3;

    // placeholderTasks: [{n, relation, parentId}]
    const placeholderTasks = [];

    const rowsWithPlaceholders = rows.map((row) => {
      const rowCopy = Object.assign({}, row);
      for (const rel of relations) {
        const n = counter++;
        const resultKey = rel.alias || rel.entity;
        rowCopy[resultKey] = slot(n);

        const relType = rel.type || 'hasMany';
        const parentId =
          relType === 'belongsTo'
            ? row[rel.foreignKey]           // FK is on this row
            : row[rel.localKey || 'id'];    // PK is on this row

        placeholderTasks.push({ n, relation: rel, parentId });
      }
      return rowCopy;
    });

    // Resolve $2 — rows with placeholders
    writeChunk(res, 2, rowsWithPlaceholders);

    // ── 5. Resolve all relations in parallel; write each chunk as it arrives ─
    await Promise.allSettled(
      placeholderTasks.map(({ n, relation, parentId }) =>
        resolveRelation(executeQuery, input.connection, relation, parentId)
          .then((data) => writeChunk(res, n, data))
          .catch((err) =>
            res.write(
              `/* $${n}-error */\n${JSON.stringify({ message: err.message })}\n`
            )
          )
      )
    );

    res.end();
  };
}

// Lazy default handler — the connector (and transitively graphql) is only loaded
// when handleStream is first called. Tests using createStreamHandler directly
// never trigger this require.
let _defaultHandler;

module.exports = {
  handleStream(req, res) {
    if (!_defaultHandler) {
      const { executeQuery } = require('./database/connector');
      _defaultHandler = createStreamHandler(executeQuery);
    }
    return _defaultHandler(req, res);
  },
  createStreamHandler,
};
