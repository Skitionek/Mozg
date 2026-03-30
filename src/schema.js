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
    """Host (not required for SQLite)"""
    host: String
    """Port (defaults to driver default when omitted)"""
    port: Int
    """Database name or file path (SQLite)"""
    database: String!
    """Username"""
    user: String
    """Password"""
    password: String
  }

  enum Driver {
    postgres
    mysql
    sqlite3
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
    """Key on the related entity that references the parent"""
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
};

module.exports = { typeDefs, resolvers };
