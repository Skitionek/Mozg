{{/*
Shell shared by every database's init containers.

`prepare` runs first, as the database's user: it makes sure the engine's
data directory exists and, when a first start died before finishing (no
ready marker), clears it so the next start begins again from the dump.
DB_DATA and READY_MARKER come from the container's environment.
*/}}
{{- define "mozg.db.prepareScript" -}}
set -eu
mkdir -p "$DB_DATA"
if [ ! -f "$READY_MARKER" ] && [ -n "$(ls -A "$DB_DATA" | grep -v -e '^mozg-dump$' -e '^lost+found$' || true)" ]; then
  echo "mozg: a previous first start did not finish; clearing $DB_DATA to retry"
  find "$DB_DATA" -mindepth 1 -maxdepth 1 ! -name mozg-dump ! -name lost+found -exec rm -rf {} +
fi
{{- end }}

{{/*
Downloads a database's dump into DUMP_DIR (resuming after a restart,
verifying DUMP_SHA256 when given) and unpacks archives.  DUMP_DIR,
READY_MARKER, DUMP_URL, DUMP_SHA256, DUMP_FORMAT and DUMP_FILENAME come from
the container's environment.
*/}}
{{- define "mozg.db.fetchScript" -}}
set -eu
if [ -f "$READY_MARKER" ]; then echo "mozg: already initialised"; exit 0; fi
dump="$DUMP_DIR"
mkdir -p "$dump"
if [ -f "$dump/.complete" ]; then echo "mozg: dump already downloaded"; exit 0; fi
part="$dump/download.part"
verified=false
if [ -n "${DUMP_SHA256:-}" ] && [ -f "$part" ] && echo "$DUMP_SHA256  $part" | sha256sum -c - >/dev/null 2>&1; then
  verified=true
fi
if [ "$verified" != true ]; then
  echo "mozg: downloading $DUMP_URL (resumes after a restart)"
  curl -fL --retry 10 --retry-delay 15 --retry-all-errors -C - -o "$part" "$DUMP_URL" || {
    echo "mozg: download failed; discarding the partial file"; rm -f "$part"; exit 1; }
  if [ -n "${DUMP_SHA256:-}" ]; then
    echo "$DUMP_SHA256  $part" | sha256sum -c - || { echo "mozg: checksum mismatch"; rm -f "$part"; exit 1; }
  fi
fi
case "$DUMP_FORMAT" in
  tar.gz|tgz) echo "mozg: extracting"; tar -xzf "$part" -C "$dump"; rm -f "$part" ;;
  *) mv "$part" "$dump/$DUMP_FILENAME" ;;
esac
touch "$dump/.complete"
echo "mozg: dump ready"
{{- end }}

{{- define "mozg.db.dumpFilename" -}}
{{- $format := toString .db.dump.format }}
{{- if eq .db.engine "neo4j" }}{{ .db.database }}.dump
{{- else if has $format (list "sql" "sql.gz" "ndjson" "ndjson.gz") }}restore.{{ $format }}
{{- else if eq .db.engine "sqlite3" }}{{ .name }}.{{ ternary "sqlite.gz" "sqlite" (eq $format "sqlite.gz") }}
{{- else }}restore.dump
{{- end }}
{{- end }}

{{/*
MySQL / MariaDB first start.  The image's entrypoint runs these in name
order on an empty data directory, against a temporary server that accepts
no TCP connections, so nothing reaches the database before it is loaded.
The .sh files are sourced (mode 0644), which gives them the entrypoint's
docker_process_sql: the SQL client, logged in, on the configured database.
*/}}
{{- define "mozg.db.mysqlRestore" -}}
# Sourced by the image's entrypoint on the first start.
mozg_dump={{ .layout.dump }}
if [ -d "$mozg_dump" ]; then
  find "$mozg_dump" -type f \( -name '*.sql' -o -name '*.sql.gz' \) | sort | while read -r f; do
    echo "mozg: loading $f - this can take a long time"
    case "$f" in
      *.gz) gunzip -c "$f" | docker_process_sql ;;
      *) docker_process_sql < "$f" ;;
    esac
  done
fi
{{- end }}

{{/*
ArangoDB first start.  The entrypoint runs these in name order against a
temporary server on 127.0.0.1:$ARANGO_INIT_PORT (the service port stays
closed); .js files run in arangosh on _system, .sh files are sourced and
see $ARANGOSH_ARGS (the root credentials).
*/}}
{{- define "mozg.db.arangoDatabase" -}}
// Run by the image's entrypoint on the first start.
const name = {{ .db.database | toJson }}
if (!db._databases().includes(name)) db._createDatabase(name)
{{- end }}

