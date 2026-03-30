'use strict';

/**
 * Neo4j Movies – public demo graph database hosted by Neo4j Labs.
 * Reference: https://demo.neo4jlabs.com
 *
 * The credentials below are the publicly documented read-only credentials
 * from https://demo.neo4jlabs.com (same as in examples/queries.json).
 */
module.exports = {
  name: 'neo4j-movies',
  label: 'Neo4j Movies Demo',
  description: 'Public Neo4j demo graph database containing movies, actors and directors.',
  driver: 'neo4j',
  connection: {
    host: 'demo.neo4jlabs.com',
    database: 'movies',
    user: 'movies',
    password: 'movies',
    scheme: 'neo4j+s',
  },
  entities: [
    {
      name: 'Movie',
      columns: ['title', 'released', 'tagline'],
      relations: [],
    },
    {
      name: 'Person',
      columns: ['name', 'born'],
      relations: [],
    },
  ],
};
