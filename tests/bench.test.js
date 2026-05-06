'use strict'

/**
 * Latency benchmark — measures Mozg's server-side processing overhead for
 * local SQLite queries (no network I/O).  Provides median, IQR, and p99
 * latency figures suitable for inclusion in the paper's evaluation section.
 *
 * All measurements are pure compute time: the SQLite file is on the local
 * filesystem, so results reflect Mozg's own overhead rather than network or
 * remote-database latency.
 *
 * DISCLAIMER: Mozg is designed for single-user / single-instance use.
 * It is not intended to be deployed as a high-throughput multi-tenant
 * service.  The concurrency results here are informational only and
 * demonstrate the expected event-loop serialisation behaviour of a
 * single-process Node.js application.
 */

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { executeQuery, destroyAll } = require('../src/database/drivers/sqlite3')

const DB = path.join(__dirname, '..', 'examples', 'sample.db')

// ── helpers ────────────────────────────────────────────────────────────────

/** Run `fn` for `n` iterations and return an array of elapsed-ms values. */
async function measure (fn, n) {
  const times = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    await fn()
    times.push(performance.now() - t0)
  }
  return times
}

function median (arr) {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function percentile (arr, p) {
  const s = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * s.length) - 1
  return s[Math.max(0, idx)]
}

function iqr (arr) {
  return percentile(arr, 75) - percentile(arr, 25)
}

/** Ensure the sample database exists by running the seed script if needed. */
function ensureSampleDb () {
  const fs = require('node:fs')
  if (!fs.existsSync(DB)) {
    const result = spawnSync('node', [path.join(__dirname, '..', 'examples', 'seed.js')], {
      timeout: 15000
    })
    if (result.status !== 0) {
      throw new Error(`seed.js failed: ${result.stderr?.toString()}`)
    }
  }
}

// ── test suite ─────────────────────────────────────────────────────────────

describe('latency benchmarks (local SQLite – no network)', () => {
  const N = 100 // sample size — sufficient for stable median/IQR/p99

  before(() => {
    ensureSampleDb()
  })

  after(async () => {
    await destroyAll()
  })

  test('simple SELECT (users, no relations) — median < 10 ms, p99 < 50 ms', async () => {
    const times = await measure(() => executeQuery({
      connection: { driver: 'sqlite3', database: DB },
      from: 'users',
      select: ['id', 'name', 'email']
    }), N)

    const med = median(times)
    const p99 = percentile(times, 99)
    const spread = iqr(times)

    // Log figures so CI output captures them for the paper
    console.log(`simple SELECT  | n=${N} | median=${med.toFixed(2)} ms | IQR=${spread.toFixed(2)} ms | p99=${p99.toFixed(2)} ms`)

    // Soft assertions — local SQLite should be fast but CI machines vary
    assert.ok(med < 10, `median ${med.toFixed(2)} ms exceeds 10 ms budget`)
    assert.ok(p99 < 50, `p99 ${p99.toFixed(2)} ms exceeds 50 ms budget`)
  })

  test('relation traversal (users → posts, hasMany) — median < 20 ms, p99 < 100 ms', async () => {
    const times = await measure(() => executeQuery({
      connection: { driver: 'sqlite3', database: DB },
      from: 'users',
      select: ['id', 'name'],
      relations: [{
        entity: 'posts',
        foreignKey: 'user_id',
        type: 'hasMany',
        select: ['id', 'title']
      }]
    }), N)

    const med = median(times)
    const p99 = percentile(times, 99)
    const spread = iqr(times)

    console.log(`users→posts    | n=${N} | median=${med.toFixed(2)} ms | IQR=${spread.toFixed(2)} ms | p99=${p99.toFixed(2)} ms`)

    assert.ok(med < 20, `median ${med.toFixed(2)} ms exceeds 20 ms budget`)
    assert.ok(p99 < 100, `p99 ${p99.toFixed(2)} ms exceeds 100 ms budget`)
  })

  test('3-level traversal (users → posts → comments) — median < 30 ms, p99 < 150 ms', async () => {
    const times = await measure(() => executeQuery({
      connection: { driver: 'sqlite3', database: DB },
      from: 'users',
      select: ['id', 'name'],
      relations: [{
        entity: 'posts',
        foreignKey: 'user_id',
        type: 'hasMany',
        select: ['id', 'title'],
        relations: [{
          entity: 'comments',
          foreignKey: 'post_id',
          type: 'hasMany',
          select: ['id', 'body']
        }]
      }]
    }), N)

    const med = median(times)
    const p99 = percentile(times, 99)
    const spread = iqr(times)

    console.log(`3-level join   | n=${N} | median=${med.toFixed(2)} ms | IQR=${spread.toFixed(2)} ms | p99=${p99.toFixed(2)} ms`)

    assert.ok(med < 30, `median ${med.toFixed(2)} ms exceeds 30 ms budget`)
    assert.ok(p99 < 150, `p99 ${p99.toFixed(2)} ms exceeds 150 ms budget`)
  })

  // ── concurrency ───────────────────────────────────────────────────────────

  test('concurrency: 10 simultaneous queries — no errors, p99 < 200 ms', async () => {
    const CONCURRENT = 10
    const ROUNDS = 20 // rounds of concurrent bursts

    const allTimes = []

    for (let r = 0; r < ROUNDS; r++) {
      const start = performance.now()

      const promises = Array.from({ length: CONCURRENT }, () =>
        executeQuery({
          connection: { driver: 'sqlite3', database: DB },
          from: 'users',
          select: ['id', 'name'],
          relations: [{ entity: 'posts', foreignKey: 'user_id', type: 'hasMany', select: ['id', 'title'] }]
        })
      )

      const results = await Promise.all(promises)
      const elapsed = performance.now() - start
      allTimes.push(elapsed)

      // All concurrent queries must return valid data
      for (const res of results) {
        assert.ok(Array.isArray(res.data), 'result.data must be an array')
        assert.ok(res.count > 0, 'result.count must be > 0')
      }
    }

    const med = median(allTimes)
    const p99 = percentile(allTimes, 99)

    console.log(`concurrency×${CONCURRENT} | rounds=${ROUNDS} | median=${med.toFixed(2)} ms | p99=${p99.toFixed(2)} ms`)
    console.log('NOTE: Mozg is designed for single-user/single-instance use; these figures reflect event-loop serialisation, not throughput capacity.')

    // p99 for 10 concurrent queries should still complete within 200 ms locally
    assert.ok(p99 < 200, `p99 ${p99.toFixed(2)} ms exceeds 200 ms budget for ${CONCURRENT} concurrent queries`)
  })

  // ── partial-failure ────────────────────────────────────────────────────────

  test('partial failure: bad relation entity returns error in result, not a thrown exception', async () => {
    // 'nonexistent_table' does not exist — the driver should return an error
    // marker in the relation field rather than throwing and losing the primary result.
    const result = await executeQuery({
      connection: { driver: 'sqlite3', database: DB },
      from: 'users',
      select: ['id', 'name'],
      limit: 2,
      relations: [{ entity: 'nonexistent_table', foreignKey: 'user_id', type: 'hasMany' }]
    })

    // Primary data must still be returned
    assert.ok(Array.isArray(result.data), 'primary data must be an array')
    assert.strictEqual(result.data.length, 2, 'primary rows must be present')

    // Each row's relation field must be an error marker, not undefined/null
    for (const row of result.data) {
      assert.ok(
        row.nonexistent_table && typeof row.nonexistent_table.error === 'string',
        `expected error marker on row, got: ${JSON.stringify(row.nonexistent_table)}`
      )
    }
  })
})
