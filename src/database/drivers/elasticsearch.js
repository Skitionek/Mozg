'use strict';

/**
 * Elasticsearch driver.
 *
 * Translates Mozg query inputs into Elasticsearch REST API calls.
 * The `from` field maps to the index name (e.g. "documents", "genes").
 * The `where` object may contain any Elasticsearch query parameters;
 * a special key `_body` (JSON string) is used as the request body for
 * POST-based search queries. All other where keys are passed as query params.
 *
 * Authentication is supported via:
 *  - user + password → HTTP Basic auth
 *  - user alone      → Bearer token
 *
 * Connection properties:
 *  database:  Base URL (e.g. "http://localhost:9200")
 *  user:      Optional username or API key
 *  password:  Optional password
 *
 * Examples (POST body search):
 *  { from: "genes", where: { _body: '{"query":{"match":{"name":"BRCA1"}}}' } }
 *  { from: "documents/_search", where: { q: "apoptosis", size: "10" } }
 */

const UNWRAP_KEYS = ['hits', 'documents', 'results', 'items', 'records'];

function buildAuth(connection) {
  const { user, password } = connection;
  if (!user) return {};
  if (!password) return { Authorization: `Bearer ${user}` };
  const encoded = Buffer.from(`${user}:${password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

function normalise(response) {
  if (Array.isArray(response)) return response;

  // Elasticsearch _search response: { hits: { hits: [...] } }
  if (response && response.hits && Array.isArray(response.hits.hits)) {
    return response.hits.hits.map(h => ({ _id: h._id, _score: h._score, ...h._source }));
  }

  if (response && typeof response === 'object') {
    for (const key of UNWRAP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(response, key)) {
        const val = response[key];
        if (Array.isArray(val)) return val;
        if (val && typeof val === 'object') return [val];
      }
    }
    return [response];
  }

  return [response];
}

function applySelect(rows, select) {
  if (!select || select.length === 0) return rows;
  return rows.map((row) => {
    const filtered = {};
    for (const field of select) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        filtered[field] = row[field];
      }
    }
    return filtered;
  });
}

async function executeQuery(input) {
  const {
    connection,
    from,
    select,
    where,
    limit,
    offset,
  } = input;

  const base = (connection.database || '').replace(/\/$/, '');
  const indexPath = from.startsWith('/') ? from : `/${from}`;

  const authHeaders = buildAuth(connection);
  const extraHeaders =
    connection.headers && typeof connection.headers === 'object'
      ? connection.headers
      : {};

  let url;
  let method;
  let body;
  let headers;

  const queryParams = where && typeof where === 'object'
    ? Object.fromEntries(Object.entries(where).filter(([k]) => k !== '_body'))
    : {};

  if (limit != null) queryParams.size = String(limit);
  if (offset != null) queryParams.from = String(offset);

  const rawUrl = new URL(`${base}${indexPath}`);
  for (const [k, v] of Object.entries(queryParams)) {
    rawUrl.searchParams.set(k, v);
  }
  url = rawUrl.toString();

  // If a JSON body is provided, use POST /_search
  const bodyStr = where && where._body ? where._body : null;
  if (bodyStr) {
    // Append /_search if not already present
    if (!url.endsWith('/_search') && !url.includes('/_search?')) {
      const u = new URL(url);
      u.pathname = u.pathname.replace(/\/?$/, '/_search');
      url = u.toString();
    }
    method = 'POST';
    body = bodyStr;
    headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders,
      ...authHeaders,
    };
  } else {
    method = 'GET';
    headers = {
      'Accept': 'application/json',
      ...extraHeaders,
      ...authHeaders,
    };
  }

  const res = await globalThis.fetch(url, {
    method,
    headers,
    ...(body ? { body } : {}),
  });

  if (!res.ok) {
    throw new Error(`Elasticsearch request failed: ${res.status} ${res.statusText} — ${url}`);
  }

  const json = await res.json();
  let rows = normalise(json);
  rows = applySelect(rows, select);

  return { data: rows, count: rows.length };
}

async function introspect(connection) {
  const base = (connection.database || '').replace(/\/$/, '');
  const authHeaders = buildAuth(connection);
  const headers = { 'Accept': 'application/json', ...authHeaders };

  try {
    const res = await globalThis.fetch(`${base}/_cat/indices?format=json`, { headers });
    if (!res.ok) return { tables: [] };
    const indices = await res.json();
    const tables = Array.isArray(indices)
      ? indices.map(idx => ({ name: idx.index || idx['index'], columns: [] }))
      : [];
    return { tables };
  } catch (_err) {
    return { tables: [] };
  }
}

module.exports = { executeQuery, introspect };
