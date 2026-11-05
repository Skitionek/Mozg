# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Mozg leaves the concept phase: the life-science catalog is now executable,
verified against the live APIs, and joined up across sources.

### Added

- **`api` driver** — executes catalog-described HTTP APIs.  Each entity
  declares its request (path template, query, POST body or GraphQL query),
  where its records sit in the response, and which fields to keep under which
  names.  `where` keys are the entity's named parameters and are validated:
  an undeclared key is an error rather than a filter the API silently ignores.
- **`source`, `include`, `apiKeys` and `raw` on `QueryInput`** — query a
  catalog source by name without spelling out a connection, pull in
  catalog-declared relations by name (dots follow them across sources:
  `include: ["structures.entry"]`), pass per-source API keys, or get records
  exactly as the source sent them.  `connection` is now optional when `source`
  is given.  The streaming endpoint accepts the same shorthand.
- **47 connected life-science sources** (206 entities, 663 relations, 441 of
  them between sources), each entity verified against the live API:
  - Genes & genomes: `ensembl`, `ncbi-gene`, `hgnc`, `mygene`, `alliance`,
    `flybase`, `genbank`, `ncbi`, `ena`
  - Proteins & structures: `uniprot`, `pdb`, `pdbe`, `alphafold`, `interpro`,
    `rnacentral`
  - Interactions & pathways: `string-db`, `intact`, `reactome`, `rhea`,
    `regulondb` (and `kegg`, whose relations now resolve)
  - Function & ontologies: `quickgo`, `geneontology`, `ols`, `hpo`, `mesh`
  - Chemistry & drugs: `chembl`, `pubchem`, `chebi`, `lipidmaps`, `rxnorm`,
    `openfda`, `dgidb`
  - Disease & variants: `opentargets`, `monarch`, `gwas`, `clinvar`,
    `myvariant`, `gnomad`, `civic`
  - Clinical: `clinicaltrials`; Literature: `pubmed`, `europepmc`
  - Expression & samples: `gtex`, `proteinatlas`, `geo`, `biosamples`, `pride`

  Every entity and relation is listed in the generated `docs/sources.md`;
  22 runnable life-science examples replace the old bioinformatics ones.
- `limit` on relations (`RelationInput.limit`, and on catalog relations) to
  cap related rows per parent; `hasOne`/`belongsTo` now fetch a single row.
- **Resilient outbound HTTP** (`src/database/http.js`) for every network
  source: timeouts, retries with exponential backoff that honour
  `Retry-After`, per-host rate limits matching each API's published policy,
  sharing of identical in-flight requests, a Mozg User-Agent, and masking of
  API keys in error messages.  Optional short-lived cache via
  `MOZG_HTTP_CACHE_TTL_MS` (off by default — queries read live data).
- **Catalog lint** (`tests/catalog-relations.test.js`) — every relation's join
  key must be a parameter of its target entity and a field of its source
  entity; every entity must carry an `example`.
- **Live verification** — `npm run verify:sources` runs every entity's example
  against the real API and follows every relation; the weekly integration
  workflow runs it and uploads the report.  The catalog health check probes
  `api` sources through the same path.
- **Generated source reference** — `docs/sources.md`, built from the catalog
  by `npm run docs:sources`; a test fails when it is stale.
- `catalog(category:, driver:)` filters, and `CatalogEntry.category`,
  `homepage`, `docs`, `license`, `auth`, `CatalogEntity.description`,
  `params`, `example` and `CatalogRelation.description`.
- `introspect(source:)` — describe a catalog source by name.
- `registerCatalog(entry)` — register private sources when embedding Mozg.
- Query builder: life-science sources grouped by category; choosing one fills
  in `source`, the entity's example `where`, and offers its relations as
  `include` checkboxes.  The "Work in Progress" banner is gone.
- `/healthz` endpoint, graceful shutdown on SIGTERM/SIGINT, a production
  `Dockerfile`, and a CI job that builds the image and checks `/healthz`.

### Changed

- KEGG requests go through the shared HTTP client (3 requests/s, as KEGG
  asks; timeouts; retries); a 404 is an empty result instead of an error.
- Cross-catalog relations on a row are resolved concurrently.
- `embl-ebi` is now `ena`, and `refseq` is now `ncbi-gene` (NCBI Datasets v2).
- `rnacentral` uses the RNAcentral REST API instead of the public Postgres
  mirror, whose read-only account lost access to its schema.

### Removed

- `hmdb` and `wormbase` (their servers now refuse automated clients), `zfin`
  (unreachable), and `brenda` (described a REST API BRENDA does not offer; it
  is SOAP-only behind registration).  Model-organism genes from ZFIN, WormBase,
  MGI, RGD and SGD are available through `alliance`.

### Fixed

- Cross-catalog relations between the life-science sources resolve.  They
  previously sent the join key as a query parameter to endpoints that take it
  in the path, so every one of them failed.
- `limit` is honoured for life-science sources (it was sent as
  JSONPlaceholder's `_limit`, which they ignore).
- The query builder generated invalid GraphQL for any `where` clause or
  connection `headers` (it pasted JSON, whose quoted keys GraphQL rejects).

[Unreleased]: https://github.com/Skitionek/Mozg/commits/main
