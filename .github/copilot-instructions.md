# Copilot Instructions for Mozg

## Project overview

Mozg is a **"slow by design"** cross-database query layer.  
It is **not** a database itself – it provides an expressive GraphQL language for
describing relations between entities that live in existing databases (PostgreSQL,
MySQL, SQLite).  A single `/graphql` endpoint accepts user-supplied credentials and
executes federated queries that traverse those relations at query time.

Key files:
- `src/index.js` – HTTP server (graphql-yoga)
- `src/schema.js` – GraphQL type definitions and resolvers
- `src/database/registry.js` – driver resolution (single source of truth)
- `src/database/connector.js` – query execution router
- `src/database/sources.js` – `source` / `include` / `apiKeys` expansion into explicit connections and relations
- `src/database/relations.js` – the one relation resolver every driver shares
- `src/database/http.js` – outbound HTTP: timeouts, retries, per-host rate limits, de-duplication
- `src/database/drivers/api.js` – declarative driver for catalog-described HTTP APIs (the life-science sources)
- `src/database/catalog-lint.js` – static checks that catalog entries and relations can resolve
- `src/database/introspect.js` – introspection router
- `src/database/drivers/` – per-driver implementations (sql, neo4j, arango, biocyc, rest, kegg, api)
- `src/catalog/` – one file per source; see `src/catalog/README.md` for the `api` entry format and conventions
- `scripts/verify-sources.js` – live verification of every api source and relation
- `src/ontology/` – OWL ontology ingestion (Turtle, RDF/XML, OWL/XML, Manchester)
- `public/index.html` – browser query-builder UI

## Adding or changing a life-science source

1. Follow `src/catalog/README.md`: canonical identifier names (`uniprotAccession`,
   `ensemblGeneId`, …), an `example` on every entity, relations whose `foreignKey`
   is a parameter of the target entity.
2. Inspect real responses before writing `fields`; never guess a response shape.
3. `node scripts/verify-sources.js <name>` must pass, `npm test` must pass, and
   `npm run docs:sources` regenerates `docs/sources.md`.

## Code style

- **Language**: Node.js (CommonJS `require`/`module.exports`)
- **Formatting**: 2-space indentation, single quotes for strings
- **Error handling**: propagate errors to GraphQL so clients receive structured
  error responses; never swallow exceptions silently
- **Security**: always use parameterised queries through knex; never interpolate
  user input directly into SQL strings

## Known deferred issues

Re-checked against the code (see docs/connectors.md for the evidence).  Open
items should **not** be fixed inline — add a `// TODO(#issue)` comment instead:

| Category | Area | Status | Description |
|----------|------|--------|-------------|
| Performance | `src/database/drivers/rest.js` | Open (mitigated) | Relations issue one request per parent row (REST has no generic batch filter); they now run four at a time instead of one after another |
| Performance | `src/database/drivers/mesh-adapter.js` | Open (mitigated) | Same per-row relation lookups for MySQL / Neo4j / OpenAPI / OData / SOAP — handler filter types share no generic `in` operator — now four at a time |
| Performance | `src/database/drivers/{sqlite3,mesh-adapter,arango}.js` | Open | Connection/source caches have no eviction; long-running servers that see many distinct connections grow without bound |

Resolved since this table was first written:

| Area | Resolution |
|------|------------|
| `src/ontology/index.js` SSRF | Fetches go through `secureFetch` (`src/ontology/url-validator.js`): protocol allowlist, private-address refusal, timeout, size cap |
| Neo4j Cypher injection (`neo4j.js`, now `mesh-adapter.js`) | Labels and relation keys are checked by `assertSafeCypherIdentifier`; every value travels as a GraphQL variable |
| Static file path traversal (`src/index.js`, now `src/static.js`) | `decodeURIComponent` plus a resolve-and-contain root check |
| Connection cache keyed without password (`sql.js`, now postgres / mesh-adapter / arango) | Every cache key includes the password, so a wrong password never reuses an authenticated connection (shown live against MySQL before the fix) |
| ArangoDB AQL injection | Collection, attribute and sort names travel as bind parameters |
| `src/database/drivers/biocyc.js` refetch per related id | One listing per related class serves every parent row, cached briefly |

## Commit messages

**All commit messages MUST follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.**

### Format

```
<type>(<optional scope>): <short imperative description>

[optional body]

[optional footer(s)]
```

### Allowed types

| Type       | When to use                                        |
|------------|----------------------------------------------------|
| `feat`     | A new feature visible to users or consumers        |
| `fix`      | A bug fix                                          |
| `docs`     | Documentation changes only                         |
| `style`    | Formatting, whitespace – no logic change           |
| `refactor` | Code restructuring without feature/fix             |
| `perf`     | Performance improvement                            |
| `test`     | Adding or correcting tests                         |
| `build`    | Build system or external dependency changes        |
| `ci`       | CI/CD pipeline configuration changes               |
| `chore`    | Maintenance tasks that don't fit other types       |
| `revert`   | Reverting a previous commit                        |

### Scopes (examples for this repo)

`api`, `schema`, `db`, `ui`, `devcontainer`, `deps`, `docs`

### Rules

1. The description must start with a **lowercase** letter and use the **imperative mood**
   ("add", "fix", "remove" – not "added", "fixes", "removed").
2. The description must **not** end with a period.
3. Breaking changes must include `!` after the type/scope and a `BREAKING CHANGE:` footer.
4. Keep the subject line ≤ 72 characters.

### Examples

```
feat(api): add introspect query for schema discovery
fix(db): handle null foreign key in belongsTo relation
docs: add Codespaces setup instructions to README
chore(deps): upgrade mysql2 to 3.9.8
ci: add commitlint workflow
feat(ui)!: redesign query builder layout

BREAKING CHANGE: query builder URL parameters have changed
```
