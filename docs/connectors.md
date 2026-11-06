# Connectors

Every way Mozg reaches data other than the catalog-described `api` driver
(see [sources.md](sources.md) for those): what each connector talks to, how it
was tested, what it supports, and how far to trust it.

The database connectors share one behavioural suite
([`tests/integration/suite.js`](../tests/integration/suite.js)), run against a
real server of each kind by the
[Connectors workflow](../.github/workflows/connectors.yml). It covers:

- select, where, orderBy, limit and offset;
- hasMany, hasOne and belongsTo, including a per-parent relation `limit`;
- relations nested three deep;
- introspection;
- a relation from a database row into an api source (a UniProt accession);
- bad-credential errors that leak nothing.

To run it locally, point `MOZG_IT_<DRIVER>_URL` at a server, with the password
(if any) in `MOZG_IT_<DRIVER>_PASSWORD`, and run
`node --test tests/integration/*.test.js`.

## Matrix

| Driver | Backend | Tested against | Query | Relations | Introspect | Status |
|--------|---------|----------------|:-----:|:---------:|:----------:|--------|
| `postgres` | PostgreSQL (knex + pg) | Integration suite: local PostgreSQL 16, CI service container | ✓ | ✓ batched, per-parent `limit` applied in SQL | ✓ `pg_catalog` | **Stable** |
| `sqlite3` | SQLite file (knex) | Integration suite on a temp file, locally and in CI; unit tests | ✓ | ✓ batched, per-parent `limit` in SQL | ✓ | **Stable** |
| `mysql` | MySQL via graphql-mesh | Integration suite: local MySQL 8.0, CI service container | ✓ | ✓ per row, 4 in flight | ✓ | **Beta**: needs `mysql_native_password` (see findings 1 and 2) |
| `neo4j` | Neo4j via graphql-mesh (`@neo4j/graphql` 7) | Shape tests against a schema of the same form; integration suite in CI (Neo4j 5) | ✓ | ✓ per row | ✓ | **Beta** (see finding 1) |
| `arango` | ArangoDB (arangojs) | Unit tests on the generated AQL; integration suite in CI (ArangoDB 3.12) | ✓ | ✓ batched, per-parent `limit` in AQL | ✓ sampled | **Beta** |
| `elasticsearch` | Elasticsearch / OpenSearch REST | Unit tests against an in-memory stand-in; integration suite in CI (Elasticsearch 8.15) | ✓ | ✓ batched `terms` / `_mget` | ✓ mappings | **Beta** |
| `rest` | Any JSON HTTP API | Unit tests; live JSONPlaceholder and SWAPI | ✓ | ✓ per row, 4 in flight | from catalog | **Stable** for JSON APIs |
| `kegg` | rest.kegg.jp (text) | Unit tests; live `/list`, `/get`, `/link` | ✓ | ✓ via `_pathSuffix` | from catalog | **Stable** |
| `openapi` | OpenAPI / Swagger via graphql-mesh | Live Petstore v3; shape tests | ✓ | ✓ per row | ✓ operations | **Beta** (see finding 1) |
| `odata` | OData v4 via graphql-mesh | Live TripPin; shape tests | ✓ server-side `$top/$skip/$orderby/$filter` | ✓ per row | ✓ entry points | **Beta** (see finding 1) |
| `soap` | SOAP / WSDL via graphql-mesh | Live NumberConversion WSDL; shape tests | ✓ runs the named operation | — | ✓ operations | **Experimental**: operations may have side effects |
| `thrift` | Apache Thrift via graphql-mesh | Schema built from a local IDL; transport reaches the network | untested end to end | — | ✓ | **Experimental**: no public server for a round trip |
| `biocyc` | BioCyc / Pathway Tools web services | Unit tests on the documented `apixml` format; one live EcoCyc listing | ✓ | ✓ via frame references | static schema | **Beta**: needs a BioCyc account (see finding 7) |

## Findings and fixes

1. **Every graphql-mesh connector was broken** (mysql, neo4j, openapi,
   soap, odata, thrift). The `@graphql-tools/utils ^13.2.0` npm override,
   added for a prototype-pollution advisory, removed `getArgumentValues`,
   which `@graphql-mesh/utils` 0.107 calls, so every mesh query failed with
   `getArgumentValues is not a function`.
   - The advisory only affects `<=12.0.1`.
   - Removing the global override lets npm resolve 12.1.0 (patched) for the
     mesh tree and 13.x for graphql-yoga.
   - `npm audit --omit=dev` is unchanged by this (no new findings).
   - The MySQL suite then passes. This is a `package.json` change and is
     tracked separately from the driver fixes.
