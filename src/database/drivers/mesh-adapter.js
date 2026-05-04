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

// Cache: connection key → { schema, executor }
// TODO: add LRU eviction to prevent unbounded growth in long-running processes
const meshSourceCache = new Map()

// ── Handler config builders ───────────────────────────────────────────────────

function buildPostgresUrl (c) {
  const user = encodeURIComponent(c.user || '')
  const pass = c.password ? `:${encodeURIComponent(c.password)}` : ''
  const host = c.host || 'localhost'
  const port = c.port || 5432
  return `postgres://${user}${pass}@${host}:${port}/${c.database}`
}

/**
 * Return `{ pkg, config }` for the given driver/connection.
 * `pkg`    – the @graphql-mesh/* handler package name
 * `config` – the handler-specific configuration object
 */
function buildHandlerDescriptor (driver, connection) {
  switch (driver) {
    case 'postgres':
      return {
        pkg: '@graphql-mesh/postgraphile',
        config: { connectionString: buildPostgresUrl(connection) }
      }

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
      return {
        pkg: '@graphql-mesh/soap',
        config: { wsdl: connection.database }
      }

    case 'odata':
      return {
        pkg: '@graphql-mesh/odata',
        config: { endpoint: connection.database }
      }

    case 'thrift':
      return {
        pkg: '@graphql-mesh/thrift',
        config: { endpoint: connection.database }
      }

    case 'mongodb':
      return {
        pkg: '@graphql-mesh/mongoose',
        config: { connectionString: connection.database }
      }

    default:
      throw new Error(`No mesh handler available for driver: ${driver}`)
  }
}

// ── Mesh source factory ───────────────────────────────────────────────────────

