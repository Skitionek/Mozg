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
- **OBO keys.** Identifier fields and parameters are annotated with the
  Bioregistry prefix of their identifier space (`uniprot`, `ensembl`,
  `chebi`, `mondo`, …; `src/database/obo.js`), by naming convention or an
  entity-level `obo` map.  Built on the rule *same key + same value = same
  thing*:
  - the api driver writes keyed values in one canonical form per key, and
    `verify-sources` fails values that are not;
  - relations are declared by key (`obo: 'uniprot'`) — 529 of the 663
    catalog relations now are; `RelationInput.obo` does the same in a query;
  - undeclared joins: `include: ["source/entity"]` follows any entity whose
    required parameter takes a key a field carries (`CatalogEntity.links`);
  - the catalog lint rejects unknown keys and relations that join
    identifiers from different spaces;
  - `oboKeys` query, `CatalogEntity.fields`, `CatalogParam.obo`,
    `CatalogRelation.obo`; the query builder offers OBO links as includes.
- Self-hosting support: `MOZG_SOURCES_DIR` registers JSON catalog entries at
  startup; connection values may come from the environment
  (`{ "env": "VAR" }`), are never shown by the `catalog` query, and a
  source whose connection the server holds cannot be redirected by callers.
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
- **Helm chart** (`deploy/helm/mozg`, [docs/deploy.md](docs/deploy.md)) for
  Mozg and the databases you choose to host beside it.
  - Every engine Mozg queries can be hosted: PostgreSQL, MySQL (MariaDB),
    Neo4j, ArangoDB and Elasticsearch, and SQLite (a file inside the Mozg
    pods). Each loads its native dump format on first start (pg_dump, SQL,
    neo4j-admin dump, arangodump, a snapshot repository or `_bulk` NDJSON),
    or inline data (`initSQL`, `initCypher`, `initJS`, `initBulk`).
  - Presets: ChEMBL (PostgreSQL dump) and Reactome (Neo4j dump). A
    `databases:` entry adds your own.
  - Each database is a StatefulSet with a volume behind a stable Service,
    scaled to zero by KEDA when idle and woken by the first query that needs
    it. Mozg waits out the cold start (`MOZG_WAKE_TIMEOUT_MS`).
  - Each is registered as a catalog source with OBO-keyed fields, so it
    joins the public APIs.
  - Generated passwords live in Secrets mounted as files. A NetworkPolicy
    and a restricted security context apply throughout.
  - CI lints and validates every configuration. For each engine, a kind
    cluster runs the whole path: first start, scale to zero, wake on query,
    OBO join to UniProt, back to zero, and wake again.
- **Connector evaluation** ([docs/connectors.md](docs/connectors.md)): every
  non-`api` driver was tested against a real server or service and given a
  status. A shared behavioural suite runs against PostgreSQL, MySQL, Neo4j,
  ArangoDB and Elasticsearch in the new Connectors workflow.
- **Public database dumps** ([docs/dumps.md](docs/dumps.md)): public
  life-science and demo databases whose dumps the chart can host, each URL
  checked and, for several, restored with the chart's own first-start
  commands. Each loadable one has a `databases:` snippet; those that need
  converting, or cannot be loaded, say why.
- REST driver: per-source `paging` parameter names, extra `unwrap` envelope
  keys, default `headers` and `rateLimit`, applied whether a query names the
  source or its base URL. Relations take a path as `foreignKey`
  (`owner.login`, `types[].type.url`) and entity paths with `{field}`
  placeholders (`/carts/user/{id}`).

- **Materialised views.**  A named, operator-defined query (`MOZG_VIEWS`, Helm
  `mozg.views`) whose rows Mozg stores and serves instead of reading live data
  each time: `query(input: { view: "name", where, select, orderBy, limit })`
  filters (a value, or `eq ne in gt gte lt lte contains`), orders and pages the
  stored rows.  Freshness is always visible (`meta`: `refreshedAt`, `ageMs`,
  `stale`, `total`, `truncated`; the `views` query).  Refresh by `ttlMs` with
  stale-while-revalidate, on a timer (`everyMs`), at start, or by the
  `refreshView` mutation (single-flight, once per `minIntervalMs`); a failed
  refresh keeps the last good rows and is not retried more than once per
  interval.  Bounded by `maxRows` and `MOZG_VIEWS_MAX_BYTES`; credentials can
  be `{ env: VAR }`; callers cannot define a view.  Per replica, in memory.
  `QueryInput.from` is optional (a view needs none).  Metrics:
  `mozg_view_rows`, `mozg_view_age_seconds`, `mozg_view_refreshes_total`,
  `mozg_view_refresh_seconds`.
