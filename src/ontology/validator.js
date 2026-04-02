'use strict';

/**
 * Validates an ontology entityMap against a live database schema.
 *
 * Compares each mapped entity's fields against the actual columns in the
 * database and emits structured warnings for:
 *   - MISSING_TABLE  – no table found for an OWL class
 *   - MISSING_COLUMN – a mapped data-property field has no matching column
 *   - TYPE_MISMATCH  – column type is incompatible with the OWL-derived GraphQL type
 */

const { introspectDatabase } = require('../database/introspect');

/**
 * @param {Map<string, import('./mapper').EntityDef>} entityMap
 * @param {object} connection  ConnectionInput passed to the driver
 * @returns {Promise<ValidationReport>}
 *
 * ValidationReport: {
 *   valid: boolean,
 *   warnings: ValidationWarning[],
 *   matchedTables: TableMatch[],
 *   missingTables: TableMismatch[],
 * }
 */
async function validateOntologyAgainstDb(entityMap, connection) {
  const dbSchema = await introspectDatabase(connection);

  // Index DB tables by lowercase name for case-insensitive lookup
  const tableMap = new Map();
  for (const table of dbSchema.tables) {
    tableMap.set(table.name.toLowerCase(), table);
  }

  const warnings = [];
  const matchedTables = [];
  const missingTables = [];

  for (const [typeName, entity] of entityMap) {
    if (entity.isAbstract) continue;

    const table = tableMap.get(entity.tableName.toLowerCase());

    if (!table) {
      missingTables.push({ typeName, tableName: entity.tableName });
      warnings.push({
        type: 'MISSING_TABLE',
        typeName,
        fieldName: null,
        message: `No table '${entity.tableName}' found in database for OWL class '${typeName}'`,
      });
      continue;
    }

    matchedTables.push({ typeName, tableName: entity.tableName });

    const colMap = new Map(
      table.columns.map((c) => [c.name.toLowerCase(), c])
    );

    for (const field of entity.fields) {
      const col = colMap.get(field.fieldName.toLowerCase());

      if (!col) {
        warnings.push({
          type: 'MISSING_COLUMN',
          typeName,
          fieldName: field.fieldName,
          message: `Column '${field.fieldName}' not found in table '${entity.tableName}'`,
        });
        continue;
      }

      if (isTypeMismatch(col.type, field.graphqlType)) {
        warnings.push({
          type: 'TYPE_MISMATCH',
          typeName,
          fieldName: field.fieldName,
          message:
            `Column '${field.fieldName}' in '${entity.tableName}' has DB type '${col.type}' ` +
            `but OWL specifies '${field.graphqlType}'`,
        });
      }
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
    matchedTables,
    missingTables,
  };
}

/** Returns true when the DB column type is incompatible with the expected GraphQL scalar. */
function isTypeMismatch(dbType, graphqlType) {
  const t = dbType.toLowerCase();
  if (graphqlType === 'Int') {
    return !/int|integer|smallint|bigint|tinyint|serial/.test(t);
  }
  if (graphqlType === 'Float') {
    return !/float|double|real|decimal|numeric/.test(t);
  }
  if (graphqlType === 'Boolean') {
    // tinyint is intentionally excluded here – it is already accepted as Int above
    return !/bool|boolean/.test(t);
  }
  // String is compatible with any type; ID and others treated as strings
  return false;
}

module.exports = { validateOntologyAgainstDb };
