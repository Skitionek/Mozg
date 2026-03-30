'use strict';

const { executeQuery } = require('./database/connector');
const { introspectDatabase } = require('./database/introspect');

// ---------------------------------------------------------------------------
// JSON scalar
// ---------------------------------------------------------------------------
const { Kind } = require('graphql');

function parseLiteralJSON(ast) {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
      return parseInt(ast.value, 10);
    case Kind.FLOAT:
      return parseFloat(ast.value);
    case Kind.NULL:
      return null;
    case Kind.OBJECT: {
      const obj = {};
      for (const field of ast.fields) {
        obj[field.name.value] = parseLiteralJSON(field.value);
      }
      return obj;
    }
    case Kind.LIST:
      return ast.values.map(parseLiteralJSON);
    case Kind.ENUM:
      return ast.value;
    default:
      return null;
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
  }

  type Mutation {
    """
    Parse an OWL ontology (Turtle, RDF/XML, OWL/XML, or Manchester Syntax) and
    extract its classes, object properties, and data properties.
    Supply either content (raw string) or url (fetched server-side).
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
    """Database name, file path (SQLite), or base URL (REST)"""
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
    postgres
    mysql
    sqlite3
    neo4j
    arango
    biocyc
    rest
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
  }

  type OWLClass {
    iri: String!
    label: String
    comment: String
    subClassOf: [String!]!
  }

  type OWLObjectProperty {
    iri: String!
    label: String
    comment: String
    domain: [String!]!
    range: [String!]!
    inverseOf: String
    relationType: RelationType!
  }

  type OWLDataProperty {
    iri: String!
    label: String
    comment: String
    domain: [String!]!
    range: [String!]!
  }
`;

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------
const resolvers = {
  JSON: {
    serialize: (value) => value,
    parseValue: (value) => value,
    parseLiteral: parseLiteralJSON,
  },
  Query: {
    query: (_parent, { input }) => executeQuery(input),
    introspect: (_parent, { connection }) => introspectDatabase(connection),
  },
  Mutation: {
    ingestOntology: (_parent, { input }) => require('./ontology').parseOntology(input),
  },
};

module.exports = { typeDefs, resolvers };
