'use strict';

/**
 * Rick and Morty API – free REST API for the Rick and Morty TV show.
 * Reference: https://rickandmortyapi.com/documentation
 *
 * No credentials required.
 * List responses are wrapped in `{info: {...}, results: [...]}`.
 * The REST driver automatically unwraps the `results` key.
 *
 * Relationship notes:
 *  - /character records have `origin` and `location` fields, each of which is
 *    an object with `{name, url}` pointing to a /location entry (URL-based FK).
 *  - /character records have an `episode` array of /episode URLs.
 *  - /location records have a `residents` array of /character URLs.
 *  - /episode records have a `characters` array of /character URLs.
 *  - Cross-entity references use full API URLs as FK values, not plain IDs.
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
      columns: ['id', 'name', 'status', 'species', 'type', 'gender', 'origin', 'location', 'episode', 'created'],
      relations: [
        { entity: '/location', foreignKey: 'location.url', type: 'belongsTo', alias: 'currentLocation' },
        { entity: '/location', foreignKey: 'origin.url', type: 'belongsTo', alias: 'originLocation' },
      ],
    },
    {
      name: '/episode',
      columns: ['id', 'name', 'air_date', 'episode', 'characters', 'created'],
      relations: [],
    },
    {
      name: '/location',
      columns: ['id', 'name', 'type', 'dimension', 'residents', 'created'],
      relations: [],
    },
  ],
};
