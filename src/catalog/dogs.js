'use strict'

/**
 * The Dog API – dogs data for developers.
 * Reference: https://dog.ceo/dog-api/documentation
 *
 * No credentials required. CORS-enabled.
 * Responses are wrapped in `{message: ..., status: "success"}`.
 *
 * Note: /breeds/list/all returns a nested object (breed → sub-breeds).
 *       /breeds/image/random and /breed/{breed}/images return image arrays.
 */
module.exports = {
  name: 'dogs',
  label: 'Dog CEO API (REST)',
  description: 'Free dog image API based on the Stanford Dogs Dataset. Fetch random images or browse by breed.',
  driver: 'rest',
  connection: {
    database: 'https://dog.ceo/api'
  },
  entities: [
    {
      name: '/breeds/list/all',
      columns: ['affenpinscher', 'african', 'airedale', 'akita', 'appenzeller', 'australian', 'basenji', 'beagle'],
      relations: []
    },
    {
      name: '/breeds/image/random',
      columns: ['message', 'status'],
      relations: []
    }
  ]
}
