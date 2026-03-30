'use strict';

/**
 * Rick and Morty API – free REST API for the Rick and Morty TV show.
 * Reference: https://rickandmortyapi.com/documentation
 *
 * No credentials required.
 * List responses are wrapped in `{info: {...}, results: [...]}`.
 * The REST driver automatically unwraps the `results` key.
 */
module.exports = {
  name: 'rickandmorty',
  label: 'Rick and Morty API (REST)',
  description: 'Free REST API for the Rick and Morty TV show with characters, episodes and locations.',
  driver: 'rest',
  connection: {
    database: 'https://rickandmortyapi.com/api',
  },
  entities: [
    {
      name: '/character',
      columns: ['id', 'name', 'status', 'species', 'type', 'gender', 'created'],
      relations: [],
    },
    {
      name: '/episode',
      columns: ['id', 'name', 'air_date', 'episode', 'created'],
      relations: [],
    },
    {
      name: '/location',
      columns: ['id', 'name', 'type', 'dimension', 'created'],
      relations: [],
    },
  ],
};
