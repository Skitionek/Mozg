'use strict'

/**
 * SWAPI – The Star Wars API.
 * Reference: https://swapi.dev/documentation
 *
 * No credentials required. All data is publicly accessible.
 *
 * Relationships: SWAPI links records by full URL (e.g.
 * "https://swapi.dev/api/planets/1/"), single or in lists, and the REST
 * driver follows those URLs on the same origin.
 *
 * List responses are wrapped in `{count, next, results: [...]}`.
 * The REST driver automatically unwraps the `results` key.
 */
module.exports = {
  name: 'swapi',
  label: 'SWAPI – Star Wars API (REST)',
  description: 'The Star Wars API with films, people, planets, species, vehicles and starships. No auth required.',
  driver: 'rest',
  connection: {
    database: 'https://swapi.dev/api'
  },
  entities: [
    {
      name: '/films',
      columns: ['title', 'episode_id', 'opening_crawl', 'director', 'producer', 'release_date', 'characters', 'planets', 'starships', 'vehicles', 'species', 'url'],
      relations: [
        { entity: '/people', foreignKey: 'characters', type: 'hasMany', alias: 'characters' },
        { entity: '/planets', foreignKey: 'planets', type: 'hasMany', alias: 'planets' }
      ]
    },
    {
      name: '/people',
      columns: ['name', 'height', 'mass', 'hair_color', 'skin_color', 'eye_color', 'birth_year', 'gender', 'homeworld', 'films', 'species', 'vehicles', 'starships', 'url'],
      relations: [
        { entity: '/planets', foreignKey: 'homeworld', type: 'belongsTo', alias: 'homeworld' },
        { entity: '/species', foreignKey: 'species', type: 'hasMany', alias: 'species' },
        { entity: '/films', foreignKey: 'films', type: 'hasMany', alias: 'films' }
      ]
    },
    {
      name: '/planets',
      columns: ['name', 'rotation_period', 'orbital_period', 'diameter', 'climate', 'gravity', 'terrain', 'surface_water', 'population', 'residents', 'films', 'url'],
      relations: [
        { entity: '/people', foreignKey: 'residents', type: 'hasMany', alias: 'residents' }
      ]
    },
    {
      name: '/species',
      columns: ['name', 'classification', 'designation', 'average_height', 'skin_colors', 'hair_colors', 'eye_colors', 'average_lifespan', 'language', 'homeworld', 'people', 'films', 'url'],
      relations: [
        { entity: '/planets', foreignKey: 'homeworld', type: 'belongsTo', alias: 'homeworld' }
      ]
    },
    {
      name: '/vehicles',
      columns: ['name', 'model', 'manufacturer', 'cost_in_credits', 'length', 'max_atmosphering_speed', 'crew', 'passengers', 'cargo_capacity', 'vehicle_class', 'pilots', 'films', 'url'],
      relations: []
    },
    {
      name: '/starships',
      columns: ['name', 'model', 'manufacturer', 'cost_in_credits', 'length', 'max_atmosphering_speed', 'crew', 'passengers', 'cargo_capacity', 'hyperdrive_rating', 'MGLT', 'starship_class', 'pilots', 'films', 'url'],
      relations: []
    }
  ]
}
