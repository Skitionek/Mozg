'use strict'

const {
  parse,
  execute,
  isObjectType,
  isScalarType,
  isEnumType,
  isNonNullType,
  isListType,
  isInputObjectType
} = require('graphql')
const { MeshStore, InMemoryStoreStorageAdapter } = require('@graphql-mesh/store')
const { PubSub, DefaultLogger } = require('@graphql-mesh/utils')

const { assertSafeCypherIdentifier } = require('./neo4j-identifiers')
const { patchNeo4jIntrospectorTypes } = require('./neo4j-types')
const { LruCache } = require('../../cache')
const { intOption, OPTIONS } = require('../../config')

/** Close a mesh source's connections (pools, sockets). */
async function disposeSource (source) {
  const dispose = source && source.executor && source.executor[Symbol.asyncDispose]
  if (typeof dispose === 'function') await dispose.call(source.executor)
}

// Cache: connection key → { schema, executor }.  Bounded and idle-expiring
// like the knex pools (MOZG_CONNECTION_CACHE_MAX, MOZG_CONNECTION_IDLE_MS):
// each entry holds a built schema and open connections, and its key is caller
// input.
const meshSourceCache = new LruCache({
  max: intOption('MOZG_CONNECTION_CACHE_MAX', OPTIONS.MOZG_CONNECTION_CACHE_MAX),
  ttlMs: intOption('MOZG_CONNECTION_IDLE_MS', OPTIONS.MOZG_CONNECTION_IDLE_MS),
  sliding: true,
  onEvict: disposeSource
})

// Sources handed in with registerMeshSource.  The embedder owns these, so the
// cache's eviction must never drop one.
const registeredMeshSources = new Map()

// ── Handler config builders ───────────────────────────────────────────────────

/**
 * Return `{ pkg, config }` for the given driver/connection.
 * `pkg`    – the @graphql-mesh/* handler package name
 * `config` – the handler-specific configuration object
 */
function buildHandlerDescriptor (driver, connection) {
  switch (driver) {
    case 'mysql':
      return {
        pkg: '@graphql-mesh/mysql',
        config: {
          host: connection.host || 'localhost',
          port: connection.port || 3306,
          database: connection.database,
          user: connection.user,
          password: connection.password || ''
        }
      }

    case 'neo4j':
      return {
        pkg: '@graphql-mesh/neo4j',
        config: {
          endpoint: `${connection.scheme || 'bolt'}://${connection.host || 'localhost'}:${connection.port || 7687}`,
          username: connection.user,
          password: connection.password || '',
          database: connection.database
        }
      }

    case 'openapi':
      return {
        pkg: '@graphql-mesh/openapi',
        config: {
          source: connection.database,
          ...(connection.host ? { endpoint: connection.host } : {})
        }
      }

    case 'soap':
      // The handler reads `source`, not `wsdl`.
      return {
        pkg: '@graphql-mesh/soap',
        config: { source: connection.database }
      }

    case 'odata':
      return {
        pkg: '@graphql-mesh/odata',
        config: { endpoint: connection.database }
      }

    case 'thrift':
      // The handler loads the IDL from `idl` and assembles its own endpoint
      // from hostName/port/path — it never reads `endpoint`.
      return {
        pkg: '@graphql-mesh/thrift',
        config: {
          idl: connection.database,
          hostName: connection.host || 'localhost',
          port: connection.port || 9090,
          path: connection.path || '',
          https: connection.scheme === 'https'
        }
      }

    default:
      throw new Error(`No mesh handler available for driver: ${driver}`)
  }
}

// ── Mesh source factory ───────────────────────────────────────────────────────

/** Everything a handler is built from, except the password. */
function connectionIdentity (connection) {
  const { driver, host, port, database, user, path, scheme } = connection
  return { driver, host, port, database, user, path, scheme }
}

