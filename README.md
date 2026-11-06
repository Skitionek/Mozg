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
| MySQL, Neo4j (via graphql-mesh), ArangoDB, Elasticsearch | **Beta.** The same suite runs against real servers in CI; MySQL needs `mysql_native_password`. |
| OpenAPI, OData (via graphql-mesh), BioCyc | **Beta.** Checked against live services; BioCyc needs an account for more than a few requests. |
| SOAP, Thrift (via graphql-mesh) | **Experimental.** |
| Self-hosted databases on Kubernetes (Helm, scale to zero) | **Beta.** Exercised end to end on a kind cluster in CI. |
| OWL ontology ingestion | **Experimental.** |

Per-connector details, test coverage and known limitations: [docs/connectors.md](docs/connectors.md).  Deploying with self-hosted databases: [docs/deploy.md](docs/deploy.md).

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
1. Start a Node 20 container
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
| RestCountries | `rest` | – | `https://restcountries.com/v3.1` | – | – | Country data |
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
| `MOZG_HTTP_CACHE_TTL_MS` | `0` (off) | Cache identical outbound GETs for this long — trades freshness for speed |
| `MOZG_ALLOW_PRIVATE_MIRRORS` | unset | Set to `1` to let callers point a catalog source at a private-network mirror (`connection.database`); otherwise such URLs are refused |
| `MOZG_SHUTDOWN_GRACE_MS` | `30000` | How long SIGTERM waits for in-flight queries |
| `MOZG_SOURCES_DIR` | unset | Directory of JSON catalog entries to register at startup (self-hosted databases; see [docs/deploy.md](docs/deploy.md)) |
| `MOZG_WAKE_TIMEOUT_MS` | `180000` | How long a query waits for a self-hosted database scaled to zero to come up |
| `MOZG_DEMAND_WINDOW_MS` | `60000` | How long after its last use `/demand/<source>` keeps reporting a self-hosted database as wanted (what KEDA scales on) |
| `MOZG_PEERS` | unset | Headless-service host name of the other Mozg replicas, so `/demand` counts their in-flight queries too |

- `GET /healthz` answers `{"status":"ok"}` without touching any upstream, for load balancers and orchestrators.
- The container runs as an unprivileged user and declares a `HEALTHCHECK`.
- `npm run verify:sources` checks every life-science source and relation against the live APIs; `npm run health` probes every catalog entry.  Both run weekly in CI and upload their reports.

---

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
