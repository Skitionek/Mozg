'use strict';

const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Helpers – lightweight mock of node:http ServerResponse
// ---------------------------------------------------------------------------
function makeRes() {
  const chunks = [];
  return {
    statusCode: null,
    headers: {},
    written: chunks,
    headersSent: false,
    writeHead(code, hdrs) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...(hdrs || {}) };
      this.headersSent = true;
    },
    write(chunk) {
      chunks.push(String(chunk));
    },
    end(chunk) {
      if (chunk != null) chunks.push(String(chunk));
      this.ended = true;
    },
    body() {
      return chunks.join('');
    },
  };
}

function makeReq(method, body) {
  const listeners = {};
  const req = {
    method,
    on(event, fn) { listeners[event] = fn; return this; },
    emit(event, data) { if (listeners[event]) listeners[event](data); },
  };
  // Simulate async body delivery
  process.nextTick(() => {
    if (body != null) req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

// ---------------------------------------------------------------------------
// Mock the executeQuery dependency so the test never hits a real database
// ---------------------------------------------------------------------------
const connector = require('../src/database/connector');

describe('streamQuery', () => {
  const { streamQuery } = require('../src/stream');

  test('emits a single envelope line when there are no relations', async () => {
    mock.method(connector, 'executeQuery', async () => ({
      data: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
      count: 2,
    }));

    const res = makeRes();
    await streamQuery({ connection: { driver: 'sqlite3', database: ':memory:' }, from: 'users' }, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.ended);

    const lines = res.body().trim().split('\n');
    assert.equal(lines.length, 1, 'should be a single line when no relations');

    const envelope = JSON.parse(lines[0]);
    assert.equal(envelope.count, 2);
    assert.deepEqual(envelope.data, [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
  });

  test('emits a single envelope line when result set is empty', async () => {
    mock.method(connector, 'executeQuery', async () => ({ data: [], count: 0 }));

    const res = makeRes();
    await streamQuery(
      {
        connection: { driver: 'sqlite3', database: ':memory:' },
        from: 'users',
        relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany' }],
      },
      res,
    );

    const lines = res.body().trim().split('\n');
    assert.equal(lines.length, 1);
    const envelope = JSON.parse(lines[0]);
    assert.equal(envelope.count, 0);
    assert.deepEqual(envelope.data, []);
  });

  test('streams envelope + data line + relation lines when relations present', async () => {
    let callCount = 0;
    mock.method(connector, 'executeQuery', async (input) => {
      callCount++;
      if (callCount === 1) {
        // Main query (relations stripped)
        return {
          data: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
          count: 2,
        };
      }
      // Relation queries
      if (input.where && input.where.user_id === 1) {
        return { data: [{ id: 10, title: 'Post A' }], count: 1 };
      }
      return { data: [], count: 0 };
    });

    const res = makeRes();
    await streamQuery(
      {
        connection: { driver: 'sqlite3', database: ':memory:' },
        from: 'users',
        relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany' }],
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.ok(res.ended);

    const lines = res.body().trim().split('\n');
    // envelope + 1 data line + 2 relation lines = 4
    assert.equal(lines.length, 4, `expected 4 lines, got: ${res.body()}`);

    // Line 0: envelope — data is a single placeholder ref string
    const envelope = JSON.parse(lines[0]);
    assert.equal(envelope.count, 2);
    assert.match(envelope.data, /^\$\d+$/, 'data should be a single ref string');

    // Line 1: data array resolution — all rows with relation placeholders
    assert.match(lines[1], /^\/\* \$\d+ \*\/ /);
    const rowsData = JSON.parse(lines[1].replace(/^\/\* \$\d+ \*\/ /, ''));
    assert.ok(Array.isArray(rowsData), 'data resolution should be an array of rows');
    assert.equal(rowsData.length, 2);
    const row0 = rowsData[0];
    assert.equal(row0.id, 1);
    assert.equal(row0.name, 'Alice');
    // The posts field should be a placeholder string
    assert.match(row0.posts, /^\$\d+$/);

    // Lines 2–3: relation resolutions
    const bodies = lines.slice(2).map((l) => JSON.parse(l.replace(/^\/\* \$\d+ \*\/ /, '')));
    const withPost = bodies.find((b) => Array.isArray(b) && b.length > 0);
    assert.ok(withPost, 'at least one relation result should be non-empty');
    assert.equal(withPost[0].id, 10);
  });

  test('relation placeholder in row uses alias when provided', async () => {
    mock.method(connector, 'executeQuery', async (input) => {
      if (!input.where) return { data: [{ id: 1 }], count: 1 };
      return { data: [], count: 0 };
    });

    const res = makeRes();
    await streamQuery(
      {
        connection: { driver: 'sqlite3', database: ':memory:' },
        from: 'users',
        relations: [{ entity: 'posts', foreignKey: 'user_id', alias: 'articles', type: 'hasMany' }],
      },
      res,
    );

    const lines = res.body().trim().split('\n');
    // lines[1] is the data array: /* $1 */ [{"id":1,"articles":"$2"}]
    const rowsData = JSON.parse(lines[1].replace(/^\/\* \$\d+ \*\/ /, ''));
    assert.ok(Array.isArray(rowsData), 'data resolution should be an array');
    const rowData = rowsData[0];
    assert.ok('articles' in rowData, 'alias should be used as the key');
    assert.ok(!('posts' in rowData), 'entity name should not appear when alias is set');
  });

  test('streams an error object for a failing relation without aborting other relations', async () => {
    let callCount = 0;
    mock.method(connector, 'executeQuery', async (input) => {
      callCount++;
      if (callCount === 1) return { data: [{ id: 1 }, { id: 2 }], count: 2 };
      if (input.where && input.where.user_id === 1) throw new Error('DB timeout');
      return { data: [{ id: 99 }], count: 1 };
    });

    const res = makeRes();
    await streamQuery(
      {
        connection: { driver: 'sqlite3', database: ':memory:' },
        from: 'users',
        relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany' }],
      },
      res,
    );

    const lines = res.body().trim().split('\n');
    // envelope + 1 data line + 2 relation lines = 4
    const relLines = lines.slice(2).map((l) => JSON.parse(l.replace(/^\/\* \$\d+ \*\/ /, '')));

    const errLine = relLines.find((b) => b && b.error);
    assert.ok(errLine, 'failed relation should produce an error object');
    assert.equal(errLine.error, 'DB timeout');

    const successLine = relLines.find((b) => Array.isArray(b) && b.length > 0);
    assert.ok(successLine, 'successful relation should still be streamed');
  });
});

describe('fetchRelation', () => {
  const { fetchRelation } = require('../src/stream');

  test('hasMany returns array', async () => {
    mock.method(connector, 'executeQuery', async () => ({
      data: [{ id: 10 }, { id: 11 }],
      count: 2,
    }));

    const result = await fetchRelation(
      { driver: 'sqlite3', database: ':memory:' },
      { id: 1 },
      { entity: 'posts', foreignKey: 'user_id', type: 'hasMany' },
    );
    assert.deepEqual(result, [{ id: 10 }, { id: 11 }]);
  });

  test('hasOne returns first element or null', async () => {
    mock.method(connector, 'executeQuery', async () => ({
      data: [{ id: 5 }],
      count: 1,
    }));

    const result = await fetchRelation(
      { driver: 'sqlite3', database: ':memory:' },
      { id: 1 },
      { entity: 'profile', foreignKey: 'user_id', type: 'hasOne' },
    );
    assert.deepEqual(result, { id: 5 });
  });

  test('hasMany returns empty array when localKey is null', async () => {
    const result = await fetchRelation(
      { driver: 'sqlite3', database: ':memory:' },
      { id: null },
      { entity: 'posts', localKey: 'id', foreignKey: 'user_id', type: 'hasMany' },
    );
    assert.deepEqual(result, []);
  });

  test('belongsTo returns first related row', async () => {
    mock.method(connector, 'executeQuery', async () => ({
      data: [{ id: 3, name: 'Engineering' }],
      count: 1,
    }));

    const result = await fetchRelation(
      { driver: 'sqlite3', database: ':memory:' },
      { id: 1, dept_id: 3 },
      { entity: 'departments', foreignKey: 'dept_id', type: 'belongsTo' },
    );
    assert.deepEqual(result, { id: 3, name: 'Engineering' });
  });

  test('belongsTo returns null when foreignKey is null', async () => {
    const result = await fetchRelation(
      { driver: 'sqlite3', database: ':memory:' },
      { id: 1, dept_id: null },
      { entity: 'departments', foreignKey: 'dept_id', type: 'belongsTo' },
    );
    assert.equal(result, null);
  });

  test('unknown relation type returns null', async () => {
    const result = await fetchRelation(
      { driver: 'sqlite3', database: ':memory:' },
      { id: 1 },
      { entity: 'tags', foreignKey: 'user_id', type: 'manyToMany' },
    );
    assert.equal(result, null);
  });
});

describe('handleStreamRequest', () => {
  const { handleStreamRequest } = require('../src/stream');

  test('rejects non-POST with 405', (_, done) => {
    const req = makeReq('GET', null);
    const res = makeRes();
    handleStreamRequest(req, res);
    setTimeout(() => {
      assert.equal(res.statusCode, 405);
      done();
    }, 10);
  });

  test('rejects malformed JSON body with 400', (_, done) => {
    const req = makeReq('POST', 'not-json{{{');
    const res = makeRes();
    handleStreamRequest(req, res);

    setTimeout(() => {
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body());
      assert.ok(body.error);
      done();
    }, 50);
  });

  test('rejects body missing connection with 400', (_, done) => {
    const req = makeReq('POST', { from: 'users' });
    const res = makeRes();
    handleStreamRequest(req, res);

    setTimeout(() => {
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body());
      assert.ok(body.error);
      done();
    }, 50);
  });

  test('rejects body missing from with 400', (_, done) => {
    const req = makeReq('POST', { connection: { driver: 'sqlite3', database: ':memory:' } });
    const res = makeRes();
    handleStreamRequest(req, res);

    setTimeout(() => {
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body());
      assert.ok(body.error);
      done();
    }, 50);
  });
});
