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
- `src/database/introspect.js` – introspection router
- `src/database/drivers/` – per-driver implementations (sql, neo4j, arango, biocyc, rest)
- `src/ontology/` – OWL ontology ingestion (Turtle, RDF/XML, OWL/XML, Manchester)
- `public/index.html` – browser query-builder UI

## Code style

- **Language**: Node.js (CommonJS `require`/`module.exports`)
- **Formatting**: 2-space indentation, single quotes for strings
- **Error handling**: propagate errors to GraphQL so clients receive structured
  error responses; never swallow exceptions silently
- **Security**: always use parameterised queries through knex; never interpolate
  user input directly into SQL strings

## Known deferred issues

The following security and performance concerns are tracked in separate issues
and should **not** be fixed inline — add a `// TODO(#issue)` comment instead:

| Category | Area | Description |
|----------|------|-------------|
| Security | `src/ontology/index.js` | SSRF: arbitrary server-side URL fetch; needs allowlist + timeout |
| Security | `src/database/drivers/neo4j.js` | Cypher injection via unescaped identifiers (`from`, `orderBy`, `alias`) |
| Security | `src/index.js` | Path traversal in static file server; needs `decodeURIComponent` + root-check |
| Security | `src/database/drivers/sql.js` | Connection cache keyed without password; same-user different-password reuse |
| Performance | `src/database/drivers/rest.js` | N+1 sub-requests per relation row; should be batched/parallelised |
| Performance | `src/database/drivers/biocyc.js` | Refetches full class-instance list per related ID instead of building an index |

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
