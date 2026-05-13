'use strict'

/**
 * SWAPI – The Star Wars API.
 * Reference: https://swapi.dev/documentation
 *
 * No credentials required. All data is publicly accessible.
 *
 * Note on relationships: SWAPI uses full URLs (e.g.
 * "https://swapi.dev/api/planets/1/") as foreign key values rather than plain
 * integer IDs. Native cross-entity resolution via the REST driver therefore
 * requires extracting the trailing ID segment from each URL. The entity
 * relationships are documented below for reference.
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
      relations: []
    },
    {
      name: '/people',
      columns: ['name', 'height', 'mass', 'hair_color', 'skin_color', 'eye_color', 'birth_year', 'gender', 'homeworld', 'films', 'species', 'vehicles', 'starships', 'url'],
      relations: [
        { entity: '/planets', foreignKey: 'homeworld', type: 'belongsTo', alias: 'homeworld' },
        { entity: '/species', foreignKey: 'url', type: 'hasMany', alias: 'species' }
      ]
    },
    {
      name: '/planets',
      columns: ['name', 'rotation_period', 'orbital_period', 'diameter', 'climate', 'gravity', 'terrain', 'surface_water', 'population', 'residents', 'films', 'url'],
      relations: []
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
