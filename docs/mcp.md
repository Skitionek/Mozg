# Mozg for AI assistants (MCP)

Mozg is a [Model Context Protocol](https://modelcontextprotocol.io) server.
An assistant that speaks MCP can find a database, read what its fields mean,
and run the same cross-database queries as `/graphql`, without anyone writing
GraphQL for it.

The endpoint is `POST /mcp` on the port Mozg listens on, over Streamable HTTP.

```bash
# Claude Code
claude mcp add --transport http mozg http://localhost:4000/mcp
```

Clients configured by file take the URL the same way: Cursor's `mcp.json`
(`{"mcpServers": {"mozg": {"url": "http://localhost:4000/mcp"}}}`), VS Code's
`.vscode/mcp.json` (`{"servers": {"mozg": {"type": "http", "url": "…"}}}`), and
anything else that supports Streamable HTTP.  To try it without a client:

```bash
curl -s http://localhost:4000/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"catalog","arguments":{"search":"protein structure"}}}'
```

## The tools

Six tools.  Each runs a fixed GraphQL document against the
schema `/graphql` serves, so a tool and the query it stands for cannot
disagree about what a source, a relation or an identifier means.

| Tool | What it is for |
|------|----------------|
| `catalog` | Start here.  Without a name: a short list of the sources, filtered by `search` (words that must all appear), `category` or `driver`.  With a `name`: everything needed to query that source — its entities, their fields and parameters (each annotated with the identifier space, the [OBO key](model.md), it carries), a ready-made example, the declared relations and the links Mozg derives from shared identifiers.  `entity` narrows that to one entity |
| `query` | Read rows from a source (`source` + `from` + `where`) or from a database you give a `connection` to.  `include` follows relations, across sources, so one call joins databases by shared identifier; `link` looks values up in an ontology.  Same arguments as `QueryInput` |
| `introspect` | Tables and columns of a database, with types and primary keys |
| `obo_keys` | The identifier spaces Mozg understands, and how an identifier in each is written |
| `ontologies` | The ontologies the operator configured for linking (`MOZG_ONTOLOGIES`), and whether each has loaded |
| `ontology_terms` | Find ontology terms by label, synonym, identifier or cross-reference |

What the tools add to the GraphQL API is what a model needs and a GraphQL client
does not:

- **A short list, then the detail.**  The whole catalog is far too large for a
  prompt, so `catalog` lists the sources briefly and describes one at a time.
- **Small answers.**  `query` returns 25 rows unless `limit` says otherwise
  (at most 1000), and no answer is larger than `MOZG_MCP_MAX_RESULT_BYTES`
  (100 kB).  A result that was cut keeps its first rows and carries
  `truncated`, `returned` and a `note` that says how to narrow the question, so
  a model does not mistake a part for the whole.
- **Arguments are checked first.**  A wrong one comes back as a tool result
  with `isError`, naming the argument and what is wrong with it — the kind of
  message a model can act on — rather than as a protocol error.  Passwords in
  a connection string are scrubbed from error text.
- **Structured results.**  Every result is in `structuredContent`, with an
  `outputSchema` in `tools/list`, and also as JSON text for clients that show
  models only the text.

Nothing here writes on purpose.  The one thing Mozg can write — registering an
ontology's schema (`ingestOntology`) — is not offered: an assistant should not
be able to change what everyone's queries mean.  Every tool but `query` is
marked read-only.  `query` is not, because a Thrift method or an allowed SOAP
operation runs as called and Mozg cannot tell a read from a write there; a
client that skips confirmation for read-only tools will therefore ask before
it runs `query`.

### A conversation

> *Which structures exist for the tumour suppressor p53, and what pathways is it in?*

The assistant calls `catalog` with `search: "protein"`, finds `uniprot` among
the 33 sources that mention proteins, calls
`catalog` with `name: "uniprot", entity: "protein"` and reads that
`uniprotAccession` carries the `uniprot` key and that `structures` and
`pathways` are relations, then calls `query` once:

```json
{
  "source": "uniprot", "from": "protein",
  "where": { "uniprotAccession": "P04637" },
  "select": ["uniprotAccession", "name"],
  "include": ["structures", "pathways"], "limit": 1
}
```

UniProt, PDBe and Reactome answer — 50 structures and 46 pathways for the one
protein — and the assistant never wrote a join.

## Protocol

The endpoint serves both generations of MCP clients on the same path, as the
specification's compatibility section describes for a dual-era server.

| | Modern | Legacy |
|---|---|---|
| Versions | `2026-07-28` | `2025-03-26`, `2025-06-18`, `2025-11-25` |
| Starts with | nothing, or `server/discover` | `initialize`, then `notifications/initialized` |
| Version and capabilities | in every request's `_meta` | negotiated once, by `initialize` |
| Recognised by | `io.modelcontextprotocol/protocolVersion` in `_meta` | no per-request `_meta` |

A request is answered by the rules of the era it comes from.  Modern requests
must carry the `MCP-Protocol-Version` and `Mcp-Method` headers (and `Mcp-Name`
for `tools/call`, optionally Base64-encoded) and they are checked against the
body, so a gateway that routes on a header cannot be told one thing while the
server does another; a mismatch is `400` with `HeaderMismatch` (`-32020`).  A
version Mozg does not speak is `400` with `UnsupportedProtocolVersion`
(`-32022`) listing the ones it does.  `server/discover` answers with the
supported versions, capabilities and instructions, and `tools/list` and
`server/discover` carry `ttlMs` and `cacheScope` so a client can cache them.

Mozg keeps no state between requests, so there are **no sessions**: it mints no
`Mcp-Session-Id`, ignores one that is sent, and answers `GET` and `DELETE` with
`405`, which both generations of clients take to mean the server has no stream
for them.  Every answer is one JSON object; Mozg sends no progress or log
notifications, so a stream would carry nothing a response does not.  It offers
no resources, prompts, subscriptions or sampling, and does not accept batches.

Checked against the official TypeScript SDK clients in
[`tests/mcp.test.js`](https://github.com/Skitionek/Mozg/blob/main/tests/mcp.test.js):
1.x, which speaks the handshake protocol most assistants still use, and 2.x,
which speaks `2026-07-28` and falls back to the handshake by itself.

## Security

**Mozg has no authentication, and `/mcp` is no more protected than `/graphql`.**
The tools reach whatever `/graphql` reaches, and `query` and `introspect` accept
a `connection` to any host a caller names.  Put authentication and network
policy in front of a deployment that is not private.

Three things the endpoint does by itself:

- **Browsers are refused by default.**  A request that carries an `Origin`
  header, as every request from a web page does, is `403` unless the operator
  named that origin in `MOZG_MCP_ALLOWED_ORIGINS` (Helm `mozg.mcp.allowedOrigins`;
  `*` allows all).  This is what stops a page you visit from calling a Mozg on
  your own machine, including by DNS rebinding.  Clients that are not browsers
  send no `Origin` and need nothing.
- **Credentials stay out of the conversation where they can.**  Querying a
  catalog source takes none from the model, and a database the operator
  hosts is registered with its connection held by the server
  (`MOZG_SOURCES_DIR`, [Deploy](deploy.md)).  Passing a `connection` with a
  password puts that password in the assistant's context and in whatever it logs;
  prefer a source.  Mozg logs which tool was called and how long it took, never
  its arguments.
- **Answers are bounded**, in rows and in bytes, as above.

## Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `MOZG_MCP` | `on` | `off` removes the endpoint (`/mcp` is then a 404) |
| `MOZG_MCP_ALLOWED_ORIGINS` | none | Origins of web pages that may call `/mcp` |
| `MOZG_MCP_MAX_RESULT_BYTES` | `100000` | Largest tool result |

`/metrics` counts requests as `mozg_mcp_requests_total{era,method,outcome}` and
tool calls as `mozg_mcp_tool_calls_total{tool,outcome}`; a tool that failed
(`tool_error`) is told apart from a request that was refused (`error`).  The
labels come from fixed lists, not from what a caller sends.
