'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { createStreamHandler } = require('../src/stream');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock IncomingMessage whose async-iterable body yields
 * the serialised JSON of `payload`.
 */
function makeRequest(payload) {
  const body = JSON.stringify(payload);
  return Readable.from([body]);
}

/**
 * Build a minimal mock ServerResponse that records written chunks.
 * Resolves when res.end() is called.
 */
function makeResponse() {
  const chunks = [];
  let statusCode = 200;
  let headers = {};

  const res = {};
  res.writeHead = (code, hdrs = {}) => { statusCode = code; headers = hdrs; };
  res.write = (chunk) => { chunks.push(chunk); return true; };

  const endPromise = new Promise((resolve) => {
    res.end = (chunk) => {
      if (chunk) chunks.push(chunk);
      resolve({ statusCode, headers, body: chunks.join('') });
    };
  });

  return { res, endPromise };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Parse the progressive-JSON stream body into:
 *   { skeleton, chunks }
 * where skeleton is the parsed first-line JSON object and
 * chunks is a map of placeholder number → parsed value.
 */
function parseProgressiveJSON(body) {
  const lines = body.split('\n').filter((l) => l.trim() !== '');
  let skeleton = null;
  const chunks = {};

  let i = 0;
  // First non-empty line is the skeleton
  skeleton = JSON.parse(lines[i++]);

  while (i < lines.length) {
    const header = lines[i++];
    const m = header.match(/^\/\* \$(\d+)(?:-error)? \*\/$/);
    if (!m) continue;
    const n = Number(m[1]);
    const valueLine = lines[i++];
    if (valueLine !== undefined) {
      chunks[n] = JSON.parse(valueLine);
    }
  }

  return { skeleton, chunks };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleStream', () => {
  // Default stub — overridden per test where needed
  let executeQueryStub;

  beforeEach(() => {
    executeQueryStub = async () => ({ data: [], count: 0 });
  });

  function makeHandler() {
    return createStreamHandler((...args) => executeQueryStub(...args));
  }

  // ── Input validation ────────────────────────────────────────────────────────

  test('responds 400 for invalid JSON body', async () => {
    const req = Readable.from(['not-json']);
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;
    assert.equal(result.statusCode, 400);
  });

  test('responds 400 when connection field is missing', async () => {
    const req = makeRequest({ from: 'users' });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;
    assert.equal(result.statusCode, 400);
  });

  test('responds 400 when from field is missing', async () => {
    const req = makeRequest({ connection: { driver: 'sqlite3', database: ':memory:' } });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;
    assert.equal(result.statusCode, 400);
  });

  // ── No-relation path ────────────────────────────────────────────────────────

  test('streams skeleton then count and empty data for empty table', async () => {
    executeQueryStub = async () => ({ data: [], count: 0 });

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    assert.equal(result.statusCode, 200);

    const { skeleton, chunks } = parseProgressiveJSON(result.body);
    assert.equal(skeleton.count, '$1');
    assert.equal(skeleton.data, '$2');
    assert.equal(chunks[1], 0);
    assert.deepEqual(chunks[2], []);
  });

  test('streams count and rows correctly when no relations requested', async () => {
    const rows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
    executeQueryStub = async () => ({ data: rows, count: rows.length });

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    const { skeleton, chunks } = parseProgressiveJSON(result.body);
    assert.equal(skeleton.count, '$1');
    assert.equal(skeleton.data, '$2');
    assert.equal(chunks[1], 2);
    assert.deepEqual(chunks[2], rows);
  });

  // ── Relation path ───────────────────────────────────────────────────────────

  test('inserts placeholders for relations in data rows', async () => {
    const rows = [{ id: 1, name: 'Alice' }];
    const relRows = [{ id: 10, title: 'Hello', user_id: 1 }];

    executeQueryStub = async (input) => {
      // Base query (no relations)
      if (!input.where || !input.where.user_id) return { data: rows, count: 1 };
      // Relation query
      return { data: relRows, count: 1 };
    };

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
      relations: [
        { entity: 'posts', foreignKey: 'user_id', type: 'hasMany' },
      ],
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    const { skeleton, chunks } = parseProgressiveJSON(result.body);

    // Skeleton shape
    assert.equal(skeleton.count, '$1');
    assert.equal(skeleton.data, '$2');

    // Count
    assert.equal(chunks[1], 1);

    // Data rows — posts column should be a placeholder string
    const dataRows = chunks[2];
    assert.equal(dataRows.length, 1);
    assert.equal(dataRows[0].id, 1);
    assert.match(dataRows[0].posts, /^\$\d+$/);

    // The posts placeholder should be resolved
    const postsSlot = Number(dataRows[0].posts.slice(1));
    assert.deepEqual(chunks[postsSlot], relRows);
  });

  test('uses alias as result key when specified', async () => {
    const rows = [{ id: 1, name: 'Alice' }];
    executeQueryStub = async (input) => {
      if (!input.where || !input.where.user_id) return { data: rows, count: 1 };
      return { data: [], count: 0 };
    };

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
      relations: [
        { entity: 'posts', foreignKey: 'user_id', type: 'hasMany', alias: 'articles' },
      ],
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    const { chunks } = parseProgressiveJSON(result.body);
    const dataRows = chunks[2];
    // Result key should be 'articles', not 'posts'
    assert.match(dataRows[0].articles, /^\$\d+$/);
    assert.equal(dataRows[0].posts, undefined);
  });

  test('resolves belongsTo using foreignKey on the row', async () => {
    const rows = [{ id: 1, name: 'Post', user_id: 42 }];
    const parentRow = { id: 42, name: 'Alice' };

    executeQueryStub = async (input) => {
      if (input.where && input.where.id === 42) return { data: [parentRow], count: 1 };
      return { data: rows, count: 1 };
    };

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'posts',
      relations: [
        { entity: 'users', foreignKey: 'user_id', type: 'belongsTo' },
      ],
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    const { chunks } = parseProgressiveJSON(result.body);
    const dataRows = chunks[2];
    const userSlot = Number(dataRows[0].users.slice(1));
    assert.deepEqual(chunks[userSlot], parentRow);
  });

  test('resolves hasOne returning single object', async () => {
    const rows = [{ id: 1, name: 'Alice' }];
    const profileRow = { id: 5, user_id: 1, bio: 'hi' };

    executeQueryStub = async (input) => {
      if (input.where && input.where.user_id === 1) return { data: [profileRow], count: 1 };
      return { data: rows, count: 1 };
    };

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
      relations: [
        { entity: 'profiles', foreignKey: 'user_id', type: 'hasOne' },
      ],
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    const { chunks } = parseProgressiveJSON(result.body);
    const dataRows = chunks[2];
    const profileSlot = Number(dataRows[0].profiles.slice(1));
    assert.deepEqual(chunks[profileSlot], profileRow);
  });

  test('multiple relations per row each get distinct placeholders', async () => {
    const rows = [{ id: 1, name: 'Alice' }];
    const posts = [{ id: 10, user_id: 1 }];
    const orders = [{ id: 20, user_id: 1 }];

    executeQueryStub = async (input) => {
      if (input.from === 'posts') return { data: posts, count: 1 };
      if (input.from === 'orders') return { data: orders, count: 1 };
      return { data: rows, count: 1 };
    };

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
      relations: [
        { entity: 'posts', foreignKey: 'user_id', type: 'hasMany' },
        { entity: 'orders', foreignKey: 'user_id', type: 'hasMany' },
      ],
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    const { chunks } = parseProgressiveJSON(result.body);
    const dataRows = chunks[2];

    const postsSlot = Number(dataRows[0].posts.slice(1));
    const ordersSlot = Number(dataRows[0].orders.slice(1));

    assert.notEqual(postsSlot, ordersSlot);
    assert.deepEqual(chunks[postsSlot], posts);
    assert.deepEqual(chunks[ordersSlot], orders);
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  test('streams error chunk when base query fails', async () => {
    executeQueryStub = async () => { throw new Error('DB connection failed'); };

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    assert.match(result.body, /\/\* error \*\//);
    assert.match(result.body, /DB connection failed/);
  });

  test('streams per-slot error chunk when relation query fails', async () => {
    const rows = [{ id: 1, name: 'Alice' }];
    executeQueryStub = async (input) => {
      if (input.where && 'user_id' in input.where) throw new Error('relation failed');
      return { data: rows, count: 1 };
    };

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany' }],
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    // An error chunk should appear, e.g. /* $3-error */
    assert.match(result.body, /\* \$\d+-error \*\//);
    assert.match(result.body, /relation failed/);
  });

  test('null parentId for hasMany yields empty array without extra DB call', async () => {
    let queryCalls = 0;
    const rows = [{ id: null, name: 'Alice' }];
    executeQueryStub = async () => {
      queryCalls++;
      if (queryCalls === 1) return { data: rows, count: 1 };
      throw new Error('should not be called for null parentId');
    };

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
      relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany' }],
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    const { chunks } = parseProgressiveJSON(result.body);
    const dataRows = chunks[2];
    const postsSlot = Number(dataRows[0].posts.slice(1));
    assert.deepEqual(chunks[postsSlot], []);
  });

  // ── Content-Type header ─────────────────────────────────────────────────────

  test('sets application/x-progressive-json content-type', async () => {
    executeQueryStub = async () => ({ data: [], count: 0 });

    const req = makeRequest({
      connection: { driver: 'sqlite3', database: ':memory:' },
      from: 'users',
    });
    const { res, endPromise } = makeResponse();
    makeHandler()(req, res);
    const result = await endPromise;

    assert.match(result.headers['Content-Type'], /application\/x-progressive-json/);
  });
});
