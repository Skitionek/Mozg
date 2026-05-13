'use strict'

/**
 * NASA APIs – public APIs from NASA.
 * Reference: https://api.nasa.gov
 *
 * Most endpoints require a free API key. Use `DEMO_KEY` for low-rate testing
 * (30 req/hour, 50 req/day). Pass it via `where: { api_key: "DEMO_KEY" }`.
 *
 * Key endpoints (all require api_key param):
 *  - /planetary/apod  – Astronomy Picture of the Day
 *  - /neo/rest/v1/feed  – Near Earth Objects (requires start_date, end_date)
 *  - /mars-photos/api/v1/rovers/{rover}/photos  – Mars Rover photos
 *
 * Note: the API base URL varies per service. APOD and NeoWs share api.nasa.gov.
 */
module.exports = {
  name: 'nasa',
  label: 'NASA APIs (REST)',
  description: 'Public NASA data APIs including Astronomy Picture of the Day (APOD) and Near Earth Objects. Use DEMO_KEY or register for a free API key at api.nasa.gov.',
  driver: 'rest',
  connection: {
    database: 'https://api.nasa.gov'
  },
  entities: [
    {
      name: '/planetary/apod',
      columns: ['date', 'explanation', 'hdurl', 'media_type', 'service_version', 'title', 'url', 'copyright'],
      relations: []
    },
    {
      name: '/neo/rest/v1/feed',
      columns: ['element_count', 'near_earth_objects'],
      relations: []
    }
  ]
}
