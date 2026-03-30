'use strict';

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
 *  - /api.php questions → /api_category.php (category int FK, belongsTo)
 */
module.exports = {
  name: 'opentrivia',
  label: 'Open Trivia DB (REST)',
  description: 'Free trivia questions API with multiple categories, difficulties and question types.',
  driver: 'rest',
  connection: {
    database: 'https://opentdb.com',
  },
  entities: [
    {
      name: '/api.php',
      columns: ['type', 'difficulty', 'category', 'question', 'correct_answer', 'incorrect_answers'],
      relations: [
        { entity: '/api_category.php', foreignKey: 'category', type: 'belongsTo', alias: 'category' },
      ],
    },
    {
      name: '/api_category.php',
      columns: ['id', 'name'],
      relations: [
        { entity: '/api.php', foreignKey: 'id', type: 'hasMany', alias: 'questions' },
      ],
    },
  ],
};
