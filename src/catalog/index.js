'use strict'

// Registry maps catalog names to loader functions.
// Each loader is called lazily — the catalog file is require()'d only when
// getCatalog() is invoked for that entry, not at server startup.
const REGISTRY = {
  // ── SQL ──────────────────────────────────────────────────────────────────
  blog: () => require('./blog'),
  chinook: () => require('./chinook'),
  rfam: () => require('./rfam'),
  // ── Graph ────────────────────────────────────────────────────────────────
  'neo4j-movies': () => require('./neo4j-movies'),
  // ── REST – entertainment & media ─────────────────────────────────────────
  ghibli: () => require('./ghibli'),
  jikan: () => require('./jikan'),
  pokeapi: () => require('./pokeapi'),
  rickandmorty: () => require('./rickandmorty'),
  swapi: () => require('./swapi'),
  // ── REST – science & space ───────────────────────────────────────────────
  nasa: () => require('./nasa'),
  spacex: () => require('./spacex'),
  // ── Life science: genes & genomes ────────────────────────────────────────
  ensembl: () => require('./ensembl'),
  'ncbi-gene': () => require('./ncbi-gene'),
  hgnc: () => require('./hgnc'),
  mygene: () => require('./mygene'),
  alliance: () => require('./alliance'),
  flybase: () => require('./flybase'),
  genbank: () => require('./genbank'),
  ncbi: () => require('./ncbi'),
  // ── Life science: proteins & structures ──────────────────────────────────
  uniprot: () => require('./uniprot'),
  pdb: () => require('./pdb'),
  pdbe: () => require('./pdbe'),
  alphafold: () => require('./alphafold'),
  interpro: () => require('./interpro'),
  rnacentral: () => require('./rnacentral'),
  pride: () => require('./pride'),
  // ── Life science: interactions & pathways ────────────────────────────────
  'string-db': () => require('./string-db'),
  intact: () => require('./intact'),
  reactome: () => require('./reactome'),
  rhea: () => require('./rhea'),
  kegg: () => require('./kegg'),
  regulondb: () => require('./regulondb'),
  // ── Life science: function & ontologies ──────────────────────────────────
  quickgo: () => require('./quickgo'),
  geneontology: () => require('./geneontology'),
  ols: () => require('./ols'),
  hpo: () => require('./hpo'),
  mesh: () => require('./mesh'),
  // ── Life science: chemistry & drugs ──────────────────────────────────────
  chembl: () => require('./chembl'),
  pubchem: () => require('./pubchem'),
  chebi: () => require('./chebi'),
  lipidmaps: () => require('./lipidmaps'),
  rxnorm: () => require('./rxnorm'),
  openfda: () => require('./openfda'),
  dgidb: () => require('./dgidb'),
  // ── Life science: disease & variants ─────────────────────────────────────
  opentargets: () => require('./opentargets'),
  monarch: () => require('./monarch'),
  gwas: () => require('./gwas'),
  clinvar: () => require('./clinvar'),
  myvariant: () => require('./myvariant'),
  gnomad: () => require('./gnomad'),
  civic: () => require('./civic'),
  // ── Life science: clinical ───────────────────────────────────────────────
  clinicaltrials: () => require('./clinicaltrials'),
  // ── Life science: literature ─────────────────────────────────────────────
  europepmc: () => require('./europepmc'),
  pubmed: () => require('./pubmed'),
  // ── Life science: expression & samples ───────────────────────────────────
  gtex: () => require('./gtex'),
  proteinatlas: () => require('./proteinatlas'),
  geo: () => require('./geo'),
  ena: () => require('./ena'),
  biosamples: () => require('./biosamples'),
  // ── BioCyc – free databases ──────────────────────────────────────────────
  'biocyc-metacyc': () => require('./biocyc-metacyc'),
  'biocyc-ecocyc': () => require('./biocyc-ecocyc'),
  // ── BioCyc – Tier 1 (extensively curated) ────────────────────────────────
  'biocyc-humancyc': () => require('./biocyc-humancyc'),
  'biocyc-yeastcyc': () => require('./biocyc-yeastcyc'),
  'biocyc-aracyc': () => require('./biocyc-aracyc'),
  'biocyc-leishcyc': () => require('./biocyc-leishcyc'),
  'biocyc-trypanocyc': () => require('./biocyc-trypanocyc'),
  // ── BioCyc – Tier 2 (computationally predicted + manual curation) ────────
  'biocyc-bsubcyc': () => require('./biocyc-bsubcyc'),
  'biocyc-mtbcyc': () => require('./biocyc-mtbcyc'),
  'biocyc-pseudocyc': () => require('./biocyc-pseudocyc'),
  'biocyc-vibriocyc': () => require('./biocyc-vibriocyc'),
  'biocyc-salentcyc': () => require('./biocyc-salentcyc'),
  'biocyc-listcyc': () => require('./biocyc-listcyc'),
  'biocyc-caulocyc': () => require('./biocyc-caulocyc'),
  'biocyc-celeganscyc': () => require('./biocyc-celeganscyc'),
  'biocyc-drosocyc': () => require('./biocyc-drosocyc'),
  'biocyc-borrcyc': () => require('./biocyc-borrcyc'),
  'biocyc-campycyc': () => require('./biocyc-campycyc'),
  // ── REST – commerce & finance ────────────────────────────────────────────
  coingecko: () => require('./coingecko'),
  fakestore: () => require('./fakestore'),
  // ── REST – culture & knowledge ───────────────────────────────────────────
  artic: () => require('./artic'),
  dogs: () => require('./dogs'),
  github: () => require('./github'),
  jsonplaceholder: () => require('./jsonplaceholder'),
  metmuseum: () => require('./metmuseum'),
  musicbrainz: () => require('./musicbrainz'),
  openfoodfacts: () => require('./openfoodfacts'),
  openlibrary: () => require('./openlibrary'),
  openbrewery: () => require('./openbrewery'),
  opentrivia: () => require('./opentrivia'),
  openmeteo: () => require('./openmeteo'),
  restcountries: () => require('./restcountries')
}