async function getOrCreateMeshSource (connection) {
  const { driver, host, port, database, user } = connection
  // Key excludes password intentionally (same deferred concern as the legacy
  // sql.js driver – tracked as a TODO; same-user different-password connections
  // may reuse the same cached source).
  const cacheKey = JSON.stringify({ driver, host, port, database, user })

  if (meshSourceCache.has(cacheKey)) return meshSourceCache.get(cacheKey)

  const { pkg, config } = buildHandlerDescriptor(driver, connection)
  const HandlerClass = require(pkg).default

  const storage = new InMemoryStoreStorageAdapter()
  const store = new MeshStore(
    `${driver}/${cacheKey}`,
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
      return isScalarType(named) || isEnumType(named)
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
 */
function findQueryField (queryFields, entityName) {
  if (queryFields[entityName]) return entityName

  const pascal = entityName.charAt(0).toUpperCase() + entityName.slice(1)
  if (queryFields['all' + pascal]) return 'all' + pascal

  const lower = entityName.toLowerCase()
  const ci = Object.keys(queryFields).find(
    (f) => f.toLowerCase() === lower || f.toLowerCase() === 'all' + lower
  )
  return ci || null
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
 * Serialize a plain JS value as an inline GraphQL literal.
 * Strings are double-quoted; numbers/booleans/null are native;
 * objects become `{k: v, …}`; arrays become `[v, …]`.
 */
function toGQLLiteral (value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(toGQLLiteral).join(', ')}]`
  if (typeof value === 'object') {
    const fields = Object.entries(value)
      .map(([k, v]) => `${k}: ${toGQLLiteral(v)}`)
      .join(', ')
    return `{${fields}}`
  }
  return JSON.stringify(value)
}

/**
 * Build an orderBy literal for the most common handler patterns:
 *  - InputObject arg (MySQL):     `{fieldName: asc}`
 *  - Enum arg (PostGraphile):     `[FIELD_ASC]`   or  `FIELD_ASC`
 * Returns null when the format cannot be determined.
 */
function buildOrderByLiteral (arg, fieldName, direction) {
  if (!fieldName) return null

  const dir = (direction || 'asc').toLowerCase()
  const dirUpper = dir.toUpperCase()
  const isList = wrapsList(arg.type)
  const namedType = unwrap(arg.type)

  if (isInputObjectType(namedType)) {
    // MySQL style: {field: asc}  (asc/desc are enum values, no quotes)
    return `{${fieldName}: ${dir}}`
  }

  if (isEnumType(namedType)) {
    const target = `${fieldName.toUpperCase()}_${dirUpper}`
    const values = namedType.getValues().map((v) => v.name)
    const found = values.find((v) => v.toLowerCase() === target.toLowerCase())
    if (!found) return null
    return isList ? `[${found}]` : found
  }

  return null
}

// ── Query execution ───────────────────────────────────────────────────────────

/** Execute a raw GraphQL query string against a mesh source. */
async function runQuery (source, queryStr) {
  const document = parse(queryStr)
  const context = Object.create(null)

  if (source.executor) {
    return source.executor({ document, variables: {}, context })
  }
  return execute({ schema: source.schema, document, contextValue: context })
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
    // The Neo4j mesh handler builds Cypher queries internally and interpolates
    // some user-provided identifiers (e.g. labels and aliases). Reject unsafe
    // values early to prevent Cypher injection and malformed queries.
    assertSafeCypherIdentifier(from)
    if (relations && relations.length > 0) {
      for (const rel of relations) {
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

  const queryFields = queryType.getFields()
  const fieldName = findQueryField(queryFields, from)
  if (!fieldName) throw new Error(`No query field found for entity "${from}" in mesh schema`)

  const field = queryFields[fieldName]
  const args = field.args || []
  const returnTypeName = getReturnTypeName(field)
  const isConn = isConnectionType(schema, returnTypeName)
  const entityTypeName = isConn
    ? getConnectionNodeTypeName(schema, returnTypeName)
    : returnTypeName
  if (!entityTypeName) throw new Error(`Cannot determine entity type for "${from}"`)

  // Build selection set
  const allLeaf = getLeafFields(schema, entityTypeName)
  const selectedFields =
    select && select.length > 0 ? select.filter((f) => allLeaf.includes(f)) : allLeaf
  if (selectedFields.length === 0) {
    throw new Error(`No selectable scalar fields for entity "${from}"`)
  }

  // Build argument list
  const argParts = []

  const limitArg = findArg(args, 'limit', 'first')
  if (limitArg && limit != null) argParts.push(`${limitArg.name}: ${limit}`)

  const offsetArg = findArg(args, 'offset', 'skip')
  if (offsetArg && offset != null) argParts.push(`${offsetArg.name}: ${offset}`)

  if (where && Object.keys(where).length > 0) {
    const whereArg = findArg(args, 'where', 'condition', 'filter')
    if (whereArg) argParts.push(`${whereArg.name}: ${toGQLLiteral(where)}`)
  }

  if (orderBy) {
    const orderByArg = findArg(args, 'orderBy')
    if (orderByArg) {
      const literal = buildOrderByLiteral(orderByArg, orderBy, orderDirection)
      if (literal) argParts.push(`orderBy: ${literal}`)
    }
  }

  const argsStr = argParts.length > 0 ? `(${argParts.join(', ')})` : ''
  const selSet = selectedFields.join(' ')

  const queryStr = isConn
    ? `{ ${fieldName}${argsStr} { nodes { ${selSet} } totalCount } }`
    : `{ ${fieldName}${argsStr} { ${selSet} } }`

  const result = await runQuery(source, queryStr)

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

  if (relations && relations.length > 0 && rows.length > 0) {
    await loadRelations(connection, rows, relations)
  }

  return { data: rows, count: rows.length }
}

/** Load related entities via additional mesh queries (per-row N+1 pattern).
 * TODO: batch hasMany/hasOne fetches to avoid N+1 round-trips (same deferred
 * performance concern as rest.js). */
async function loadRelations (connection, rows, relations) {
  for (const rel of relations) {
    const {
      entity,
      localKey = 'id',
      foreignKey,
      alias,
      type = 'hasMany',
      select: relSelect,
      where: relWhere,
      relations: nested
    } = rel
    const resultKey = alias || entity

    if (type === 'hasMany' || type === 'hasOne') {
      for (const row of rows) {
        const parentId = row[localKey]
        if (parentId == null) {
          row[resultKey] = type === 'hasMany' ? [] : null
          continue
        }
        const { data: relData } = await executeQuery({
          connection,
          from: entity,
          select: relSelect,
          where: { ...relWhere, [foreignKey]: parentId },
          relations: nested
        })
        row[resultKey] = type === 'hasMany' ? relData : (relData[0] ?? null)
      }
    } else if (type === 'belongsTo') {
      for (const row of rows) {
        const fkVal = row[foreignKey]
        if (fkVal == null) { row[resultKey] = null; continue }
        const { data: relData } = await executeQuery({
          connection,
          from: entity,
          select: relSelect,
          where: { ...relWhere, id: fkVal },
          relations: nested
        })
        row[resultKey] = relData[0] ?? null
      }
    }
  }
}

// ── Introspection ─────────────────────────────────────────────────────────────

async function introspect (connection) {
  const source = await getOrCreateMeshSource(connection)
  const { schema } = source

  const queryType = schema.getQueryType()
  if (!queryType) return { tables: [] }

  const tables = []
  const seenTypes = new Set()

  for (const [fieldName, field] of Object.entries(queryType.getFields())) {
    const returnTypeName = getReturnTypeName(field)
    const isConn = isConnectionType(schema, returnTypeName)
    const entityTypeName = isConn
      ? getConnectionNodeTypeName(schema, returnTypeName)
      : returnTypeName

    if (!entityTypeName || seenTypes.has(entityTypeName)) continue

    const type = schema.getType(entityTypeName)
    if (!type || !isObjectType(type)) continue

    seenTypes.add(entityTypeName)

    const columns = Object.entries(type.getFields())
      .filter(([, f]) => {
        const named = unwrap(f.type)
        return isScalarType(named) || isEnumType(named)
      })
      .map(([colName, f]) => ({
        name: colName,
        type: unwrap(f.type).name,
        nullable: !isNonNullType(f.type),
        defaultValue: null,
        isPrimaryKey: colName === 'id'
      }))

    tables.push({ name: fieldName, columns })
  }

  return { tables }
}

module.exports = { executeQuery, introspect }
