{{/*
Shell run by every database's init containers, shared by both engines.
DATA_DIR, READY_MARKER, DUMP_URL, DUMP_SHA256, DUMP_FORMAT and DUMP_FILENAME
come from the container's environment.
*/}}
{{- define "mozg.db.fetchScript" -}}
set -eu
if [ -f "$READY_MARKER" ]; then echo "mozg: already initialised"; exit 0; fi
dump="$DATA_DIR/mozg-dump"
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
{{- if eq .db.engine "neo4j" }}{{ .db.database }}.dump
{{- else if eq (toString .db.dump.format) "sql" }}restore.sql
{{- else if eq (toString .db.dump.format) "sql.gz" }}restore.sql.gz
{{- else }}restore.dump
{{- end }}
{{- end }}
