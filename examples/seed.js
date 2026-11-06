'use strict'

/**
 * Seed script – creates examples/sample.db (SQLite) with:
 *   users, posts, comments
 *
 * Usage: node examples/seed.js
 */

const path = require('node:path')
const sqlite3 = require('sqlite3').verbose()

const DB_PATH = path.join(__dirname, 'sample.db')
const db = new sqlite3.Database(DB_PATH)

// tests/bench.test.js and tests/examples.test.js both seed this file from
// their own `before()` hooks, and Node's test runner executes test files
// concurrently by default — so two `seed.js` processes can open the same
// database at once. Without a busy timeout, SQLite fails a writer that
// finds the file locked instead of waiting for the other process to finish.
db.configure('busyTimeout', 10000)

function run (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err)
      else resolve(this)
    })
  })
}

function all (sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

async function seed () {
  // ── Schema ───────────────────────────────────────────────────────────────
  await run('PRAGMA journal_mode=WAL')

  await run(`CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL
  )`)

  await run(`CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  )`)

  await run(`CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  )`)

  // ── Rows ─────────────────────────────────────────────────────────────────
  // One write transaction: a second seed.js running at the same time waits
  // (busyTimeout), then finds the rows in place and leaves them.  A database
  // holding anything but exactly the sample rows (empty, or grown by an older
  // seed.js that appended a copy on every run) is rebuilt from scratch, so
  // ids always start at 1.
  await run('BEGIN IMMEDIATE')
  try {
    if (await hasSampleRows()) {
      await run('COMMIT')
      return report()
    }
    await run('DELETE FROM comments')
    await run('DELETE FROM posts')
    await run('DELETE FROM users')
    await run("DELETE FROM sqlite_sequence WHERE name IN ('users', 'posts', 'comments')")
    await insertRows()
    await run('COMMIT')
  } catch (err) {
    await run('ROLLBACK').catch(() => {})
    throw err
  }
  return report()
}

const USER_NAMES = ['Alice Müller', 'Bob Smith', 'Carol Jones', 'Dave Brown', 'Eve Davis']
const POSTS_PER_USER = 3
const COMMENTS_PER_POST = 3

async function count (table) {
  const [{ n }] = await all(`SELECT COUNT(*) AS n FROM ${table}`)
  return n
}

async function hasSampleRows () {
  const posts = USER_NAMES.length * POSTS_PER_USER
  return await count('users') === USER_NAMES.length &&
    await count('posts') === posts &&
    await count('comments') === posts * COMMENTS_PER_POST
}

async function insertRows () {
  // ── Users ────────────────────────────────────────────────────────────────
  const now = new Date().toISOString()
  const userNames = USER_NAMES

  for (let i = 0; i < userNames.length; i++) {
    const name = userNames[i]
    const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com'
    await run(
      'INSERT INTO users (name, email, created_at) VALUES (?, ?, ?)',
      [name, email, now]
    )
  }

  const users = await all('SELECT id FROM users ORDER BY id')

  // ── Posts ────────────────────────────────────────────────────────────────
  for (const user of users) {
    for (let p = 1; p <= POSTS_PER_USER; p++) {
      await run(
        'INSERT INTO posts (user_id, title, body, created_at) VALUES (?, ?, ?, ?)',
        [
          user.id,
          `Post ${p} by user ${user.id}`,
          `This is the body of post ${p} written by user ${user.id}. Lorem ipsum dolor sit amet.`,
          now
        ]
      )
    }
  }

  const posts = await all('SELECT id, user_id FROM posts ORDER BY id')

  // ── Comments ─────────────────────────────────────────────────────────────
  for (const post of posts) {
    for (let c = 1; c <= COMMENTS_PER_POST; c++) {
      // Cycle through users as commenters
      const commenter = users[(post.id + c) % users.length]
      await run(
        'INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
        [
          post.id,
          commenter.id,
          `Comment ${c} on post ${post.id} by user ${commenter.id}.`,
          now
        ]
      )
    }
  }
}

async function report () {
  console.log(`Seeded ${DB_PATH}`)
  console.log(`  users:    ${await count('users')}`)
  console.log(`  posts:    ${await count('posts')}`)
  console.log(`  comments: ${await count('comments')}`)
  db.close()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  db.close()
  process.exit(1)
})
