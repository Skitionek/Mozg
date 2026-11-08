'use strict'

/**
 * The tools Mozg offers over MCP.
 *
 * They are a thin face on the GraphQL schema: each runs one fixed GraphQL
 * document against the same schema the /graphql endpoint serves, so a tool
 * and the query it stands for cannot disagree about what a source, a relation
 * or an identifier means.  What the tools add is what a language model needs
 * and a GraphQL client does not:
 *
 *   - arguments are checked first, with messages that say what to change;
 *   - the catalog is offered as a short list to choose from, then in full for
 *     the one source chosen, rather than all at once;
 *   - results are capped in size (MOZG_MCP_MAX_RESULT_BYTES), and a result
 *     that was cut says so and says how to narrow the question.
 *
 * Tools only read.  What Mozg can write — registering an ontology's schema —
 * is not offered: a model should not be able to change what everyone's queries
 * mean.
 */

const { graphql } = require('graphql')
const { redactCredentials } = require('../errors')
const { validate } = require('./validate')

/** The rows a query returns when the caller does not say; small on purpose, it goes into a prompt. */
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 1000

/** A failure the caller can act on.  Reported as a tool result with isError, not as a protocol error. */
class ToolError extends Error {}

// ── GraphQL documents ───────────────────────────────────────────────────────

const DOCUMENTS = {
  catalogSummary: `query ($name: String, $category: String, $driver: Driver) {
    catalog(name: $name, category: $category, driver: $driver) {
      name label description category driver selfHosted
      auth { required }
      entities { name description }
    }
  }`,
  catalogDetail: `query ($name: String) {
    catalog(name: $name) {
      name label description category driver homepage docs license selfHosted
      auth { required param header signup }
      entities {
        name description
        fields { name obo }
        params { name in required description example obo }
        example
        relations { entity foreignKey localKey alias catalog type description limit where obo }
        links { name catalog entity localKey foreignKey obo description }
      }
    }
  }`,
  query: 'query ($input: QueryInput!) { query(input: $input) { count data meta } }',
  introspect: `query ($connection: ConnectionInput, $source: String) {
    introspect(connection: $connection, source: $source) {
      tables { name columns { name type nullable defaultValue isPrimaryKey } }
    }
  }`,
  oboKeys: '{ oboKeys { key label prefix form pattern field } }',
  ontologies: '{ ontologies { name label url format obo loaded termCount error } }',
  ontologyTerms: `query ($search: String!, $ontology: String, $url: String, $format: TermFormat, $match: [OntologyMatch!], $limit: Int) {
    ontologyTerms(search: $search, ontology: $ontology, url: $url, format: $format, match: $match, limit: $limit) {
      iri id label synonyms definition xrefs parents deprecated ontology
    }
  }`
}

/**
 * One source in the list to choose from.  Short on purpose — the whole catalog
 * goes into a prompt — so what is false or empty is left out; the full
 * description of one source has the rest.
 */
function summarise (source) {
  return {
    name: source.name,
    label: source.label,
    description: source.description,
    ...(source.category ? { category: source.category } : {}),
    driver: source.driver,
    ...(source.auth && source.auth.required ? { needsKey: true } : {}),
    ...(source.selfHosted ? { selfHosted: true } : {}),
    entities: source.entities.map((e) => e.name)
  }
}

/** Run a document; GraphQL errors become one ToolError carrying the messages, credentials removed. */
async function run (schema, source, variableValues) {
  const result = await graphql({ schema, source, variableValues })
  if (result.errors && result.errors.length) {
    const messages = result.errors.map((e) => redactCredentials((e.originalError && e.originalError.message) || e.message))
    throw new ToolError([...new Set(messages)].join('; '))
  }
  return result.data
}

// ── Sizes ───────────────────────────────────────────────────────────────────

const bytes = (value) => Buffer.byteLength(JSON.stringify(value))

/**
 * Keep a result within `maxBytes` by dropping the end of its list.  A result
 * that was cut says how much it kept and what to do about it, so the model
 * does not mistake a part for the whole.
 */
function fit (result, key, maxBytes, advice) {
  if (bytes(result) <= maxBytes) return result
  const items = result[key]
  const attempt = (n) => ({
    ...result,
    [key]: items.slice(0, n),
    truncated: true,
    returned: n,
    note: `Showing ${n} of ${items.length} ${key}, because the answer is capped at ${maxBytes} bytes. ${advice}`
  })
  let low = 0
  let high = items.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (bytes(attempt(mid)) <= maxBytes) low = mid
    else high = mid - 1
  }
  return attempt(low)
}

