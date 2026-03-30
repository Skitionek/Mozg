'use strict';

/**
 * Seed script – creates examples/sample.db (SQLite) with:
 *   users, posts, comments
 *
 * Usage: node examples/seed.js
 */

const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'sample.db');
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function seed() {
  // ── Schema ───────────────────────────────────────────────────────────────
  await run('PRAGMA journal_mode=WAL');

  await run(`CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  )`);

  // ── Users ────────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const userNames = ['Alice Müller', 'Bob Smith', 'Carol Jones', 'Dave Brown', 'Eve Davis'];

  for (let i = 0; i < userNames.length; i++) {
    const name = userNames[i];
    const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';
    await run(
      'INSERT OR IGNORE INTO users (name, email, created_at) VALUES (?, ?, ?)',
      [name, email, now]
    );
  }

  const users = await all('SELECT id FROM users ORDER BY id');

  // ── Posts ────────────────────────────────────────────────────────────────
  for (const user of users) {
    for (let p = 1; p <= 3; p++) {
      await run(
        'INSERT OR IGNORE INTO posts (user_id, title, body, created_at) VALUES (?, ?, ?, ?)',
        [
          user.id,
          `Post ${p} by user ${user.id}`,
          `This is the body of post ${p} written by user ${user.id}. Lorem ipsum dolor sit amet.`,
          now,
        ]
      );
    }
  }

  const posts = await all('SELECT id, user_id FROM posts ORDER BY id');

  // ── Comments ─────────────────────────────────────────────────────────────
  for (const post of posts) {
    for (let c = 1; c <= 3; c++) {
      // Cycle through users as commenters
      const commenter = users[(post.id + c) % users.length];
      await run(
        'INSERT OR IGNORE INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
        [
          post.id,
          commenter.id,
          `Comment ${c} on post ${post.id} by user ${commenter.id}.`,
          now,
        ]
      );
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const [{ n: userCount }]    = await all('SELECT COUNT(*) AS n FROM users');
  const [{ n: postCount }]    = await all('SELECT COUNT(*) AS n FROM posts');
  const [{ n: commentCount }] = await all('SELECT COUNT(*) AS n FROM comments');

  console.log(`Seeded ${DB_PATH}`);
  console.log(`  users:    ${userCount}`);
  console.log(`  posts:    ${postCount}`);
  console.log(`  comments: ${commentCount}`);

  db.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  db.close();
  process.exit(1);
});
