'use strict'

/**
 * Open Trivia Database – free trivia questions API.
 * Reference: https://opentdb.com/api_config.php
 *
 * No credentials required.
 *
 * Usage notes:
 *  - /api.php requires at least `amount` param (e.g. `where: { amount: "10" }`).
 *  - Optional params: category (int), difficulty (easy|medium|hard), type (multiple|boolean).
 *  - /api_category.php returns all categories (wrapped in `{trivia_categories: [...]}`).
 *
 * Response: /api.php wraps in `{response_code, results: [...]}`.
 * The REST driver automatically unwraps the `results` key.
 *
 * Relationship map:
 *  - /api_category.php → /api.php  (questions in a category, 10 per category)
 * Questions name their category in words, so there is no way back.  The API
 * allows one request every five seconds per IP and answers faster ones with
 * `response_code: 5` and no results.
 */
module.exports = {
  name: 'opentrivia',
  label: 'Open Trivia DB (REST)',
  description: 'Free trivia questions API with multiple categories, difficulties and question types.',
  driver: 'rest',
  connection: {
    database: 'https://opentdb.com',
    unwrap: ['trivia_categories']
  },
  rateLimit: { requestsPerSecond: 0.2, maxConcurrent: 1 },
  // Health-probe hint: the API returns an empty body without amount.
  probe: { params: { amount: '1' } },
  entities: [
    {
      name: '/api.php',
      columns: ['type', 'difficulty', 'category', 'question', 'correct_answer', 'incorrect_answers'],
      relations: []
    },
    {
      name: '/api_category.php',
      columns: ['id', 'name'],
      relations: [
        { entity: '/api.php', foreignKey: 'category', type: 'hasMany', alias: 'questions', where: { amount: 10 } }
      ]
    }
  ]
}
