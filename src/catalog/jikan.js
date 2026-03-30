'use strict';

/**
 * Jikan – unofficial MyAnimeList REST API.
 * Reference: https://docs.api.jikan.moe/
 *
 * No credentials required.
 * Responses are wrapped in `{data: [...], pagination: {...}}`.
 * The REST driver automatically unwraps the `data` key.
 *
 * Rate limits: 3 req/sec, 60 req/min.
 */
module.exports = {
  name: 'jikan',
  label: 'Jikan – MyAnimeList (REST)',
  description: 'Unofficial MyAnimeList API with anime, manga, characters, people and genres.',
  driver: 'rest',
  connection: {
    database: 'https://api.jikan.moe/v4',
  },
  entities: [
    {
      name: '/anime',
      columns: ['mal_id', 'title', 'title_english', 'type', 'source', 'episodes', 'status', 'airing', 'score', 'rank', 'popularity', 'season', 'year'],
      relations: [],
    },
    {
      name: '/manga',
      columns: ['mal_id', 'title', 'title_english', 'type', 'chapters', 'volumes', 'status', 'score', 'rank', 'popularity'],
      relations: [],
    },
    {
      name: '/characters',
      columns: ['mal_id', 'name', 'name_kanji', 'nicknames', 'favorites', 'about'],
      relations: [],
    },
    {
      name: '/people',
      columns: ['mal_id', 'name', 'family_name', 'given_name', 'birthday', 'favorites', 'about'],
      relations: [],
    },
    {
      name: '/genres/anime',
      columns: ['mal_id', 'name', 'url', 'count'],
      relations: [],
    },
    {
      name: '/genres/manga',
      columns: ['mal_id', 'name', 'url', 'count'],
      relations: [],
    },
    {
      name: '/top/anime',
      columns: ['mal_id', 'title', 'type', 'episodes', 'score', 'rank', 'popularity', 'members'],
      relations: [],
    },
    {
      name: '/top/manga',
      columns: ['mal_id', 'title', 'type', 'chapters', 'score', 'rank', 'popularity', 'members'],
      relations: [],
    },
    {
      name: '/seasons/now',
      columns: ['mal_id', 'title', 'type', 'episodes', 'score', 'season', 'year'],
      relations: [],
    },
  ],
};
