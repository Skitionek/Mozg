# Mozg

> A **"slow by design"** cross-database query layer with a single GraphQL endpoint — and a live, joined-up map of 47 public life-science databases.

**Mozg** (Polish for "brain") is an experiment in thinking differently about data: instead of centralizing knowledge, it teaches systems how to connect it.

At its core, Mozg is a **"slow by design" cognition layer** — a single GraphQL endpoint that doesn't store knowledge, but reasons across it. Rather than building yet another database, Mozg acts as a unifying language for describing relationships between entities that already exist: rows in PostgreSQL, nodes in Neo4j, documents in ArangoDB, pathways in BioCyc, proteins in UniProt, compounds in ChEMBL, or trials on ClinicalTrials.gov.

Where most systems optimize for speed through precomputation and duplication, Mozg embraces a different trade-off: **freshness and flexibility over latency**. Every query is executed live, traversing connections across heterogeneous data sources at runtime. The result is not just data retrieval, but on-demand knowledge synthesis.

The single `/graphql` endpoint becomes a kind of neural interface:

- **You bring your own credentials**
- **Mozg maps the relationships**
- **The system resolves meaning across boundaries**

And because not every user wants to think in GraphQL, Mozg includes a browser-based **query builder** — a visual way to compose complex, cross-database queries without writing a single line of code.

> In essence, Mozg is less like a database and more like a brain-shaped abstraction layer: it doesn't store memories — it connects them.

▶ **[Watch the 80-second demo](docs/media/mozg-demo.mp4)**: one query across UniProt, PDBe, AlphaFold and Reactome, an OBO-key join to Open Targets, and GraphiQL.

```graphql
# One protein → its structures, its predicted model, the pathways it acts in,
# and the drug-target record of the gene that encodes it — five databases, one query.
{
  query(input: {
    source: "uniprot"
    from: "protein"
    where: { uniprotAccession: "P04637" }
    select: ["uniprotAccession", "symbol", "name", "ensemblGeneId"]
    include: ["structures", "alphafold", "pathways", "target"]
  }) { count data }
}
```

---

## Status

Mozg has left the concept phase.  Some parts are production-ready; others are still maturing:

| Area | Status |
|------|--------|
| Life-science sources (`api` driver, 47 sources) | **Stable.** Every entity's example and every relation is verified against the live APIs weekly; requests are throttled to each provider's published limits and retried on transient failures. |
| PostgreSQL, SQLite | **Stable.** A shared behavioural suite runs against real servers in CI. |
| KEGG, plain REST | **Stable.** |
| MySQL and MariaDB, Neo4j (via graphql-mesh), ArangoDB, Elasticsearch | **Beta.** The same suite runs against real servers in CI. MySQL logs in with either method (`caching_sha2_password`, MySQL 8's default and MySQL 9's only one, or `mysql_native_password`). |
| OpenAPI, OData (via graphql-mesh), BioCyc | **Beta.** Checked against live services; BioCyc needs an account for more than a few requests. |
| SOAP, Thrift (via graphql-mesh) | **Experimental.** SOAP runs only read-named operations unless you allow more (`MOZG_SOAP_OPERATIONS`). Thrift is tested end to end against a real server for integer and boolean parameters and scalar results; string parameters and struct results do not work (upstream). |
| Self-hosted databases on Kubernetes (Helm, scale to zero) | **Beta.** Every engine (PostgreSQL, MySQL/MariaDB, Neo4j, ArangoDB, Elasticsearch, SQLite) exercised end to end on a kind cluster in CI. |
| OWL ontology ingestion | **Experimental.** |

