'use strict';

/**
 * Fake Store API – free fake e-commerce REST API for prototyping and testing.
 * Reference: https://fakestoreapi.com/docs
 *
 * No credentials required. All endpoints are publicly accessible.
 *
 * Relationship notes:
 *  - Each cart has a `userId` field. The REST driver resolves this by
 *    fetching /users/{userId} (belongsTo).
 *  - /users hasMany carts: the driver fetches /carts/{userId} for each user,
 *    but Fake Store exposes /carts/user/{userId} for per-user carts.
 */
module.exports = {
  name: 'fakestore',
  label: 'Fake Store API (REST)',
  description: 'Free fake e-commerce REST API for prototyping, with products, carts, and users.',
  driver: 'rest',
  connection: {
    database: 'https://fakestoreapi.com',
  },
  entities: [
    {
      name: '/products',
      columns: ['id', 'title', 'price', 'description', 'category', 'image', 'rating'],
      relations: [],
    },
    {
      name: '/products/categories',
      columns: ['name'],
      relations: [],
    },
    {
      name: '/carts',
      columns: ['id', 'userId', 'date', 'products'],
      relations: [
        { entity: '/users', foreignKey: 'userId', type: 'belongsTo', alias: 'user' },
      ],
    },
    {
      name: '/users',
      columns: ['id', 'email', 'username', 'phone', 'name', 'address'],
      relations: [],
    },
  ],
};
