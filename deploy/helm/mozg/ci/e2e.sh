#!/usr/bin/env bash
# End-to-end check of a self-hosted database scaling to zero behind Mozg.
#
# Expects: a cluster with KEDA, the chart installed as release "mozg" in
# namespace "bio" with ci/e2e-values.yaml, and Mozg port-forwarded to
# localhost:4000.  Asserts that the database
#   1. scales to zero when idle,
#   2. is woken by a query, which then answers (rows from the dump/init SQL),
#   3. joins to the public UniProt API by OBO key (include uniprot/protein(accession)),
#   4. scales back to zero once the demand window and cooldown have passed.
set -euo pipefail

NS=bio
STS=mozg-db-example
SOURCE=example-proteins
MOZG=http://localhost:4000

replicas() { kubectl -n "$NS" get statefulset "$STS" -o jsonpath='{.spec.replicas}'; }
pods() { kubectl -n "$NS" get pods -l mozg.io/database=example --no-headers 2>/dev/null | wc -l; }

wait_for_zero() {
  local deadline=$((SECONDS + $1))
  until [ "$(replicas)" = "0" ] && [ "$(pods)" = "0" ]; do
    if [ $SECONDS -ge $deadline ]; then
      echo "::error::$STS did not scale to zero within $1 s (replicas=$(replicas), pods=$(pods))"
      return 1
    fi
    sleep 5
  done
  echo "$STS is at zero replicas"
}

graphql() {
  jq -n --arg q "$1" '{query: $q}' | curl -fsS -X POST "$MOZG/graphql" -H 'Content-Type: application/json' --data @- --max-time 300
}

echo "== 1. idle database scales to zero"
wait_for_zero 300

echo "== demand while idle"
curl -fsS "$MOZG/demand/$SOURCE" | tee /dev/stderr | jq -e '.demand == 0' >/dev/null

echo "== 2. a query wakes it and is answered"
start=$SECONDS
out=$(graphql "{ query(input: { source: \"$SOURCE\", from: \"proteins\", orderBy: \"id\" }) { count data } }")
echo "$out" | jq .
echo "$out" | jq -e '.data.query.count == 2 and .data.query.data[0].accession == "P04637"' >/dev/null
echo "answered after a cold start of $((SECONDS - start)) s"
[ "$(replicas)" = "1" ] || { echo "::error::expected 1 replica after the query"; exit 1; }

echo "== demand reported across pods"
curl -fsS "$MOZG/demand/$SOURCE" | tee /dev/stderr | jq -e '.demand == 1' >/dev/null

echo "== 3. OBO-key join to the public UniProt API"
out=$(graphql "{ query(input: { source: \"$SOURCE\", from: \"proteins\", where: { accession: \"P04637\" }, include: [\"uniprot/protein(accession)\"] }) { count data } }")
echo "$out" | jq '.data.query.data[0] | {accession, uniprot: (.["uniprot/protein(accession)"][0] | {uniprotAccession, symbol, name})}'
echo "$out" | jq -e '.data.query.data[0]["uniprot/protein(accession)"][0].symbol == "TP53"' >/dev/null

echo "== the catalog never shows the server-held connection"
graphql "{ catalog(name: \"$SOURCE\") { selfHosted connection { host password } } }" | tee /dev/stderr \
  | jq -e '.data.catalog[0].selfHosted == true and .data.catalog[0].connection.host == null and .data.catalog[0].connection.password == null' >/dev/null

echo "== 4. back to zero once idle"
wait_for_zero 300

echo "e2e passed"
