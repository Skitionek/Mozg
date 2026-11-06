# Public database dumps the chart can host

This is a list of public databases that publish a dump the Helm chart can
host, and of some that look as if they should but cannot be loaded as
published.  To host one, copy its `databases:` snippet into your values and
follow [Deploying Mozg on Kubernetes](deploy.md) (the [Engines](deploy.md#engines)
table lists what each engine loads, and [Adding your own
database](deploy.md#adding-your-own-database) explains the catalog part).

Checked on 2026-11-06.  Every URL below answered that day.  For each file
the HTTP status and size come from a `HEAD` request, and the format from its
first bytes (a ranged `GET`, partly decompressed where the file is
compressed).  Licences, releases and checksums come from each source's own
site.  Nothing multi-gigabyte was downloaded in full.  Entries marked
**restored** were loaded on that day with the chart's own first-start
commands, in the engine's default image (Docker, not a cluster), and then
queried.

## Recognising a dump

| First bytes | Format | `engine` / `dump.format` |
|-------------|--------|--------------------------|
| `PGDMP` | pg_dump custom format | `postgres` / `dump` |
| `-- PostgreSQL database dump` | pg_dump plain SQL | `postgres` / `sql` (or `sql.gz` when gzipped) |
| `-- MySQL dump` | mysqldump SQL | `mysql` / `sql` or `sql.gz` |
| `1f 8b` | gzip: look inside (a tar archive has `ustar` at byte 257) | depends on the content |
| `SQLite format 3` | SQLite database | `sqlite3` / `sqlite` (or `sqlite.gz`) |
| `DZV1` then `28 b5 2f fd` | Neo4j 5 dump (zstd) | `neo4j` / `dump` |
| `28 b5 2f fd` | Neo4j 4 dump (zstd) | `neo4j` / `dump` with `dump.migrate: true`; a 3.x store inside cannot be loaded |
| `{"index":` | Elasticsearch `_bulk` NDJSON | `elasticsearch` / `ndjson` |
| `PK` | ZIP | not loadable: unzip and repackage |

## Summary

"Loadable as-is" means the published URL goes straight into `dump.url`.
"Needs conversion" means the data is there but has to be repackaged (and
hosted somewhere your cluster can download from) first; [Converting a
dump](#converting-a-dump) shows how.

| Name | Domain | Engine | Format | Size | Licence | Loadable as-is |
|------|--------|--------|--------|------|---------|----------------|
| [ChEMBL 37](#chembl-37) (preset `chembl`) | Chemistry & drugs | postgres | tar.gz holding a pg_dump custom file | 2.09 GB | CC BY-SA 3.0 | yes |
| [Reactome 98 graph](#reactome-98-graph-database) (preset `reactome`) | Interactions & pathways | neo4j | dump, Neo4j 4 format | 512 MB | CC0 1.0 (data) | yes, with `dump.migrate` |
| [Reactome 98 relational](#reactome-98-relational-database) | Interactions & pathways | mysql | sql.gz | 122 MB | CC0 1.0 (data) | yes, **restored** |
| [ChEBI 257](#chebi-257) | Chemistry & drugs | postgres | dump (pg_dump custom, PostgreSQL 14) | 263 MB | CC BY 4.0 | yes, **restored** |
| [STRING 12.5](#string-125) | Interactions & pathways | postgres | sql.gz, one file per schema | 42.6 GB (items), 243 GB (network), 57.2 GB (evidence) | CC BY 4.0 | yes, one schema per database |
| [OBO ontologies (semantic-sql)](#obo-ontologies-semantic-sql) | Function & ontologies | sqlite3 | sqlite.gz | 2.8 MB (SO) to 2.37 GB (NCBITaxon) | that of each ontology | yes (opened) |
| [org.Hs.eg.db 3.23.1](#orghsegdb-3231) | Genes & genomes | sqlite3 | tar.gz holding one `.sqlite` | 104 MB | Artistic-2.0 | yes (opened) |
| [Monarch KG 2026-10-07](#monarch-kg-2026-10-07) | Disease & variants | neo4j | dump, Neo4j 5 format | 2.04 GB | per upstream source | yes; queries through Mozg untested |
| [TCRD 6.13.4](#tcrd-6134) (Pharos) | Proteins & structures | mysql | sql.gz | 7.95 GB | per upstream source | yes (not restored; last updated 2023-07) |
| ChEMBL 37 SQLite | Chemistry & drugs | sqlite3 | tar.gz holding a 30.5 GB `.db` | 5.76 GB | CC BY-SA 3.0 | yes, but not advised: every Mozg pod would hold a 30 GB copy; use the preset |
| Monarch KG SQLite | Disease & variants | sqlite3 | sqlite.gz | 5.29 GB | per upstream source | yes, but not advised for the same reason |
| GEOmetadb | Expression & samples | sqlite3 | sqlite.gz | 1.10 GB | not stated with the file | yes, but not advised: several GB per pod, last updated 2024-03-06 |
| ChEMBL 37 MySQL | Chemistry & drugs | mysql | tar.gz holding `chembl_37_mysql.dmp` (mysqldump text) | 2.10 GB | CC BY-SA 3.0 | needs conversion: the MySQL restore only picks up `*.sql` and `*.sql.gz` |
| BindingDB 2026-11 | Chemistry & drugs | mysql | ZIP holding a mysqldump (MySQL 8.4) | 261 MB | CC BY 3.0; ChEMBL-derived rows CC BY-SA 3.0 | needs conversion: ZIP |
| Guide to Pharmacology 2026.3.1 | Chemistry & drugs | postgres | ZIP holding plain pg_dump SQL | 34 MB | ODbL (database), CC BY-SA 4.0 (contents) | needs conversion: ZIP |
| COCONUT 2026-11 | Chemistry & drugs | postgres | plain pg_dump SQL, uncompressed | 37.9 GB | CC0 1.0 | needs conversion: `OWNER TO sail` statements fail (no such role) |
| Bgee 15.2 (EasyBgee) | Expression & samples | mysql | sql.gz | 11.9 GB | not confirmed | needs conversion: the first line is a mysqldump warning, not SQL |
| Rfam 15.1 | Genes & genomes | mysql | per-table `.sql` + `.txt.gz` | — | CC0 1.0 | needs conversion: per-table TSV for `LOAD DATA` |
| Pfam 38.x | Proteins & structures | mysql | per-table `.sql.gz` + `.txt.gz` | — | CC0 1.0 | needs conversion: per-table TSV; release 39.0 has no database files |
| UCSC Genome Browser (hg38, …) | Genes & genomes | mysql | per-table `.sql` + `.txt.gz` | — | see genome.ucsc.edu/license | needs conversion: per-table TSV |
| Ensembl 116 | Genes & genomes | mysql | per-table `.txt.gz` + schema `.sql.gz` | — | not checked | needs conversion: per-table TSV |
| DrugCentral 2026-09-25 | Chemistry & drugs | postgres | dump (pg_dump custom, PostgreSQL 16); also sql.gz | 1.38 GB | CC BY-SA 4.0 | no, with the default image: needs the RDKit cartridge |
| Hetionet v1.0 | Disease & variants | neo4j | dump holding a Neo4j 3.x store | 73.4 MB | CC0 1.0 (original content) | no: Neo4j 5 cannot load a 3.x store (tested) |
| miRBase 23.1 | Genes & genomes | — | FASTA, GFF, TSV | — | public domain | no: no database dump is published |
| UniChem | Chemistry & drugs | — | TSV; Oracle dumps from 2021 | — | — | no: no dump for a supported engine |
| AACT (ClinicalTrials.gov) | Clinical | — | — | — | — | no: downloads need an AACT account |
| [Neo4j graph examples](#neo4j-graph-examples) | Demo | neo4j | dump, Neo4j 5 format (`*-50.dump`) | 21 KB to 41 MB | no licence file found | yes, **restored** (movies) |
| [Elastic Shakespeare sample](#elastic-shakespeare-sample) | Demo | elasticsearch | ndjson | 25.3 MB | not stated with the file | yes, **restored** |
| [Chinook 1.4.5](#chinook-145) SQLite | Demo | sqlite3 | sqlite | 1.07 MB | MIT | yes |
| [Chinook 1.4.5](#chinook-145) MySQL | Demo | mysql | sql | 616 KB | MIT | yes, with `database: Chinook`, **restored** |
| Chinook 1.4.5 PostgreSQL | Demo | postgres | sql | 600 KB | MIT | needs conversion: the script drops, creates and `\c`-switches to its own database |
| [Northwind](#northwind) PostgreSQL | Demo | postgres | sql | 350 KB | Ms-PL | yes, **restored** |
| [Northwind](#northwind) SQLite | Demo | sqlite3 | sqlite | 24.7 MB | MIT | yes (opened) |
| Sakila 1.5 | Demo | mysql | tar.gz of two SQL files | 732 KB | BSD-3-Clause | needs conversion: the data file sorts before the schema file (tested) |
| Pagila | Demo | postgres | separate schema and data SQL files | 13 MB | PostgreSQL | needs conversion: two files, and the schema needs pgvector and a `postgres` role |
| ArangoDB example datasets | Demo | arango | `arangodump` directories inside a Git repository | — | no licence file found | needs conversion: no archive is published |

## Loadable entries

Every snippet goes under `databases:` in your values.  `catalog.entities`
must list the tables (node labels, indices) Mozg should expose, with their
columns and the OBO key of every identifier column; ChEMBL's preset,
[`files/catalog/chembl-postgres.json`](../deploy/helm/mozg/files/catalog/chembl-postgres.json),
is the model.  The snippets list a few entities each; add the rest the same
way.  Sizes for `storage.size` include the downloaded dump, which stays on
the volume until the restore has finished.

### ChEMBL 37

The `chembl` preset.  Released May 2026; it is still the newest release
(`ChEMBLdb/latest/` points at 37).  The archive holds
`chembl_37_postgresql.dmp`; its sha256 is published in
[`checksums.txt`](https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/chembl_37/checksums.txt)
and pinned in the preset.

```yaml
chembl:
  enabled: true
```

OBO keys: see the preset (`chembl.compound`, `chembl.target`,
`chembl.assay`, `chembl.document`, `inchikey`, `uniprot`, `pubmed`, …).

### Reactome 98 graph database

The `reactome` preset.  Release 98 (files dated 2026-10-22); Reactome
releases quarterly, under a new number in the URL.  The dump starts directly
with a zstd frame, so it is in the Neo4j 4 format and needs
`dump.migrate: true` (set by the preset).  No checksum is published.
Reactome's [licence page](https://reactome.org/license) puts the database
data under CC0 1.0 and illustrations and artwork under CC BY 4.0.  The
`reactome.graphdb.tgz` next to the dump is a store directory, not a dump,
and is not loadable.

```yaml
reactome:
  enabled: true
```

OBO keys: see the preset (`reactome`, `uniprot`, `chebi` stored bare with
`oboForm: local`).

### Reactome 98 relational database

The relational (GKB) form of the same release:
`https://download.reactome.org/98/databases/gk_current.sql.gz`, 121,734,551
bytes, a mysqldump of a MySQL 8.0 server (MyISAM tables, `utf8mb3`).  It
creates no database and switches to none, so any `database` name works.
**Restored** into MariaDB 12.3 in about a minute: 242 tables, 1.89 million
`DatabaseObject` rows, about 1 GB on disk.

```yaml
reactome-mysql:
  enabled: true
  engine: mysql
  database: reactome
  dump:
    url: https://download.reactome.org/98/databases/gk_current.sql.gz
    format: sql.gz
  storage:
    size: 4Gi            # ~1 GB restored, plus the 122 MB download
  startupTimeoutSeconds: 1800
  catalog:
    name: reactome-mysql
    label: Reactome (self-hosted MySQL)
    category: Interactions & pathways
    homepage: https://reactome.org
    license: CC0 1.0
    entities:
      - name: StableIdentifier
        description: A stable identifier (R-HSA-…) and its version
        columns: [DB_ID, identifier, identifierVersion, released]
        obo: { identifier: reactome }
        relations: []
      - name: DatabaseObject
        description: Every instance, with its class and display name
        columns: [DB_ID, _class, _displayName, stableIdentifier]
        relations:
          - { alias: stId, entity: StableIdentifier, foreignKey: stableIdentifier, ownerKey: DB_ID, type: belongsTo }
```

OBO keys: `StableIdentifier.identifier` is `reactome`.
`ReferenceEntity.identifier` holds UniProt accessions, bare ChEBI numbers or
Ensembl ids depending on the row's class, so no single key fits it; the
graph preset separates them by label.

### ChEBI 257

ChEBI now publishes its PostgreSQL database:
`generic_dumps/pgsql_allstars.dump`, 262,556,501 bytes, pg_dump custom
format from PostgreSQL 14.24, all tables in schema `chebi_allstar`, no
extensions.  Release 257 is dated 2026-11-05; releases are monthly.  The file
is replaced in place each month, and the previous release moves to
`archive/rel<N>/generic_dumps/pgsql_allstars.dump` (release 257 will be
there once 258 is out).  No checksum is published.  Licence: CC BY 4.0
(the directory's `LICENSE` file).  **Restored** into PostgreSQL 18 in under
a minute, without errors: 242,920 compounds, 2.8 GB.

```yaml
chebi:
  enabled: true
  engine: postgres
  database: chebi
  dump:
    url: https://ftp.ebi.ac.uk/pub/databases/chebi/generic_dumps/pgsql_allstars.dump
    format: dump
    verifySQL: SELECT 1 FROM chebi_allstar.compounds LIMIT 1
  storage:
    size: 8Gi            # 2.8 GB restored, plus the 263 MB download
  startupTimeoutSeconds: 1800
  catalog:
    name: chebi-postgres
    label: ChEBI (self-hosted PostgreSQL)
    category: Chemistry & drugs
    homepage: https://www.ebi.ac.uk/chebi/
    license: CC BY 4.0
    entities:
      - name: chebi_allstar.compounds
        description: One ChEBI entity
        columns: [id, chebi_accession, name, definition, stars, parent_id, status_id]
        obo: { chebi_accession: chebi }
        relations:
          - { alias: structures, entity: chebi_allstar.structures, localKey: id, foreignKey: compound_id, type: hasMany }
      - name: chebi_allstar.structures
        description: A structure of a compound (SMILES, InChI, InChIKey)
        columns: [id, compound_id, smiles, standard_inchi, standard_inchi_key, default_structure]
        obo: { standard_inchi_key: inchikey }
        relations: []
```

OBO keys: `compounds.chebi_accession` is `chebi`, stored as `CHEBI:15377`
(the canonical form, so no `oboForm`); `structures.standard_inchi_key` is
`inchikey`.  Tables outside `public` are named `schema.table`.

### STRING 12.5

Three plain pg_dump files (PostgreSQL 16.11, dumped without owners, no
extensions), one per schema, dated 2026-10-07:

| File | Size | Schema |
|------|------|--------|
| `https://stringdb-downloads.org/download/items_schema.v12.5.sql.gz` | 42,578,695,524 bytes | `items`: proteins, species, names, sequences, orthologous groups |
| `https://stringdb-downloads.org/download/network_schema.v12.5.sql.gz` | 243,027,445,520 bytes | `network`: scored protein–protein links |
| `https://stringdb-downloads.org/download/evidence_schema.v12.5.sql.gz` | 57,225,579,743 bytes | `evidence`: evidence behind the scores (license-restricted data excluded) |

Each loads as-is into its own database.  `network` and `evidence` refer to
proteins by STRING's internal `protein_id`, so they are useful only next to
`items` in the same database: put the three files in one `tar.gz` (the
restore runs `*.sql.gz` files in name order).  No checksums are published,
and STRING does not publish restored sizes; the storage below is an
estimate.  A plain-SQL restore runs in one session (`restoreJobs` does not
apply), so expect many hours.

```yaml
string-items:
  enabled: true
  engine: postgres
  database: string
  dump:
    url: https://stringdb-downloads.org/download/items_schema.v12.5.sql.gz
    format: sql.gz
  storage:
    size: 500Gi          # estimate: 42.6 GB compressed SQL, plus the download
  resources:
    requests: { cpu: 500m, memory: 2Gi }
    limits: { cpu: "2", memory: 4Gi }
  startupTimeoutSeconds: 86400
  scaleToZero:
    initialCooldownSeconds: 86400
  catalog:
    name: string-items
    label: STRING proteins (self-hosted PostgreSQL)
    category: Interactions & pathways
    homepage: https://string-db.org
    license: CC BY 4.0
    entities:
      - name: items.proteins
        description: One protein of one organism
        columns: [protein_id, protein_external_id, species_id, preferred_name, protein_size, annotation]
        obo: { protein_external_id: string, species_id: ncbitaxon }
        relations: []
      - name: items.species
        description: One organism
        columns: [species_id, official_name, compact_name, kingdom, type, protein_count]
        obo: { species_id: ncbitaxon }
        relations: []
```

OBO keys: `items.proteins.protein_external_id` (`9606.ENSP00000269305`) is
`string`; `species_id` columns are NCBI taxon ids, `ncbitaxon`.

### OBO ontologies (semantic-sql)

[semantic-sql](https://github.com/INCATools/semantic-sql) builds a SQLite
database for every OBO ontology at `https://semanticsql.berkeleybop.io/<id>.db.gz`.
The old `https://s3.amazonaws.com/bbop-sqlite/` URLs now answer 403.  The
project says builds are weekly; the files served on 2026-11-06 were dated
2026-09-26.  Files are replaced in place (no versioned URLs) and no
checksums are published.  `so.db` was opened and its schema checked.
Uncompressed sizes come from each file's gzip trailer.

| Ontology | URL id | Compressed | Uncompressed | Licence (OBO Foundry) | OBO key |
|----------|--------|-----------:|-------------:|-----------------------|---------|
| Gene Ontology | `go` | 331 MB | 1.70 GB | CC BY 4.0 | `go` |
| Human Phenotype Ontology | `hp` | 85 MB | 447 MB | HPO licence | `hp` |
| MONDO | `mondo` | 243 MB | 1.30 GB | CC BY 4.0 | `mondo` |
| ChEBI | `chebi` | 841 MB | 4.1 GB | CC BY 4.0 | `chebi` |
| Uberon | `uberon` | 195 MB | 1.05 GB | CC BY 3.0 | `uberon` |
| Cell Ontology | `cl` | 104 MB | 550 MB | CC BY 4.0 | `cl` |
| Disease Ontology | `doid` | 23 MB | 110 MB | CC0 1.0 | `doid` |
| Sequence Ontology | `so` | 2.8 MB | 13.6 MB | CC BY 4.0 | none in Mozg |
| EFO, NCIt, MP, MAxO, NCBITaxon | `efo`, `ncit`, `mp`, `maxo`, `ncbitaxon` | 255 MB, 550 MB, 144 MB, 23 MB, 2.37 GB | not measured | per ontology | `efo`, `ncit`, none, none, `ncbitaxon` |

sqlite3 databases are copied into every Mozg pod, so prefer the smaller
ontologies; `storage.size` must hold the file and, briefly, the download.

```yaml
go:
  enabled: true
  engine: sqlite3
  dump:
    url: https://semanticsql.berkeleybop.io/go.db.gz
    format: sqlite.gz
  storage:
    size: 4Gi            # 1.7 GB file, plus the 331 MB download while it is unpacked
  catalog:
    name: go-sqlite
    label: Gene Ontology (semantic-sql)
    category: Function & ontologies
    homepage: https://geneontology.org
    license: CC BY 4.0
    entities:
      - name: statements
        description: Every triple of the ontology
        columns: [subject, predicate, object, value, datatype, language]
        obo: { subject: "*", object: "*" }
        relations: []
      - name: rdfs_label_statement
        description: The label of each term (a view over statements)
        columns: [subject, value]
        obo: { subject: "*" }
        relations: []
      - name: entailed_edge
        description: Every inferred is-a and part-of ancestor of each term
        columns: [subject, predicate, object]
        obo: { subject: "*", object: "*" }
        relations: []
```

OBO keys: `subject` and `object` hold CURIEs from several ontologies
(`GO:0006915`, `BFO:0000050`, `CHEBI:…`), so they take the key `*`: each
value's prefix names its key.  The same entities fit every build; change
the URL, the name and `storage.size`.

### org.Hs.eg.db 3.23.1

Bioconductor's human gene annotation package (Bioconductor 3.23, the current
release; a new release comes every six months).  The source tarball,
103,790,170 bytes, holds one SQLite file,
`org.Hs.eg.db/inst/extdata/org.Hs.eg.sqlite` (418 MB), which the sqlite3
engine finds and uses.  Gene data are from NCBI Gene, 2026-03-18.
Bioconductor publishes an MD5 (`813be1921e7bc08c1348dbce9d244d0a`, in
`PACKAGES`); the download matched it, and the sha256 below was computed from
that download.  The file was opened and its tables checked.  The other
`org.*.eg.db` packages (mouse, rat, fly, …) are built the same way.

```yaml
org-hs-eg:
  enabled: true
  engine: sqlite3
  dump:
    url: https://bioconductor.org/packages/3.23/data/annotation/src/contrib/org.Hs.eg.db_3.23.1.tar.gz
    sha256: 470620665cf49d0319422731164f377e3e74253989f1d33a8a1d100cc3d49cfe
    format: tar.gz
  storage:
    size: 2Gi            # 418 MB file; the 104 MB archive is unpacked next to it first
  catalog:
    name: org-hs-eg
    label: Human genes (Bioconductor org.Hs.eg.db)
    category: Genes & genomes
    homepage: https://bioconductor.org/packages/org.Hs.eg.db
    license: Artistic-2.0
    entities:
      - name: genes
        description: One NCBI Gene record; _id links the other tables
        columns: [_id, gene_id]
        obo: { gene_id: ncbigene }
        relations:
          - { alias: info, entity: gene_info, localKey: _id, foreignKey: _id, type: hasOne }
          - { alias: uniprot, entity: uniprot, localKey: _id, foreignKey: _id, type: hasMany }
          - { alias: ensembl, entity: ensembl, localKey: _id, foreignKey: _id, type: hasMany }
          - { alias: go, entity: go, localKey: _id, foreignKey: _id, type: hasMany }
      - name: gene_info
        columns: [_id, gene_name, symbol]
        obo: { symbol: hgnc.symbol }
        relations: []
      - name: uniprot
        columns: [_id, uniprot_id]
        obo: { uniprot_id: uniprot }
        relations: []
      - name: ensembl
        columns: [_id, ensembl_id]
        obo: { ensembl_id: ensembl }
        relations: []
      - name: go
        description: GO annotations (a view over go_bp, go_mf and go_cc)
        columns: [_id, go_id, evidence, ontology]
        obo: { go_id: go }
        relations: []
      - name: pubmed
        columns: [_id, pubmed_id]
        obo: { pubmed_id: pubmed }
        relations: []
```

OBO keys: `genes.gene_id` is `ncbigene`, `gene_info.symbol` is
`hgnc.symbol`, `uniprot.uniprot_id` is `uniprot`, `ensembl.ensembl_id` is
`ensembl`, `go.go_id` is `go`, `pubmed.pubmed_id` is `pubmed`,
`refseq.accession` is `refseq`.

### Monarch KG 2026-10-07

The Monarch Initiative knowledge graph (genes, diseases, phenotypes and their
associations from many sources).  Builds are dated; the directory
`monarch-kg/latest/` points at the newest.  `monarch-kg.neo4j.v5.dump`,
2,044,217,043 bytes, starts with `DZV1`: a Neo4j 5 dump, loaded without
migration.  `monarch-kg.neo4j.dump` beside it also starts with `DZV1`, but
its name does not say which Neo4j version wrote it; use the `v5` file.
`metadata.yaml` lists sha256 sums
for some artefacts but not for the dump.  The data keep the licences of
their sources; the pipeline's code is BSD-3-Clause.

This dump was not loaded here.  Its node labels are Biolink classes
(`biolink:Gene`, `biolink:Disease`, …), which contain a colon; whether
Mozg's Neo4j connector (the GraphQL Mesh Neo4j handler) can expose such
labels is untested, so the snippet stops short of `catalog.entities`.

```yaml
monarch:
  enabled: true
  engine: neo4j
  database: monarch
  dump:
    url: https://data.monarchinitiative.org/monarch-kg/2026-10-07/monarch-kg.neo4j.v5.dump
    format: dump
  storage:
    size: 60Gi           # estimate: the store is several times the 2 GB dump
  resources:
    requests: { cpu: 500m, memory: 8Gi }
    limits: { cpu: "2", memory: 10Gi }
  neo4j:
    heapSize: 4G
    pageCacheSize: 4G
  startupTimeoutSeconds: 7200
  scaleToZero:
    initialCooldownSeconds: 7200
  catalog:
    name: monarch-neo4j
    label: Monarch KG (self-hosted Neo4j)
    category: Disease & variants
    homepage: https://monarchinitiative.org
    # entities: required (the chart refuses a catalog without them); see above
```

OBO keys: every node's `id` is a CURIE (`HGNC:11998`, `MONDO:0005148`,
`HP:0001250`), so it takes the key `*`.

### TCRD 6.13.4

The Target Central Resource Database behind Pharos:
`https://unmtid-dbs.net/download/TCRD/latest.sql.gz`, 7,950,527,053 bytes,
gzip of `TCRDv6.13.4.sql`, a mysqldump of a MySQL 8.0.30 server (InnoDB,
`utf8mb3`, no `CREATE DATABASE` or `USE`).  It was last updated on
2023-07-11.  An MD5 is published (`latest.sql.gz.md5`:
`4971db2109db2e2bac63967a4b5526f8`); the chart checks sha256 only.
Licences are per source (`TCRDv6_DataSourcesLicenses.xlsx` in the same
directory).  The header was checked; the file was not restored, and its
restored size is not published.

```yaml
tcrd:
  enabled: true
  engine: mysql
  database: tcrd
  dump:
    url: https://unmtid-dbs.net/download/TCRD/latest.sql.gz
    format: sql.gz
  storage:
    size: 150Gi          # estimate: 7.95 GB compressed SQL, plus the download
  startupTimeoutSeconds: 43200
  scaleToZero:
    initialCooldownSeconds: 43200
  catalog:
    name: tcrd
    label: TCRD (self-hosted MySQL)
    category: Proteins & structures
    homepage: https://pharos.nih.gov
    # entities: required; take tables and columns from TCRDv6_ERD.pdf in the same directory
```

OBO keys: annotate UniProt accessions `uniprot`, NCBI Gene ids `ncbigene`,
gene symbols `hgnc.symbol` and STRING ids `string`.  The column names were
not checked against this dump.

### Neo4j graph examples

[neo4j-graph-examples](https://github.com/neo4j-graph-examples) keeps a
Neo4j 5 dump of each example in `data/<name>-50.dump` (and Neo4j 4 dumps,
`-40`/`-43`, which load with `dump.migrate: true`).  Seen on 2026-11-06:
`movies` (21 KB), `northwind` (161 KB), `healthcare-analytics` (FDA adverse
event reports, 1.6 MB), `stackoverflow` (1.8 MB), `fincen` (1.4 MB), `pole`
(4.6 MB), `recommendations` (9.6 MB), `twitter-trolls` (41 MB).  The
repositories checked have no licence file.  `movies-50.dump` was **restored** with
neo4j-admin 5.26 (38 movies, 133 people), and `movies-43.dump` loaded and
migrated.  The URLs follow the `main` branch; pin a commit for a stable
dump.

```yaml
movies:
  enabled: true
  engine: neo4j
  database: movies
  dump:
    url: https://raw.githubusercontent.com/neo4j-graph-examples/movies/main/data/movies-50.dump
    format: dump
  storage:
    size: 1Gi
  neo4j:
    heapSize: 512m
    pageCacheSize: 128m
  resources:
    requests: { cpu: 200m, memory: 768Mi }
    limits: { cpu: "2", memory: 1536Mi }
  startupTimeoutSeconds: 600
  catalog:
    name: movies
    label: Movies (Neo4j example)
    entities:
      - name: movies         # nodes labelled Movie
        columns: [title, released, tagline]
        relations: []
      - name: people         # nodes labelled Person
        columns: [name, born]
        relations: []
```

Entity names are the query fields the Neo4j handler generates: the label,
pluralised and lower-cased.  No OBO keys.

### Elastic Shakespeare sample

`https://download.elastic.co/demos/kibana/gettingstarted/8.x/shakespeare.json`,
25,327,465 bytes, `_bulk` NDJSON for index `shakespeare` (111,396 lines of
the plays).  **Restored** into Elasticsearch 9.5.6 in 20,000-line `_bulk`
batches, as the chart loads it: no errors, 19 MB index.  Use the `8.x`
file: `shakespeare.json` one directory up, and `logs.jsonl.gz`, still carry
`_type` in their action lines, which Elasticsearch 8 and later reject.
`accounts.zip` is a ZIP.

```yaml
shakespeare:
  enabled: true
  engine: elasticsearch
  dump:
    url: https://download.elastic.co/demos/kibana/gettingstarted/8.x/shakespeare.json
    format: ndjson
  storage:
    size: 2Gi
  elasticsearch:
    heapSize: 512m
  resources:
    requests: { cpu: 200m, memory: 1Gi }
    limits: { cpu: "2", memory: 2Gi }
  startupTimeoutSeconds: 900
  catalog:
    name: shakespeare
    label: Shakespeare (Elastic sample)
    entities:
      - name: shakespeare
        columns: [type, line_id, play_name, speech_number, line_number, speaker, text_entry]
        relations: []
```

### Chinook 1.4.5

[Chinook](https://github.com/lerocha/chinook-database) (a music store),
release v1.4.5, MIT licence.  `Chinook_Sqlite.sqlite` (1,067,008 bytes) is a
SQLite file.  `Chinook_MySql.sql` (616,450 bytes) drops, creates and `USE`s
a database named `Chinook`; with `database: Chinook` that is the database
the chart creates, and the `mozg` user keeps its grant on it.  **Restored**
into MariaDB 12.3 (3,503 tracks).

```yaml
chinook:
  enabled: true
  engine: sqlite3
  dump:
    url: https://github.com/lerocha/chinook-database/releases/download/v1.4.5/Chinook_Sqlite.sqlite
    format: sqlite
  storage:
    size: 1Gi
  catalog:
    name: chinook
    label: Chinook (sample)
    entities:
      - name: Track
        columns: [TrackId, Name, AlbumId, MediaTypeId, GenreId, Composer, Milliseconds, Bytes, UnitPrice]
        relations:
          - { alias: album, entity: Album, foreignKey: AlbumId, ownerKey: AlbumId, type: belongsTo }
      - name: Album
        columns: [AlbumId, Title, ArtistId]
        relations: []
chinook-mysql:
  enabled: true
  engine: mysql
  database: Chinook      # must match the name the script creates
  dump:
    url: https://github.com/lerocha/chinook-database/releases/download/v1.4.5/Chinook_MySql.sql
    format: sql
  storage:
    size: 1Gi
  catalog:
    name: chinook-mysql
    label: Chinook (sample, MySQL)
    entities:
      - name: Track
        columns: [TrackId, Name, AlbumId, MediaTypeId, GenreId, Composer, Milliseconds, Bytes, UnitPrice]
        relations: []
```

### Northwind

The Northwind sample (originally Microsoft's).  The PostgreSQL script from
[pthom/northwind_psql](https://github.com/pthom/northwind_psql) (Ms-PL,
349,810 bytes) creates tables in whatever database it runs in; **restored**
into PostgreSQL 18 (830 orders).  The SQLite file from
[jpwhite3/northwind-SQLite3](https://github.com/jpwhite3/northwind-SQLite3)
(MIT, 24,702,976 bytes) was opened and checked.  A Neo4j 5 dump is among the
[Neo4j graph examples](#neo4j-graph-examples).  Both URLs follow a branch.

```yaml
northwind:
  enabled: true
  engine: postgres
  database: northwind
  dump:
    url: https://raw.githubusercontent.com/pthom/northwind_psql/master/northwind.sql
    format: sql
  storage:
    size: 1Gi
  catalog:
    name: northwind
    label: Northwind (sample)
    entities:
      - name: orders
        columns: [order_id, customer_id, employee_id, order_date, shipped_date, ship_country]
        relations:
          - { alias: customer, entity: customers, foreignKey: customer_id, ownerKey: customer_id, type: belongsTo }
      - name: customers
        columns: [customer_id, company_name, contact_name, city, country]
        relations: []
northwind-sqlite:
  enabled: true
  engine: sqlite3
  dump:
    url: https://raw.githubusercontent.com/jpwhite3/northwind-SQLite3/main/dist/northwind.db
    format: sqlite
  storage:
    size: 1Gi
  catalog:
    name: northwind-sqlite
    label: Northwind (sample, SQLite)
    entities:
      - name: Orders
        columns: [OrderID, CustomerID, EmployeeID, OrderDate, ShippedDate, ShipCountry]
        relations: []
```

## Converting a dump

The chart needs one URL your cluster can download.  To use an entry marked
"needs conversion", fetch it, repackage it as below, and host the result
(an object store bucket or any HTTPS server); then set `dump.url`,
`dump.sha256` and `dump.format` as for any other dump.

- **ZIP** (BindingDB, Guide to Pharmacology): unzip and gzip the SQL.
  - BindingDB, updated monthly:
    `https://www.bindingdb.org/rwd/bind/BDB-mySQL_All_202611_dmp.zip`
    (260,827,759 bytes; MD5 in `BDB-mySQL_All_202611_dmp.md5` beside it).
    The file inside, `BDB-mySQL_All_202611.dmp`, is a mysqldump of MySQL 8.4
    using `utf8mb4_0900_ai_ci`, which MariaDB 12.3 accepts (tested):
    `unzip -p BDB-mySQL_All_202611_dmp.zip | gzip > bindingdb.sql.gz`, then
    `engine: mysql`, `format: sql.gz`.  The link on BindingDB's download page
    goes through `SDFdownload.jsp`, which returns HTML; use the direct URL.
  - Guide to Pharmacology 2026.3.1:
    `https://www.guidetopharmacology.org/DATA/public_iuphardb_v2026.3.1.zip`
    (about 34 MB; the server sends no length).  Its download page now asks
    for an API key, but the file URL answered without one.  The `.dmp`
    inside is plain pg_dump SQL from PostgreSQL 18.6; it creates the
    `pg_trgm` extension, which the default image has.  gzip it,
    `engine: postgres`, `format: sql.gz`.
- **A file with the wrong name** (ChEMBL MySQL,
  `https://ftp.ebi.ac.uk/pub/databases/chembl/ChEMBLdb/releases/chembl_37/chembl_37_mysql.tar.gz`):
  the archive holds `chembl_37_mysql.dmp`, a 20 GB mysqldump; the MySQL
  restore runs only `*.sql` and `*.sql.gz`.  Rename it to `.sql`, gzip it,
  `format: sql.gz`.
- **Statements that fail**: remove them, then gzip.
  - COCONUT (`https://coconut.s3.uni-jena.de/prod/downloads/2026-11/coconut-dump-11-2026.sql`,
    plain pg_dump SQL from PostgreSQL 17.11): the `ALTER … OWNER TO sail;`
    lines (the restore stops at the first error).
  - Bgee 15.2 (`https://www.bgee.org/ftp/current/easybgee_dump.sql.gz`, a
    mysqldump of MySQL 8.0.37): the first line, `mysqldump: [Warning] …`.
  - Chinook's PostgreSQL script: the `DROP DATABASE`, `CREATE DATABASE`
    and `\c chinook` lines.
- **Files in the wrong order** (Sakila): the tarball's `sakila-data.sql`
  sorts before `sakila-schema.sql`.  Concatenate schema then data into one
  file and set `database: sakila` (the script creates and `USE`s it).
- **Per-table TSV** (Rfam, Pfam, UCSC, Ensembl): each table is a
  `table.sql` with its `CREATE TABLE` and a `table.txt.gz` meant for
  `LOAD DATA`.  Load them into a MariaDB of your own (`mysql < table.sql`,
  then `mysqlimport`), then `mysqldump` that database to one `sql.gz`.
- **STRING in one database**: `tar czf string.tar.gz items_schema.v12.5.sql.gz
  network_schema.v12.5.sql.gz evidence_schema.v12.5.sql.gz`, `format: tar.gz`.
- **arangodump directories** (ArangoDB examples, e.g.
  `DebianDependencyGraph`, which has a `dump.json`): tar the directory,
  `format: tar.gz`.
- **Pagila**: concatenate `pagila-schema.sql` and `pagila-data.sql`, and use
  a PostgreSQL 18 image with pgvector (`image:`); the schema also assigns
  objects to a `postgres` role, which the chart does not create (it creates
  `username`, `mozg` by default).

## Not loadable

- **DrugCentral**: the dump (pg_dump custom from PostgreSQL 16.15, at
  `https://unmtid-dbs.net/download/DrugCentral/2027/db_dump/Drugcentral_2026-09-25.pgdump`,
  1,378,106,682 bytes; also as `drugcentral.dump.09022026.sql.gz` beside it)
  creates the `rdkit` extension, and its central `structures` table has
  RDKit column types (`mol`, `bfp`), so on the default image, which lacks
  RDKit, that table cannot be created.  It needs a PostgreSQL 18 image with
  the RDKit cartridge set as `image:`; no such image was tested here.
- **Hetionet**: `hetionet-v1.0-neo4j.dump` (Git LFS, 73,402,686 bytes, LFS
  sha256 `80a56c887f885a1b5c1a27327a2b3840cc4b7519109865d8fc6de6b60043a96b`)
  holds a Neo4j 3.x store (version `v0.A.7`).  neo4j-admin 5.26 refuses it:
  "Unable to read store with version 'v0.A.7'".  It would first have to be
  upgraded through Neo4j 3.5 and 4.4 (not tried).
- **miRBase** 23.1 publishes FASTA, GFF and an id mapping, no database.
- **UniChem** publishes TSV tables; its Oracle dumps under `legacy/` date
  from 2021.
- **AACT** (ClinicalTrials.gov in PostgreSQL) offers downloads only to
  signed-in users.
