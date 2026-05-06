'use strict'

const { executeQuery } = require('./database/connector')
const { introspectDatabase } = require('./database/introspect')

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
    """
    introspect(connection: ConnectionInput!): DatabaseSchema!

    """
    Return pre-defined database catalog entries.
    When name is supplied only that entry is returned; omit to list all entries.
    Catalog files are loaded lazily on first access.
    """
    catalog(name: String): [CatalogEntry!]!

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
    """Database connection credentials"""
    connection: ConnectionInput!
    """The entity (table) to query"""
    from: String!
    """Columns to select (defaults to all)"""
    select: [String!]
    """Filter conditions as a JSON object {column: value, …}"""
    where: JSON
    """Related entities to include"""
    relations: [RelationInput!]
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
    """Database name, file path (SQLite), base URL (REST/openapi), spec URL (openapi/soap/odata/thrift), or connection string (mongodb)"""
    database: String!
    """Username or API key value (REST)"""
    user: String
    """Password; if user is set but password is omitted, user is treated as a Bearer token (REST)"""
    password: String
    """Connection scheme, e.g. bolt, neo4j+s, http, https"""
    scheme: String
    """Default request headers as a JSON object (REST driver only)"""
    headers: JSON
    """Query-parameter name to use for the API key (REST driver only)"""
    apiKeyParam: String
  }

  enum Driver {
    """PostgreSQL (via @graphql-mesh/postgraphile)"""
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
    """MongoDB via Mongoose models (via @graphql-mesh/mongoose);
       set database to the mongodb:// connection string"""
    mongodb
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
    """Relation type (default: hasMany)"""
    type: RelationType
    """Columns to select from the related entity"""
    select: [String!]
    """Filter conditions for the related entity"""
    where: JSON
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
    """Unique identifier used in the catalog(name:) query"""
    name: String!
    """Human-readable display name"""
    label: String!
    """Short description of the database"""
    description: String
    """Driver required to connect"""
    driver: Driver!
    """Default connection parameters (credentials are public demo values where applicable)"""
    connection: CatalogConnection!
    """Known tables / node labels / REST paths with their columns and relations"""
    entities: [CatalogEntity!]!
  }

  """Connection parameters template stored in a catalog entry"""
  type CatalogConnection {
    host: String
    port: Int
    database: String
    user: String
    """Included only for databases with publicly documented read-only credentials"""
    password: String
    scheme: String
  }

  """A table, node label, or API path defined in a catalog entry"""
  type CatalogEntity {
    name: String!
    """Known column / property / field names"""
    columns: [String!]!
    """Pre-defined relations to other entities"""
    relations: [CatalogRelation!]!
  }

  """A pre-defined relationship within a catalog entity"""
  type CatalogRelation {
    entity: String!
    foreignKey: String!
    localKey: String
    alias: String
    catalog: String
    type: RelationType!
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
    introspect: (_parent, { connection }) => introspectDatabase(connection),
    // Catalog is lazy-required so the files are only loaded when the resolver runs
    catalog: (_parent, { name }) => require('./catalog').getCatalog(name),
    generateSchema: (_parent, { input }) => require('./ontology').parseOntology(input)
  },
  Mutation: {
    ingestOntology: (_parent, { input }) => require('./ontology').parseOntology(input)
  }
}

module.exports = { typeDefs, resolvers }
