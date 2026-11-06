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
| `chembl` | PostgreSQL 16 | [ChEMBL 37 PostgreSQL dump](https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/chembl_37/) (2.1 GB, sha256-verified) | `chembl-postgres` | ~30 GB restored, plus ~4 GB during the restore (default PVC 80 Gi) | 2–4 GiB |
| `reactome` | Neo4j 5.26 | [Reactome 98 graph database dump](https://reactome.org/download-data) (0.5 GB) | `reactome-neo4j` | ~10 GB (default PVC 20 Gi) | 4–6 GiB (2 G heap, 2 G page cache) |

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
  are refused.  Mozg treats that — and DNS failures, timeouts, Postgres
  "starting up", Neo4j "service unavailable" — as a **cold start**, not an
  error, and keeps retrying (backing off to 5 s) for up to
  `mozg.wakeTimeoutMs` (3 minutes by default).  Errors that mean the query is
  wrong (bad credentials, unknown table) fail at once.
- **Cold-start latency** is the KEDA polling interval (15 s by default) plus
  the database's start time: a few seconds for PostgreSQL, 30–60 s for Neo4j
  with Reactome.  Mozg is "slow by design"; this is where that shows most.
- `cooldownSeconds` (15 minutes by default) is how long a database stays up
  after the last demand.  `initialCooldownSeconds` keeps it up after
  installation until the first restore can finish — set it above your
  expected restore time (the ChEMBL preset uses 8 hours).

## Adding your own database

Any PostgreSQL dump (pg_dump custom format, plain SQL, gzipped SQL, or a
tar.gz around one) or Neo4j dump can be hosted the same way.  Describe its
tables and, crucially, the **OBO key** of every identifier column:

```yaml
databases:
  targets:
    enabled: true
    engine: postgres
    image: { repository: postgres, tag: "16-alpine" }
    database: targets
    username: mozg
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

For a small table, `initSQL` (run once on first start) replaces the dump.
The `example` entry in `values.yaml` is a working template; it is what the
chart's end-to-end test deploys.

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

Store identifiers the way the key writes them: bare accessions and ids
(`P04637`, `ENSG00000141510`, `CHEMBL25`), and `PREFIX:id` CURIEs for OBO
ontologies (`CHEBI:15365`, `GO:0006915`).  Mozg converts what it sends to a
public source, but filters your tables with the value as given — a column
storing ChEBI ids without the `CHEBI:` prefix (as Reactome's does) joins
*out* correctly but will not be found by a link coming *in*.

## Security

- **Credentials never leave the server.**  A self-hosted database's
  connection comes entirely from environment variables populated from the
  Service name and the Secret; the catalog entry names the variables, not the
  values, and the `catalog` query shows `selfHosted: true` with every
  connection field null.
- **Connections cannot be redirected.**  A query may name a self-hosted
  source but may not override its connection — otherwise a caller could send
  the server's password to a host of their choosing.
- Databases are reachable only inside the cluster by default
  (`service.type: ClusterIP`).  Restrict further with a NetworkPolicy
  allowing only the Mozg pods if your cluster enforces them.
- Mozg runs as a non-root user with a read-only root filesystem and no
  Kubernetes API access; database pods run as their image's unprivileged
  user, without privilege escalation.

## Reference

| Value | Default | Meaning |
|-------|---------|---------|
| `databases.<name>.enabled` | `false` | Host this database |
| `databases.<name>.engine` | — | `postgres` or `neo4j` |
| `databases.<name>.dump.url` / `sha256` / `format` | preset | Dump to restore on first start (`tar.gz`, `dump`, `sql`, `sql.gz`) |
| `databases.<name>.dump.verifySQL` | preset | Accept a restore whose pg_restore reported errors if this query succeeds |
| `databases.<name>.initSQL` | `""` | SQL run once on first start (PostgreSQL) |
| `databases.<name>.storage.size` | preset | Data volume size |
| `databases.<name>.startupTimeoutSeconds` | preset | Startup-probe budget, covering the first restore |
| `databases.<name>.catalog` | preset | `name`, and `preset` or `label`/`entities` |
| `databaseDefaults.scaleToZero.enabled` | `true` | Scale between 0 and 1 replica (needs KEDA) |
| `databaseDefaults.scaleToZero.cooldownSeconds` | `900` | Idle time before scaling to zero |
| `databaseDefaults.scaleToZero.pollingIntervalSeconds` | `15` | KEDA polling interval |
| `databaseDefaults.scaleToZero.initialCooldownSeconds` | `3600` | No scale-down for this long after install |
| `mozg.wakeTimeoutMs` | `180000` | How long a query waits for a cold start |
| `mozg.demandWindowMs` | `60000` | Demand persists this long after the last query |
| `mozg.extraSourcesConfigMaps` | `[]` | ConfigMaps of extra catalog entries (`*.json`) |

The chart is validated in CI (`.github/workflows/helm.yml`): lint, rendering
of every configuration against the Kubernetes and KEDA schemas, and an
end-to-end run on kind with KEDA that watches a database scale to zero, wake
for a query, join to UniProt by OBO key, and scale back to zero.