/**
 * The cache key for a connection's mesh source: everything the handler is
 * built from, the password included.  Leaving the password out let a request
 * with the wrong password ride on a source another caller had already
 * authenticated (demonstrated against MySQL: a bad password still returned
 * rows).  The key lives only in this process's memory, beside the connection
 * object and source that hold the same password already.  path and scheme
 * matter because the thrift handler builds its endpoint from them.
 */
function cacheKeyFor (connection) {
  return JSON.stringify({ ...connectionIdentity(connection), password: connection.password || '' })
}

/**
 * The Neo4j transport opens its driver with `useBigInt`, so integer
 * properties arrive as native BigInts — which the BigInt scalar of the
 * @neo4j/graphql it executes with cannot serialize ("BigInt cannot represent
 * value: 1"): no node with an integer property could be read.  Teach that
 * scalar BigInts: a number while it is a safe integer, else a string (as it
 * returns driver Integers).  Done before the first Neo4j schema is built,
 * which copies the scalar's functions.
 */
let neo4jBigIntPatched = false
function patchNeo4jBigInt () {
  if (neo4jBigIntPatched) return
  neo4jBigIntPatched = true
  try {
    const path = require('node:path')
    const transport = path.dirname(require.resolve('@graphql-mesh/transport-neo4j'))
    const neo4jGraphql = require.resolve('@neo4j/graphql', { paths: [transport] })
    const { GraphQLBigInt } = require(path.join(path.dirname(neo4jGraphql), 'graphql', 'scalars', 'BigInt.js'))
    const serialize = GraphQLBigInt.serialize
    GraphQLBigInt.serialize = (value) => typeof value === 'bigint' ? bigIntOutput(value) : serialize.call(GraphQLBigInt, value)
  } catch {
    // A different layout of the Neo4j transport: leave its scalar alone.
  }
}

/** A BigInt as a JSON value: a number while it is a safe integer, else a string. */
function bigIntOutput (value) {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
}

async function getOrCreateMeshSource (connection) {
  const { driver } = connection
  const cacheKey = cacheKeyFor(connection)

  if (registeredMeshSources.has(cacheKey)) return registeredMeshSources.get(cacheKey)
  meshSourceCache.prune()
  const cached = meshSourceCache.get(cacheKey)
  if (cached) return cached
  if (driver === 'neo4j') {
    patchNeo4jBigInt()
    patchNeo4jIntrospectorTypes()
  }

  const { pkg, config } = buildHandlerDescriptor(driver, connection)
  const HandlerClass = require(pkg).default

  const storage = new InMemoryStoreStorageAdapter()
  // Named without the password: handlers may log their store's name.
  const store = new MeshStore(
    `${driver}/${JSON.stringify(connectionIdentity(connection))}`,
    storage,
    { readonly: false, validate: false }
  )

  const pubsub = new PubSub()
  const logger = new DefaultLogger(driver)

  const handler = new HandlerClass({
    name: driver,
    config,
    baseDir: '/',
    store,
    pubsub,
    logger,
    importFn: (mod) => import(mod)
  })

  const source = await handler.getMeshSource({ fetchFn: globalThis.fetch })
  meshSourceCache.set(cacheKey, source)
  return source
}

/**
 * Use a ready-built mesh source for a connection instead of building one from
 * its handler — for embedding Mozg in front of an existing executable schema,
 * and for exercising this adapter against a schema of a known shape.
 * @returns {Function} removes the registration again
 */
function registerMeshSource (connection, source) {
  const cacheKey = cacheKeyFor(connection)
  registeredMeshSources.set(cacheKey, source)
  return () => registeredMeshSources.delete(cacheKey)
}

// ── Schema helpers ────────────────────────────────────────────────────────────

/** Fully unwrap NonNull/List wrappers and return the named type. */
function unwrap (type) {
  while (isNonNullType(type) || isListType(type)) type = type.ofType
  return type
}

/** Return whether the root of the wrapping chain contains a List. */
function wrapsList (type) {
  if (isListType(type)) return true
  if (isNonNullType(type)) return wrapsList(type.ofType)
  return false
}

