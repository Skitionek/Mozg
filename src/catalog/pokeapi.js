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
 * PokéAPI answers 403 to any query parameter other than `limit` and `offset`,
 * so it can only be paged, never filtered or sorted server-side.
 *
 * Relationship notes:
 *  - List rows are `{name, url}`; `detail` follows the url to the full record
 *    (or query `/pokemon/pikachu` directly).
 *  - Full records reference others by `{name, url}` objects, followed by
 *    path: a Pokémon's `types[].type.url` → /type, `abilities[].ability.url`
 *    → /ability; a move's `type.url` and `generation.url`; a generation's
 *    `main_region.url`; a region's `main_generation.url`.  On list rows these
 *    relations are empty, so include them under `detail` (`detail.types`).
 */
module.exports = {
  name: 'pokeapi',
  label: 'PokéAPI (REST)',
  description: 'Free, open Pokémon data API with Pokémon, abilities, moves, types and generations.',
  driver: 'rest',
  connection: {
    database: 'https://pokeapi.co/api/v2',
    paging: { limit: 'limit', offset: 'offset', sort: null, order: null }
  },
  rateLimit: { requestsPerSecond: 1.5, maxConcurrent: 4 },
  entities: [
    {
      name: '/pokemon',
      columns: ['id', 'name', 'url', 'base_experience', 'height', 'weight', 'order', 'is_default', 'types', 'abilities'],
      relations: [
        { entity: '/pokemon', foreignKey: 'url', type: 'belongsTo', alias: 'detail' },
        { entity: '/type', foreignKey: 'types[].type.url', type: 'hasMany', alias: 'types' },
        { entity: '/ability', foreignKey: 'abilities[].ability.url', type: 'hasMany', alias: 'abilities' }
      ]
    },
    {
      name: '/ability',
      columns: ['id', 'name', 'url', 'is_main_series', 'generation', 'effect_entries', 'pokemon'],
      relations: [
        { entity: '/ability', foreignKey: 'url', type: 'belongsTo', alias: 'detail' },
        { entity: '/generation', foreignKey: 'generation.url', type: 'belongsTo', alias: 'generation' }
      ]
    },
    {
      name: '/type',
      columns: ['id', 'name', 'url', 'damage_relations', 'pokemon', 'moves'],
      relations: [
        { entity: '/type', foreignKey: 'url', type: 'belongsTo', alias: 'detail' }
      ]
    },
    {
      name: '/move',
      columns: ['id', 'name', 'url', 'accuracy', 'effect_chance', 'pp', 'priority', 'power', 'type', 'damage_class', 'generation'],
      relations: [
        { entity: '/move', foreignKey: 'url', type: 'belongsTo', alias: 'detail' },
        { entity: '/type', foreignKey: 'type.url', type: 'belongsTo', alias: 'type' },
        { entity: '/generation', foreignKey: 'generation.url', type: 'belongsTo', alias: 'generation' }
      ]
    },
    {
      name: '/generation',
      columns: ['id', 'name', 'url', 'abilities', 'main_region', 'moves', 'pokemon_species', 'types', 'version_groups'],
      relations: [
        { entity: '/generation', foreignKey: 'url', type: 'belongsTo', alias: 'detail' },
        { entity: '/region', foreignKey: 'main_region.url', type: 'belongsTo', alias: 'mainRegion' }
      ]
    },
    {
      name: '/nature',
      columns: ['id', 'name', 'url', 'decreased_stat', 'increased_stat', 'hates_flavor', 'likes_flavor'],
      relations: [
        { entity: '/nature', foreignKey: 'url', type: 'belongsTo', alias: 'detail' }
      ]
    },
    {
      name: '/region',
      columns: ['id', 'name', 'url', 'locations', 'main_generation', 'pokedexes', 'version_groups'],
      relations: [
        { entity: '/region', foreignKey: 'url', type: 'belongsTo', alias: 'detail' },
        { entity: '/generation', foreignKey: 'main_generation.url', type: 'belongsTo', alias: 'mainGeneration' }
      ]
    }
  ]
}
