'use strict'

/**
 * JSONPlaceholder – free fake REST API for testing and prototyping.
 * Reference: https://jsonplaceholder.typicode.com
 *
 * No credentials required. All endpoints are publicly accessible.
 */
module.exports = {
  name: 'jsonplaceholder',
  label: 'JSONPlaceholder (REST)',
  description: 'Free fake REST API with posts, users, comments, todos, albums and photos.',
  driver: 'rest',
  connection: {
    database: 'https://jsonplaceholder.typicode.com'
  },
  entities: [
    {
      name: '/posts',
      columns: ['id', 'userId', 'title', 'body'],
      relations: [
        { entity: '/comments', foreignKey: 'postId', type: 'hasMany', batch: true, alias: 'comments' },
        { entity: '/users', foreignKey: 'userId', localKey: 'userId', type: 'belongsTo', alias: 'user' }
      ]
    },
    {
      name: '/users',
      columns: ['id', 'name', 'username', 'email', 'phone', 'website'],
      relations: [
        { entity: '/posts', foreignKey: 'userId', type: 'hasMany', batch: true, alias: 'posts' },
        { entity: '/todos', foreignKey: 'userId', type: 'hasMany', batch: true, alias: 'todos' },
        { entity: '/albums', foreignKey: 'userId', type: 'hasMany', batch: true, alias: 'albums' }
      ]
    },
    {
      name: '/comments',
      columns: ['id', 'postId', 'name', 'email', 'body'],
      relations: [
        { entity: '/posts', foreignKey: 'postId', localKey: 'postId', type: 'belongsTo', alias: 'post' }
      ]
    },
    {
      name: '/todos',
      columns: ['id', 'userId', 'title', 'completed'],
      relations: [
        { entity: '/users', foreignKey: 'userId', localKey: 'userId', type: 'belongsTo', alias: 'user' }
      ]
    },
    {
      name: '/albums',
      columns: ['id', 'userId', 'title'],
      relations: [
        { entity: '/photos', foreignKey: 'albumId', type: 'hasMany', batch: true, alias: 'photos' },
        { entity: '/users', foreignKey: 'userId', localKey: 'userId', type: 'belongsTo', alias: 'user' }
      ]
    },
    {
      name: '/photos',
      columns: ['id', 'albumId', 'title', 'url', 'thumbnailUrl'],
      relations: [
        { entity: '/albums', foreignKey: 'albumId', localKey: 'albumId', type: 'belongsTo', alias: 'album' }
      ]
    }
  ]
}
