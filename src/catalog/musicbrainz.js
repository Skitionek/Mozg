'use strict'

/**
 * MusicBrainz – open music encyclopedia maintained by the community.
 * Reference: https://musicbrainz.org/doc/MusicBrainz_API
 *
 * No credentials required. Rate limit: 1 req/sec.
 * Requests must include a User-Agent header – set it via connection headers.
 *
 * Searches take `where: { query: '…' }` (Lucene syntax); browse requests
 * filter by a linked MBID (`/recording?artist={mbid}`), which is how the
 * hasMany relations below are fetched.
 *
 * Relationship map (cross-entity via MBIDs):
 *  - /artist        → /recording, /release, /release-group  (browse by artist)
 *  - /recording     → /artist   (artist-credit[].artist.id)
 *  - /recording     → /release  (releases[].id, present on search results)
 *  - /release       → /artist   (artist-credit[].artist.id)
 *  - /release       → /release-group (release-group.id)
 *  - /release-group → /artist   (artist-credit[].artist.id)
 *  - /release-group → /release  (browse by release-group)
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
    },
    paging: { limit: 'limit', offset: 'offset', sort: null, order: null },
    unwrap: ['artists', 'recordings', 'releases', 'release-groups']
  },
  rateLimit: { requestsPerSecond: 1, maxConcurrent: 1 },
  // Health-probe hint: search requires a query; fmt selects JSON.
  probe: { params: { query: 'beatles', fmt: 'json' } },
  entities: [
    {
      name: '/artist',
      columns: ['id', 'name', 'sort-name', 'type', 'country', 'score', 'disambiguation'],
      relations: [
        { entity: '/recording', foreignKey: 'artist', type: 'hasMany', alias: 'recordings' },
        { entity: '/release-group', foreignKey: 'artist', type: 'hasMany', alias: 'releaseGroups' },
        { entity: '/release', foreignKey: 'artist', type: 'hasMany', alias: 'releases' }
      ]
    },
    {
      name: '/recording',
      columns: ['id', 'title', 'length', 'score', 'disambiguation', 'first-release-date', 'artist-credit', 'releases'],
      relations: [
        { entity: '/artist', foreignKey: 'artist-credit[].artist.id', type: 'hasMany', alias: 'artists' },
        { entity: '/release', foreignKey: 'releases[].id', type: 'hasMany', alias: 'releases' }
      ]
    },
    {
      name: '/release',
      columns: ['id', 'title', 'status', 'date', 'country', 'score', 'track-count', 'artist-credit', 'release-group'],
      relations: [
        { entity: '/artist', foreignKey: 'artist-credit[].artist.id', type: 'hasMany', alias: 'artists' },
        { entity: '/release-group', foreignKey: 'release-group.id', type: 'belongsTo', alias: 'releaseGroup' }
      ]
    },
    {
      name: '/release-group',
      columns: ['id', 'title', 'primary-type', 'score', 'first-release-date', 'artist-credit'],
      relations: [
        { entity: '/artist', foreignKey: 'artist-credit[].artist.id', type: 'hasMany', alias: 'artists' },
        { entity: '/release', foreignKey: 'release-group', type: 'hasMany', alias: 'releases' }
      ]
    }
  ]
}
