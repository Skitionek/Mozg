# Mozg Agent Guide

This file is a fast startup map for Copilot and contributors working in this repository.

## Project in one minute

- **Mozg** is a "slow by design" GraphQL layer over existing data sources.
- It does **not** store data; it resolves queries live against SQL databases, Neo4j, REST APIs, KEGG, BioCyc, and ontology-derived schemas.
- Main entry points:
  - `/` → browser query builder in `public/index.html`
  - `/graphql` → GraphQL API and GraphiQL
  - `/stream` → streaming endpoint in `src/stream.js`

## Run and verify

```bash
npm install
npm run dev     # local development server on http://localhost:4000
npm test        # Node test runner across tests/*.test.js
npm run lint    # eslint src tests
```

Use targeted checks while iterating, then run `npm test` before wrapping up work.

## High-level request flow

1. `src/index.js` starts the HTTP server and serves `public/` + `examples/`.
2. `src/schema.js` defines the GraphQL schema and resolvers.
3. `query` routes through `src/database/connector.js`.
4. `introspect` routes through `src/database/introspect.js`.
5. Both pick a driver via `src/database/registry.js`.
6. Driver implementations live in `src/database/drivers/`.
7. Prebuilt public-source presets live in `src/catalog/`.
8. Ontology ingestion and GraphQL mapping live in `src/ontology/`.

## Codebase map

| Path                         | Role                                              | Touch this when...                                            |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `src/index.js`               | HTTP bootstrap, static file serving, route wiring | changing endpoints, startup flow, or static asset behavior    |
| `src/schema.js`              | GraphQL SDL and resolvers                         | adding fields, inputs, mutations, or resolver logic           |
| `src/database/registry.js`   | single source of truth for driver selection       | adding or renaming a driver                                   |
| `src/database/connector.js`  | query dispatch                                    | adjusting query execution routing                             |
| `src/database/introspect.js` | introspection dispatch                            | adjusting schema discovery routing                            |
| `src/database/drivers/`      | per-backend execution logic                       | fixing backend-specific query/introspection behavior          |
| `src/catalog/`               | curated demo/public data source definitions       | adding a new catalog entry or improving examples              |
| `src/ontology/`              | OWL parsing, extraction, mapping, validation      | changing ontology ingestion or generated GraphQL schema       |
| `public/index.html`          | browser query builder UI                          | changing UX, editor behavior, or client-side query generation |
| `examples/`                  | sample ontologies and saved query examples        | updating demos or regression samples                          |
| `tests/`                     | regression and behavior coverage                  | verifying features and adding bug repros                      |

## Common change paths

### GraphQL API changes

- Start with `src/schema.js`.
- If the change affects execution, trace into `src/database/connector.js` and the chosen driver.
- Update or add tests in `tests/schema.test.js`, `tests/rest.test.js`, or other relevant suites.

### New data source or driver behavior

- Add or update the driver in `src/database/drivers/`.
- Register it in `src/database/registry.js`.
- Ensure the GraphQL `Driver` enum in `src/schema.js` stays in sync.
- Add tests, especially for query shape and introspection behavior.

### New public catalog entry

- Add `src/catalog/<name>.js`.
- Register it in `src/catalog/index.js`.
- If useful, add an example to `examples/queries.json` and mention it in `README.md`.

### Ontology pipeline work

- Parsers live in `src/ontology/formats/`.
- Extraction happens in `src/ontology/extractor.js`.
- GraphQL mapping happens in `src/ontology/mapper.js`.
- Validation against a live database happens in `src/ontology/validator.js`.

### UI/query-builder work

- Most client logic is in `public/index.html`.
- The UI uses **CodeMirror 6** and keeps a hidden `<textarea>` fallback for tests/no-bundle environments.
- UI changes often need a quick manual check in the browser plus `npm test`.

## Useful test files

- `tests/schema.test.js` → GraphQL query/introspection behavior
- `tests/rest.test.js` → REST driver execution and relation traversal
- `tests/kegg-driver.test.js` → KEGG-specific adapter behavior
- `tests/catalog.test.js` → catalog registry and metadata
- `tests/ontology.test.js` / `tests/mapper.test.js` → ontology parsing and schema generation
- `tests/stream.test.js` → streaming endpoint behavior
- `tests/examples.test.js` → sample queries and examples stay valid
- `tests/registry.test.js` → driver registry stays in sync

## Repo conventions and guardrails

- Use **CommonJS** (`require` / `module.exports`).
- Prefer **2-space indentation** and **single quotes**.
- Let errors propagate to GraphQL clients; do not swallow exceptions silently.
- SQL work must stay **parameterized through knex**.
- Some known security/performance issues are intentionally deferred in `.github/copilot-instructions.md`; do not fix them inline unless explicitly asked.

## Known gotchas

- `src/database/drivers/rest.js` supports **templated REST paths**, dotted `localKey` / `foreignKey` paths, and array fan-out relations.
- Some BioCyc catalogs expose `requiresCredentials`; keep the query builder behavior aligned with that metadata.
- WormBase requests should use `https://rest.wormbase.org`, not the main site host.

## Good final verification

Before declaring work complete, prefer this checklist:

1. Run the smallest relevant test or repro.
2. Run `npm test` if behavior changed.
3. Run `npm run lint` for broad JS edits.
4. If UI/server behavior changed, start `npm run dev` and do a quick manual check at `http://localhost:4000`.
