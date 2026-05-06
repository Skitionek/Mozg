'use strict'

/**
 * REST Countries – free country data API.
 * Reference: https://restcountries.com
 *
 * No credentials required. CORS-enabled.
 * All endpoints return arrays directly (no envelope wrapper).
 *
 * Usage tips:
 *  - Use `where: { fields: "name,capital,population" }` to limit returned fields.
 *  - Region-specific endpoints: /region/europe, /region/asia, /region/africa,
 *    /region/americas, /region/oceania.
 *  - Search by name: /name/{name}, by CCA2 code: /alpha/{code}.
 */
module.exports = {
  name: 'restcountries',
  label: 'REST Countries (REST)',
  description: 'Free country data API with names, capitals, populations, currencies, languages, flags and more.',
  driver: 'rest',
  connection: {
    database: 'https://restcountries.com/v3.1'
  },
  entities: [
    {
      name: '/all',
      columns: ['name', 'tld', 'cca2', 'cca3', 'ccn3', 'cioc', 'independent', 'status', 'unMember', 'currencies', 'idd', 'capital', 'altSpellings', 'region', 'subregion', 'languages', 'translations', 'latlng', 'landlocked', 'area', 'population', 'flags', 'coatOfArms', 'timezones', 'continents'],
      relations: []
    },
    {
      name: '/region/europe',
      columns: ['name', 'cca2', 'cca3', 'capital', 'region', 'subregion', 'population', 'area', 'currencies', 'languages', 'flags'],
      relations: []
    },
    {
      name: '/region/asia',
      columns: ['name', 'cca2', 'cca3', 'capital', 'region', 'subregion', 'population', 'area', 'currencies', 'languages', 'flags'],
      relations: []
    },
    {
      name: '/region/africa',
      columns: ['name', 'cca2', 'cca3', 'capital', 'region', 'subregion', 'population', 'area', 'currencies', 'languages', 'flags'],
      relations: []
    },
    {
      name: '/region/americas',
      columns: ['name', 'cca2', 'cca3', 'capital', 'region', 'subregion', 'population', 'area', 'currencies', 'languages', 'flags'],
      relations: []
    },
    {
      name: '/region/oceania',
      columns: ['name', 'cca2', 'cca3', 'capital', 'region', 'subregion', 'population', 'area', 'currencies', 'languages', 'flags'],
      relations: []
    }
  ]
}
