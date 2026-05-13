'use strict'

/**
 * MusicBrainz – open music encyclopedia maintained by the community.
 * Reference: https://musicbrainz.org/doc/MusicBrainz_API
 *
 * No credentials required. Rate limit: 1 req/sec.
 * Requests must include a User-Agent header – set it via connection headers.
 *
 * Relationship map (cross-entity via MBIDs):
 *  - /recording    → /artist         (via artist-credit[].artist.id, belongsTo)
 *  - /recording    → /release        (via releases[].id, hasMany)
 *  - /release      → /artist         (via artist-credit[].artist.id, belongsTo)
 *  - /release      → /release-group  (via release-group.id, belongsTo)
 *  - /release-group → /artist        (via artist-credit[].artist.id, belongsTo)
 *
 * Note: Related entities are embedded in responses when the `inc=` parameter
 * is used. For list queries (/artist?query=…), related data is not embedded;
 * a separate lookup by MBID is required.
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
      Accept: 'application/json'
    }
  },
  entities: [
    {
      name: '/artist',
      columns: ['id', 'name', 'sort-name', 'type', 'country', 'score', 'disambiguation'],
      relations: [
        { entity: '/recording', foreignKey: 'id', type: 'hasMany', alias: 'recordings' },
        { entity: '/release-group', foreignKey: 'id', type: 'hasMany', alias: 'releaseGroups' },
        { entity: '/release', foreignKey: 'id', type: 'hasMany', alias: 'releases' }
      ]
    },
    {
      name: '/recording',
      columns: ['id', 'title', 'length', 'score', 'disambiguation', 'first-release-date', 'artist-credit', 'releases'],
      relations: [
        { entity: '/artist', foreignKey: 'artist-credit', type: 'belongsTo', alias: 'artist' },
        { entity: '/release', foreignKey: 'id', type: 'hasMany', alias: 'releases' }
      ]
    },
    {
      name: '/release',
      columns: ['id', 'title', 'status', 'date', 'country', 'score', 'track-count', 'artist-credit', 'release-group'],
      relations: [
        { entity: '/artist', foreignKey: 'artist-credit', type: 'belongsTo', alias: 'artist' },
        { entity: '/release-group', foreignKey: 'release-group', type: 'belongsTo', alias: 'releaseGroup' }
      ]
    },
    {
      name: '/release-group',
      columns: ['id', 'title', 'primary-type', 'score', 'first-release-date', 'artist-credit'],
      relations: [
        { entity: '/artist', foreignKey: 'artist-credit', type: 'belongsTo', alias: 'artist' },
        { entity: '/release', foreignKey: 'id', type: 'hasMany', alias: 'releases' }
      ]
    }
  ]
}
