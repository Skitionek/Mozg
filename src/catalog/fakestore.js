'use strict';

/**
 * Fake Store API – free fake e-commerce REST API for prototyping and testing.
 * Reference: https://fakestoreapi.com/docs
 *
 * No credentials required. All endpoints are publicly accessible.
 *
 * Relationship map:
 *  - /carts     → /users     (userId FK, belongsTo)
 *  - /users     → /carts     (userId FK on carts, hasMany)
 *  - /products  → /products/categories (category string, belongsTo by name)
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
      relations: [
        { entity: '/carts', foreignKey: 'id', type: 'hasMany', alias: 'carts' },
      ],
    },
  ],
};
