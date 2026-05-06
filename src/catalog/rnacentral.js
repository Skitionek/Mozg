'use strict'

/**
 * RNAcentral – public non-coding RNA sequence database maintained by EBI.
 * Reference: https://rnacentral.org/help/public-database
 *
 * The credentials below are the publicly documented read-only credentials
 * from https://rnacentral.org (same as in examples/queries.json).
 */
module.exports = {
  name: 'rnacentral',
  label: 'RNAcentral (PostgreSQL)',
  description: 'Public EBI database of non-coding RNA sequences from multiple expert databases.',
  driver: 'postgres',
  connection: {
    host: 'hh-pgsql-public.ebi.ac.uk',
    port: 5432,
    database: 'pfmegrnargs',
    user: 'reader',
    password: 'NWDMCE5xdipIjRrp'
  },
  entities: [
    {
      name: 'rna',
      columns: ['upi', 'length', 'seq_short', 'seq_long', 'md5'],
      relations: [
        { entity: 'xref', foreignKey: 'upi', type: 'hasMany', alias: 'xrefs' }
      ]
    },
    {
      name: 'xref',
      columns: ['upi', 'db_id', 'ac', 'created', 'last', 'is_active', 'version'],
      relations: [
        { entity: 'rna', foreignKey: 'upi', localKey: 'upi', type: 'belongsTo', alias: 'rna' },
        { entity: 'rnc_database', foreignKey: 'id', localKey: 'db_id', type: 'belongsTo', alias: 'database' }
      ]
    },
    {
      name: 'rnc_database',
      columns: ['id', 'timestamp', 'userstamp', 'descr', 'current_release', 'full_descr', 'alive', 'display_name', 'url'],
      relations: [
        { entity: 'xref', foreignKey: 'db_id', localKey: 'id', type: 'hasMany', alias: 'xrefs' }
      ]
    },
    {
      name: 'rnc_modifications',
      columns: ['id', 'upi', 'position', 'author_assigned_name', 'modomics_short_name', 'chem_comp_id'],
      relations: [
        { entity: 'rna', foreignKey: 'upi', localKey: 'upi', type: 'belongsTo', alias: 'rna' }
      ]
    }
  ]
}
