# Deploying Mozg on Kubernetes

The Helm chart in [`deploy/helm/mozg`](../deploy/helm/mozg) runs Mozg, and —
if you want them — copies of large databases hosted next to it.  Mozg itself
is stateless: it answers GraphQL by querying sources live, so the 47 public
life-science APIs need nothing deployed.  A database you host yourself is
worth it when you query it heavily, need it close, or want its full schema
rather than an API's view of it.

```bash
docker build -t registry.example.org/mozg:0.1.0 . && docker push registry.example.org/mozg:0.1.0

helm install mozg deploy/helm/mozg --namespace bio --create-namespace \
  --set image.repository=registry.example.org/mozg --set image.tag=0.1.0
```

```bash
kubectl -n bio port-forward svc/mozg 4000:80   # then open http://localhost:4000/
```

## Choosing which databases to host

Every entry under `databases:` in `values.yaml` is a database the chart can
run.  All are disabled by default; you enable the ones you want:

```yaml
databases:
  chembl:
    enabled: true        # ChEMBL 37, restored from EMBL-EBI's PostgreSQL dump
  reactome:
    enabled: true        # Reactome 98, loaded from its Neo4j graph dump
```

| Preset | Engine | Source | Registered as | Disk | Memory |
|--------|--------|--------|---------------|------|--------|
| `chembl` | PostgreSQL 18 | [ChEMBL 37 PostgreSQL dump](https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/chembl_37/) (2.1 GB, sha256-verified) | `chembl-postgres` | ~30 GB restored, plus ~4 GB during the restore (default PVC 80 Gi) | 2–4 GiB |
| `reactome` | Neo4j 5.26 (LTS) | [Reactome 98 graph database dump](https://reactome.org/download-data) (0.5 GB) | `reactome-neo4j` | ~10 GB (default PVC 20 Gi) | 4–6 GiB (2 G heap, 2 G page cache) |

Each enabled database gets:

- a **StatefulSet** with a persistent volume, so its data survives being
  scaled to zero and restarts;
- a **first-start restore** — an init container downloads the dump (resuming
  after interruptions, verifying the sha256 when one is configured), the
  database restores it, and a marker file records success.  A first start
  that dies part-way is detected and retried from a clean data directory;
  later starts skip all of it;
- a **Service** in front: the stable address Mozg reaches it through, whether
  or not it is currently running (`service.type` can make it a
  `LoadBalancer` if other clients should reach it too);
- a **Secret** with a generated password, kept stable across upgrades and
  retained on uninstall (like the volume it unlocks);
- a **catalog entry** registered by Mozg at startup, so `source:
  "chembl-postgres"` works in any query.

The first ChEMBL restore takes one to several hours.  Follow it with:

```bash
kubectl -n bio logs -f statefulset/mozg-db-chembl -c fetch-dump
kubectl -n bio logs -f statefulset/mozg-db-chembl
```

## Engines

Every database Mozg can query can be hosted.  `engine` picks the server and
how its first start loads data; the image can be overridden with `image`.

| `engine` | Default image | Dump (`dump.format`) | Inline data | Mozg connects as |
|----------|---------------|----------------------|-------------|------------------|
| `postgres` | `postgres:18-alpine` | pg_dump custom format (`dump`), `sql`, `sql.gz`, or a `tar.gz` around one | `initSQL` | `username` |
| `mysql` | `mariadb:12.3` (LTS) | `sql`, `sql.gz`, or a `tar.gz` of SQL files | `initSQL` | `username` (not root) |
| `neo4j` | `neo4j:5.26-community` (LTS) | `neo4j-admin database dump` file (`dump`), migrated from Neo4j 4 with `dump.migrate` | `initCypher` (a list of statements) | `neo4j` |
| `arango` | `arangodb:3.12.13` | `tar.gz` of an `arangodump` directory | `initJS` (arangosh, `db` is the database) | `root` |
| `elasticsearch` | `elasticsearch:9.5.6` | `tar.gz` of a snapshot repository (its latest snapshot is restored) or of `_bulk` NDJSON files; `ndjson`, `ndjson.gz` | `initBulk` (`_bulk` NDJSON) | `elastic` |
| `sqlite3` | none — a file Mozg opens | the file (`sqlite`), `sqlite.gz`, or a `tar.gz` holding one | `initSQL` | — |

Every server engine follows the same first start:
1. an init container downloads the dump (resuming, checksum-verified);
2. the engine loads it, then the inline data;
3. a ready marker is written, and only then does the database become ready.

A first start that dies part-way is cleared and retried from the dump.
Until the database is ready, Mozg's queries treat it as a cold start and
wait.

- **MySQL** runs MariaDB by default (12.3, its newest LTS).  MariaDB speaks
  the MySQL protocol and authenticates with `mysql_native_password`, as
  Mozg's mysql connector needs.  Oracle MySQL 8.4 (LTS) works with that
  plugin switched on, which its image needs as server flags:

  ```yaml
  image: { repository: mysql, tag: "8.4" }
  mysql:
    args: [--mysql-native-password=ON, --authentication-policy=mysql_native_password]
  ```

  MySQL 9 (9.7 LTS included) has removed the plugin and cannot be used.
  `root` shares the Secret's password but may only log in from inside the
  pod.
- **Neo4j, ArangoDB and Elasticsearch** create only their built-in
  superuser on first start, so Mozg connects as that user.  Mozg's
  connectors only read.
- **Elasticsearch** runs as one node with password authentication over
  plain HTTP inside the cluster, where the NetworkPolicy admits only Mozg.
  Memory-mapped stores are off (`node.store.allow_mmap=false`), so nodes
  need no `vm.max_map_count` tuning.  `elasticsearch.heapSize` sets the
  JVM heap (`512m`), and `elasticsearch.config` adds settings.
- **SQLite** has no server.  The file is fetched (and given its `initSQL`)
  by init containers of each Mozg pod, into a volume of `storage.size`.
  It neither scales nor needs a password.  It suits files that download in
  seconds; host larger data in one of the server engines.

`ci/e2e-<engine>.yaml` in the chart has the same small table for every
engine; CI deploys each on kind and runs the whole cycle below.

## Scaling to zero

With [KEDA](https://keda.sh) installed in the cluster, each database scales
between zero and one replica on demand (`scaleToZero.enabled`, on by
default).  Without KEDA the chart notices and runs one replica permanently.

```
query ──▶ Mozg ──(connection refused: nothing running)──▶ retries, counting the query as demand
             ▲                                                 │
             │  GET /demand/chembl-postgres → {"demand": 1}    │
           KEDA ──────────── scales StatefulSet 0 → 1 ─────────┘
             │
             └── after cooldownSeconds with demand 0 → scales back to 0
```

- Mozg counts every query against a self-hosted source as **demand** while it
  runs and for `mozg.demandWindowMs` afterwards.  `GET /demand/<source>`
  reports it; KEDA's `metrics-api` trigger polls it every
  `pollingIntervalSeconds`.
- Each Mozg pod only sees its own queries, so a pod asked for demand also asks
  its peers (through the `mozg-peers` headless Service) and reports demand if
  any of them has it.  Scaling Mozg out does not hide demand from KEDA.
- While the database is at zero its Service has no endpoints and connections
  are refused.  Mozg treats all of these as a **cold start**, not an error:
  - refused connections, DNS failures and timeouts;
  - Postgres "starting up" and Neo4j "service unavailable";
  - pooled connections the database closed when it scaled down.

  It keeps retrying, backing off to 5 s, for up to `mozg.wakeTimeoutMs`
  (3 minutes by default).  Errors that mean the query is wrong (bad
  credentials, unknown table) fail at once.
- **Cold-start latency** is the KEDA polling interval (15 s by default) plus
  the database's start time: a few seconds for PostgreSQL and MariaDB, 10–20 s
  for ArangoDB, 30–60 s for Neo4j (with Reactome) and Elasticsearch.  Mozg is
  "slow by design"; this is where that shows most.
- `cooldownSeconds` (15 minutes by default) is how long a database stays up
  after the last demand.  `initialCooldownSeconds` keeps it up after
  installation until the first restore can finish — set it above your
  expected restore time (the ChEMBL preset uses 8 hours).

## Adding your own database

Any dump of a supported engine (see [Engines](#engines)) can be hosted the
same way.  [Public database dumps](dumps.md) lists public life-science and
demo databases whose dumps load as published, with a ready `databases:`
snippet for each, and the ones that need converting first.  Describe its tables (node labels, collections, indices) and,
crucially, the **OBO key** of every identifier column:

```yaml
databases:
  targets:
    enabled: true
    engine: postgres
    database: targets
    dump:
      url: https://data.example.org/targets.dump
      sha256: 0123…ef
      format: dump
    storage: { size: 20Gi }
    catalog:
      name: my-targets
      label: Internal target list
      entities:
        - name: target
          columns: [id, uniprot_ac, ensembl_gene, compound_inchikey, status]
          obo:
            uniprot_ac: uniprot
            ensembl_gene: ensembl
            compound_inchikey: inchikey
          relations: []
```

For a small dataset, the engine's inline data (`initSQL`, `initCypher`,
`initJS`, `initBulk`; run once on first start) replaces the dump.  The
`example` entry in `values.yaml` is a working template, and
`ci/e2e-<engine>.yaml` shows the same table for every engine:

```yaml
databases:
  interactions:
    enabled: true
    engine: neo4j
    database: interactions
    initCypher:
      - "CREATE (:Protein {accession: 'P04637', name: 'Cellular tumor antigen p53'})"
      - "CREATE (:Protein {accession: 'Q00987', name: 'E3 ubiquitin-protein ligase Mdm2'})"
    catalog:
      name: my-interactions
      entities:
        - name: proteins            # nodes labelled Protein
          columns: [accession, name]
          obo: { accession: uniprot }
```

### How OBO keys connect it to everything else

An OBO key is the [Bioregistry](https://bioregistry.io) prefix of an
identifier space — `uniprot`, `ensembl`, `ncbigene`, `chembl.compound`,
`inchikey`, `pubmed`, `reactome`, `chebi`, … (the `oboKeys` query lists the
ones Mozg knows).  Mozg's rule is simple: **two fields with the same OBO key
and the same value name the same thing.**  So annotating a column is enough
to join it, in both directions, with every public source that uses that key —
no relation has to be declared:

```graphql
{
  # Your rows → UniProt (and from there AlphaFold, PDBe, Reactome, …)
  query(input: {
    source: "my-targets", from: "target",
    include: ["uniprot/protein(uniprot_ac)", "opentargets/target(ensembl_gene)"]
  }) { count data }
}
```

```graphql
{
  # A public protein → the rows in your database that mention it
  query(input: {
    source: "uniprot", from: "protein", where: { uniprotAccession: "P23219" },
    include: ["chembl-postgres/component_sequences"]
  }) { count data }
}
```

`source/entity` names an implicit link; `(column)` picks the column when it is
not the identifier's canonical name.  The `catalog` query lists every
entity's links.

Each key has one canonical form: bare accessions and ids for most
(`P04637`, `ENSG00000141510`, `CHEMBL25`) and `PREFIX:id` CURIEs for OBO
ontologies (`CHEBI:15365`, `GO:0006915`).  Mozg normalises keyed columns to
that form when it reads your rows, so the values it returns always compare
equal across sources.  When a column *stores* a key differently, say so with
`oboForm`, and joins into it are converted to the stored form:

```yaml
- name: ReferenceMolecule              # Reactome stores ChEBI ids bare: 15365
  columns: [dbId, identifier, name]
  obo:     { identifier: chebi }
  oboForm: { identifier: local }       # "local" (bare) or "curie" (PREFIX:id)
```

With that, a link from `CHEBI:15365` finds the row storing `15365`.  The
chart's catalog entries are checked by Mozg's own catalog lint in CI, so an
unknown key or a malformed `oboForm` fails the build.

## Security

- **Credentials never leave the server.**  A self-hosted database's
  connection comes entirely from environment variables populated from the
  Service name and the Secret; the catalog entry names the variables, not the
  values, and the `catalog` query shows `selfHosted: true` with every
  connection field null.
- **Connections cannot be redirected.**  A query may name a self-hosted
  source but may not override its connection — otherwise a caller could send
  the server's password to a host of their choosing.
- **Only Mozg reaches a database.**  NetworkPolicies (on by default,
  `networkPolicy.enabled`) let each self-hosted database accept connections
  from Mozg pods alone; Mozg accepts traffic from anyone (narrow it with
  `networkPolicy.ingressFrom`) and may call out freely, since it queries
  public APIs.  Services are `ClusterIP` unless you choose otherwise.  The
  policies need a CNI that enforces them.
- **Secrets are files, not environment variables, for the databases.**
  - PostgreSQL, MariaDB and ArangoDB read the Secret's file directly.
  - Neo4j and Elasticsearch insist on a file of their own (`neo4j/<password>`
    and mode 600 respectively); an init container composes it in memory
    from the Secret.
  - First-start scripts pass credentials in files or on stdin, never on a
    command line.

  Mozg receives the passwords as environment variables, which its catalog
  names; they are never returned by its API.
- Mozg runs as UID 10001 with a read-only root filesystem, no Kubernetes API
  access, all capabilities dropped and every container resource-limited.
  Database pods run as their image's own unprivileged user (which owns the
  data volume).  PostgreSQL, MariaDB, ArangoDB and every init container run
  with a read-only root filesystem.  Neo4j and Elasticsearch cannot: their
  entrypoints write configuration and a keystore into the image.
- The chart passes checkov with no failures at its defaults and with every
  preset and every engine enabled.  The few checks that do not fit a chart are skipped with
  their reason on the resource: the namespace comes from `helm install -n`,
  and image tags and pull policy are values you control.

## Reference

| Value | Default | Meaning |
|-------|---------|---------|
| `databases.<name>.enabled` | `false` | Host this database |
| `databases.<name>.engine` | — | `postgres`, `mysql`, `neo4j`, `arango`, `elasticsearch` or `sqlite3` |
| `databases.<name>.image` | per engine | Server image (see [Engines](#engines)) |
| `databases.<name>.dump.url` / `sha256` / `format` | preset | Dump to restore on first start (formats per engine) |
| `databases.<name>.dump.verifySQL` | preset | PostgreSQL: accept a restore whose pg_restore reported errors if this query succeeds |
| `databases.<name>.dump.restoreJobs` | `2` | Parallel pg_restore jobs / arangorestore threads |
| `databases.<name>.initSQL` / `initCypher` / `initJS` / `initBulk` | — | Inline data loaded once on first start, per engine |
| `databases.<name>.neo4j.heapSize` / `pageCacheSize` / `config` | `1G` / `1G` / `{}` | Neo4j memory and extra `NEO4J_*` settings |
| `databases.<name>.elasticsearch.heapSize` / `config` | `512m` / `{}` | Elasticsearch heap and extra settings |
| `databases.<name>.mysql.args` | `[]` | Extra MySQL / MariaDB server arguments |
| `databases.<name>.storage.size` | `8Gi` | Data volume size (sqlite3: the in-pod volume's limit) |
| `databases.<name>.startupTimeoutSeconds` | preset | Startup-probe budget, covering the first restore |
| `databases.<name>.catalog` | preset | `name`, and `preset` or `label`/`entities` |
| `databaseDefaults.scaleToZero.enabled` | `true` | Scale between 0 and 1 replica (needs KEDA) |
| `databaseDefaults.scaleToZero.cooldownSeconds` | `900` | Idle time before scaling to zero |
| `databaseDefaults.scaleToZero.pollingIntervalSeconds` | `15` | KEDA polling interval |
| `databaseDefaults.scaleToZero.initialCooldownSeconds` | `3600` | No scale-down for this long after install |
| `metrics.enabled` / `metrics.port` | `true` / `9464` | Serve `/metrics` on its own port, which the Service and Ingress do not route to |
| `metrics.scrapeFrom` | `[]` | NetworkPolicy peers allowed to scrape (empty = anything that can reach the pod) |
| `metrics.annotations` | `true` | `prometheus.io/*` pod annotations |
| `metrics.podMonitor.enabled` / `interval` / `labels` | `false` / `30s` / `{}` | A Prometheus Operator PodMonitor |
| `mozg.logLevel` / `logFormat` / `slowQueryMs` | `info` / `json` / `10000` | Logging |
| `mozg.httpCacheTtlMs` / `mozg.httpCacheMaxEntries` | `0` / `500` | Cache identical outbound GETs (HTTP-backed sources only) |
| `mozg.resultCache.ttlMs` | `0` (off) | Reuse the answer to a whole query for every driver; callers can pass `fresh: true` |
| `mozg.resultCache.perSource` | `{}` | Per-source TTL in ms, overriding `ttlMs`; `0` turns it off for that source |
| `mozg.resultCache.maxEntries` / `maxBytes` | `500` / `64 MiB` | Bounds on the result cache |
| `mozg.connectionCacheMax` / `connectionIdleMs` | `32` / `600000` | Database clients kept, and how long an idle one lives |
| `mozg.ontologyCacheMax` | `20` | Parsed ontologies kept in memory |
| `mozg.wakeTimeoutMs` | `180000` | How long a query waits for a cold start |
| `mozg.demandWindowMs` | `60000` | Demand persists this long after the last query |
| `mozg.extraSourcesConfigMaps` | `[]` | ConfigMaps of extra catalog entries (`*.json`) |
| `networkPolicy.enabled` | `true` | Databases accept only Mozg; Mozg ingress per `networkPolicy.ingressFrom` |
| `databaseDefaults.resources` / `initResources` | modest | Requests and limits for database and init containers |

The chart is validated in CI (`.github/workflows/helm.yml`):
- lint;
- rendering of every configuration against the Kubernetes and KEDA schemas;
- for each engine, an end-to-end run on kind with KEDA that watches a
  database scale to zero, wake for a query, join to UniProt by OBO key,
  scale back to zero, and wake again.