{{- define "mozg.db.arangoRestore" -}}
# Sourced by the image's entrypoint on the first start.
mozg_dir=$(find {{ .layout.dump }} -name dump.json 2>/dev/null | head -n 1)
if [ -n "$mozg_dir" ]; then
  mozg_dir=$(dirname "$mozg_dir")
  echo "mozg: restoring $mozg_dir into $MOZG_DATABASE - this can take a long time"
  $NUMACTL arangorestore $ARANGOSH_ARGS \
    --server.endpoint "tcp://127.0.0.1:$ARANGO_INIT_PORT" \
    --server.database "$MOZG_DATABASE" --create-database true \
    --threads "${MOZG_RESTORE_JOBS:-2}" --input-directory "$mozg_dir"
fi
{{- end }}

{{/* Last of the init files: the first start has finished. */}}
{{- define "mozg.db.readyScript" -}}
touch {{ .layout.marker }}
rm -rf {{ .layout.dump }}
echo "mozg: {{ .db.catalog.name }} is ready"
{{- end }}

{{/*
Neo4j: the server is started by this script, which on the first start
runs the database's init Cypher (Neo4j's HTTP endpoint on localhost; the
image has no cypher-shell) before writing the ready marker.  Readiness
waits for the marker, so nothing reaches the database before that.  A dump,
if any, was loaded offline by the `load` init container.
*/}}
{{- define "mozg.db.neo4jStart" -}}
#!/bin/bash
set -euo pipefail
marker={{ .layout.marker }}
/startup/docker-entrypoint.sh neo4j &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null; wait "$pid"; exit $?' TERM INT
if [ ! -f "$marker" ]; then
  if [ -f /mozg/init/init.json ]; then
    # Credentials travel in a wgetrc only this user can read, never on the command line.
    rc=$(mktemp)
    chmod 600 "$rc"
    printf 'header = Authorization: Basic %s\n' "$(printf 'neo4j:%s' "$(cat /run/secrets/mozg/password)" | base64 -w0)" > "$rc"
    tx="http://127.0.0.1:7474/db/$DB/tx/commit"
    echo "mozg: waiting for Neo4j"
    until WGETRC="$rc" wget -q -O /dev/null --header 'Content-Type: application/json' --post-data '{"statements":[]}' "$tx"; do
      kill -0 "$pid" 2>/dev/null || { echo "mozg: Neo4j exited during the first start"; exit 1; }
      sleep 2
    done
    echo "mozg: running the init Cypher"
    response=$(WGETRC="$rc" wget -q -O - --header 'Content-Type: application/json' --post-file /mozg/init/init.json "$tx")
    rm -f "$rc"
    case "$response" in
      *'"errors":[]'*) ;;
      *) echo "mozg: the init Cypher failed: ${response:0:1000}"; kill -TERM "$pid"; exit 1 ;;
    esac
  fi
  touch "$marker"
  rm -rf {{ .layout.dump }}
  echo "mozg: {{ .db.catalog.name }} is ready"
fi
wait "$pid"
{{- end }}

