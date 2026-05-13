'use strict'

/**
 * PokéAPI – free, open Pokémon data API.
 * Reference: https://pokeapi.co/docs/v2
 *
 * No credentials required. Rate limit: 100 requests/minute per IP.
 * The list endpoints (/pokemon, /ability, etc.) return lightweight summaries
 * with id+name; pass a specific id or name to the entity path for full detail.
 *
 * Note: /pokemon list response is wrapped in `{count, results: [...]}`.
 * The REST driver automatically unwraps the `results` key.
 *
 * Relationship notes:
 *  - All cross-entity references use `{name, url}` objects (URL-slug FKs),
 *    not plain integer IDs. The FK value is the entity name (slug), e.g. "fire".
 *  - A Pokémon has `types` (array → /type), `abilities` (array → /ability).
 *  - A move has a `type` → /type and `generation` → /generation.
 *  - A generation has `main_region` → /region.
 *  - A region has `main_generation` → /generation.
 *  - An ability has `generation` → /generation.
 */
module.exports = {
  name: 'pokeapi',
  label: 'PokéAPI (REST)',
  description: 'Free, open Pokémon data API with Pokémon, abilities, moves, types and generations.',
  driver: 'rest',
  connection: {
    database: 'https://pokeapi.co/api/v2'
  },
  entities: [
    {
      name: '/pokemon',
      columns: ['id', 'name', 'base_experience', 'height', 'weight', 'order', 'is_default'],
      relations: [
        { entity: '/type', foreignKey: 'name', type: 'hasMany', alias: 'types' },
        { entity: '/ability', foreignKey: 'name', type: 'hasMany', alias: 'abilities' }
      ]
    },
    {
      name: '/ability',
      columns: ['id', 'name', 'is_main_series', 'generation', 'effect_entries', 'pokemon'],
      relations: [
        { entity: '/generation', foreignKey: 'name', type: 'belongsTo', alias: 'generation' }
      ]
    },
    {
      name: '/type',
      columns: ['id', 'name', 'damage_relations', 'pokemon', 'moves'],
      relations: []
    },
    {
      name: '/move',
      columns: ['id', 'name', 'accuracy', 'effect_chance', 'pp', 'priority', 'power', 'type', 'damage_class'],
      relations: [
        { entity: '/type', foreignKey: 'name', type: 'belongsTo', alias: 'type' },
        { entity: '/generation', foreignKey: 'name', type: 'belongsTo', alias: 'generation' }
      ]
    },
    {
      name: '/generation',
      columns: ['id', 'name', 'abilities', 'main_region', 'moves', 'pokemon_species', 'types', 'version_groups'],
      relations: [
        { entity: '/region', foreignKey: 'name', type: 'belongsTo', alias: 'mainRegion' }
      ]
    },
    {
      name: '/nature',
      columns: ['id', 'name', 'decreased_stat', 'increased_stat', 'hates_flavor', 'likes_flavor'],
      relations: []
    },
    {
      name: '/region',
      columns: ['id', 'name', 'locations', 'main_generation', 'pokedexes', 'version_groups'],
      relations: [
        { entity: '/generation', foreignKey: 'name', type: 'belongsTo', alias: 'mainGeneration' }
      ]
    }
  ]
}
