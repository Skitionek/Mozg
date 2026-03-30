# Mozg

> A **"slow by design"** cross-database query layer with a single GraphQL endpoint.

Mozg is not a database – it is an expressive language for describing **relations between entities that live in existing databases** (PostgreSQL, MySQL, SQLite, Neo4j, ArangoDB, BioCyc) and REST APIs.  A single `/graphql` endpoint accepts user-supplied credentials and executes federated queries that traverse those relations at query time.  A browser-based **query builder** lets you compose and run queries without writing GraphQL by hand.

---

## Features

- 🔌 **One endpoint** – `/graphql` queries any supported database or REST API
- 🔑 **Credentials in the query** – connection parameters are part of the GraphQL input
- 🔗 **Relation traversal** – `hasMany`, `hasOne`, `belongsTo` across tables / endpoints
- 🗺 **Schema introspection** – discover tables & columns of any connected database
- 🌐 **Web UI** – visual query builder at `/` with examples dropdown
- 🧪 **GraphiQL** – full IDE at `/graphql`
- 🦉 **OWL ontology ingestion** – parse Turtle, RDF/XML, OWL/XML and Manchester Syntax ontologies via `ingestOntology` mutation

---

## Quick start

```bash
npm install
npm start          # http://localhost:4000
# or
npm run dev        # restarts on file changes (Node ≥ 18.11)
```

---

## Open in GitHub Codespaces

Click the button below to open a fully configured dev environment in your browser – no local setup required.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Skitionek/Mozg)

The Codespace will automatically:
1. Start a Node 20 container
2. Run `npm install`
3. Start the dev server (`npm run dev`)
4. Forward port **4000** and open a preview

---

## Public Databases & APIs

The following free, public endpoints can be used directly — no sign-up required.

| Name | Driver | Host | Database | User | Password | Notes |
|------|--------|------|----------|------|----------|-------|
| RNAcentral | `postgres` | `hh-pgsql-public.ebi.ac.uk` | `pfmegrnargs` | `reader` | `NWDMCE5xdipIjRrp` | RNA sequences |
| RFAM | `mysql` | `mysql-rfam-public.ebi.ac.uk` | `Rfam` | `rfamro` | *(empty)* | RNA families |
| Neo4j Movies | `neo4j` | `demo.neo4jlabs.com` | `movies` | `movies` | `movies` | Movie graph (scheme: `neo4j+s`) |
| JSONPlaceholder | `rest` | – | `https://jsonplaceholder.typicode.com` | – | – | Fake REST data |
| RestCountries | `rest` | – | `https://restcountries.com/v3.1` | – | – | Country data |
| Open-Meteo | `rest` | – | `https://api.open-meteo.com/v1` | – | – | Weather (no key) |
| PokéAPI | `rest` | – | `https://pokeapi.co/api/v2` | – | – | Pokémon |
| Jikan | `rest` | – | `https://api.jikan.moe/v4` | – | – | Anime (MyAnimeList) |

---

## OWL Ontology Ingestion

Mozg can parse OWL ontologies in Turtle, RDF/XML, OWL/XML or Manchester Syntax and extract classes, object properties and data properties.

```graphql
mutation {
  ingestOntology(input: {
    url: "https://raw.githubusercontent.com/Skitionek/Mozg/main/examples/blog.ttl"
    format: turtle
  }) {
    tripleCount
    classes { iri label subClassOf }
    objectProperties { iri label domain range relationType }
    dataProperties { iri label domain range }
  }
}
```

You can also supply raw content instead of a URL:

```graphql
mutation {
  ingestOntology(input: {
    content: "@prefix : <http://example.org/> . :Foo a owl:Class ."
    format: turtle
  }) {
    tripleCount
    classes { iri label }
  }
}
```

---

## Example queries

### Introspect a SQLite database

```graphql
{
  introspect(connection: { driver: sqlite3, database: "path/to/file.db" }) {
    tables {
      name
      columns { name type nullable isPrimaryKey }
    }
  }
}
```

### Query with a relation

```graphql
{
  query(input: {
    connection: { driver: postgres, host: "localhost", database: "mydb", user: "alice", password: "secret" }
    from: "users"
    limit: 20
    relations: [
      { entity: "posts", foreignKey: "user_id", type: hasMany, select: ["id", "title"] }
    ]
  }) {
    count
    data
  }
}
```

---

## Commit conventions

This project uses **[Conventional Commits](https://www.conventionalcommits.org/)**.  
GitHub Copilot is configured (`.github/copilot-instructions.md` + `.vscode/settings.json`) to generate compliant commit messages automatically.

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code restructure without behaviour change |
| `chore` | Maintenance / dependency updates |
| `ci` | CI/CD changes |
| `test` | Tests |
| `perf` | Performance |
| `build` | Build system |
| `revert` | Revert a commit |

Examples:
```
feat(api): add introspect query for schema discovery
fix(db): handle null foreign key in belongsTo relation
chore(deps): upgrade mysql2 to 3.9.8
```