/** Return the leaf field names (scalar / enum) for a named object type. */
function getLeafFields (schema, typeName) {
  const type = schema.getType(typeName)
  if (!type || !isObjectType(type)) return []
  return Object.entries(type.getFields())
    .filter(([, f]) => {
      const named = unwrap(f.type)
      // A field that needs an argument (an OData action, a computed field)
      // cannot be selected without one, so it is not a column.
      const needsArgs = (f.args || []).some((a) => isNonNullType(a.type) && a.defaultValue === undefined)
      return (isScalarType(named) || isEnumType(named)) && !needsArgs
    })
    .map(([name]) => name)
}

/**
 * Find the Query field name that corresponds to a given entity name.
 * Strategies tried in order:
 *   1. Exact match                (MySQL:  `users`)
 *   2. `all` + PascalCase prefix  (PostGraphile: `allUsers`)
 *   3. Case-insensitive exact     (Neo4j label casing)
 *   4. Case-insensitive `all` prefix
 *   5. The list field of the type named so (a Neo4j node label: `Pathway`
 *      for the handler's `pathways`)
 *   6. A generated operation name ending in `_<entity>` (SOAP)
 */
function findQueryField (queryFields, entityName) {
  if (queryFields[entityName]) return entityName

  const pascal = entityName.charAt(0).toUpperCase() + entityName.slice(1)
  if (queryFields['all' + pascal]) return 'all' + pascal

  const lower = entityName.toLowerCase()
  const ci = Object.keys(queryFields).find(
    (f) => f.toLowerCase() === lower || f.toLowerCase() === 'all' + lower
  )
  if (ci) return ci

  // An entity named after its rows' type rather than the field: @neo4j/graphql
  // pluralises labels into field names (Pathway -> pathways,
  // ReferenceGeneProduct -> referenceGeneProducts), so a catalog naming its
  // entities after the labels is matched here.  Single-row lookups returning
  // the same type are not lists and are left alone.
  const byType = Object.keys(queryFields).find((f) => {
    const type = queryFields[f].type
    return unwrap(type).name === entityName && wrapsList(type)
  })
  if (byType) return byType

  // Generated operation names (SOAP: Service_Service_Port_Operation): accept
  // the bare operation name when it identifies one operation, preferring the
  // first port that offers it.
  const suffixed = Object.keys(queryFields).filter((f) => f.toLowerCase().endsWith('_' + lower))
  return suffixed[0] || null
}

/** The bare operation name of a generated field name (SOAP), else the name itself. */
function shortName (fieldName) {
  const parts = fieldName.split('_')
  return parts.length > 2 ? parts[parts.length - 1] : fieldName
}

/** Return true when `typeName` is a Relay-style connection (has `nodes`). */
function isConnectionType (schema, typeName) {
  const type = schema.getType(typeName)
  if (!type || !isObjectType(type)) return false
  return 'nodes' in type.getFields()
}

/** Return the node type name from a connection type. */
function getConnectionNodeTypeName (schema, connectionTypeName) {
  const type = schema.getType(connectionTypeName)
  if (!type || !isObjectType(type)) return null
  const nodesField = type.getFields().nodes
  if (!nodesField) return null
  return unwrap(nodesField.type).name
}

/** Return the named return type of a field. */
function getReturnTypeName (field) {
  return unwrap(field.type).name
}

/** Return the first arg whose name matches one of the given candidates. */
function findArg (args, ...names) {
  for (const name of names) {
    const found = args.find((a) => a.name === name)
    if (found) return found
  }
  return null
}

/**
 * Return true when `name` is a syntactically valid GraphQL name.
 * GraphQL names must match /^[_A-Za-z][_0-9A-Za-z]*$/ (spec §2.1.9).
 * Used to reject user-supplied field names that contain injection characters
 * before they are interpolated into a raw GraphQL query string.
 */
function isValidGraphQLName (name) {
  return typeof name === 'string' && /^[_A-Za-z][_0-9A-Za-z]*$/.test(name)
}

