'use strict'

/**
 * The data every connector integration test loads into its backend: the
 * blog shape of examples/seed.js (users → posts → comments), plus a
 * `proteins` table whose rows carry UniProt accessions, for checking that a
 * row from a self-hosted database can follow a relation into an api source.
 */

const USERS = [
  { id: 1, name: 'Ada', email: 'ada@example.org', created_at: '2024-01-01' },
  { id: 2, name: 'Barbara', email: 'barbara@example.org', created_at: '2024-01-02' },
  { id: 3, name: 'Carl', email: 'carl@example.org', created_at: '2024-01-03' },
  { id: 4, name: 'Dorothy', email: 'dorothy@example.org', created_at: '2024-01-04' }
]

const POSTS = [
  { id: 1, user_id: 1, title: 'Engines', body: 'On the analytical engine', created_at: '2024-02-01' },
  { id: 2, user_id: 1, title: 'Notes', body: 'Note G', created_at: '2024-02-02' },
  { id: 3, user_id: 2, title: 'Compilers', body: 'Abstraction', created_at: '2024-02-03' },
  { id: 4, user_id: 3, title: 'Proteins', body: 'Folding', created_at: '2024-02-04' },
  { id: 5, user_id: 3, title: 'Graphs', body: 'Edges', created_at: '2024-02-05' },
  { id: 6, user_id: 3, title: 'Trees', body: 'Leaves', created_at: '2024-02-06' }
]

const COMMENTS = [
  { id: 1, post_id: 1, body: 'Brilliant' },
  { id: 2, post_id: 1, body: 'Agreed' },
  { id: 3, post_id: 2, body: 'Which note?' },
  { id: 4, post_id: 3, body: 'Layers' },
  { id: 5, post_id: 4, body: 'Alpha' },
  { id: 6, post_id: 4, body: 'Beta' },
  { id: 7, post_id: 4, body: 'Gamma' },
  { id: 8, post_id: 6, body: 'Roots' }
]

const PROTEINS = [
  { id: 1, name: 'p53', uniprot_accession: 'P04637' },
  { id: 2, name: 'BRCA1', uniprot_accession: 'P38398' },
  { id: 3, name: 'EGFR', uniprot_accession: 'P00533' }
]

const TABLES = { users: USERS, posts: POSTS, comments: COMMENTS, proteins: PROTEINS }

/** Column types, for backends that need a schema. */
const COLUMNS = {
  users: { id: 'int', name: 'text', email: 'text', created_at: 'text' },
  posts: { id: 'int', user_id: 'int', title: 'text', body: 'text', created_at: 'text' },
  comments: { id: 'int', post_id: 'int', body: 'text' },
  proteins: { id: 'int', name: 'text', uniprot_accession: 'text' }
}

/**
 * A connection from a `scheme://user@host:port/database` URL.  A password,
 * when the server needs one, comes from its own variable —
 * MOZG_IT_<DRIVER>_PASSWORD — never from inside a URL.
 */
function connectionFromUrl (driver, url) {
  const u = new URL(url)
  const connection = { driver, host: u.hostname }
  if (u.port) connection.port = Number(u.port)
  if (u.username) connection.user = decodeURIComponent(u.username)
  const password = process.env[`MOZG_IT_${driver.toUpperCase()}_PASSWORD`]
  if (password) connection.password = password
  const db = u.pathname.replace(/^\//, '')
  if (db) connection.database = db
  return connection
}

module.exports = { USERS, POSTS, COMMENTS, PROTEINS, TABLES, COLUMNS, connectionFromUrl }