/**
 * Return catalog entries.
 * @param {string} [name]  When provided, returns only that entry (as a
 *   single-element array).  When omitted, returns all entries.
 * @returns {Array<object>}
 */
function getCatalog (name) {
  if (name) {
    if (!Object.hasOwn(REGISTRY, name)) throw new Error(`Unknown catalog: ${name}`)
    return [REGISTRY[name]()]
  }
  return Object.values(REGISTRY).map(load => load())
}

/**
 * Register a catalog entry at runtime — for embedding Mozg with private
 * sources, and for tests.  Names are restricted to lower-case slugs so a
 * caller cannot reach Object.prototype through the registry.
 * @param {object} entry  a catalog entry (same shape as the files here)
 * @returns {Function} call it to unregister the entry again
 */
function registerCatalog (entry) {
  if (!entry || typeof entry.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) {
    throw new Error('A catalog entry needs a lower-case slug name, e.g. "my-source"')
  }
  if (Object.hasOwn(REGISTRY, entry.name)) throw new Error(`Catalog entry "${entry.name}" is already registered`)
  REGISTRY[entry.name] = () => entry
  return () => { delete REGISTRY[entry.name] }
}

/**
 * Return the names of all registered catalog entries without loading them.
 * @returns {string[]}
 */
function listCatalog () {
  return Object.keys(REGISTRY)
}

/**
 * Find every catalog entry whose connection points at the given database or
 * base URL, ignoring a trailing slash.  Several catalog entries can share one
 * base URL (NCBI E-utilities backs `ncbi`, `genbank`, `pubmed` and `geo`,
 * distinguished only by a `where: { db }` the caller supplies per query, which
 * a bare connection does not carry) — returning every match lets a caller
 * combine them rather than silently picking one at random.
 * @param {string} database
 * @returns {object[]}
 */
function findCatalogsByDatabase (database) {
  if (!database) return []

  const wanted = String(database).replace(/\/$/, '')

  return Object.values(REGISTRY)
    .map((load) => load())
    .filter((entry) => {
      const candidate = (entry.connection && entry.connection.database) || ''
      return candidate.replace(/\/$/, '') === wanted
    })
}

module.exports = { getCatalog, listCatalog, findCatalogsByDatabase, registerCatalog }
