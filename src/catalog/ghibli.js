'use strict'

/**
 * Studio Ghibli API – resource data from Studio Ghibli films.
 * Reference: https://ghibliapi.vercel.app/#section/Studio-Ghibli-API
 *
 * No credentials required. CORS-enabled.
 * All endpoints return arrays directly (no envelope wrapper).
 *
 * Relationship notes:
 *  - Films contain arrays of people/location/species/vehicle URLs.
 *  - `/people` has a `species` field (single URL) and a `films` array (URLs).
 *  - `/locations` has a `residents` array of /people URLs and a `films` array.
 *  - `/species` has a `people` array of /people URLs and a `films` array.
 *  - `/vehicles` has a `pilot` field (single URL → /people) and a `films` array.
 *  - All cross-entity references are full REST URLs, not plain IDs.
 */
module.exports = {
  name: 'ghibli',
  label: 'Studio Ghibli API (REST)',
  description: 'Resource data from Studio Ghibli films: films, characters, locations, species and vehicles.',
  driver: 'rest',
  connection: {
    database: 'https://ghibliapi.vercel.app'
  },
  entities: [
    {
      name: '/films',
      columns: ['id', 'title', 'original_title', 'original_title_romanised', 'description', 'director', 'producer', 'release_date', 'running_time', 'rt_score', 'people', 'species', 'locations', 'vehicles', 'url'],
      relations: [
        { entity: '/people', foreignKey: 'url', type: 'hasMany', alias: 'people' },
        { entity: '/locations', foreignKey: 'url', type: 'hasMany', alias: 'locations' },
        { entity: '/species', foreignKey: 'url', type: 'hasMany', alias: 'species' },
        { entity: '/vehicles', foreignKey: 'url', type: 'hasMany', alias: 'vehicles' }
      ]
    },
    {
      name: '/people',
      columns: ['id', 'name', 'gender', 'age', 'eye_color', 'hair_color', 'films', 'species', 'url'],
      relations: [
        { entity: '/species', foreignKey: 'species', type: 'belongsTo', alias: 'species' }
      ]
    },
    {
      name: '/locations',
      columns: ['id', 'name', 'climate', 'terrain', 'surface_water', 'residents', 'films', 'url'],
      relations: []
    },
    {
      name: '/species',
      columns: ['id', 'name', 'classification', 'eye_colors', 'hair_colors', 'people', 'films', 'url'],
      relations: []
    },
    {
      name: '/vehicles',
      columns: ['id', 'name', 'description', 'vehicle_class', 'length', 'pilot', 'films', 'url'],
      relations: [
        { entity: '/people', foreignKey: 'pilot', type: 'belongsTo', alias: 'pilot' }
      ]
    }
  ]
}
