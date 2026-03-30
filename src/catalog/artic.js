'use strict';

/**
 * Art Institute of Chicago – free public REST API.
 * Reference: https://api.artic.edu/docs/
 *
 * No credentials required. Rate-limited to reasonable usage.
 * Use the `fields` query parameter (via `where`) to limit response size.
 */
module.exports = {
  name: 'artic',
  label: 'Art Institute of Chicago (REST)',
  description: 'Free public REST API for the Art Institute of Chicago with artworks, artists, and exhibitions.',
  driver: 'rest',
  connection: {
    database: 'https://api.artic.edu/api/v1',
  },
  entities: [
    {
      name: '/artworks',
      columns: ['id', 'title', 'date_display', 'medium_display', 'artist_display', 'artist_id', 'place_of_origin', 'dimensions', 'image_id'],
      relations: [
        { entity: '/artists', foreignKey: 'artist_id', type: 'belongsTo', alias: 'artist' },
      ],
    },
    {
      name: '/artists',
      columns: ['id', 'title', 'birth_date', 'death_date', 'birth_place', 'death_place', 'description'],
      relations: [],
    },
    {
      name: '/exhibitions',
      columns: ['id', 'title', 'description', 'status', 'aic_start_at', 'aic_end_at'],
      relations: [],
    },
  ],
};
