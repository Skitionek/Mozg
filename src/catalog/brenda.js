'use strict';

/**
 * BRENDA – BRaunschweig ENzyme DAtabase, the world's largest enzyme database.
 * Reference: https://www.brenda-enzymes.org/
 * API docs:  https://www.brenda-enzymes.org/soap.php
 *
 * ⚠️  Authentication required: free registration at https://www.brenda-enzymes.org/register.php
 * After registration, use your email (user) and the SHA-256 hash of your
 * password concatenated with the email as the API password.
 *
 * BRENDA provides a SOAP/WSDL API. A limited REST interface is also available
 * at https://www.brenda-enzymes.org/enzyme.php for individual enzyme pages.
 *
 * The REST-accessible endpoints below use the BRENDA REST API at
 * https://www.brenda-enzymes.org/rest which accepts GET requests with
 * API credentials.
 *
 * EC number format: 1.1.1.1 (class.subclass.sub-subclass.serial)
 *
 * Key where parameters:
 *  - ecNumber:  EC number (e.g. 1.1.1.1)
 *  - organism:  organism name (e.g. "Homo sapiens")
 *
 * Relationship map:
 *  - /enzyme/{ecNumber}  →  /km_value/{ecNumber}  (EC number, hasMany)
 *  - /enzyme/{ecNumber}  →  /turnover_number/{ecNumber}  (EC number, hasMany)
 */
module.exports = {
  name: 'brenda',
  label: 'BRENDA Enzyme Database (REST)',
  description: 'BRaunschweig ENzyme DAtabase — comprehensive enzyme/metabolism data for 80 000+ enzymes across all organisms. Free registration required. EC numbers follow the 1.1.1.1 format. SOAP and REST interfaces available.',
  driver: 'rest',
  connection: {
    database: 'https://www.brenda-enzymes.org/rest',
    // Credentials are user-supplied at query time (not stored in the catalog).
    // Pass user (registered email) and password (SHA-256 of password + email)
    // via the GraphQL query's connection argument.
  },
  entities: [
    {
      // Fetch enzyme by EC number: /enzyme/1.1.1.1
      name: '/enzyme',
      columns: ['ecNumber', 'recommendedName', 'systematicName', 'reaction', 'reactionType', 'substrate', 'product', 'inhibitors', 'cofactors', 'organism', 'tissues'],
      relations: [
        { entity: '/km_value', foreignKey: 'ecNumber', type: 'hasMany', alias: 'kmValues' },
        { entity: '/turnover_number', foreignKey: 'ecNumber', type: 'hasMany', alias: 'turnoverNumbers' },
        { entity: '/temperature_optimum', foreignKey: 'ecNumber', type: 'hasMany', alias: 'temperatureOptima' },
        { entity: '/list/enzyme', foreignKey: 'ecNumber', type: 'hasOne', alias: 'keggEnzyme', catalog: 'kegg' },
      ],
    },
    {
      // Kinetic constants (Km) for a given EC number: /km_value/1.1.1.1
      name: '/km_value',
      columns: ['ecNumber', 'organism', 'substrate', 'value', 'unit', 'commentary', 'reference'],
      relations: [],
    },
    {
      // Turnover number (kcat): /turnover_number/1.1.1.1
      name: '/turnover_number',
      columns: ['ecNumber', 'organism', 'substrate', 'value', 'unit', 'commentary', 'reference'],
      relations: [],
    },
    {
      // Temperature and pH optima: /temperature_optimum/1.1.1.1
      name: '/temperature_optimum',
      columns: ['ecNumber', 'organism', 'value', 'unit', 'commentary', 'reference'],
      relations: [],
    },
  ],
};
