# Catalog sources

Each file in this directory describes one data source.  Entries using the
`api` driver (the life-science sources) are *executable* descriptions: the
`api` driver reads them to build requests, unwrap responses and rename fields,
and the relation resolver reads them to join one source to another.  Nothing
about a source is hard-coded anywhere else.

```graphql
{
  query(input: {
    source: "uniprot"
    from: "protein"
    where: { uniprotAccession: "P04637" }
    include: ["structures", "alphafold", "pathways"]
  }) { count data }
}
```

## Anatomy of an `api` entry

```js
module.exports = {
  name: 'uniprot',                       // QueryInput.source
  label: 'UniProt',
  description: '…',
  category: 'Proteins & structures',     // one of the categories below
  homepage: 'https://www.uniprot.org',
  docs: 'https://www.uniprot.org/help/api',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: { database: 'https://rest.uniprot.org', headers: { Accept: 'application/json' } },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },   // per host; be polite
  rateLimitWithKey: { … },               // optional, when an API key raises the limit
  auth: { param: 'api_key', required: false, signup: 'https://…' },  // or { header: 'X-Api-Key' }
  query: { tool: 'mozg' },               // optional query params sent with every request
  entities: [ … ]
}
```

### Entities

```js
{
  name: 'protein',                        // QueryInput.from — a noun, camelCase
  description: 'One UniProtKB entry',
  path: '/uniprotkb/{uniprotAccession}',  // {placeholders} become required params
  params: {                               // every accepted `where` key
    uniprotAccession: { description: 'UniProtKB accession, e.g. P04637' },
    fields: { in: 'query', default: '…', description: '…' },
    reviewed: { in: 'query', name: 'reviewed', transform: '{value}' },
    organism: { in: 'filter', field: 'organism' }   // applied by Mozg after fetching
  },
  query: { format: 'json' },              // fixed query params, or (params) => ({ … })
  method: 'GET',                          // POST with body: (params) => ({ … })
  graphql: { query: '…', variables: (params) => ({ … }) },   // GraphQL APIs
  format: 'json',                         // 'tsv' (header row), 'text' or 'xml' with parse()
  rows: 'results',                        // where the records are: path, or (body, params) => []
  fields: {                               // output field → path into one record
    uniprotAccession: 'primaryAccession',
    symbol: 'genes[0].geneName.value',
    synonyms: 'genes[0].synonyms[].value',          // [] maps over an array
    name: 'proteinDescription.recommendedName.fullName.value|proteinDescription.submissionNames[0].fullName.value',
    ensemblGeneId: (r) => …                          // or a function
  },
  paginate: { limit: 'size', offset: 'offset', page: 'page', pageBase: 0, max: 500 },
  emptyStatus: [404],                     // statuses meaning "no such record" (default [404])
  resolve: async (params, ctx) => records,          // escape hatch for multi-request lookups
  example: { uniprotAccession: 'P04637' },          // REQUIRED: a where known to return rows
  relations: [ … ]
}
```

`where` is strict: a key the entity does not declare is an error, never a
parameter silently dropped (an API that ignores a filter returns everything).

`fields` decides the output.  Pass `raw: true` in a query to get the source's
records untouched.

`resolve(params, ctx)` replaces the single request when a lookup needs
several (NCBI's search-then-summarise, for instance).  `ctx.request(pathOrUrl,
{ query, format, method, body })` goes through the same throttled, retrying
client and resolves to the parsed body; `ctx.limit`/`ctx.offset` are the
caller's paging.  `fields` and `rows`-free mapping still apply to what it returns.

### Relations

```js
{
  alias: 'structures',                    // QueryInput.include name
  description: 'Experimental structures covering this protein (PDBe SIFTS)',
  catalog: 'pdbe',                        // omit for the same source
  entity: 'bestStructures',
  localKey: 'uniprotAccession',           // field on this entity's rows
  foreignKey: 'uniprotAccession',         // param on the target entity
  type: 'hasMany'                         // or hasOne (first row only)
}
```

For each parent row the target is queried with
`where: { [foreignKey]: row[localKey] }`.  `foreignKey` must be a declared
parameter of the target entity and `localKey` a field of this one —
`tests/catalog-relations.test.js` enforces both for every relation.  A parent
whose `localKey` is null gets `[]` (hasMany) or `null` (hasOne) without a request.

## Conventions

**Identifier fields and parameters use one name everywhere**, so a relation is
usually `localKey: X, foreignKey: X`:

| Name | Meaning | Example |
|------|---------|---------|
| `uniprotAccession` | UniProtKB accession | `P04637` |
| `ensemblGeneId` | Ensembl gene, **unversioned** | `ENSG00000141510` |
| `ncbiGeneId` | NCBI Gene (Entrez) id, as a string | `7157` |
| `hgncId` | HGNC CURIE | `HGNC:11998` |
| `symbol` | Gene symbol | `TP53` |
| `taxonId` | NCBI taxonomy id, number | `9606` |
| `pdbId` | PDB entry, upper case | `1TUP` |
| `chemblId` | ChEMBL id of a molecule/target | `CHEMBL25` |
| `pubchemCid` | PubChem compound id, number | `2244` |
| `inchiKey` | Standard InChIKey | `BSYNRYMUTXBXSQ-UHFFFAOYSA-N` |
| `chebiId` | ChEBI CURIE | `CHEBI:15365` |
| `pmid` | PubMed id, as a string | `31452104` |
| `doi` | DOI | `10.1038/…` |
| `rsId` | dbSNP id | `rs28934578` |
| `goId` | GO CURIE | `GO:0006915` |
| `reactomeId` | Reactome stable id | `R-HSA-69620` |
| `interproId` | InterPro accession | `IPR011615` |
| `diseaseId` | Disease CURIE with a colon (MONDO/EFO/Orphanet…) | `MONDO:0007254` |
| `hpoId` | HPO CURIE | `HP:0001250` |
| `nctId` | ClinicalTrials.gov id | `NCT04267848` |
| `stringId` | STRING protein id | `9606.ENSP00000269305` |
| `rnacentralId` | RNAcentral URS id | `URS000075C808_9606` |

Other fields are camelCase.  Keep rows flat where a record is naturally flat;
nested values (lists of synonyms, cross-references) are fine as arrays.

**Categories:** `Genes & genomes`, `Proteins & structures`,
`Interactions & pathways`, `Function & ontologies`, `Chemistry & drugs`,
`Disease & variants`, `Clinical`, `Literature`, `Expression & samples`.

**Verification.** Every entity's `example` must return rows from the live API:

```bash
node scripts/verify-sources.js uniprot pdbe      # one or more sources
node scripts/verify-sources.js                   # every api source
```

It runs each entity's example, checks the declared fields came back, then
follows every relation from the first row.  The weekly integration workflow
runs the same check.
