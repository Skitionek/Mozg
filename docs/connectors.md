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

### Versions tested

CI tests three version presets, kept in one file,
[`.github/ci-presets.json`](../.github/ci-presets.json). It does not test the
product of every version. The connector suite, the unit tests, the Docker
image and the Helm chart's kind test (all six engines in one cluster) each
run once per preset:

| Component | `oldest`: oldest still supported | `lts`: current LTS (else newest stable) | `newest`: newest, pre-releases included |
|-----------|----------------------------------|-----------------------------------------|-----------------------------------------|
| Node.js | 22 | 26 | 28 nightly (image: 26) |
| PostgreSQL | 14 | 18 | 19 RC1 |
| MariaDB (the chart's `mysql` engine) | 10.11 | 12.3 | 13.1 RC |
| MySQL | 8.4 | 8.4 | 8.4 (pinned, finding 2) |
| Neo4j | 5.26 | 5.26 | 2026.10.1 |
| ArangoDB | 3.12.13 | 3.12.13 | 3.12.13 (its only supported line) |
| Elasticsearch | 8.19.24 | 9.5.6 | 9.7.0 snapshot |
| Kubernetes (kind) | 1.35.8 | 1.37.0 | 1.37.0 |
| Helm | 3.22.1 | 4.3.1 | 4.3.1 |
| KEDA | 2.20.2 | 2.21.0 | 2.21.0 |

The `newest` preset is an early warning: its jobs may fail without failing
CI. Once a week,
[`scripts/ci-presets.js`](../scripts/ci-presets.js) checks the presets against
[endoflife.date](https://endoflife.date)
([Presets drift](../.github/workflows/presets-drift.yml) workflow). It fails
when a preset is on the wrong release line, for example once PostgreSQL 14
reaches its end of life on 2026-11-12.

## Matrix

| Driver | Backend | Tested against | Query | Relations | Introspect | Status |
|--------|---------|----------------|:-----:|:---------:|:----------:|--------|
| `postgres` | PostgreSQL (knex + pg) | Integration suite on PostgreSQL 14, 18 and 19 RC1 (the three presets); Helm chart end to end on kind | ✓ | ✓ batched, per-parent `limit` applied in SQL | ✓ `pg_catalog` | **Stable** |
| `sqlite3` | SQLite file (knex) | Integration suite on a temp file, locally and in CI; unit tests; inside the Docker image; Helm chart end to end on kind | ✓ | ✓ batched, per-parent `limit` in SQL | ✓ | **Stable** |
| `mysql` | MySQL via graphql-mesh | Integration suite: MySQL 8.4 LTS, and MariaDB 10.11, 12.3 and 13.1 RC, in CI; Helm chart end to end on kind (MariaDB) | ✓ | ✓ per row, 4 in flight | ✓ | **Beta**: needs `mysql_native_password` (see findings 1 and 2) |
| `neo4j` | Neo4j via graphql-mesh (`@neo4j/graphql` 7) | Shape tests against a schema of the same form; integration suite in CI (Neo4j 5.26 LTS and 2026.10.1); Helm chart end to end on kind, with Cypher-created integer properties | ✓ | ✓ per row | ✓ | **Beta** (see findings 1, 13, 16 and 18) |
| `arango` | ArangoDB (arangojs) | Unit tests on the generated AQL; integration suite in CI (ArangoDB 3.12.13); Helm chart end to end on kind | ✓ | ✓ batched, per-parent `limit` in AQL | ✓ sampled | **Beta** |
| `elasticsearch` | Elasticsearch / OpenSearch REST | Unit tests against an in-memory stand-in; integration suite in CI (Elasticsearch 8.19, 9.5 and a 9.7 snapshot); Helm chart end to end on kind | ✓ | ✓ batched `terms` / `_mget` | ✓ mappings | **Beta** |
| `rest` | Any JSON HTTP API | Unit tests; every relation of the demo sources followed live (see finding 12) | ✓ | ✓ per row, 4 in flight | from catalog | **Stable** for JSON APIs |
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
   client, which cannot speak MySQL 8's default `caching_sha2_password`, even
   for an empty password. Users need `mysql_native_password`:
   - MariaDB uses it by default.
   - MySQL 8.4 (LTS) ships it switched off, and needs
     `--mysql-native-password=ON --authentication-policy=mysql_native_password`.
     The connector suite runs that way in CI.
   - MySQL 9 (9.7 LTS included) has removed it; the connector cannot reach it.

   Replacing the handler with knex and `mysql2`, as the postgres driver did,
   would remove the limitation.
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

   The REST catalog entries written for the old behaviour are fixed in
   finding 12.
10. **Per-parent relation `limit`.** It is now honoured by every connector:
    in SQL with `row_number() over (partition by …)`, in AQL with a LIMITed
    subquery per parent, and after grouping elsewhere. `hasOne` is a limit of
    one.
11. **Introspection waits for self-hosted databases.** It now waits out a
    scale-from-zero, as queries do (`withWake`).
12. **The REST demo sources' relations, and their paging.** Followed live,
    most relations in `jsonplaceholder`, `fakestore`, `coingecko`, `pokeapi`,
    `musicbrainz`, `ghibli`, `swapi`, `metmuseum`, `jikan`, `artic` and
    `opentrivia` returned the wrong records, an error, or nothing:
    - some joined on the wrong key (jsonplaceholder `users → posts` by `id`);
    - some depended on behaviour the API lacks (Fake Store ignores
      `?userId=`);
    - some joined fields that hold no identifier (Open Trivia names
      categories in words);
    - PokéAPI answers 403 to any query parameter except `limit` and
      `offset`, so a plain `limit: 10` failed;
    - MusicBrainz and the Met wrap rows in envelope keys the driver did not
      know.

    The REST driver gained what those APIs need:
    - per-source `paging` parameter names: a name set to null means that
      step is done client-side;
    - extra `unwrap` envelope keys;
    - default `headers`;
    - an entry-level `rateLimit`.

    These settings apply whether a query names the `source` or spells out the
    same base URL. Relations gained:
    - a `foreignKey` that is a path into the parent (`owner.login`,
      `types[].type.url`, `artist-credit[].artist.id`);
    - entity paths with `{field}` placeholders (`/carts/user/{id}`);
    - `belongsTo` over a list of references.

    A reference to the collection itself names no record and is skipped
    (Ghibli writes `/locations/` where it has no list). Each relation was
    then fixed or removed:
    - **fixed and checked live:** jsonplaceholder, fakestore, coingecko,
      pokeapi, musicbrainz, opentrivia, ghibli, swapi and rickandmorty;
    - **removed:** metmuseum (no join the API can serve), jikan's genre
      relations (genres are embedded in each record) and artic's
      artist → artworks;
    - **not checked live:** artic, jikan and spacex were unreachable from the
      test environment, so their remaining relations were checked against
      the API documentation only.

13. **Neo4j nodes with integer properties could not be read.** The mesh
    Neo4j transport opens its driver with `useBigInt`, so integers arrive as
    native BigInts. The `@neo4j/graphql` 7 BigInt scalar it executes with
    rejects those ("BigInt cannot represent value: 1"), and so did any query
    over such a node.
    - The connector suite missed it: its fixture is seeded from JavaScript
      numbers, which Neo4j stores as floats.
    - Cypher-created data, Reactome's `dbId` among it, has integers.
    - The adapter now serialises BigInts as numbers while they are safe
      integers, else as strings.
    - BigInt filter values are sent as the strings that scalar requires.
    - Found by the Helm chart's Neo4j end-to-end test, which creates its
      nodes in Cypher.
14. **Waking from zero, for every engine.** A query to a database that is
    scaled to zero retries until it comes up, but only for errors it
    recognises as "not up yet". Two cases were missing:
    - the HTTP client dropped the network error, so a refused Elasticsearch
      connection read as a bare "fetch failed";
    - a pooled connection closed by the database when it scaled down
      (undici's `UND_ERR_SOCKET` "other side closed", MySQL's
      `PROTOCOL_CONNECTION_LOST`) failed the query.

    A third case was missing too: a MySQL server that accepted the connection
    but had not greeted yet ("Handshake inactivity timeout").
    The error now keeps its cause, and all three count as a cold start.
    Each engine's kind test wakes its database a second time to cover them.
15. **The Docker image could not load SQLite.** `sqlite3`'s prebuilt binding
    needs glibc 2.38; the image was Debian 12 (2.36). It is now Debian 13
    (`node:26-trixie-slim`; CI also builds it on Node 22), and the Docker CI
    job opens a SQLite database inside the image. `/healthz`, all that job
    checked before, never loads a native module.
16. **Neo4j 2025 and later lost numeric filters.** Since the calendar
    releases, `db.schema.nodeTypeProperties()` names property types in
    Cypher's terms (`INTEGER NOT NULL`, `LIST<FLOAT NOT NULL> NOT NULL`),
    not the driver's (`Long`, `DoubleArray`). The Neo4j handler's schema
    introspector (`@neo4j/introspector` 5) knows only the older names and
    typed every such property as `String`, so a filter on a number failed
    against Neo4j 2026.10.1 (4 of the 7 connector tests).
    - The adapter now translates the new names back before the introspector
      maps them, so both generations produce the same schema.
    - Found by the `newest` CI preset. Neo4j 5.26 and 2026.10.1 both pass
      the connector suite.
17. **A PostgreSQL waking from zero could time out in the pool.** kind 0.33
    drops connections to a Service with no pods instead of refusing them.
    - The other drivers' connect timeouts turned that into a recognised
      cold start.
    - The pg client has none, so knex's pool gave up after a minute with
      "Timeout acquiring a connection", which `withWake` does not retry.
    - PostgreSQL connections now give up after 10 s with "timeout expired",
      which it does.
    - Found by the kind test once it ran every engine at once on the
      presets' kind release.
18. **A Neo4j entity named after its node label was not found.** The Neo4j
    handler names query fields after pluralised labels (`Pathway` becomes
    `pathways`), and the adapter matched entity names only to field names.
    - The `reactome` preset names its entities after the labels, so none of
      them could be queried. The e2e catalog names its entity `proteins`, so
      the kind test passed.
    - An entity name now also matches the list field returning the type of
      that name. Checked against Neo4j 5.26.
    - Found while writing [the list of public dumps](dumps.md).

## Known limitations

- MySQL users must use `mysql_native_password` (finding 2).
- REST and mesh relations issue one request per parent row. REST has no
  generic batch filter, and the mesh handlers' filter types share no `in`
  operator. They run four at a time.
- SOAP has no read/write distinction: naming an operation in `from` runs it.
- Thrift is verified only up to the transport.
- A REST API that pages by default but cannot sort (PokéAPI) is sorted only
  within its first page.
