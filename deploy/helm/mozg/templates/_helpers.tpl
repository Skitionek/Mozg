{{/* Chart name */}}
{{- define "mozg.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Fully qualified app name */}}
{{- define "mozg.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "mozg.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mozg.labels" -}}
helm.sh/chart: {{ include "mozg.chart" . }}
{{ include "mozg.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "mozg.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mozg.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: server
{{- end }}

{{- define "mozg.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mozg.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Headless Service resolving to every Mozg pod (demand is combined across them) */}}
{{- define "mozg.peersName" -}}
{{- printf "%s-peers" (include "mozg.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Engines the chart can host, and what each one starts from.  `user` is the
account Mozg connects as: Neo4j, ArangoDB and Elasticsearch create only
their built-in superuser on first start, so for them it is fixed.
*/}}
{{- define "mozg.engineDefaults" -}}
postgres:
  image: { repository: postgres, tag: "16-alpine" }
  username: mozg
mysql:
  # MariaDB speaks the MySQL protocol and authenticates with
  # mysql_native_password, which Mozg's mysql connector needs.
  image: { repository: mariadb, tag: "11.4" }
  username: mozg
neo4j:
  image: { repository: neo4j, tag: "5.26-community" }
  username: neo4j
arango:
  image: { repository: arangodb, tag: "3.12.4" }
  username: root
elasticsearch:
  image: { repository: docker.elastic.co/elasticsearch/elasticsearch, tag: "8.15.5" }
  username: elastic
sqlite3: {}
{{- end }}

{{/* Users an engine insists on (its built-in superuser) */}}
{{- define "mozg.fixedUsers" -}}
neo4j: neo4j
arango: root
elasticsearch: elastic
{{- end }}

{{/*
Enabled databases, each merged over the engine's defaults and then
databaseDefaults, as a dict keyed by name.
Usage: {{ $dbs := include "mozg.databases" . | fromYaml }}
*/}}
{{- define "mozg.databases" -}}
{{- $out := dict }}
{{- $engines := include "mozg.engineDefaults" . | fromYaml }}
{{- $fixed := include "mozg.fixedUsers" . | fromYaml }}
{{- range $name, $db := .Values.databases }}
{{- if and $db $db.enabled }}
{{- if not (regexMatch "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$" $name) }}
{{- fail (printf "databases.%s: names must be lower-case DNS labels" $name) }}
{{- end }}
{{- if not (hasKey $engines (toString $db.engine)) }}
{{- fail (printf "databases.%s.engine must be one of %s, got %v" $name (keys $engines | sortAlpha | join ", ") $db.engine) }}
{{- end }}
{{- if not (and $db.catalog $db.catalog.name) }}
{{- fail (printf "databases.%s.catalog.name is required (the source name Mozg registers)" $name) }}
{{- end }}
{{- $merged := mustMergeOverwrite (deepCopy (get $engines $db.engine)) (deepCopy $.Values.databaseDefaults) (deepCopy $db) }}
{{- if hasKey $fixed $db.engine }}
{{- $user := get $fixed $db.engine }}
{{- if and $db.username (ne (toString $db.username) $user) }}
{{- fail (printf "databases.%s.username must be %s for the %s engine (its built-in superuser)" $name $user $db.engine) }}
{{- end }}
{{- $_ := set $merged "username" $user }}
{{- end }}
{{- if and (eq $db.engine "mysql") (eq (toString $merged.username) "root") }}
{{- fail (printf "databases.%s.username: use an ordinary user for mysql; root is reachable only inside its pod" $name) }}
{{- end }}
{{- if and (has $db.engine (list "postgres" "mysql" "neo4j" "arango")) (not $merged.database) }}
{{- fail (printf "databases.%s.database is required for the %s engine" $name $db.engine) }}
{{- end }}
{{- if and (eq $db.engine "sqlite3") (not (or (and $merged.dump $merged.dump.url) $merged.initSQL)) }}
{{- fail (printf "databases.%s: a sqlite3 database needs dump.url (the file) or initSQL" $name) }}
{{- end }}
{{- $_ := set $out $name $merged }}
{{- end }}
{{- end }}
{{- toYaml $out }}
{{- end }}

{{/* Whether a database runs as its own server (everything but sqlite3, which Mozg opens in-process) */}}
{{- define "mozg.db.isServer" -}}
{{- if ne .db.engine "sqlite3" }}true{{ end }}
{{- end }}

{{/* Resource name for a database: <fullname>-db-<name> */}}
{{- define "mozg.db.fullname" -}}
{{- printf "%s-db-%s" (include "mozg.fullname" .root) .name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mozg.db.labels" -}}
helm.sh/chart: {{ include "mozg.chart" .root }}
{{ include "mozg.db.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
mozg.io/engine: {{ .db.engine }}
mozg.io/source: {{ .db.catalog.name }}
{{- end }}

{{- define "mozg.db.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mozg.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: database
mozg.io/database: {{ .name }}
{{- end }}

{{/* Secret holding a database's password */}}
{{- define "mozg.db.secretName" -}}
{{- if .db.existingSecret }}
{{- .db.existingSecret }}
{{- else }}
{{- printf "%s-auth" (include "mozg.db.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/* Environment-variable prefix carrying a database's connection into Mozg: MOZG_DB_<NAME> */}}
{{- define "mozg.db.envPrefix" -}}
{{- printf "MOZG_DB_%s" (.name | upper | replace "-" "_") }}
{{- end }}

{{- define "mozg.db.port" -}}
{{- get (dict "postgres" "5432" "mysql" "3306" "neo4j" "7687" "arango" "8529" "elasticsearch" "9200") .db.engine }}
{{- end }}

{{/* Numeric user the database image runs as (also the volume's group) */}}
{{- define "mozg.db.uid" -}}
{{- if eq .db.engine "postgres" }}{{ if hasSuffix "alpine" (toString .db.image.tag) }}70{{ else }}999{{ end }}
{{- else if eq .db.engine "mysql" }}999
{{- else if eq .db.engine "neo4j" }}7474
{{- else }}1000
{{- end }}
{{- end }}

{{- define "mozg.db.image" -}}
{{- printf "%s:%s" .db.image.repository (toString .db.image.tag) }}
{{- end }}

{{/*
Where a database keeps things on its volume.
  mount   where the volume is mounted in every container
  data    the engine's own data directory (cleared when a first start did not finish)
  dump    where a downloaded dump waits until it is loaded
  marker  written once the first start (restore, init data) has finished
Postgres and Neo4j use the volume as they always have; MySQL, ArangoDB and
Elasticsearch get their data directory as a subdirectory, because their
first-start initialisation refuses a directory holding anything else (a
volume's lost+found included).
*/}}
{{- define "mozg.db.layout" -}}
{{- if eq .db.engine "postgres" }}
mount: /var/lib/postgresql/data
data: /var/lib/postgresql/data/pgdata
dump: /var/lib/postgresql/data/mozg-dump
marker: /var/lib/postgresql/data/pgdata/.mozg-ready
{{- else if eq .db.engine "neo4j" }}
mount: /data
data: /data
dump: /data/mozg-dump
marker: /data/.mozg-ready
{{- else }}
mount: /mozg-data
data: /mozg-data/data
dump: /mozg-data/dump
marker: /mozg-data/.mozg-ready
engineData: {{ get (dict "mysql" "/var/lib/mysql" "arango" "/var/lib/arangodb3" "elasticsearch" "/usr/share/elasticsearch/data") .db.engine }}
{{- end }}
{{- end }}

{{/* The SQLite file of a sqlite3 database, inside the Mozg pod */}}
{{- define "mozg.db.sqlitePath" -}}
{{- printf "/var/lib/mozg/sqlite/%s/%s.sqlite" .name .name }}
{{- end }}

{{/*
checkov skips, documented where they apply.  Each line is
`checkov.io/skipN: <check>=<reason>`; .skips is a list of "<check>=<reason>".
*/}}
{{- define "mozg.checkov.render" -}}
{{- range $i, $skip := . }}
checkov.io/skip{{ add1 $i }}: {{ $skip | quote }}
{{- end }}
{{- end }}

{{- define "mozg.checkov.ns" -}}
CKV_K8S_21=The namespace is chosen at install time with helm install -n; the chart sets none on purpose
{{- end }}

{{- define "mozg.checkov.pull" -}}
CKV_K8S_15=The pull policy is a value (image.pullPolicy); IfNotPresent suits tagged releases
{{- end }}

{{- define "mozg.checkov.digest" -}}
CKV_K8S_43=Images are referenced by tag from values; pin a digest in image.tag if your policy requires it
{{- end }}

{{/* Annotations for the Mozg Deployment (on the resource and its pod template) */}}
{{- define "mozg.checkov.server" -}}
{{- include "mozg.checkov.render" (list
    (include "mozg.checkov.ns" .)
    (include "mozg.checkov.pull" .)
    (include "mozg.checkov.digest" .)
    "CKV_K8S_35=Mozg reads self-hosted database credentials from environment variables named in its catalog; they are never returned by the API") }}
{{- end }}

{{/* Annotations for a database StatefulSet (on the resource and its pod template) */}}
{{- define "mozg.checkov.db" -}}
{{- $skips := list
    (include "mozg.checkov.ns" .root)
    (include "mozg.checkov.pull" .root)
    (include "mozg.checkov.digest" .root)
    "CKV_K8S_40=Runs as the database image's own unprivileged user (postgres 70/999, mysql 999, neo4j 7474, arangodb and elasticsearch 1000), which owns the data volume" }}
{{- if eq .db.engine "neo4j" }}
{{- $skips = append $skips "CKV_K8S_22=The Neo4j image's entrypoint writes its configuration under /var/lib/neo4j at startup; the init containers do run read-only" }}
{{- end }}
{{- if eq .db.engine "elasticsearch" }}
{{- $skips = append $skips "CKV_K8S_22=The Elasticsearch image's entrypoint writes its keystore under /usr/share/elasticsearch/config at startup; the init containers do run read-only" }}
{{- end }}
{{- include "mozg.checkov.render" $skips }}
{{- end }}

{{/* Annotations for a resource that is not a workload */}}
{{- define "mozg.checkov.resource" -}}
{{- include "mozg.checkov.render" (list (include "mozg.checkov.ns" .)) }}
{{- end }}
