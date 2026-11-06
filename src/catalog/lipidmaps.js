'use strict'

/**
 * LIPID MAPS Structure Database — curated structures and classification of
 * 48 000+ biologically relevant lipids, with cross-references to PubChem,
 * ChEBI, KEGG and HMDB.
 * API docs: https://lipidmaps.org/resources/rest
 *
 * Lookups answer `[]` for no match, a bare record for one match, and
 * `{ Row1: …, Row2: … }` for several; `rows` folds all three into a list.
 */

const rowsOf = (body) => {
  if (body == null) return []
  if (Array.isArray(body)) return body
  if (body.Row1) return Object.values(body)
  return body.lm_id ? [body] : []
}

const COMPOUND_FIELDS = {
  lmId: 'lm_id',
  name: 'name',
  systematicName: 'sys_name',
  synonyms: (r) => (r.synonyms ? String(r.synonyms).split(';').map((s) => s.trim()).filter(Boolean) : []),
  abbreviation: 'abbrev',
  abbreviationChains: 'abbrev_chains',
  category: 'core',
  mainClass: 'main_class',
  subClass: 'sub_class',
  formula: 'formula',
  mass: (r) => (r.exactmass ? Number(r.exactmass) : null),
  inchi: 'inchi',
  inchiKey: 'inchi_key',
  smiles: 'smiles',
  keggId: 'kegg_id',
  hmdbId: 'hmdb_id',
  chebiId: (r) => (r.chebi_id ? `CHEBI:${r.chebi_id}` : null),
  pubchemCid: (r) => (r.pubchem_cid ? Number(r.pubchem_cid) : null)
}

const COMPOUND_RELATIONS = [
  { alias: 'pubchem', description: 'The PubChem compound', catalog: 'pubchem', entity: 'compound', obo: 'pubchem.compound', type: 'hasOne' },
  { alias: 'chebi', description: 'The ChEBI entity', catalog: 'chebi', entity: 'compound', obo: 'chebi', type: 'hasOne' },
  { alias: 'chembl', description: 'The same structure in ChEMBL (by InChIKey)', catalog: 'chembl', entity: 'moleculeByInchiKey', obo: 'inchikey', type: 'hasOne' },
  { alias: 'kegg', description: 'The KEGG COMPOUND record', catalog: 'kegg', entity: '/get', localKey: 'keggId', foreignKey: '_pathSuffix', type: 'hasOne' }
]

module.exports = {
  name: 'lipidmaps',
  label: 'LIPID MAPS',
  description: 'LIPID MAPS Structure Database: curated structures, nomenclature and hierarchical classification of 48 000+ lipids, cross-referenced to PubChem, ChEBI, KEGG and HMDB.',
  category: 'Chemistry & drugs',
  homepage: 'https://www.lipidmaps.org',
  docs: 'https://lipidmaps.org/resources/rest',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://lipidmaps.org/rest',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 3, maxConcurrent: 2 },
  entities: [
    {
      name: 'compound',
      description: 'One lipid by LIPID MAPS id',
      path: '/compound/lm_id/{lmId}/all/json',
      params: {
        lmId: { description: 'LIPID MAPS id, e.g. LMFA01010001 (palmitic acid)' }
      },
      rows: rowsOf,
      fields: COMPOUND_FIELDS,
      example: { lmId: 'LMFA01010001' },
      relations: COMPOUND_RELATIONS
    },
    {
      name: 'compoundByInchiKey',
      description: 'The lipid with this standard InChIKey',
      path: '/compound/inchi_key/{inchiKey}/all/json',
      params: {
        inchiKey: { description: 'Standard InChIKey, e.g. IPCSVZSSVZVIGE-UHFFFAOYSA-N' }
      },
      rows: rowsOf,
      fields: COMPOUND_FIELDS,
      example: { inchiKey: 'IPCSVZSSVZVIGE-UHFFFAOYSA-N' },
      relations: COMPOUND_RELATIONS
    },
    {
      name: 'compoundsByAbbreviation',
      description: 'Lipids matching a shorthand name at species or chain level, e.g. "PC 34:1" or "PC 16:0_18:1"',
      path: '/compound/{level}/{abbreviation}/all/json',
      params: {
        abbreviation: { description: 'LIPID MAPS shorthand, e.g. PC 34:1' },
        level: { default: 'abbrev', description: '"abbrev" for species level (PC 34:1) or "abbrev_chains" for chain level (PC 16:0_18:1)' }
      },
      rows: rowsOf,
      fields: COMPOUND_FIELDS,
      example: { abbreviation: 'PC 34:1' },
      relations: COMPOUND_RELATIONS
    },
    {
      name: 'compoundsByFormula',
      description: 'Lipids with this molecular formula',
      path: '/compound/formula/{formula}/all/json',
      params: {
        formula: { description: 'Molecular formula, e.g. C16H32O2' }
      },
      rows: rowsOf,
      fields: COMPOUND_FIELDS,
      example: { formula: 'C16H32O2' },
      relations: COMPOUND_RELATIONS
    }
  ]
}