Per-connector details, test coverage and known limitations: [docs/connectors.md](docs/connectors.md).  Deploying with self-hosted databases: [docs/deploy.md](docs/deploy.md), with public dumps ready to host in [docs/dumps.md](docs/dumps.md).  All of it, with the examples and the paper, is on the [documentation site](https://skitionek.github.io/Mozg/).

---

## Features

- 🔌 **One endpoint** – `/graphql` queries any supported database or API
- 🧬 **47 life-science sources, joined up** – UniProt, Ensembl, NCBI, ChEMBL, PubChem, Open Targets, Reactome, PDB, AlphaFold, GWAS Catalog, ClinVar, ClinicalTrials.gov and more, with 660+ declared relations, 440+ of them between sources
- 🧭 **`source` + `include`** – name a source and the relations you want; Mozg knows how to reach each source and how its records connect to the others
- 🔑 **Credentials in the query** – connection parameters, or `apiKeys` per source, are part of the GraphQL input
- 🔗 **Relation traversal** – `hasMany`, `hasOne`, `belongsTo` across tables, endpoints and sources
- 🗺 **Schema introspection** – discover tables & columns of SQL and graph databases; catalog sources describe their own entities, parameters and fields
- 🛡 **Polite, resilient HTTP** – timeouts, retries with backoff that honour `Retry-After`, per-host rate limits, request de-duplication
- 🌐 **Web UI** – visual query builder at `/` with examples and a catalog browser
- 🧪 **GraphiQL** – full IDE at `/graphql`
- ⚡ **Streaming** – `POST /stream` returns progressive JSON as relations resolve
- 🧰 **SDK** – a dependency-free JavaScript/TypeScript client in [`sdk/`](sdk/README.md): query builders, streaming, ontology links, retries and typed errors
- 🦉 **OWL ontology ingestion** – parse Turtle, RDF/XML, OWL/XML and Manchester Syntax ontologies via `ingestOntology` mutation

---

## Quick start

```bash
npm install
npm start          # http://localhost:4000
# or
npm run dev        # restarts on file changes
```

Or with Docker:

```bash
docker build -t mozg .
docker run -p 4000:4000 mozg
```

---

## Open in GitHub Codespaces

Click the button below to open a fully configured dev environment in your browser – no local setup required.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Skitionek/Mozg)

The Codespace will automatically:
1. Start a Node 26 (LTS) container
2. Run `npm install`
3. Start the dev server (`npm run dev`)
4. Forward port **4000** and open a preview

---

## Life-science sources

Every source below is free to query and needs no account unless marked.  The
full reference — each entity, its `where` parameters, output fields and
relations — is in **[docs/sources.md](docs/sources.md)**, generated from the
catalog.

| Category | Sources |
|----------|---------|
| Genes & genomes | `ensembl` · `ncbi-gene` · `hgnc` · `mygene` · `alliance` (MGI, RGD, SGD, ZFIN, WormBase, FlyBase) · `flybase` · `genbank` · `ncbi` (all E-utilities databases) · `ena` |
| Proteins & structures | `uniprot` · `pdb` · `pdbe` · `alphafold` · `interpro` · `rnacentral` |
| Interactions & pathways | `string-db` · `intact` · `reactome` · `rhea` · `kegg` · `regulondb` |
| Function & ontologies | `quickgo` · `geneontology` · `ols` (MONDO, EFO, HPO, GO, UBERON, CL, …) · `hpo` · `mesh` |
| Chemistry & drugs | `chembl` · `pubchem` · `chebi` · `lipidmaps` · `rxnorm` · `openfda` · `dgidb` |
| Disease & variants | `opentargets` · `monarch` · `gwas` · `clinvar` · `myvariant` · `gnomad` · `civic` |
| Clinical | `clinicaltrials` |
| Literature | `pubmed` · `europepmc` |
| Expression & samples | `gtex` · `proteinatlas` · `geo` · `biosamples` · `pride` |

### Querying a source

```graphql
{
  query(input: {
    source: "chembl"                          # which catalog source
    from: "molecule"                          # which of its entities
    where: { chemblId: "CHEMBL25" }           # the entity's parameters
    include: ["mechanisms.target", "pubchem"] # catalog relations; dots go deeper
    limit: 10
  }) { count data }
}
```