// ── Argument values ───────────────────────────────────────────────────────────
//
// Every value a caller supplies travels as a GraphQL *variable*, coerced to the
// type the handler's schema declares for it.  Handlers disagree about those
// types — the MySQL handler types every `where` field as String, the Neo4j
// handler (@neo4j/graphql 7) wants operator objects such as `{ id: { eq: 1 } }`
// and sorts with `sort: [{ name: DESC }]` — so the schema, not a guess, decides
// the shape.  Only field names reach the query text, and only after they have
// been checked against the schema.

const EQUALITY_OPERATORS = ['eq', 'equals', '_eq', 'equalTo', 'EQ']

/** Coerce a plain value to a scalar or enum input type. */
function coerceLeaf (named, value) {
  if (value == null) return null
  if (isEnumType(named)) return String(value)
  switch (named.name) {
    case 'String':
    case 'ID':
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
    case 'Int': {
      const n = Number.parseInt(value, 10)
      if (Number.isNaN(n)) throw new Error(`"${value}" is not an integer`)
      return n
    }
    case 'Float': {
      const n = Number(value)
      if (Number.isNaN(n)) throw new Error(`"${value}" is not a number`)
      return n
    }
    case 'Boolean':
      return value === true || value === 'true' || value === 1 || value === '1'
    case 'BigInt': {
      // @neo4j/graphql takes BigInt variables only as strings.
      const text = String(value)
      if (!/^-?\d+$/.test(text)) throw new Error(`"${value}" is not an integer`)
      return text
    }
    default:
      // Custom scalars (BigInt, DateTime, …) parse their own input.
      return value
  }
}

/**
 * Coerce a caller's `where` value for one field to the field's input type.
 * A plain value given to an operator-object type means equality.
 */
function coerceWhereValue (type, value, path) {
  const named = unwrap(type)
  if (isInputObjectType(named)) {
    const fields = named.getFields()
    const isOperatorObject = value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).every((k) => Object.hasOwn(fields, k))
    if (isOperatorObject) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, coerceWhereValue(fields[k].type, v, `${path}.${k}`)]))
    }
    const op = EQUALITY_OPERATORS.find((o) => Object.hasOwn(fields, o))
    if (!op) throw new Error(`where.${path} needs one of: ${Object.keys(fields).join(', ')}`)
    return { [op]: coerceWhereValue(fields[op].type, value, `${path}.${op}`) }
  }
  if (isListType(isNonNullType(type) ? type.ofType : type)) {
    return [].concat(value).map((v) => coerceLeaf(named, v))
  }
  try {
    return coerceLeaf(named, value)
  } catch (err) {
    throw new Error(`where.${path}: ${err.message}`, { cause: err })
  }
}

/** The `where` variable for a query, checked and coerced against its input type. */
function buildWhere (whereArg, where, entityName) {
  const inputType = unwrap(whereArg.type)
  if (!isInputObjectType(inputType)) return where
  const fields = inputType.getFields()
  const out = {}
  for (const [key, value] of Object.entries(where)) {
    if (!Object.hasOwn(fields, key)) {
      const filterable = Object.keys(fields).filter((k) => !/_(EQ|IN|LT|LTE|GT|GTE|CONTAINS|STARTS_WITH|ENDS_WITH|MATCHES|INCLUDES)$/.test(k) && !['AND', 'OR', 'NOT'].includes(k))
      throw new Error(`Cannot filter "${entityName}" by "${key}". Filterable fields: ${filterable.join(', ')}`)
    }
    out[key] = coerceWhereValue(fields[key].type, value, key)
  }
  return out
}

/** The enum value naming a direction (asc/ASC/Asc), or null. */
function directionValue (enumType, direction) {
  const wanted = (direction || 'asc').toLowerCase()
  const match = enumType.getValues().find((v) => v.name.toLowerCase() === wanted)
  return match ? match.name : null
}

/**
 * The ordering variable for the handler's ordering argument:
 *  - input object       (MySQL):        { field: asc }
 *  - list of objects    (Neo4j):        [{ field: DESC }]
 *  - enum / enum list   (PostGraphile): FIELD_ASC / [FIELD_ASC]
 */
