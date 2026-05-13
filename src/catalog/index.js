'use strict'

// Registry maps catalog names to loader functions.
// Each loader is called lazily — the catalog file is require()'d only when
// getCatalog() is invoked for that entry, not at server startup.
const REGISTRY = {
  // ── SQL ──────────────────────────────────────────────────────────────────
  blog: () => require('./blog'),
  chinook: () => require('./chinook'),
  rnacentral: () => require('./rnacentral'),
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
  // ── Bioinformatics – NCBI family ─────────────────────────────────────────
  ncbi: () => require('./ncbi'),
  genbank: () => require('./genbank'),
  pubmed: () => require('./pubmed'),
  refseq: () => require('./refseq'),
  geo: () => require('./geo'),
  // ── Bioinformatics – protein & structure ─────────────────────────────────
  uniprot: () => require('./uniprot'),
  pdb: () => require('./pdb'),
  interpro: () => require('./interpro'),
  brenda: () => require('./brenda'),
  hmdb: () => require('./hmdb'),
  'string-db': () => require('./string-db'),
  // ── Bioinformatics – genome browsers & annotation ────────────────────────
  ensembl: () => require('./ensembl'),
  reactome: () => require('./reactome'),
  kegg: () => require('./kegg'),
  // ── Bioinformatics – nucleotide archives ─────────────────────────────────
  'embl-ebi': () => require('./embl-ebi'),
  ddbj: () => require('./ddbj'),
  // ── Bioinformatics – model organism databases ─────────────────────────────
  flybase: () => require('./flybase'),
  wormbase: () => require('./wormbase'),
  zfin: () => require('./zfin'),
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
  // ── Bioinformatics – chemical ontologies ─────────────────────────────────
  chebi: () => require('./chebi'),
  geneontology: () => require('./geneontology'),
  // ── Bioinformatics – biomedical vocabularies ──────────────────────────────
  mesh: () => require('./mesh'),
  regulondb: () => require('./regulondb'),
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
    const loader = REGISTRY[name]
    if (!loader) throw new Error(`Unknown catalog: ${name}`)
    return [loader()]
  }
  return Object.values(REGISTRY).map(load => load())
}

/**
 * Return the names of all registered catalog entries without loading them.
 * @returns {string[]}
 */
function listCatalog () {
  return Object.keys(REGISTRY)
}

module.exports = { getCatalog, listCatalog }
