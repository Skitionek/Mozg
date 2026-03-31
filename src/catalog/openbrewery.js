'use strict';

/**
 * Open Brewery DB – free public database of breweries worldwide.
 * Reference: https://www.openbrewerydb.org/documentation
 *
 * No credentials required. Supports filtering via query parameters
 * (by_type, by_city, by_state, by_country) passed through `where`.
 */
module.exports = {
  name: 'openbrewery',
  label: 'Open Brewery DB (REST)',
  description: 'Free public database of breweries worldwide. Filter by type, city, state, or country using the `where` argument.',
  driver: 'rest',
  connection: {
    database: 'https://api.openbrewerydb.org/v1',
  },
  entities: [
    {
      name: '/breweries',
      columns: ['id', 'name', 'brewery_type', 'address_1', 'city', 'state_province', 'country', 'website_url', 'longitude', 'latitude'],
      relations: [],
    },
  ],
};
