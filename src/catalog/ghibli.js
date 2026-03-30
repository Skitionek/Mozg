'use strict';

/**
 * Studio Ghibli API – resource data from Studio Ghibli films.
 * Reference: https://ghibliapi.vercel.app/#section/Studio-Ghibli-API
 *
 * No credentials required. CORS-enabled.
 * All endpoints return arrays directly (no envelope wrapper).
 *
 * Relationship notes:
 *  - Films contain arrays of people/location/species/vehicle URLs.
 *    The `people` and `locations` arrays hold full REST URLs
 *    (e.g. "https://ghibliapi.vercel.app/people/ba924631-…").
 */
module.exports = {
  name: 'ghibli',
  label: 'Studio Ghibli API (REST)',
  description: 'Resource data from Studio Ghibli films: films, characters, locations, species and vehicles.',
  driver: 'rest',
  connection: {
    database: 'https://ghibliapi.vercel.app',
  },
  entities: [
    {
      name: '/films',
      columns: ['id', 'title', 'original_title', 'original_title_romanised', 'description', 'director', 'producer', 'release_date', 'running_time', 'rt_score', 'people', 'species', 'locations', 'vehicles', 'url'],
      relations: [],
    },
    {
      name: '/people',
      columns: ['id', 'name', 'gender', 'age', 'eye_color', 'hair_color', 'films', 'species', 'url'],
      relations: [],
    },
    {
      name: '/locations',
      columns: ['id', 'name', 'climate', 'terrain', 'surface_water', 'residents', 'films', 'url'],
      relations: [],
    },
    {
      name: '/species',
      columns: ['id', 'name', 'classification', 'eye_colors', 'hair_colors', 'people', 'films', 'url'],
      relations: [],
    },
    {
      name: '/vehicles',
      columns: ['id', 'name', 'description', 'vehicle_class', 'length', 'pilot', 'films', 'url'],
      relations: [],
    },
  ],
};
