'use strict'

/**
 * Open Library – Internet Archive's open book catalog.
 * Reference: https://openlibrary.org/developers/api
 *
 * No credentials required.
 *
 * Key endpoints:
 *  - /search.json?q={query}  – full-text book search
 *  - /subjects/{subject}.json  – books by subject
 *  - /works/{id}.json  – a single work (book)
 *  - /authors/{id}.json  – a single author
 *
 * Response notes:
 *  - /search.json wraps results in `{docs: [...]}` (not in UNWRAP_KEYS).
 *    Use /subjects/{subject}.json which wraps in `{works: [...]}` instead.
 *  - Author FKs in search results are OLID strings like "OL23919A".
 */
module.exports = {
  name: 'openlibrary',
  label: 'Open Library (REST)',
  description: 'Internet Archive open book catalog with millions of books, authors and subjects.',
  driver: 'rest',
  connection: {
    database: 'https://openlibrary.org'
  },
  entities: [
    {
      name: '/subjects/science.json',
      columns: ['key', 'name', 'edition_count', 'ebook_count_i', 'cover_i', 'first_publish_year', 'subject'],
      relations: []
    },
    {
      name: '/subjects/fiction.json',
      columns: ['key', 'name', 'edition_count', 'ebook_count_i', 'cover_i', 'first_publish_year', 'subject'],
      relations: []
    },
    {
      name: '/subjects/history.json',
      columns: ['key', 'name', 'edition_count', 'ebook_count_i', 'cover_i', 'first_publish_year'],
      relations: []
    }
  ]
}