function buildOrderBy (arg, fieldName, direction) {
  const named = unwrap(arg.type)
  const isList = wrapsList(arg.type)

  if (isInputObjectType(named)) {
    const field = named.getFields()[fieldName]
    if (!field) return null
    const dirType = unwrap(field.type)
    const value = isEnumType(dirType) ? directionValue(dirType, direction) : (direction || 'asc')
    if (value == null) return null
    return isList ? [{ [fieldName]: value }] : { [fieldName]: value }
  }

  if (isEnumType(named)) {
    const target = `${fieldName}_${direction || 'asc'}`.toLowerCase()
    const found = named.getValues().find((v) => v.name.toLowerCase() === target)
    if (!found) return null
    return isList ? [found.name] : found.name
  }

  return null
}

/** Coerce a value to any input type (direct operation arguments). */
function coerceInput (type, value, path) {
  const named = unwrap(type)
  if (value == null) return null
  if (isInputObjectType(named) && typeof value === 'object' && !Array.isArray(value)) {
    const fields = named.getFields()
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (!Object.hasOwn(fields, k)) throw new Error(`${path} has no field "${k}". Fields: ${Object.keys(fields).join(', ')}`)
      out[k] = coerceInput(fields[k].type, v, `${path}.${k}`)
    }
    return out
  }
  if (isListType(isNonNullType(type) ? type.ofType : type)) {
    return [].concat(value).map((v) => coerceInput(named, v, path))
  }
  if (isEnumType(named)) {
    const match = named.getValues().find((v) => v.name.toLowerCase() === String(value).toLowerCase() || String(v.value).toLowerCase() === String(value).toLowerCase())
    if (!match) throw new Error(`${path} must be one of: ${named.getValues().map((v) => v.name).join(', ')}`)
    return match.name
  }
  try {
    return coerceLeaf(named, value)
  } catch (err) {
    throw new Error(`${path}: ${err.message}`, { cause: err })
  }
}

/**
 * Operations that take their inputs as plain arguments (OpenAPI paths, OData
 * functions, SOAP operations) rather than a `where` filter: map where keys
 * onto those arguments, or into the single input object that wraps them.
 */
function bindDirectArgs (args, where, entityName, bind) {
  const remaining = { ...where }
  for (const arg of args) {
    if (Object.hasOwn(remaining, arg.name)) {
      bind(arg, coerceInput(arg.type, remaining[arg.name], arg.name))
      delete remaining[arg.name]
    }
  }

  const leftover = Object.keys(remaining)
  if (leftover.length > 0) {
    const wrappers = args.filter((a) => isInputObjectType(unwrap(a.type)))
    const wrapper = wrappers.length === 1 ? wrappers[0] : null
    const fields = wrapper ? unwrap(wrapper.type).getFields() : {}
    if (!wrapper || !leftover.every((k) => Object.hasOwn(fields, k))) {
      const accepted = [...args.map((a) => a.name), ...Object.keys(fields)]
      throw new Error(`"${entityName}" does not accept ${leftover.map((k) => `"${k}"`).join(', ')}. Accepted: ${accepted.join(', ') || '(none)'}`)
    }
    bind(wrapper, coerceInput(wrapper.type, remaining, wrapper.name))
  }

  const missing = args.filter((a) => isNonNullType(a.type) && a.defaultValue === undefined && !Object.hasOwn(where, a.name) &&
    !(isInputObjectType(unwrap(a.type)) && leftover.length > 0))
  if (missing.length > 0) {
    throw new Error(`"${entityName}" requires where.${missing.map((a) => a.name).join(', where.')}`)
  }
}

