'use strict'

const { executeQuery } = require('./database/connector')
const { introspectDatabase } = require('./database/introspect')
const { connectionForSource, entityColumns, entityParams, implicitLinks, isEnvValue, isServerHeld } = require('./database/sources')
const obo = require('./database/obo')

// ---------------------------------------------------------------------------
// JSON scalar
// ---------------------------------------------------------------------------
const { Kind } = require('graphql')

function parseLiteralJSON (ast) {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value
    case Kind.INT:
      return parseInt(ast.value, 10)
    case Kind.FLOAT:
      return parseFloat(ast.value)
    case Kind.NULL:
      return null
    case Kind.OBJECT: {
      const obj = {}
      for (const field of ast.fields) {
        obj[field.name.value] = parseLiteralJSON(field.value)
      }
      return obj
    }
    case Kind.LIST:
      return ast.values.map(parseLiteralJSON)
    case Kind.ENUM:
      return ast.value
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------
const typeDefs = /* GraphQL */ `
  """Arbitrary JSON value"""
  scalar JSON

  type Query {
    """
    Query entities from a database using the provided connection credentials.
    Relations defined in the input are traversed and embedded in the result.
    """
    query(input: QueryInput!): QueryResult!

    """
    Introspect the schema of a database to discover tables and columns.
    Pass either a connection, or the name of a catalog source.
    """
    introspect(connection: ConnectionInput, source: String): DatabaseSchema!

    """
    Return pre-defined database catalog entries.
    When name is supplied only that entry is returned; omit to list all entries.
    Filter by category (e.g. "Genes & genomes") or driver (e.g. api).
    Catalog files are loaded lazily on first access.
    """
    catalog(name: String, category: String, driver: Driver): [CatalogEntry!]!

    """
    The OBO keys Mozg understands: identifier spaces, as registered in the
    Bioregistry, that catalog fields and parameters are annotated with.
    Two fields with the same key and the same value name the same thing.
    """
    oboKeys: [OboKey!]!

    """
    Parse an OWL ontology and return the GraphQL schema that would be generated
    from its TBox, without caching the result (read-only counterpart to
    ingestOntology).
    """
    generateSchema(input: OntologyInput!): OntologyResult!
  }

  type Mutation {
    """
    Parse an OWL ontology (Turtle, RDF/XML, OWL/XML, or Manchester Syntax),
    extract its TBox, map it to a GraphQL schema, and cache the result.
    Supply either content (raw string) or url (fetched server-side).
    Set validate: true and supply connection to validate the mapped schema
    against a live database.
    """
    ingestOntology(input: OntologyInput!): OntologyResult!
  }

  input QueryInput {
    """
    Name of a catalog source to query (e.g. "uniprot", "ensembl", "chembl").
    Supplies the connection, so connection can be omitted.  See the catalog query.
    """
    source: String
    """Database connection credentials (required unless source is given; fields given here override the source's)"""
    connection: ConnectionInput
    """The entity (table, label, path, or catalog entity name) to query"""
    from: String!
    """Columns to select (defaults to all)"""
    select: [String!]
    """Filter conditions as a JSON object {column: value, …}"""
    where: JSON
    """Related entities to include"""
    relations: [RelationInput!]
    """
    Catalog-declared relations to include, by alias — e.g. ["structures", "pathways.events"].
    Dots follow relations into the related entity, across sources where needed.
    Requires a catalog source.
    """
    include: [String!]
    """API keys by source name, e.g. { ncbi: "…", openfda: "…" }; applied to the queried source and every related one"""
    apiKeys: JSON
    """Return records exactly as the source sent them instead of the catalog's normalized fields (api sources)"""
    raw: Boolean
    """
    Read live data even if the server caches results (MOZG_RESULT_CACHE_TTL_MS).  Reaches
    every relation fetched for this query, and refreshes the cached result for others.
    """
    fresh: Boolean
    """Maximum number of rows to return"""
    limit: Int
    """Number of rows to skip"""
    offset: Int
    """Column to order results by"""
    orderBy: String
    """Sort direction"""
    orderDirection: SortDirection
  }

  """Database connection parameters"""
  input ConnectionInput {
    """Database driver"""
    driver: Driver!
    """Host (not required for SQLite or REST)"""
    host: String
    """Port (defaults to driver default when omitted)"""
    port: Int
    """Database name, file path (SQLite), base URL (REST/openapi), WSDL URL (soap), or IDL URL (thrift)"""
    database: String!
    """Username or API key value (REST)"""
    user: String
    """Password; if user is set but password is omitted, user is treated as a Bearer token (REST)"""
    password: String
    """Connection scheme, e.g. bolt, neo4j+s, http, https"""
    scheme: String
    """URL path appended to host:port when building the service endpoint (thrift only)"""
    path: String
    """Default request headers as a JSON object (REST driver only)"""
    headers: JSON
    """Query-parameter name to use for the API key (REST driver only)"""
    apiKeyParam: String
  }

  enum Driver {
    """PostgreSQL (query and introspection both via knex)"""
    postgres
    """MySQL (via @graphql-mesh/mysql)"""
    mysql
    """SQLite3 (legacy custom driver)"""
    sqlite3
    """Neo4j (via @graphql-mesh/neo4j)"""
    neo4j
    """ArangoDB (legacy custom driver)"""
    arango
    """BioCyc biological databases (legacy custom driver)"""
    biocyc
    """HTTP API described by a catalog entry (the life-science sources): request shape,
       response unwrapping, field names and cross-source relations all come from the catalog"""
    api
    """Plain REST API without an OpenAPI specification (legacy custom driver)"""
    rest
    """KEGG REST API (rest.kegg.jp); converts text/plain TSV and flat-file responses to JSON"""
    kegg
    """REST API with an OpenAPI / Swagger specification (via @graphql-mesh/openapi);
       set database to the spec URL/path and host to the API base URL"""
    openapi
    """SOAP / WSDL web service (via @graphql-mesh/soap);
       set database to the WSDL URL"""
    soap
    """OData endpoint, e.g. Microsoft Graph (via @graphql-mesh/odata);
       set database to the service root URL"""
    odata
    """Apache Thrift service (via @graphql-mesh/thrift);
       set database to the service endpoint"""
    thrift
    """Elasticsearch / OpenSearch REST API (legacy custom driver);
       set database to the cluster base URL"""
    elasticsearch
  }

  enum SortDirection {
    asc
    desc
  }

  """Describes a relation between two entities"""
  input RelationInput {
    """Name of the related entity (table)"""
    entity: String!
    """Key on the parent entity (default: id)"""
    localKey: String
    """Key linking to the related entity:
       - for hasMany/hasOne: the column on the *related* entity that references the parent
       - for belongsTo: the column on the *current* entity that references the parent"""
    foreignKey: String!
    """Property name in the result (defaults to entity name)"""
    alias: String
    """Key on the related entity that foreignKey points at (belongsTo only, default: id)"""
    ownerKey: String
    """Relation type (default: hasMany)"""
    type: RelationType
    """Resolve this relation against another catalog entry's connection
       instead of the parent query's connection (see CatalogRelation.catalog)"""
    catalog: String
    """Columns to select from the related entity"""
    select: [String!]
    """Filter conditions for the related entity"""
    where: JSON
    """Maximum related rows per parent row (hasMany)"""
    limit: Int
    """
    Fetch this relation for all parent rows in a few requests, by repeating the
    filter (?userId=1&userId=2), when the REST API is known to accept that.
    Falls back to one request per row if the API answers with anything it was
    not asked for.  Without it, rows sharing a key still fetch it once.
    """
    batch: Boolean
    """
    Join by OBO key instead of naming fields: the parent field carrying this
    key and the target parameter accepting it are found from the catalog
    (e.g. obo: "uniprot").  Explicit localKey / foreignKey still win.
    """
    obo: String
    """Nested relations on the related entity"""
    relations: [RelationInput!]
  }

  enum RelationType {
    """Parent has many related rows (1-to-N)"""
    hasMany
    """Parent has exactly one related row"""
    hasOne
    """Row belongs to a related parent (N-to-1)"""
    belongsTo
  }

  type QueryResult {
    """Query results as a JSON array"""
    data: JSON!
    """Number of rows returned"""
    count: Int!
    """
    How the answer was produced.  Absent unless the server caches results:
    { cache: "hit" | "miss" | "bypass", ageMs, ttlMs }.  Other features add their own keys.
    """
    meta: JSON
  }

  type DatabaseSchema {
    """Tables found in the database"""
    tables: [TableInfo!]!
  }

  type TableInfo {
    name: String!
    columns: [ColumnInfo!]!
  }

  type ColumnInfo {
    name: String!
    type: String!
    nullable: Boolean!
    defaultValue: String
    isPrimaryKey: Boolean!
  }

  input OntologyInput {
    """Raw ontology content"""
    content: String
    """URL to fetch the ontology from"""
    url: String
    """Serialization format – auto-detected when omitted"""
    format: OntologyFormat
    """When true, validate the mapped schema against the supplied database connection"""
    validate: Boolean
    """Database connection used for schema validation (required when validate is true)"""
    connection: ConnectionInput
  }

  enum OntologyFormat {
    turtle
    rdfxml
    owlxml
    manchester
    auto
  }

  type OntologyResult {
    classes: [OWLClass!]!
    objectProperties: [OWLObjectProperty!]!
    dataProperties: [OWLDataProperty!]!
    tripleCount: Int!
    """GraphQL SDL generated from the TBox"""
    generatedTypeDefs: String!
    """Summary of the GraphQL types generated from the TBox"""
    generatedTypes: [GeneratedType!]!
    """Validation report against a live database (present only when validate: true)"""
    validationReport: ValidationReport
  }

  """A GraphQL type generated from an OWL class"""
  type GeneratedType {
    name: String!
    iri: String!
    isAbstract: Boolean!
    fieldCount: Int!
    relationCount: Int!
  }

  """Result of validating a mapped ontology schema against a live database"""
  type ValidationReport {
    valid: Boolean!
    warnings: [ValidationWarning!]!
    matchedTables: [TableMatch!]!
    missingTables: [TableMismatch!]!
  }

  type ValidationWarning {
    type: String!
    typeName: String!
    fieldName: String
    message: String!
  }

  type TableMatch {
    typeName: String!
    tableName: String!
  }

  type TableMismatch {
    typeName: String!
    tableName: String!
  }

  type OWLClass {
    iri: String!
    label: String
    comment: String
    subClassOf: [String!]!
    equivalentTo: [String!]!
    disjointWith: [String!]!
  }

  type OWLObjectProperty {
    iri: String!
    label: String
    comment: String
    domain: [String!]!
    range: [String!]!
    inverseOf: String
    relationType: RelationType!
    isFunctional: Boolean!
    minCard: Int
    maxCard: Int
  }

  type OWLDataProperty {
    iri: String!
    label: String
    comment: String
    domain: [String!]!
    range: [String!]!
    """GraphQL scalar type derived from the xsd datatype (String, Int, Float, Boolean)"""
    graphqlType: String!
    """True when a cardinality restriction (min ≥ 1) or someValuesFrom makes the property required"""
    required: Boolean!
  }

  """A pre-defined database with known schema and relationships"""
  type CatalogEntry {
    """Unique identifier used in the catalog(name:) query and as QueryInput.source"""
    name: String!
    """Human-readable display name"""
    label: String!
    """Short description of the database"""
    description: String
    """Grouping used by the UI and docs, e.g. Proteins & structures"""
    category: String
    """Project home page"""
    homepage: String
    """API documentation"""
    docs: String
    """Data licence or terms of use"""
    license: String
    """How the source authenticates, when it does (api sources)"""
    auth: CatalogAuth
    """True when the database is hosted with this deployment; its connection is held by the server and cannot be overridden"""
    selfHosted: Boolean!
    """Driver required to connect"""
    driver: Driver!
    """Default connection parameters (credentials are public demo values where applicable)"""
    connection: CatalogConnection!
    """Known tables / node labels / REST paths with their columns and relations"""
    entities: [CatalogEntity!]!
  }

  """Connection parameters template stored in a catalog entry; values the server supplies from its environment are never shown"""
  type CatalogConnection {
    host: String
    port: Int
    database: String
    user: String
    """Included only for databases with publicly documented read-only credentials"""
    password: String
    scheme: String
    """Default request headers as a JSON object (REST driver only)"""
    headers: JSON
  }

  """How an api source takes an API key"""
  type CatalogAuth {
    """True when the source cannot be queried without a key"""
    required: Boolean!
    """Query parameter that carries the key"""
    param: String
    """Header that carries the key"""
    header: String
    """Where to obtain a key"""
    signup: String
  }

  """A table, node label, or API path defined in a catalog entry"""
  type CatalogEntity {
    name: String!
    """What one row of this entity is"""
    description: String
    """Known column / property / field names"""
    columns: [String!]!
    """Fields with the OBO key each carries, where it carries one"""
    fields: [CatalogField!]!
    """Parameters accepted in where (api sources)"""
    params: [CatalogParam!]!
    """A where value known to return rows — a ready-made starting point"""
    example: JSON
    """Pre-defined relations to other entities"""
    relations: [CatalogRelation!]!
    """
    Relations nobody had to declare: entities in any source whose required
    parameter shares an OBO key with a field here.  Use the name in include.
    """
    links: [CatalogLink!]!
  }

  """A field of a catalog entity"""
  type CatalogField {
    name: String!
    """OBO key of the identifier this field holds (* = a CURIE naming its own key)"""
    obo: String
  }

  """An implicit relation, by shared OBO key"""
  type CatalogLink {
    """Name to use in QueryInput.include, e.g. pdbe/bestStructures"""
    name: String!
    catalog: String!
    entity: String!
    localKey: String!
    foreignKey: String!
    obo: String!
    description: String
  }

  """An identifier space"""
  type OboKey {
    """Bioregistry prefix, e.g. uniprot"""
    key: String!
    label: String!
    """Preferred CURIE prefix, e.g. CHEBI"""
    prefix: String!
    """curie (written PREFIX:local) or local (written bare)"""
    form: String!
    """Pattern of the local identifier"""
    pattern: String!
    """Catalog field name conventionally carrying this key"""
    field: String
  }

  """A parameter an api entity accepts in where"""
  type CatalogParam {
    name: String!
    """path, query, or filter (applied by Mozg after fetching)"""
    in: String!
    required: Boolean!
    description: String
    example: JSON
    """OBO keys of the identifiers this parameter accepts"""
    obo: [String!]!
  }

  """A pre-defined relationship within a catalog entity"""
  type CatalogRelation {
    entity: String!
    foreignKey: String!
    localKey: String
    """Name to use in QueryInput.include"""
    alias: String
    catalog: String
    type: RelationType!
    """What following this relation yields"""
    description: String
    """Cap on related rows per parent row, when the catalog sets one"""
    limit: Int
    """Fixed filters sent with the related lookup (e.g. Open Trivia's amount)"""
    where: JSON
    """OBO key the join is declared by, when it is"""
    obo: String
  }
`

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------
const resolvers = {
  JSON: {
    serialize: (value) => value,
    parseValue: (value) => value,
    parseLiteral: parseLiteralJSON
  },
  Query: {
    query: (_parent, { input }) => executeQuery(input),
    introspect: (_parent, { connection, source }) => {
      if (source) return introspectDatabase({ ...connectionForSource(source), ...(connection || {}), source })
      if (!connection) throw new Error('introspect needs a connection or a source')
      return introspectDatabase(connection)
    },
    // Catalog is lazy-required so the files are only loaded when the resolver runs
    catalog: (_parent, { name, category, driver }) => require('./catalog').getCatalog(name)
      .filter((entry) => !category || entry.category === category)
      .filter((entry) => !driver || entry.driver === driver),
    generateSchema: (_parent, { input }) => require('./ontology').parseOntology(input),
    oboKeys: () => Object.entries(obo.KEYS).map(([key, spec]) => ({
      key,
      label: spec.label,
      prefix: spec.prefix,
      form: spec.form,
      pattern: spec.pattern.source,
      field: obo.CANONICAL_FIELD[key] || null
    }))
  },
  Mutation: {
    ingestOntology: (_parent, { input }) => require('./ontology').parseOntology(input)
  },
  CatalogAuth: {
    required: (auth) => Boolean(auth.required)
  },
  CatalogEntry: {
    selfHosted: (entry) => isServerHeld(entry),
    // Entities need to know their entry to resolve relations declared by OBO key.
    entities: (entry) => entry.entities.map((entity) => ({ ...entity, __entry: entry }))
  },
  CatalogConnection: Object.fromEntries(['host', 'port', 'database', 'user', 'password', 'scheme', 'headers'].map((field) => [
    field,
    (connection) => (isEnvValue(connection[field]) ? null : connection[field])
  ])),
  CatalogEntity: {
    columns: (entity) => entityColumns(entity),
    fields: (entity) => entityColumns(entity).map((name) => ({ name, obo: obo.fieldKey(entity, name) })),
    params: (entity) => entityParams(entity).map((p) => ({ ...p, obo: obo.paramKeys(entity, p.name) })),
    relations: (entity) => (entity.relations || []).map((rel) => {
      try {
        return require('./database/sources').resolveRelation(entity.__entry, entity, rel)
      } catch {
        return rel
      }
    }),
    links: (entity) => {
      if (!entity.__entry) return []
      const declared = new Set((entity.relations || []).map((r) => `${r.catalog || entity.__entry.name}/${r.entity}`))
      return implicitLinks(entity.__entry, entity).filter((l) => !declared.has(`${l.catalog}/${l.entity}`))
    }
  }
}

module.exports = { typeDefs, resolvers }