- **`where`** takes the entity's declared parameters — `catalog(name: "chembl")` lists them with an example for each.  An unknown key is an error, never a silently ignored filter.
- **`include`** follows catalog relations by name, across sources.  `"mechanisms.target"` fetches the molecule's mechanisms, then each mechanism's target.  You can still pass explicit `relations` alongside.
- **Identifiers carry OBO keys** — the [Bioregistry](https://bioregistry.io) prefix of their identifier space (`uniprot`, `ensembl`, `ncbigene`, `chebi`, `mondo`, …).  Two fields with the same key and the same value name the same thing, so Mozg writes every keyed value one canonical way (`CHEBI:15365`, `P04637`, unversioned `ENSG00000141510`) whatever the source sent, and relations are declared by key rather than by field names.
- **Joins nobody declared** — `include: ["pdbe/bestStructures"]` follows any entity whose required parameter takes a key a field carries, across all sources (the `catalog` query lists them as `links`; `oboKeys` lists the keys).  Self-hosted databases join the same way through their annotated columns.
- **`raw: true`** returns records exactly as the source sent them, for fields the catalog does not map.
- **`apiKeys: { ncbi: "…", openfda: "…" }`** passes optional keys that raise a provider's rate limit; keys never appear in error messages.
- Relations are fetched per parent row and throttled per provider, so wide `include`s are slow by design — use `limit` on the parent query.

The same input works on the streaming endpoint (`POST /stream` with the `QueryInput` as JSON), and the query builder at `/` lets you pick a source, an entity and the relations to include.

### Adding a source

A source is one file in `src/catalog/` describing its requests and records —
no driver code.  See [`src/catalog/README.md`](src/catalog/README.md) for the
format and conventions, then:

```bash
node scripts/verify-sources.js my-source   # runs every example and relation live
npm test                                   # includes the catalog lint
npm run docs:sources                       # regenerates docs/sources.md
```

---

## Other databases & APIs

The following free, public endpoints can be used directly — no sign-up required.

| Name | Driver | Host | Database | User | Password | Notes |
|------|--------|------|----------|------|----------|-------|
| RFAM | `mysql` | `mysql-rfam-public.ebi.ac.uk` | `Rfam` | `rfamro` | *(empty)* | RNA families |
| Neo4j Movies | `neo4j` | `demo.neo4jlabs.com` | `movies` | `movies` | *(public demo — see [Neo4j Labs](https://demo.neo4jlabs.com))* | Movie graph (scheme: `neo4j+s`) |
| JSONPlaceholder | `rest` | – | `https://jsonplaceholder.typicode.com` | – | – | Fake REST data |
| Open-Meteo | `rest` | – | `https://api.open-meteo.com/v1` | – | – | Weather (no key) |
| PokéAPI | `rest` | – | `https://pokeapi.co/api/v2` | – | – | Pokémon |
| Jikan | `rest` | – | `https://api.jikan.moe/v4` | – | – | Anime (MyAnimeList) |

BioCyc databases (`biocyc-*` catalog entries) use the `biocyc` driver; most require a BioCyc account, passed as `connection.user` / `connection.password`.

---

## OWL Ontology Ingestion

Mozg can parse OWL ontologies in Turtle, RDF/XML, OWL/XML or Manchester Syntax and extract classes, object properties and data properties.

```graphql
mutation {
  ingestOntology(input: {
    url: "https://raw.githubusercontent.com/Skitionek/Mozg/main/examples/blog.ttl"
    format: turtle
  }) {
    tripleCount
    classes { iri label subClassOf }
    objectProperties { iri label domain range relationType }
    dataProperties { iri label domain range }
  }
}
```

You can also supply raw content instead of a URL:

```graphql
mutation {
  ingestOntology(input: {
    content: "@prefix : <http://example.org/> . :Foo a owl:Class ."
    format: turtle
  }) {
    tripleCount
    classes { iri label }
  }
}
```

---

## Linking values to ontology terms

A database column holding `MONDO:0005015`, `diabetes mellitus` or `MESH:D003920` is a name for something an ontology defines.  A query can ask Mozg to resolve those values to the ontology's terms:

```graphql
{
  query(input: {
    source: "opentargets", from: "diseasePhenotypes", where: { diseaseId: "MONDO_0007739" }
    link: [{ field: "hpoId", ontology: "hpo", as: "phenotype" }]
  }) { data }
}
```

Each row gains `phenotype`: the term (`iri`, `id`, `label`, `matchedBy`), or `null` when the value names none.  A value may be an identifier (`MONDO:0005015`, `MONDO_0005015`, the IRI, or a bare `0005015` given the ontology's OBO key), a label, a synonym or a cross-reference; `match: [id, label, synonym, xref]` chooses which and in what order, `details: true` adds definition, synonyms, cross-references and parents, and `field: "target.diseaseId"` links a field of an included relation or a list.  A `field` the rows do not have is an error naming the ones they do, never a column of nulls.

- **Named ontologies** are configured by the operator (`MOZG_ONTOLOGIES`, Helm `mozg.ontologies`) and load on first use.  The `ontologies` query lists them and whether each has loaded.  There is deliberately no way for a caller to register or replace one: with no authentication in front of Mozg that would let anyone change what everybody's links resolve to.
- **Inline ontologies** are given as `url` or `content` in the link itself, with the same screening as `ingestOntology` (no private addresses, 10 MB, 10 s).
- **Formats:** the OBO flat-file format (`obo`) is the compact way to load a large ontology — OBO ontologies publish it about a tenth the size of their OWL; Turtle and RDF/XML give labels, synonyms, cross-references and definitions; OWL/XML gives labels and nothing else.  Human Phenotype Ontology's `hp.obo` (20,482 terms, 10 MB) loads in under half a second.
- `ontologyTerms(search:, ontology:)` searches an ontology's terms, for the query builder and the SDK.
- On `/stream`, links apply to the main rows; related rows stream separately and are not linked.

## Example queries

### Introspect a SQLite database

```graphql
{
  introspect(connection: { driver: sqlite3, database: "path/to/file.db" }) {
    tables {
      name
      columns { name type nullable isPrimaryKey }
    }
  }
}
```

### Query with a relation

```graphql
{
  query(input: {
    connection: { driver: postgres, host: "localhost", database: "mydb", user: "alice", password: "secret" }
    from: "users"
    limit: 20
    relations: [
      { entity: "posts", foreignKey: "user_id", type: hasMany, select: ["id", "title"] }
    ]
  }) {
    count
    data
  }
}
```

---

## Running Mozg in production

| Setting | Default | Purpose |
|---------|---------|---------|
| `PORT` | `4000` | HTTP port |
| `MOZG_HTTP_TIMEOUT_MS` | `30000` | Timeout per outbound request |
| `MOZG_HTTP_RETRIES` | `2` | Retries for 408/429/502/503/504 and network errors |
| `MOZG_LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |
| `MOZG_LOG_FORMAT` | `json` (`text` on a terminal) | One JSON object per line, or plain text |
| `MOZG_SLOW_QUERY_MS` | `10000` | Log queries slower than this at `warn` (`0` = off) |
| `MOZG_METRICS` | `on` | Set `off` to serve no `/metrics` |
| `MOZG_METRICS_PORT` | unset | Serve `/metrics` on this port, and nothing else, instead of the main one |
| `MOZG_HTTP_CACHE_TTL_MS` | `0` (off) | Cache identical outbound GETs for this long — trades freshness for speed |
| `MOZG_HTTP_CACHE_MAX_ENTRIES` | `500` | Most outbound responses kept; the least recently used go first |
| `MOZG_RESULT_CACHE_TTL_MS` | `0` (off) | Reuse the answer to a whole query, relations included, for every driver. A caller can always pass `fresh: true` |
| `MOZG_RESULT_CACHE_TTL_BY_SOURCE` | unset | JSON object of per-source overrides in ms, e.g. `{"uniprot":3600000,"my-postgres":0}`; `0` turns the cache off for that source |
| `MOZG_RESULT_CACHE_MAX_ENTRIES` / `MOZG_RESULT_CACHE_MAX_BYTES` | `500` / `67108864` | Bounds on the result cache |
| `MOZG_CONNECTION_CACHE_MAX` | `32` | Database clients (connection pools) kept per driver; the least recently used is closed |
| `MOZG_CONNECTION_IDLE_MS` | `600000` | A database client unused for this long is closed |
| `MOZG_ONTOLOGY_CACHE_MAX` | `20` | Inline ontologies (given by `url` or `content`) kept in memory; the named ones in `MOZG_ONTOLOGIES` are kept apart and never evicted by them |
| `MOZG_ONTOLOGIES` | unset | JSON array of ontologies queries may link values to, by name: `[{"name":"mondo","url":"https://…/mondo.obo","format":"obo","obo":"mondo"}]`; each loads on first use |
| `MOZG_ONTOLOGY_TTL_MS` | `86400000` | A loaded ontology is read again after this long |
| `MOZG_SOAP_OPERATIONS` | unset | SOAP operations Mozg may run besides those named like reads (`Get…`, `List…`, `Search…`): comma-separated, `*` a wildcard, `*` alone for all |
| `MOZG_ALLOW_PRIVATE_MIRRORS` | unset | Set to `1` to let callers point a catalog source at a private-network mirror (`connection.database`); otherwise such URLs are refused |
| `MOZG_SHUTDOWN_GRACE_MS` | `30000` | How long SIGTERM waits for in-flight queries |
| `MOZG_SOURCES_DIR` | unset | Directory of JSON catalog entries to register at startup (self-hosted databases; see [docs/deploy.md](docs/deploy.md)) |
| `MOZG_WAKE_TIMEOUT_MS` | `180000` | How long a query waits for a self-hosted database scaled to zero to come up |
| `MOZG_DEMAND_WINDOW_MS` | `60000` | How long after its last use `/demand/<source>` keeps reporting a self-hosted database as wanted (what KEDA scales on) |
| `MOZG_PEERS` | unset | Headless-service host name of the other Mozg replicas, so `/demand` counts their in-flight queries too |

- **Metrics.** `GET /metrics` is Prometheus text: inbound requests by route and status, queries by driver and source (relation fetches counted separately as `nested`), rows returned, outbound requests by host and status with retries, cold starts of self-hosted databases, every cache's size and hit counts, and process memory and CPU.  Source and host labels are capped, so a caller cannot create series by naming new hosts.  Set `MOZG_METRICS_PORT` to serve it on a port of its own; the Helm chart does by default, so it never reaches the Service or the Ingress.
- **Logs.** One JSON line per request and per query, each with the request's `requestId` (taken from the caller's `X-Request-Id` if it is short and plain, else generated, and returned in the response).  Queries log the *names* of their `where` keys, never the values, and every message is scrubbed of connection-string passwords.  Probes and scrapes log at `debug`.  There is no tracing SDK; the request id is what ties a request's lines together.
- `GET /healthz` answers `{"status":"ok"}` without touching any upstream, for load balancers and orchestrators.
- The container runs as an unprivileged user and declares a `HEALTHCHECK`.
- `npm run verify:sources` checks every life-science source and relation against the live APIs; `npm run health` probes every catalog entry.  Both run weekly in CI and upload their reports.

---

## Releases

Releases are **date-based, not semver**: Mozg ships continuously from `main` and has no supported-version matrix, so a calendar date says more than a version number would.  (`package.json` stays at `0.1.0`.)

A push to `main` that leaves `CI`, `Lint`, `CodeQL Advanced` and `Connectors` all green triggers [`release.yml`](.github/workflows/release.yml), which

1. tags the validated commit `vYYYY-MM-DD` (`.1`, `.2`, … for a second release the same day; a commit is never tagged twice);
2. publishes a GitHub release whose notes are the `## [Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md), plus GitHub's generated notes;
3. pushes the container image as `ghcr.io/skitionek/mozg:<tag>` and `:latest`.

Nothing is pushed to `main` and nothing rewrites the changelog, so **keep `[Unreleased]` current** — it is read at release time.  Pin a deployment to a release with `--set image.tag=v2026-11-08` (the chart otherwise defaults to its `appVersion`).

## Commit conventions

This project uses **[Conventional Commits](https://www.conventionalcommits.org/)**.  
GitHub Copilot is configured (`.github/copilot-instructions.md` + `.vscode/settings.json`) to generate compliant commit messages automatically.

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code restructure without behaviour change |
| `chore` | Maintenance / dependency updates |
| `ci` | CI/CD changes |
| `test` | Tests |
| `perf` | Performance |
| `build` | Build system |
| `revert` | Revert a commit |

Examples:
```
feat(api): add introspect query for schema discovery
fix(db): handle null foreign key in belongsTo relation
chore(deps): upgrade mysql2 to 3.9.8
```
