# @skitionek/mozg-sdk

A client for [Mozg](../README.md): one GraphQL endpoint over 47 life-science databases, and any you add.  No dependencies; it needs only a `fetch` (Node 18+, every browser).  Written in plain JavaScript with TypeScript types.

> **Not published to npm yet.**  Until it is, copy this directory into your project, or depend on it by path (`"@skitionek/mozg-sdk": "file:../Mozg/sdk"`).

```js
import { Mozg } from '@skitionek/mozg-sdk'

const mozg = new Mozg({ url: 'http://localhost:4000' })

// One protein → its structures and pathways, from three databases, in one call.
const { data } = await mozg.source('uniprot').from('protein')
  .where({ uniprotAccession: 'P04637' })
  .select('symbol', 'name')
  .include('structures', 'pathways')
```

## Queries

`mozg.source(name)` starts a query on a catalog source; `mozg.connect(connection)` on a database you give the credentials for.  Every method returns a **new** builder (the one you had is unchanged), and **awaiting a builder runs it** — `then`, `catch` and `finally` all work, or call `.run()`.

| Method | |
|---|---|
| `.from(entity)` | the table, label, path or catalog entity |
| `.where({…})` | filter; calls merge |
| `.select('a', 'b')` | columns |
| `.include('structures', 'mechanisms.target')` | catalog relations by name; dots go deeper |
| `.relation({ entity, foreignKey, type })` | an explicit relation |
| `.link({ field, ontology })` | link a field's values to ontology terms |
| `.limit(n)` `.offset(n)` `.orderBy('col', 'desc')` | paging and order |
| `.apiKeys({ ncbi: '…' })` `.raw()` `.fresh()` | per-source keys; rows as the source sent them; live data even if the server caches |
| `.toInput()` | the `QueryInput` it builds |

You can also pass the input yourself: `mozg.query({ source: 'chembl', from: 'molecule', where: { chemblId: 'CHEMBL25' } })`.

The result is `{ count, data, meta }`.  `meta` appears when the server has something to say: whether the answer came from its result cache (`meta.cache`), or how old a view's rows are.

The query always travels as a GraphQL **variable**, never as query text, so nothing you pass can change what is asked.

## Linking values to ontology terms

```js
const { data } = await mozg.source('opentargets').from('diseasePhenotypes')
  .where({ diseaseId: 'MONDO_0007739' })
  .link({ field: 'hpoId', ontology: 'hpo', as: 'phenotype' })
// data[0].phenotype → { iri, id: 'HP:0002063', label: 'Rigidity', matchedBy: 'id', ontology: 'hpo' }
```

`mozg.ontologies()` lists what the server has configured; `mozg.ontologyTerms({ search: 'seizure', ontology: 'hpo' })` searches one.

## Materialised views

```js
const rows = await mozg.view('tp53').where({ symbol: 'TP53' }).orderBy('length', 'desc').limit(10)
rows.meta   // { refreshedAt, ageMs, stale, total, truncated, … } — a stored answer says how old it is

await mozg.views()                    // what the server keeps, with sizes, ages and last errors
await mozg.view('tp53').info()
await mozg.view('tp53').refresh()     // refused, with the time to wait, if refreshed too recently
```

## Streaming

`/stream` sends the main rows first and each related record as it resolves.

```js
for await (const event of mozg.stream(input)) {
  // { type: 'envelope', count, data } then { type: 'chunk', ref, value } …
}
const whole = await mozg.streamAll(input)   // { count, data, errors } — placeholders filled in
```

Two limits: from a **browser**, `stream()` works only from a page Mozg itself serves, because `/stream` (unlike `/graphql`) sends no CORS headers.  And the protocol marks a placeholder as any string `"$N"`, so a cell that is exactly such a string can be mistaken for one; the SDK replaces a string only if the stream sent a chunk for it, but where rows can hold such values, use `query()`.

## Discovery

```js
await mozg.catalog()                          // every source, summarised
await mozg.catalog({ name: 'uniprot' })       // one source in full: entities, parameters, relations, links
await mozg.oboKeys()                          // the identifier spaces Mozg joins on
await mozg.introspect({ source: 'chembl' })   // tables and columns
await mozg.health()                           // { status: 'ok', version }
```

## Errors

Everything that goes wrong is a `MozgError`:

```js
try {
  await mozg.source('uniprot').from('protein').where({ nope: 1 })
} catch (err) {
  err.message      // the server's explanation
  err.code         // 'DOWNSTREAM_ERROR' when a database or API said no
  err.status       // the HTTP status, if there was an answer
  err.errors       // every GraphQL error
  err.requestId    // find this request in the server's logs
}
```

Each request carries an `X-Request-Id`, which Mozg writes into every log line the request causes; `err.requestId` is that id.

## Retries and timeouts

`new Mozg({ retries: 2, timeoutMs: 120000 })`.  A network failure or a 429/502/503/504 is retried with backoff (and `Retry-After`), but **reads only**: `refreshView` and `ingestOntology` are never retried, since they may have taken effect.  An answer that says no (a bad column, a database error) is not retried, nor is a timeout.  Pass `{ signal }` to any call to cancel it.  Mozg is slow by design, so the default timeout is generous.

## TypeScript

Types ship with the package, and rows are generic: `mozg.source<Protein>('uniprot').from('protein')` gives `QueryResult<Protein>`.

```ts
interface Protein { uniprotAccession: string, symbol: string, length: number }
const { data } = await mozg.source<Protein>('uniprot').from('protein').where({ symbol: 'TP53' }).limit(5)
```