2. **MySQL authentication.** The mesh MySQL handler uses the `mysql` 2.x
   client, which cannot speak MySQL 8's default `caching_sha2_password`.
   Users need `mysql_native_password`; that plugin is off by default in MySQL
   8.4 and gone in 9. MariaDB is unaffected. Replacing the handler with knex
   and `mysql2`, as the postgres driver did, would remove the limitation.
3. **MySQL paging was swapped.** The handler renders `LIMIT ${limit},${offset}`,
   which MySQL reads as offset first, then count; it also drops zeros. The
   adapter now asks only for a row count and skips the offset itself.
4. **Mesh filters were built for one handler's types only.** The MySQL handler
   types every `where` field as `String`. `@neo4j/graphql` 7 wants operator
   objects (`{ id: { eq: 1 } }`) and `sort: [{ f: DESC }]`. The adapter used to
   splice raw literals into the query text, which neither accepted. Now:
   - every value is a GraphQL variable, coerced to the type the schema
     declares;
   - field names are checked against the schema first;
   - OpenAPI, OData and SOAP operations take `where` as their direct
     arguments, or as their single wrapper input;
   - OData pushes paging, ordering and equality filters to the server, so the
     result isn't just the first page;
   - scalar results become `{ value }` rows;
   - fields that need arguments (OData actions) are never auto-selected;
   - operations are named, which the Thrift executor requires.
5. **Credential-blind caches.** The mesh source cache, like ArangoDB's client
   cache, was keyed without the password. A request with a *wrong* password
   reused a source another caller had authenticated; against MySQL it
   returned rows. Both keys now include the password. It is held only in
   process memory, beside the connection object that already holds it.
6. **AQL injection in ArangoDB.** Collection names, `where` keys, `orderBy` and
   `select` were spliced into AQL, so a caller could append `REMOVE`/`UPDATE`.
   They now travel as bind parameters (`@@coll`, `doc[@attr]`). `belongsTo`
   now honours `ownerKey`, and offset-only paging works.
7. **BioCyc used an endpoint that no longer exists.** `/ORG/class-instances`
   answers 400 with an HTML page, so the driver never worked. It now uses the
   documented `apixml?fn=get-class-all-instances&detail=low`. Related frames
   resolve from one listing of their class, not one request per id (a
   deferred issue). Anonymous access is rationed: after a handful of requests
   BioCyc redirects to "account required" or serves an anti-bot check. Both
   are reported as such. Real use needs `connection.user` / `password`.
8. **Elasticsearch ignored most of the query.** `from: "users"` sent
   `GET /users`, which returns index metadata, not documents. Relations and
   `orderBy` were silently dropped. A bare index name now searches it:
   - `where` becomes exact-match filters on keyword forms;
   - `limit`, `offset` and `orderBy` become `size`, `from` and `sort`;
   - relations are one batched query each;
   - introspection reads the mappings.

   `_body`, `q`, and explicit `_endpoint` paths keep their old meaning.
9. **REST `hasMany` fetched the wrong records.** It requested
   `/{entity}/{parent.id}` (users → posts returned post #1 for user 1).
   Relations now follow the documented contract:
   - `belongsTo` fetches the record the foreign key names (an id or a URL);
   - `hasMany` filters by `?{foreignKey}={parent[localKey]}`, or follows a
     list of ids or URLs held by the parent;
   - URLs found in data are followed only on the connection's own origin;
   - lookups run four at a time through the shared HTTP client (timeouts,
     retries);
   - paging and sorting fall back to client-side when the API ignores
     JSONPlaceholder's parameters.

   Several REST catalog entries describe relations in the old shape and should
   be updated; see below.
10. **Per-parent relation `limit`.** It is now honoured by every connector:
    in SQL with `row_number() over (partition by …)`, in AQL with a LIMITed
    subquery per parent, and after grouping elsewhere. `hasOne` is a limit of
    one.
11. **Introspection waits for self-hosted databases.** It now waits out a
    scale-from-zero, as queries do (`withWake`).

## Known limitations

- MySQL users must use `mysql_native_password` (finding 2).
- REST and mesh relations issue one request per parent row. REST has no
  generic batch filter, and the mesh handlers' filter types share no `in`
  operator. They run four at a time.
- SOAP has no read/write distinction: naming an operation in `from` runs it.
- Thrift is verified only up to the transport.
- The REST catalog entries for `jsonplaceholder`, `pokeapi`, `jikan`,
  `musicbrainz`, `coingecko`, `fakestore`, `artic` and `opentrivia` declare
  relations whose `foreignKey` assumed the old path-fetch behaviour (for
  example jsonplaceholder `/users → /posts` with `foreignKey: 'id'`; it should
  be `'userId'`).