/** An OData literal: strings quoted with embedded quotes doubled. */
function odataLiteral (value) {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * OData's system query options ($top, $skip, $orderby, $filter) as the
 * OData handler's `queryOptions` input, so paging, ordering and equality
 * filters happen on the server — OData services page their collections,
 * and doing any of these here would only see the first page.
 */
function buildODataOptions (allLeaf, { where, limit, offset, orderBy, orderDirection }, entityName) {
  const options = {}
  if (limit != null) options.top = limit
  if (offset) options.skip = offset
  if (orderBy) options.orderby = `${orderBy} ${(orderDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'}`
  if (where && Object.keys(where).length > 0) {
    options.filter = Object.entries(where).map(([k, v]) => {
      if (!allLeaf.includes(k)) throw new Error(`Cannot filter "${entityName}" by "${k}". Filterable fields: ${allLeaf.join(', ')}`)
      return `${k} eq ${odataLiteral(v)}`
    }).join(' and ')
  }
  return options
}

/** Order rows by a field, nulls last, for handlers that cannot order. */
function sortRows (rows, field, direction) {
  const sign = (direction || 'asc').toLowerCase() === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = a[field]
    const y = b[field]
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sign
  })
}

// ── Query execution ───────────────────────────────────────────────────────────

/** Execute a GraphQL document against a mesh source. */
async function runQuery (source, queryStr, variables = {}) {
  const document = parse(queryStr)
  const context = Object.create(null)

  if (source.executor) {
    return source.executor({ document, variables, context })
  }
  return execute({ schema: source.schema, document, variableValues: variables, contextValue: context })
}