{{/*
Elasticsearch: started by this script, which on the first start loads the
dump (a snapshot repository restored in full, then any NDJSON bulk files)
and the inline init documents before writing the ready marker.  Readiness
waits for the marker.
*/}}
{{- define "mozg.db.elasticsearchStart" -}}
#!/bin/bash
set -euo pipefail
marker={{ .layout.marker }}
dump={{ .layout.dump }}
es=http://127.0.0.1:9200
/usr/local/bin/docker-entrypoint.sh eswrapper &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null; wait "$pid"; exit $?' TERM INT
if [ ! -f "$marker" ]; then
  password=$(cat "$ELASTIC_PASSWORD_FILE")
  # Credentials travel in a curl config on stdin, never on the command line.
  es_curl() { printf 'user = "elastic:%s"\n' "$password" | curl -fsS -K - "$@"; }
  fail() { echo "mozg: $1"; kill -TERM "$pid"; exit 1; }
  echo "mozg: waiting for Elasticsearch"
  until es_curl -o /dev/null "$es/_cluster/health?wait_for_status=yellow&timeout=5s" 2>/dev/null; do
    kill -0 "$pid" 2>/dev/null || { echo "mozg: Elasticsearch exited during the first start"; exit 1; }
    sleep 2
  done
  bulk() {
    local response
    response=$(es_curl -H 'Content-Type: application/x-ndjson' -X POST "$es/_bulk" --data-binary "@$1") || fail "bulk request for $1 failed"
    case "$response" in *'"errors":false'*) ;; *) fail "bulk load reported errors: ${response:0:1000}" ;; esac
  }
  # NDJSON on stdin, in batches of whole action/document line pairs.
  load_ndjson() {
    local parts
    parts=$(mktemp -d)
    split -l "${MOZG_BULK_LINES:-20000}" - "$parts/part-"
    for part in "$parts"/part-*; do [ -s "$part" ] && bulk "$part"; done
    rm -rf "$parts"
  }
  repo=""
  if [ -d "$dump" ]; then
    latest=$(find "$dump" -name index.latest 2>/dev/null | head -n 1)
    if [ -n "$latest" ]; then
      repo=$(dirname "$latest")
      echo "mozg: restoring the latest snapshot in $repo - this can take a long time"
      es_curl -o /dev/null -X PUT -H 'Content-Type: application/json' "$es/_snapshot/mozg-dump" \
        --data "{\"type\":\"fs\",\"settings\":{\"location\":\"$repo\",\"readonly\":true}}" || fail "cannot register $repo"
      snapshot=$(es_curl "$es/_cat/snapshots/mozg-dump?h=id&s=end_epoch" | tail -n 1)
      [ -n "$snapshot" ] || fail "no snapshot in $repo"
      es_curl -o /dev/null -X POST -H 'Content-Type: application/json' \
        "$es/_snapshot/mozg-dump/$snapshot/_restore?wait_for_completion=true" \
        --data '{"indices":"*,-.*","include_global_state":false}' || fail "restoring $snapshot failed"
      es_curl -o /dev/null -X DELETE "$es/_snapshot/mozg-dump"
    fi
    find "$dump" -type f \( -name '*.ndjson' -o -name '*.ndjson.gz' \) | sort | while read -r f; do
      if [ -n "$repo" ]; then case "$f" in "$repo"/*) continue ;; esac; fi
      echo "mozg: bulk loading $f"
      case "$f" in *.gz) gunzip -c "$f" | load_ndjson ;; *) load_ndjson < "$f" ;; esac
    done
  fi
  if [ -f /mozg/init/init.ndjson ]; then
    echo "mozg: loading the init documents"
    load_ndjson < /mozg/init/init.ndjson
  fi
  es_curl -o /dev/null -X POST "$es/_refresh"
  touch "$marker"
  rm -rf "$dump"
  echo "mozg: {{ .db.catalog.name }} is ready"
fi
wait "$pid"
{{- end }}

{{/*
SQLite: fetched into the Mozg pod itself (Mozg opens the file in-process).
SQLITE_FILE, DUMP_URL, DUMP_SHA256 and DUMP_FORMAT come from the
container's environment.  Formats: sqlite (the file), sqlite.gz, or tar.gz
holding one *.sqlite / *.sqlite3 / *.db file.
*/}}
{{- define "mozg.db.sqliteFetchScript" -}}
set -eu
dir=$(dirname "$SQLITE_FILE")
mkdir -p "$dir"
part="$dir/download.part"
echo "mozg: downloading $DUMP_URL"
curl -fL --retry 10 --retry-delay 15 --retry-all-errors -o "$part" "$DUMP_URL"
if [ -n "${DUMP_SHA256:-}" ]; then
  echo "$DUMP_SHA256  $part" | sha256sum -c - || { echo "mozg: checksum mismatch"; exit 1; }
fi
case "$DUMP_FORMAT" in
  sqlite.gz|gz) gunzip -c "$part" > "$SQLITE_FILE"; rm -f "$part" ;;
  tar.gz|tgz)
    mkdir -p "$dir/unpacked"
    tar -xzf "$part" -C "$dir/unpacked"
    found=$(find "$dir/unpacked" -type f \( -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' \) | head -n 1)
    [ -n "$found" ] || { echo "mozg: no *.sqlite, *.sqlite3 or *.db file in the archive"; exit 1; }
    mv "$found" "$SQLITE_FILE"
    rm -rf "$dir/unpacked" "$part" ;;
  *) mv "$part" "$SQLITE_FILE" ;;
esac
echo "mozg: $SQLITE_FILE ready"
{{- end }}
