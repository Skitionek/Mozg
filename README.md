# Mozg

> A **"slow by design"** cross-database query layer with a single GraphQL endpoint.

Mozg is not a database – it is an expressive language for describing **relations between entities that live in existing databases** (PostgreSQL, MySQL, SQLite).  A single `/graphql` endpoint accepts user-supplied credentials and executes federated queries that traverse those relations at query time.  A browser-based **query builder** lets you compose and run queries without writing GraphQL by hand.

---

## Features

- 🔌 **One endpoint** – `/graphql` queries any supported database
- 🔑 **Credentials in the query** – connection parameters are part of the GraphQL input
- 🔗 **Relation traversal** – `hasMany`, `hasOne`, `belongsTo` across tables
- 🗺 **Schema introspection** – discover tables & columns of any connected database
- 🌐 **Web UI** – visual query builder at `/`
- 🧪 **GraphiQL** – full IDE at `/graphql`

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
