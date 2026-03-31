'use strict';

/**
 * Blog – local SQLite sample database seeded by examples/seed.js.
 * Run `node examples/seed.js` to create and populate examples/sample.db.
 */
module.exports = {
  name: 'blog',
  label: 'Blog (SQLite)',
  description: 'Local sample blog database with users, posts and comments. Run `node examples/seed.js` to create it.',
  driver: 'sqlite3',
  connection: {
    database: 'examples/sample.db',
  },
  entities: [
    {
      name: 'users',
      columns: ['id', 'name', 'email', 'created_at'],
      relations: [
        { entity: 'posts', foreignKey: 'user_id', type: 'hasMany', alias: 'posts' },
        { entity: 'comments', foreignKey: 'user_id', type: 'hasMany', alias: 'comments' },
      ],
    },
    {
      name: 'posts',
      columns: ['id', 'user_id', 'title', 'body', 'created_at'],
      relations: [
        { entity: 'users', foreignKey: 'user_id', type: 'belongsTo', alias: 'author' },
        { entity: 'comments', foreignKey: 'post_id', type: 'hasMany', alias: 'comments' },
      ],
    },
    {
      name: 'comments',
      columns: ['id', 'post_id', 'user_id', 'body', 'created_at'],
      relations: [
        { entity: 'posts', foreignKey: 'post_id', type: 'belongsTo', alias: 'post' },
        { entity: 'users', foreignKey: 'user_id', type: 'belongsTo', alias: 'author' },
      ],
    },
  ],
};
