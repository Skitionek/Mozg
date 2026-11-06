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
Enabled databases, each merged over databaseDefaults, as a dict keyed by name.
Usage: {{ $dbs := include "mozg.databases" . | fromYaml }}
*/}}
{{- define "mozg.databases" -}}
{{- $out := dict }}
{{- range $name, $db := .Values.databases }}
{{- if and $db $db.enabled }}
{{- if not (regexMatch "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$" $name) }}
{{- fail (printf "databases.%s: names must be lower-case DNS labels" $name) }}
{{- end }}
{{- if not (has $db.engine (list "postgres" "neo4j")) }}
{{- fail (printf "databases.%s.engine must be postgres or neo4j, got %v" $name $db.engine) }}
{{- end }}
{{- if not (and $db.catalog $db.catalog.name) }}
{{- fail (printf "databases.%s.catalog.name is required (the source name Mozg registers)" $name) }}
{{- end }}
{{- $merged := mustMergeOverwrite (deepCopy $.Values.databaseDefaults) (deepCopy $db) }}
{{- $_ := set $out $name $merged }}
{{- end }}
{{- end }}
{{- toYaml $out }}
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
{{- if eq .db.engine "neo4j" }}7687{{ else }}5432{{ end }}
{{- end }}

{{/* Numeric user the database image runs as (also the volume's group) */}}
{{- define "mozg.db.uid" -}}
{{- if eq .db.engine "neo4j" }}7474{{ else if hasSuffix "alpine" (toString .db.image.tag) }}70{{ else }}999{{ end }}
{{- end }}

{{- define "mozg.db.image" -}}
{{- printf "%s:%s" .db.image.repository (toString .db.image.tag) }}
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
    "CKV_K8S_40=Runs as the database image's own unprivileged user (postgres 70/999, neo4j 7474), which owns the data volume" }}
{{- if eq .db.engine "neo4j" }}
{{- $skips = append $skips "CKV_K8S_22=The Neo4j image's entrypoint writes its configuration under /var/lib/neo4j at startup; the init containers do run read-only" }}
{{- end }}
{{- include "mozg.checkov.render" $skips }}
{{- end }}

{{/* Annotations for a resource that is not a workload */}}
{{- define "mozg.checkov.resource" -}}
{{- include "mozg.checkov.render" (list (include "mozg.checkov.ns" .)) }}
{{- end }}
