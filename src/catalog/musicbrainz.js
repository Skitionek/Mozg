'use strict';

/**
 * MusicBrainz – open music encyclopedia maintained by the community.
 * Reference: https://musicbrainz.org/doc/MusicBrainz_API
 *
 * No credentials required. Rate limit: 1 req/sec.
 * Requests must include a User-Agent header – set it via connection headers.
 *
 * Relationship notes:
 *  - Each recording has releases (albums); each release has an artist.
 *  - Uses MBID (UUID) as the primary key for all entities.
 *
 * Response format: JSON with per-entity result arrays.
 *  - /artist?query=… returns {artists: [...], count, offset}
 *  - /recording?query=… returns {recordings: [...]}
 *  - /release?query=… returns {releases: [...]}
 */
module.exports = {
  name: 'musicbrainz',
  label: 'MusicBrainz (REST)',
  description: 'Open music encyclopedia with artists, recordings, releases, labels and more. No auth required; 1 req/sec rate limit.',
  driver: 'rest',
  connection: {
    database: 'https://musicbrainz.org/ws/2',
    headers: {
      'User-Agent': 'Mozg/0.1.0 (https://github.com/Skitionek/Mozg)',
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      name: '/artist',
      columns: ['id', 'name', 'sort-name', 'type', 'country', 'score', 'disambiguation'],
      relations: [],
    },
    {
      name: '/recording',
      columns: ['id', 'title', 'length', 'score', 'disambiguation', 'first-release-date'],
      relations: [],
    },
    {
      name: '/release',
      columns: ['id', 'title', 'status', 'date', 'country', 'score', 'track-count', 'artist-credit'],
      relations: [],
    },
    {
      name: '/release-group',
      columns: ['id', 'title', 'primary-type', 'score', 'first-release-date', 'artist-credit'],
      relations: [],
    },
  ],
};