- **Link database values to ontology terms.**  `QueryInput.link` resolves a
  result field's values to the terms of an ontology and writes the term beside
  the value (`<field>Term`, or `as`): by identifier (any spelling, the IRI, or
  a bare id plus the ontology's OBO key), label, synonym or cross-reference,
  in the order `match` gives.  Works on lists and, with `a.b`, on the fields
  of included relations.  Ontologies are named in `MOZG_ONTOLOGIES` (Helm
  `mozg.ontologies`) and load once on first use, or given inline as `url` /
  `content`; the new `ontologies` and `ontologyTerms` queries list and search
  them.  Terms are read from the OBO flat-file format (new; a tenth the size
  of OWL), Turtle and RDF/XML.  Checked on the real Human Phenotype Ontology
  (20,482 terms, 288 ms).  Callers cannot register a named ontology: without
  authentication that would let anyone rewrite everyone's links.
- **Metrics and logs.**  `GET /metrics` serves Prometheus text (a small
  registry in `src/metrics.js`, no new dependency): inbound requests, queries
  by driver and source, rows, outbound requests by host with retries, cold
  starts, cache sizes and hit counts, process memory and CPU.  Label values
  that come from callers are capped.  `MOZG_METRICS_PORT` serves it on a
  separate port; the Helm chart does so by default (`metrics.*`, with a
  NetworkPolicy rule, pod annotations and an optional PodMonitor).  Logs are
  one JSON line per request and query with a `requestId` (from `X-Request-Id`
  or generated, and returned in the response); queries log the names of their
  `where` keys, never the values (`MOZG_LOG_LEVEL`, `MOZG_LOG_FORMAT`,
  `MOZG_SLOW_QUERY_MS`).  The server now lives in `src/server.js`, started by
  `src/index.js`, so it can be started on any port.
- **Result cache.** `MOZG_RESULT_CACHE_TTL_MS` (Helm `mozg.resultCache.ttlMs`)
  reuses the answer to a whole query, relations included, for every driver
  and for `/stream`; `MOZG_RESULT_CACHE_TTL_BY_SOURCE` (`perSource`) overrides
  it per source, `0` turning it off for one.  Off by default, so Mozg still
  reads live data unless an operator chooses otherwise.  `QueryInput.fresh`
  reads live data for one query (and every relation fetched for it) and
  refreshes the entry; `QueryResult.meta` says whether an answer was a
  `hit`, `miss`, `bypass` or `shared`.  Keys cover credentials and API keys,
  errors and SOAP/Thrift are never cached, and identical concurrent queries
  share one execution.  `MOZG_HTTP_CACHE_TTL_MS` keeps its meaning (it caches
  single outbound GETs).

### Changed

- **SOAP is read-only by default.**  A WSDL does not say whether an operation
  changes data and the SOAP handler exposes all of them as mutations, so
  naming one in `from` ran it.  Now only operations whose first word is a read
  verb (`Get…`, `List…`, `Search…`) run, plus those in `MOZG_SOAP_OPERATIONS`
  (Helm `mozg.soapOperations`); `*` restores the old behaviour.
  **Breaking** for anyone calling other SOAP operations.
- **Relations fetch each distinct parent key once** (REST and mesh
  connectors); a mesh handler whose filters take an `in` list (Neo4j) is asked
  once per 200 parents, falling back to one query per key if that fails; and a
  REST relation that says `batch: true` (`RelationInput.batch`, set on
  JSONPlaceholder's relations) fetches all parents with one repeated filter,
  checked live (6 requests became 2, same answer).
- **Dependencies, runtimes and images on their current LTS lines** (as of
  November 2026):
  - Node.js: the image runs Node 26 (active LTS); CI tests 22, 26 and the
    28 nightly (see the version presets below). `engines` is `>=22`, since
    Node 20 reached end of life in April 2026.
  - Database images:
    - MariaDB 12.3 LTS (was 11.4);
    - Neo4j 5.26 LTS, pinned in CI too;
    - PostgreSQL 18, Elasticsearch 9.5.6 and ArangoDB 3.12.13, the newest
      releases of projects without LTS lines;
    - MySQL 8.4 LTS in CI (was 8.0, end of life).
  - Tooling:
    - Helm 4.3.1 (`azure/setup-helm` v5);
    - kubeconform 0.8.0, validating against Kubernetes 1.35 and 1.37;
    - curl 8.23.0;
    - the Codespaces image (`javascript-node:5-26-trixie`, was Node 20).
  - npm: every direct dependency at its latest release.
    - `graphql-scalars` is pinned to 2.0.1 for a high-severity ReDoS
      (GHSA-x8rm-f576-gq67) that the mesh packages' `^1` range cannot reach.
    - The `thrift` override moves to 0.25.
    - `npm audit --omit=dev` goes from 9 findings (1 high) to 4 moderate.
      They come only through `@graphql-mesh/openapi`, whose suggested "fix"
      is a stray 1.0.0 from 2023.
    - Transitive packages stay pinned: refreshing them all broke the Neo4j
      handler ("Unknown argument kind on directive @transport").
- **CI tests three version presets, not the product of every version**
  (`.github/ci-presets.json`):
  - `oldest`: each project's oldest supported line (Node 22, PostgreSQL 14,
    MariaDB 10.11, Elasticsearch 8.19, Kubernetes 1.35, Helm 3, KEDA 2.20);
  - `lts`: its current LTS line, or newest stable release;
  - `newest`: its newest release, pre-releases included (Node 28 nightly,
    PostgreSQL 19 RC1, MariaDB 13.1 RC, Neo4j 2026.10, an Elasticsearch 9.7
    snapshot). This preset is allowed to fail.

  Each preset runs the unit tests, the Docker image (now built
  with `--build-arg NODE_TAG`), and the connector suite, which now covers
  MariaDB too. It also runs the Helm chart's kind test, which now installs
  all six engines into one cluster, with every image, Kubernetes, kind, Helm
  and KEDA taken from the preset. A weekly workflow checks the presets
  against endoflife.date (`scripts/ci-presets.js`).
- **A recorded demo** (`docs/media/mozg-demo.mp4`, 80 s) of the query
  builder: UniProt with structures, AlphaFold and pathways in one query, an
  OBO-key join to Open Targets, a REST source, and GraphiQL.
  `scripts/record-demo.js` re-records it against the live APIs with
  Playwright, and fails rather than record an error.
- **GitHub Pages is the documentation site** (`scripts/build-site.js`). It
  publishes the overview, the source reference, the runnable examples, the
  connector and deployment guides, the changelog, the demo recording and the
  paper. It replaces a copy of the query builder, which cannot work without
  a Mozg server behind it.
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
- `restcountries`: RestCountries retired the keyless v3.1 API it used, and
  v5 needs an API key.

### Fixed

- **MySQL 8's default login and MySQL 9 work.** The driver is now knex over
  `mysql2` (`src/database/drivers/mysql.js`), like PostgreSQL, replacing the
  graphql-mesh MySQL handler, whose `mysql` 2.x client answered
  `ER_NOT_SUPPORTED_AUTH_MODE` to `caching_sha2_password` and could not reach
  MySQL 9 at all.  Against a stock MySQL 8.0 the connector suite went from 8
  of 8 failing to 8 of 8 passing, with both login methods.  CI now starts
  MySQL without `--mysql-native-password=ON` and tests 8.4, 9.7 and 26.10
  (not yet run: the Connectors workflow is its test).  Relations batch (one
  query each) and `where` values keep their types.  `@graphql-mesh/mysql` is
  no longer a dependency; `mysql2` is.
- **Thrift calls carried no arguments.**  The Thrift executor drops arguments
  given as GraphQL variables, so every call reached the server with an empty
  argument struct.  They are now written as literals (built by GraphQL's own
  serialiser, so a value still cannot become query text), and Thrift is
  tested end to end against a real server.  Two limits are upstream and have
  `todo` tests: string parameters get no type, and struct results lose their
  field names.
- `Int` filters no longer read a number out of text (`"2) { evil } #"` was
  `2`, `2.5` was `2`); a value that is not an integer is refused.
- Operations that return a scalar (a Thrift `i32`, a SOAP string) appear in
  introspection, as a table with one `value` column.
- **Caches no longer grow without bound.** The database client per distinct
  connection (SQLite, PostgreSQL, ArangoDB, graphql-mesh), the Elasticsearch
  mapping, BioCyc's listing and session, parsed ontologies and the per-host
  rate limiters were keyed by caller input and never evicted.  They now share
  one LRU; clients also close after sitting idle
  (`MOZG_CONNECTION_CACHE_MAX`, `MOZG_CONNECTION_IDLE_MS`,
  `MOZG_ONTOLOGY_CACHE_MAX`).  The HTTP response cache now evicts the least
  recently used entry, not the oldest, and its size is
  `MOZG_HTTP_CACHE_MAX_ENTRIES` (Helm `mozg.httpCacheMaxEntries`).
- Cross-catalog relations between the life-science sources resolve.  They
  previously sent the join key as a query parameter to endpoints that take it
  in the path, so every one of them failed.
- `limit` is honoured for life-science sources (it was sent as
  JSONPlaceholder's `_limit`, which they ignore).
- The query builder generated invalid GraphQL for any `where` clause or
  connection `headers` (it pasted JSON, whose quoted keys GraphQL rejects).
- Every graphql-mesh connector (mysql, neo4j, openapi, odata, soap, thrift)
  failed with `getArgumentValues is not a function`. An npm override of
  `@graphql-tools/utils` caused it and is removed. The advisories it targeted
  affect `<=12.0.1`, and the tree now resolves to 12.1.0 and 13.2.0.
- Mesh connectors: values are sent as typed GraphQL variables instead of
  spliced into query text; MySQL paging had limit and offset swapped; Neo4j
  filters and sorting use `@neo4j/graphql` 7's input shapes; OData pushes
  paging, ordering and filters to the server.
- A request with a wrong password could reuse a MySQL or ArangoDB connection
  another caller had opened with the right one; the caches now key on the
  password.
- ArangoDB: collection names, `where` keys, `orderBy` and `select` were
  spliced into AQL (an injection); they are bind parameters now.
- Elasticsearch searches the index named in `from`, with `where`, paging,
  sorting and relations, instead of returning index metadata.
- BioCyc uses the documented `apixml` endpoint; the one it called no longer
  exists.
- REST `hasMany` filters related records by their foreign key instead of
  fetching `/{entity}/{parent id}`.  The demo REST sources' relations were
  rewritten to what each API can serve and followed live. PokéAPI, which
  rejects unknown query parameters, works with `limit`. MusicBrainz and the
  Met return rows instead of one envelope.
- A relation `limit` is honoured by every connector, and introspection of a
  self-hosted database waits for it to wake, as queries do.
- Neo4j nodes with integer properties (anything created in Cypher, Reactome's
  `dbId`) could not be read: the mesh transport's driver returns native
  BigInts, which `@neo4j/graphql`'s BigInt scalar rejected.  They are
  returned as numbers (strings beyond 2^53), and BigInt filters work.
- A query to a self-hosted database waking from zero now also waits through:
  - a refused Elasticsearch connection (the HTTP client kept no cause);
  - pooled connections the database closed when it scaled down;
  - a MySQL server that accepted the connection but has not greeted yet.
- A self-hosted PostgreSQL scaling down under an idle pooled connection
  (`57P01`, "terminating connection due to administrator command") failed
  the next query instead of waiting for it to come back.
- ArangoDB 3.12.5 and later: the image's entrypoint starts its first-start
  server on `./arangod` instead of the data directory, so the chart's
  database creation and restore landed beside the real data. The chart
  mounts the data directory there too.
- The Docker image could not load SQLite: `sqlite3`'s prebuilt binding needs
  glibc 2.38, and the image was based on Debian 12 (glibc 2.36).  It is now
  based on Debian 13 (`node:26-trixie-slim`), and CI opens a SQLite database
  inside the image.
- A self-hosted PostgreSQL waking from zero could fail the query with
  "Knex: Timeout acquiring a connection" where the network drops connections
  to a Service with no pods (kind 0.33) instead of refusing them. The pg
  client had no connect timeout, so knex's pool gave up after a minute with
  an error that does not say the database is down. PostgreSQL connections now
  time out after 10 s with "timeout expired", which counts as a cold start.
- `examples/seed.js` appended another copy of the sample rows on every run
  (its `INSERT OR IGNORE`s had nothing unique to ignore on), and every test
  run seeds. Comments grew quadratically, to 105,000 after 68 runs, and the
  3-level benchmark slowed from 1 ms to 176 ms. It now seeds in one
  transaction: it leaves the sample rows alone if they are already there,
  and otherwise rebuilds them, which also repairs a database the old script
  grew.
- npm 12, which ships with Node 28, blocks dependency install scripts unless
  `allowScripts` in `package.json` covers them. sqlite3's binding was never
  built under it, so every SQLite query failed. `allowScripts` now names
  sqlite3.
- Neo4j 2025 and later: numeric properties were typed as strings, so
  filtering on a number failed. These releases name property types in
  Cypher's terms (`INTEGER NOT NULL`), which the Neo4j handler's schema
  introspector does not know. The adapter now translates them to the older
  names first.
- An entity named after its Neo4j node label (`Pathway`) was not found,
  because the Neo4j handler names its query fields after pluralised labels
  (`pathways`). The `reactome` preset names all its entities that way, so
  none of them could be queried. An entity name now also matches the list
  field returning the type of that name.
- The Reactome entries gave its licence as CC BY 4.0. Reactome's data is
  CC0 1.0; only its illustrations are CC BY 4.0.

[Unreleased]: https://github.com/Skitionek/Mozg/commits/main
