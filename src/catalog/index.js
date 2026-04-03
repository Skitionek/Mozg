'use strict';

// Registry maps catalog names to loader functions.
// Each loader is called lazily — the catalog file is require()'d only when
// getCatalog() is invoked for that entry, not at server startup.
const REGISTRY = {
  // ── SQL ──────────────────────────────────────────────────────────────────
  blog:             () => require('./blog'),
  chinook:          () => require('./chinook'),
  rnacentral:       () => require('./rnacentral'),
  rfam:             () => require('./rfam'),
  // ── Graph ────────────────────────────────────────────────────────────────
  'neo4j-movies':   () => require('./neo4j-movies'),
  // ── REST – entertainment & media ─────────────────────────────────────────
  ghibli:           () => require('./ghibli'),
  jikan:            () => require('./jikan'),
  pokeapi:          () => require('./pokeapi'),
  rickandmorty:     () => require('./rickandmorty'),
  swapi:            () => require('./swapi'),
  // ── REST – science & space ───────────────────────────────────────────────
  nasa:             () => require('./nasa'),
  spacex:           () => require('./spacex'),
  // ── REST – commerce & finance ────────────────────────────────────────────
  coingecko:        () => require('./coingecko'),
  fakestore:        () => require('./fakestore'),
  // ── REST – culture & knowledge ───────────────────────────────────────────
  artic:            () => require('./artic'),
  dogs:             () => require('./dogs'),
  github:           () => require('./github'),
  jsonplaceholder:  () => require('./jsonplaceholder'),
  metmuseum:        () => require('./metmuseum'),
  musicbrainz:      () => require('./musicbrainz'),
  openfoodfacts:    () => require('./openfoodfacts'),
  openlibrary:      () => require('./openlibrary'),
  openbrewery:      () => require('./openbrewery'),
  opentrivia:       () => require('./opentrivia'),
  openmeteo:        () => require('./openmeteo'),
  restcountries:    () => require('./restcountries'),
};

/**
 * Return catalog entries.
 * @param {string} [name]  When provided, returns only that entry (as a
 *   single-element array).  When omitted, returns all entries.
 * @returns {Array<object>}
 */
function getCatalog(name) {
  if (name) {
    const loader = REGISTRY[name];
    if (!loader) throw new Error(`Unknown catalog: ${name}`);
    return [loader()];
  }
  return Object.values(REGISTRY).map(load => load());
}

/**
 * Return the names of all registered catalog entries without loading them.
 * @returns {string[]}
 */
function listCatalog() {
  return Object.keys(REGISTRY);
}

module.exports = { getCatalog, listCatalog };