// ── Schemas ─────────────────────────────────────────────────────────────────

/** The names of a GraphQL enum, so a tool's choices cannot drift from the API's. */
function enumOf (schema, name) {
  return schema.getType(name).getValues().map((value) => value.name)
}

const str = (description, extra) => ({ type: 'string', description, ...extra })

function buildTools ({ schema, maxBytes }) {
  const drivers = enumOf(schema, 'Driver')
  const relationTypes = enumOf(schema, 'RelationType')
  const termFormats = enumOf(schema, 'TermFormat')
  const ontologyMatches = enumOf(schema, 'OntologyMatch')

  const connection = {
    type: 'object',
    description: 'How to reach a database that is not a catalog source. Not needed with source.',
    properties: {
      driver: { type: 'string', enum: drivers },
      host: str('Host; not used by sqlite3 or rest'),
      port: { type: 'integer', description: 'Defaults to the driver\'s' },
      database: str('Database name, SQLite file path, or the base URL (rest, openapi, odata), WSDL URL (soap) or endpoint (thrift)'),
      user: str('User name, or the API key for rest'),
      password: str('Password'),
      scheme: str('For example bolt, neo4j+s, http, https'),
      path: str('Endpoint path (thrift)'),
      headers: { type: 'object', description: 'Default request headers (rest)' },
      apiKeyParam: str('Query parameter that carries the API key (rest)')
    },
    required: ['driver', 'database'],
    additionalProperties: false
  }

  const relation = {
    type: 'object',
    description: 'A related entity to fetch for every row.',
    properties: {
      entity: str('The related entity'),
      foreignKey: str('hasMany/hasOne: the field on the related entity that holds the parent\'s key. belongsTo: the field on this entity that holds the related one\'s key.'),
      localKey: str('Key on the parent entity (default id)'),
      alias: str('Name of the property in the result (default: the entity name)'),
      ownerKey: str('belongsTo: the key on the related entity that foreignKey points at (default id)'),
      type: { type: 'string', enum: relationTypes },
      catalog: str('Fetch from another catalog source'),
      select: { type: 'array', items: { type: 'string' } },
      where: { type: 'object' },
      limit: { type: 'integer', minimum: 1 },
      batch: { type: 'boolean' },
      obo: str('Join by OBO key instead of naming fields'),
      relations: { type: 'array', items: { type: 'object' } }
    },
    required: ['entity', 'foreignKey'],
    additionalProperties: false
  }

  const link = {
    type: 'object',
    description: 'Look the values of one field up in an ontology and put the term beside them.',
    properties: {
      field: str('The result field holding the value; a.b follows related rows'),
      ontology: str('A configured ontology (see the ontologies tool)'),
      url: str('Or an ontology fetched from a URL'),
      format: { type: 'string', enum: termFormats },
      match: { type: 'array', items: { type: 'string', enum: ontologyMatches } },
      as: str('Where to put the term (default: the field name plus Term)'),
      obo: str('OBO key of the identifiers in the field, so a bare local id reads as a CURIE'),
      details: { type: 'boolean', description: 'Also return definition, synonyms, cross-references and parents' }
    },
    required: ['field'],
    additionalProperties: false
  }

  const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }

  return [
    {
      name: 'catalog',
      title: 'Find a data source',
      description: 'List the data sources Mozg knows (UniProt, Ensembl, ChEMBL, ClinVar, …), or describe one. Without a name this is a short list to choose from; filter it with search (words that must all appear), category or driver. With a name it returns everything needed to query that source: its entities, their fields and parameters (each annotated with the identifier space, the OBO key, it carries), a ready-made example, the relations to other entities and the implicit links by shared identifier. Start here.',
      inputSchema: {
        type: 'object',
        properties: {
          name: str('A source name from the list, for its full description'),
          entity: str('With name: describe only this entity'),
          search: str('Words that must all appear in a source\'s name, label, description, category or entities'),
          category: str('For example "Genes & genomes"'),
          driver: { type: 'string', enum: drivers }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: { sources: { type: 'array' }, truncated: { type: 'boolean' }, note: { type: 'string' } },
        required: ['sources']
      },
      annotations: { title: 'Find a data source', ...READ, openWorldHint: false },
      async run (args) {
        if (args.entity && !args.name) throw new ToolError('entity goes with name: say which source the entity belongs to.')
        if (args.name) {
          let data
          try {
            data = await run(schema, DOCUMENTS.catalogDetail, { name: args.name })
          } catch (err) {
            if (/^Unknown catalog/.test(err.message)) throw new ToolError(`${err.message}. Call catalog without a name to list the sources.`)
            throw err
          }
          const sources = data.catalog
          if (args.entity) {
            const wanted = args.entity
            for (const source of sources) {
              const known = source.entities.map((e) => e.name)
              source.entities = source.entities.filter((e) => e.name === wanted)
              if (!source.entities.length) throw new ToolError(`${source.name} has no entity "${wanted}". Its entities: ${known.join(', ')}.`)
            }
          }
          return fit({ sources }, 'sources', maxBytes, 'Ask for one entity with the entity argument.')
        }

        const data = await run(schema, DOCUMENTS.catalogSummary, { category: args.category, driver: args.driver })
        const words = (args.search || '').toLowerCase().split(/\s+/).filter(Boolean)
        const sources = data.catalog
          .filter((source) => {
            if (!words.length) return true
            const haystack = [source.name, source.label, source.description, source.category, ...source.entities.flatMap((e) => [e.name, e.description])]
              .filter(Boolean).join(' ').toLowerCase()
            return words.every((word) => haystack.includes(word))
          })
          .map(summarise)
        return fit({ sources }, 'sources', maxBytes, 'Narrow it with search or category.')
      }
    },

    {
      name: 'query',
      title: 'Query a data source',
      description: `Read rows from a catalog source or a database. Give source (a name from catalog) or connection, and from (an entity). where filters by the entity's parameters or columns; include follows relations the catalog declares (names from the catalog's relations and links, "a.b" goes deeper), including to other sources, so one call can join databases by shared identifier. Returns at most ${DEFAULT_LIMIT} rows unless limit says otherwise, and the answer is capped in size: narrow with where, select and limit. Some sources are slow; repeat calls are cheap only if the server caches results.`,
      inputSchema: {
        type: 'object',
        properties: {
          source: str('A catalog source name, e.g. "uniprot"'),
          connection,
          from: str('The entity, table or path to read, e.g. "gene" (see catalog)', { minLength: 1 }),
          select: { type: 'array', items: { type: 'string' }, description: 'Fields to return (default all)' },
          where: { type: 'object', description: 'Filter {name: value, …}. For a catalog source, the entity\'s parameters.' },
          include: { type: 'array', items: { type: 'string' }, description: 'Catalog relations to include by name, e.g. ["structures", "pathways.events", "pdbe/bestStructures"]' },
          relations: { type: 'array', items: relation, description: 'Relations declared by hand, for databases without a catalog entry' },
          link: { type: 'array', maxItems: 5, items: link },
          apiKeys: { type: 'object', additionalProperties: { type: 'string' }, description: 'API keys by source name' },
          raw: { type: 'boolean', description: 'Return records as the source sent them' },
          fresh: { type: 'boolean', description: 'Read live data even if the server caches results' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows to return (default ${DEFAULT_LIMIT})` },
          offset: { type: 'integer', minimum: 0 },
          orderBy: str('Field to sort by'),
          orderDirection: { type: 'string', enum: ['asc', 'desc'] }
        },
        required: ['from'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          data: { type: 'array' },
          meta: { type: 'object' },
          truncated: { type: 'boolean' },
          returned: { type: 'integer' },
          note: { type: 'string' }
        },
        required: ['count', 'data']
      },
      annotations: { title: 'Query a data source', ...READ, openWorldHint: true },
      async run (args) {
        if (!args.source && !args.connection) {
          throw new ToolError('Give either source (a catalog source name; see the catalog tool) or connection.')
        }
        const input = { ...args, limit: args.limit == null ? DEFAULT_LIMIT : args.limit }
        const { query } = await run(schema, DOCUMENTS.query, { input })
        const result = { count: query.count, data: query.data }
        if (query.meta != null) result.meta = query.meta
        if (!Array.isArray(result.data)) return result
        return fit(result, 'data', maxBytes, 'Narrow it with where, select or a smaller limit.')
      }
    },

    {
      name: 'introspect',
      title: 'Describe a database\'s tables',
      description: 'List the tables, node labels or entities of a database and their columns, with types and primary keys. Give source (a catalog source) or connection. For catalog sources the catalog tool is usually more useful: it also says which identifiers the fields carry.',
      inputSchema: {
        type: 'object',
        properties: { source: str('A catalog source name'), connection },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: { tables: { type: 'array' }, truncated: { type: 'boolean' }, note: { type: 'string' } },
        required: ['tables']
      },
      annotations: { title: 'Describe a database\'s tables', ...READ, openWorldHint: true },
      async run (args) {
        if (!args.source && !args.connection) throw new ToolError('Give either source or connection.')
        const { introspect } = await run(schema, DOCUMENTS.introspect, { source: args.source, connection: args.connection })
        return fit({ tables: introspect.tables }, 'tables', maxBytes, 'Query a smaller database, or use the catalog tool.')
      }
    },

    {
      name: 'obo_keys',
      title: 'List identifier spaces',
      description: 'The identifier spaces (OBO keys) Mozg understands, such as uniprot, ensembl, mondo, chebi or hp: the Bioregistry prefix, how an identifier is written and its pattern. Two fields or parameters that carry the same key and the same value name the same thing; that is how `query` joins databases.',
      inputSchema: {
        type: 'object',
        properties: { search: str('Part of a key, label or prefix') },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: { keys: { type: 'array' }, truncated: { type: 'boolean' }, note: { type: 'string' } },
        required: ['keys']
      },
      annotations: { title: 'List identifier spaces', ...READ, openWorldHint: false },
      async run (args) {
        const { oboKeys } = await run(schema, DOCUMENTS.oboKeys)
        const needle = (args.search || '').toLowerCase()
        const keys = oboKeys.filter((k) => !needle || [k.key, k.label, k.prefix].some((text) => String(text).toLowerCase().includes(needle)))
        return fit({ keys }, 'keys', maxBytes, 'Narrow it with search.')
      }
    },

    {
      name: 'ontologies',
      title: 'List configured ontologies',
      description: 'The ontologies this server was set up to link values to (for example MONDO or HPO), and whether each has loaded. Use a name from this list as the ontology of ontology_terms or of a link in query.',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: {
        type: 'object',
        properties: { ontologies: { type: 'array' } },
        required: ['ontologies']
      },
      annotations: { title: 'List configured ontologies', ...READ, openWorldHint: false },
      async run () {
        const { ontologies } = await run(schema, DOCUMENTS.ontologies)
        return { ontologies }
      }
    },

    {
      name: 'ontology_terms',
      title: 'Search ontology terms',
      description: 'Find terms of an ontology by label, synonym, identifier or cross-reference, e.g. "type 2 diabetes" or "MONDO:0005148". Name a configured ontology (see ontologies) or give the url of one. Returns identifier, label, synonyms, definition, cross-references and parents.',
      inputSchema: {
        type: 'object',
        properties: {
          search: str('What to look for', { minLength: 1 }),
          ontology: str('A configured ontology'),
          url: str('Or an ontology fetched from a URL'),
          format: { type: 'string', enum: termFormats, description: 'Serialization of url; detected when omitted' },
          match: { type: 'array', items: { type: 'string', enum: ontologyMatches }, description: 'How a value may name a term, tried in order (default id, label, synonym, xref)' },
          limit: { type: 'integer', minimum: 1, maximum: 100 }
        },
        required: ['search'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: { terms: { type: 'array' }, truncated: { type: 'boolean' }, note: { type: 'string' } },
        required: ['terms']
      },
      annotations: { title: 'Search ontology terms', ...READ, openWorldHint: true },
      async run (args) {
        if (!args.ontology && !args.url) throw new ToolError('Name an ontology (see the ontologies tool) or give the url of one.')
        const { ontologyTerms } = await run(schema, DOCUMENTS.ontologyTerms, { limit: 10, ...args })
        return fit({ terms: ontologyTerms }, 'terms', maxBytes, 'Ask for fewer with limit.')
      }
    }
  ]
}

// ── Results ─────────────────────────────────────────────────────────────────

/**
 * A successful tool result.  The same data goes in structuredContent, for
 * clients that read it, and as text, which the specification asks of a tool
 * that returns structured content and which is what most models are shown.
 */
function success (structured) {
  return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured, isError: false }
}

/** A tool execution error: the model sees the message and may try again differently. */
function failure (message) {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Run a tool with the arguments a client sent.  Never throws: whatever goes
 * wrong is a result the model can read.
 */
async function callTool (tool, args) {
  const problems = validate(args, tool.inputSchema)
  if (problems.length) return failure(`Invalid arguments: ${problems.join('; ')}.`)
  try {
    return success(await tool.run(args))
  } catch (err) {
    return failure(redactCredentials(err instanceof Error ? err.message : String(err)))
  }
}

/** What tools/list shows: the definition without the code. */
function describe (tool) {
  const { run: _run, ...definition } = tool
  return definition
}

module.exports = { buildTools, callTool, describe, ToolError, DEFAULT_LIMIT, MAX_LIMIT }
