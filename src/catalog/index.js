'use strict';

// Registry maps catalog names to loader functions.
// Each loader is called lazily — the catalog file is require()'d only when
// getCatalog() is invoked for that entry, not at server startup.
const REGISTRY = {
  blog:             () => require('./blog'),
  chinook:          () => require('./chinook'),
  jsonplaceholder:  () => require('./jsonplaceholder'),
  'neo4j-movies':   () => require('./neo4j-movies'),
  rnacentral:       () => require('./rnacentral'),
  artic:            () => require('./artic'),
  openbrewery:      () => require('./openbrewery'),
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