async function executeQuery (input) {
  const {
    connection,
    from,
    select,
    where,
    relations,
    limit,
    offset,
    orderBy,
    orderDirection
  } = input

  if (connection?.driver === 'neo4j') {
    // Labels and keys reach Cypher through the Neo4j handler; reject anything
    // that is not a plain identifier before it gets that far.
    assertSafeCypherIdentifier(from)
    if (relations && relations.length > 0) {
      for (const rel of relations) {
        if (rel.catalog) continue
        assertSafeCypherIdentifier(rel.entity)
        assertSafeCypherIdentifier(rel.foreignKey)
        if (rel.alias != null) assertSafeCypherIdentifier(rel.alias)
      }
    }
  }

  const source = await getOrCreateMeshSource(connection)
  const { schema } = source

  const queryType = schema.getQueryType()
  if (!queryType) throw new Error('Mesh schema has no Query type')

  // SOAP has no read/write distinction, so the SOAP handler exposes every
  // operation as a mutation; for that driver alone, naming an operation in
  // `from` runs it.  Every other driver is read-only through Mozg.
  const rootType = connection?.driver === 'soap' ? (schema.getMutationType() || queryType) : queryType
  const operation = rootType === queryType ? 'query' : 'mutation'

  const queryFields = rootType.getFields()
  const fieldName = findQueryField(queryFields, from)
  if (!fieldName) {
    const known = Object.keys(queryFields).filter((f) => !/^count_|Connection$|Aggregate$|^placeholder$/.test(f)).map(shortName).join(', ')
    throw new Error(`No query field found for entity "${from}". Available: ${known}`)
  }

  const field = queryFields[fieldName]
  const args = field.args || []
  const returnTypeName = getReturnTypeName(field)
  const isConn = isConnectionType(schema, returnTypeName)
  const entityTypeName = isConn
    ? getConnectionNodeTypeName(schema, returnTypeName)
    : returnTypeName
  if (!entityTypeName) throw new Error(`Cannot determine entity type for "${from}"`)

  // A field returning a scalar (a count, a JSON blob, a SOAP string) has no
  // selection set; each value becomes a row of { value }.
  const returnsScalar = !isObjectType(schema.getType(entityTypeName))

  // Build selection set from schema-checked leaf names only
  const allLeaf = returnsScalar ? [] : getLeafFields(schema, entityTypeName)
  const selectedFields =
    select && select.length > 0 ? select.filter((f) => allLeaf.includes(f)) : allLeaf
  if (!returnsScalar && selectedFields.length === 0) {
    throw new Error(`No selectable scalar fields for entity "${from}"`)
  }

  const varDefs = []
  const argParts = []
  const variables = {}
  const bind = (arg, value) => {
    variables[arg.name] = value
    varDefs.push(`$${arg.name}: ${String(arg.type)}`)
    argParts.push(`${arg.name}: $${arg.name}`)
  }

  // @graphql-mesh/transport-mysql renders `LIMIT ${limit},${offset}`, which
  // MySQL reads as offset-then-count — the two arrive swapped — and it drops
  // zeros.  For MySQL, ask only for a row count and skip the offset here.
  const skipHere = connection?.driver === 'mysql' && offset ? offset : 0

  // Paging and ordering the handler cannot do are done here instead, so the
  // same query means the same thing on every driver.
  let pageHere = false
  let sortHere = false

  if (orderBy && !allLeaf.includes(orderBy)) {
    throw new Error(`orderBy field "${orderBy}" is not a valid field for entity "${from}"`)
  }

  const odataOptions = connection?.driver === 'odata' && findArg(args, 'queryOptions')
  if (odataOptions) {
    const options = buildODataOptions(allLeaf, { where, limit, offset, orderBy, orderDirection }, from)
    if (Object.keys(options).length > 0) bind(odataOptions, options)
  } else {
    const limitArg = findArg(args, 'limit', 'first')
    const offsetArg = findArg(args, 'offset', 'skip')
    if ((limit != null && !limitArg) || (offset && !offsetArg)) pageHere = true
    if (!pageHere) {
      if (limitArg && limit != null) bind(limitArg, limit + skipHere)
      if (offsetArg && offset != null && !skipHere) bind(offsetArg, offset)
    }

    if (where && Object.keys(where).length > 0) {
      for (const k of Object.keys(where)) {
        if (!isValidGraphQLName(k)) {
          throw new Error(`Invalid where field name "${k}" for entity "${from}"`)
        }
      }
      const whereArg = findArg(args, 'where', 'condition', 'filter')
      if (whereArg) bind(whereArg, buildWhere(whereArg, where, from))
      else bindDirectArgs(args.filter((a) => !varDefs.some((d) => d.startsWith(`$${a.name}:`))), where, from, bind)
    } else {
      bindDirectArgs(args.filter((a) => !varDefs.some((d) => d.startsWith(`$${a.name}:`))), {}, from, bind)
    }

    if (orderBy) {
      const orderArg = findArg(args, 'orderBy', 'sort', 'order_by')
      const value = orderArg && buildOrderBy(orderArg, orderBy, orderDirection)
      if (value != null && !pageHere) bind(orderArg, value)
      else sortHere = true
    }
  }

  const argsStr = argParts.length > 0 ? `(${argParts.join(', ')})` : ''
  const defsStr = varDefs.length > 0 ? `(${varDefs.join(', ')})` : ''
  const selSet = selectedFields.join(' ')
  const selection = returnsScalar ? '' : (isConn ? `{ nodes { ${selSet} } totalCount }` : `{ ${selSet} }`)

  // Named: some executors (Thrift) index operations by name and fail on anonymous ones.
  const queryStr = `${operation} Mozg${defsStr} { ${fieldName}${argsStr} ${selection} }`

  const result = await runQuery(source, queryStr, variables)

  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors.map((e) => e.message).join('; '))
  }

  const rawData = result.data?.[fieldName]
  let rows
  if (isConn) {
    rows = rawData?.nodes ?? []
  } else {
    rows = Array.isArray(rawData) ? rawData : rawData != null ? [rawData] : []
  }
  // Handlers may return their own result objects; give callers plain ones.
  rows = rows.map((row) => (returnsScalar || row === null || typeof row !== 'object' ? { value: row } : { ...row }))
  if (skipHere) rows = rows.slice(skipHere)
  if (sortHere) rows = sortRows(rows, orderBy, orderDirection)
  if (pageHere) rows = rows.slice(offset || 0, limit != null ? (offset || 0) + limit : undefined)

  if (relations && relations.length > 0 && rows.length > 0) {
    await loadRelations(connection, rows, relations)
  }

  return { data: rows, count: rows.length }
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimited (items, limit, fn) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * Load related entities with one mesh query per parent row.  The handlers'
 * filter types do not share an `in` operator (MySQL's are plain equality), so
 * rows cannot be batched generically; they are fetched a few at a time
 * instead of one after another.
 */
async function loadRelations (connection, rows, relations) {
  for (const rel of relations) {
    // A relation naming another catalog entry has no local source to join
    // against; hand it to the connector, which knows how to resolve it
    // against the connection that catalog entry actually names.
    if (rel.catalog) {
      const { resolveCrossCatalogRelation } = require('../relations')
      const connector = require('../connector')
      await resolveCrossCatalogRelation(connector.executeQuery, rows, rel)
      continue
    }

    const {
      entity,
      localKey = 'id',
      foreignKey,
      ownerKey = 'id',
      alias,
      type = 'hasMany',
      select: relSelect,
      where: relWhere,
      limit: relLimit,
      relations: nested
    } = rel
    const resultKey = alias || entity

    await mapLimited(rows, 4, async (row) => {
      const isBelongsTo = type === 'belongsTo'
      const value = isBelongsTo ? row[foreignKey] : row[localKey]
      if (value == null) {
        row[resultKey] = type === 'hasMany' ? [] : null
        return
      }
      try {
        const { data: relData } = await executeQuery({
          connection,
          from: entity,
          select: relSelect,
          where: { ...relWhere, [isBelongsTo ? ownerKey : foreignKey]: value },
          limit: type === 'hasMany' ? relLimit : 1,
          relations: nested
        })
        row[resultKey] = type === 'hasMany' ? relData : (relData[0] ?? null)
      } catch (err) {
        row[resultKey] = { error: `relation fetch failed for ${entity}: ${err.message}` }
      }
    })
  }
}

/** Close every cached source's connections (pools, sockets). */
async function destroyAll () {
  const sources = [...meshSourceCache.drain(), ...registeredMeshSources.values()]
  registeredMeshSources.clear()
  for (const source of sources) await disposeSource(source)
}

// ── Introspection ─────────────────────────────────────────────────────────────

async function introspect (connection) {
  const source = await getOrCreateMeshSource(connection)
  const { schema } = source

  const rootType = connection.driver === 'soap' ? (schema.getMutationType() || schema.getQueryType()) : schema.getQueryType()
  if (!rootType) return { tables: [] }

  const tables = []
  const fields = rootType.getFields()
  const seen = new Set()

  // Every entry point is a table: `People` and `Me` both return Person but are
  // different things to query.  Relay/aggregate twins of a plain list field
  // (Neo4j's usersConnection / usersAggregate) are the same table again.
  for (const [fieldName, field] of Object.entries(fields)) {
    const twin = fieldName.match(/^(.+?)(Connection|Aggregate)$/)
    if (twin && fields[twin[1]]) continue

    const returnTypeName = getReturnTypeName(field)
    const isConn = isConnectionType(schema, returnTypeName)
    const entityTypeName = isConn
      ? getConnectionNodeTypeName(schema, returnTypeName)
      : returnTypeName

    const type = entityTypeName && schema.getType(entityTypeName)
    if (!type || !isObjectType(type)) continue

    const name = connection.driver === 'soap' ? shortName(fieldName) : fieldName
    if (seen.has(name)) continue
    seen.add(name)

    const leaf = new Set(getLeafFields(schema, entityTypeName))
    const columns = Object.entries(type.getFields())
      .filter(([colName]) => leaf.has(colName))
      .map(([colName, f]) => ({
        name: colName,
        type: unwrap(f.type).name,
        nullable: !isNonNullType(f.type),
        defaultValue: null,
        isPrimaryKey: colName === 'id'
      }))

    tables.push({ name, columns })
  }

  return { tables }
}

module.exports = { bigIntOutput, patchNeo4jBigInt, executeQuery, introspect, destroyAll, registerMeshSource, isValidGraphQLName, buildHandlerDescriptor, buildWhere, buildOrderBy }
