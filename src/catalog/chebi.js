'use strict'

/**
 * ChEBI — Chemical Entities of Biological Interest: a curated dictionary and
 * ontology of small molecules (CC BY 4.0), via the ChEBI 2.0 public API.
 * API docs: https://www.ebi.ac.uk/chebi/backend/api/docs/
 *
 * Other resources write ChEBI ids every which way — CHEBI:15365, chebi:15365
 * (KEGG), 15365 (Reactome) — so the chebiId parameter accepts all of them.
 */

// Normalise any spelling of a ChEBI id to the canonical CHEBI:nnnn form.
const chebiId = (value) => {
  const digits = String(value).replace(/^chebi:/i, '')
  return `CHEBI:${digits}`
}

const accessions = (r, kind) => ((r.database_accessions && r.database_accessions[kind]) || [])
const names = (r, kind) => ((r.names && r.names[kind]) || []).map((n) => n.name)
const toNumber = (v) => (v == null || v === '' ? null : Number(v))

const COMPOUND_RELATIONS = [
  { alias: 'pubchem', description: 'The PubChem compound with the same InChIKey', catalog: 'pubchem', entity: 'compoundByInchiKey', obo: 'inchikey', type: 'hasOne' },
  { alias: 'ontologyRelations', description: 'ChEBI ontology relations: is a, has role, has functional parent, …', entity: 'ontologyRelations', obo: 'chebi', type: 'hasMany' },
  { alias: 'reactions', description: 'Rhea reactions this compound takes part in', catalog: 'rhea', entity: 'reactionsForCompound', obo: 'chebi', type: 'hasMany' },
  { alias: 'ols', description: 'The compound as an ontology term in OLS', catalog: 'ols', entity: 'term', obo: 'chebi', type: 'hasOne' }
]

module.exports = {
  name: 'chebi',
  label: 'ChEBI',
  description: 'Chemical Entities of Biological Interest: manually curated dictionary and ontology of small molecules — structures, formulae, masses, roles (drug, metabolite, …) and cross-references.',
  category: 'Chemistry & drugs',
  homepage: 'https://www.ebi.ac.uk/chebi/',
  docs: 'https://www.ebi.ac.uk/chebi/backend/api/docs/',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/chebi/backend/api/public',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'compound',
      description: 'One ChEBI entry: structure, formula, mass, names, roles and cross-references',
      path: '/compound/{chebiId}/',
      params: {
        chebiId: { transform: chebiId, description: 'ChEBI id, e.g. CHEBI:15365 (chebi:15365 and 15365 also accepted)' }
      },
      fields: {
        chebiId: 'chebi_accession',
        name: 'name',
        definition: 'definition',
        stars: 'stars',
        formula: 'chemical_data.formula',
        charge: (r) => toNumber(r.chemical_data && r.chemical_data.charge),
        mass: (r) => toNumber(r.chemical_data && r.chemical_data.mass),
        monoisotopicMass: (r) => toNumber(r.chemical_data && r.chemical_data.monoisotopic_mass),
        smiles: 'default_structure.smiles',
        inchi: 'default_structure.standard_inchi',
        inchiKey: 'default_structure.standard_inchi_key',
        iupacName: (r) => names(r, 'IUPAC NAME')[0] || null,
        synonyms: (r) => names(r, 'SYNONYM'),
        inn: (r) => names(r, 'INN'),
        roles: 'roles_classification[].name',
        casNumber: (r) => (accessions(r, 'CAS')[0] || {}).accession_number || null,
        keggId: (r) => (accessions(r, 'MANUAL_X_REF').find((x) => x.source_name === 'KEGG COMPOUND') || {}).accession_number || null,
        pmids: (r) => accessions(r, 'CITATION').filter((x) => x.source_name === 'PubMed').map((x) => x.accession_number),
        secondaryIds: 'secondary_ids'
      },
      example: { chebiId: 'CHEBI:15365' },
      relations: COMPOUND_RELATIONS
    },
    {
      name: 'ontologyRelations',
      description: 'Outgoing ChEBI ontology relations of a compound (is a, has role, has functional parent, …)',
      path: '/compound/{chebiId}/',
      params: {
        chebiId: { transform: chebiId, description: 'ChEBI id, e.g. CHEBI:15365' },
        relation: { in: 'filter', field: 'relation', description: 'Keep one relation type, e.g. is a, has role, has functional parent' }
      },
      rows: 'ontology_relations.outgoing_relations',
      fields: {
        relation: 'relation_type',
        chebiId: (r) => `CHEBI:${r.final_id}`,
        name: 'final_name'
      },
      example: { chebiId: 'CHEBI:15365' },
      relations: [
        { alias: 'compound', description: 'The related ChEBI entry in full', entity: 'compound', obo: 'chebi', type: 'hasOne' }
      ]
    },
    {
      name: 'search',
      description: 'Search ChEBI by name, synonym, formula or identifier',
      path: '/es_search/',
      params: {
        term: { required: true, description: 'Search text, e.g. aspirin' }
      },
      rows: 'results[]._source',
      fields: {
        chebiId: 'chebi_accession',
        name: 'name',
        stars: 'stars',
        formula: 'formula',
        mass: 'mass',
        smiles: 'smiles',
        inchiKey: 'inchikey'
      },
      paginate: { limit: 'size', page: 'page', pageBase: 1, max: 100 },
      example: { term: 'aspirin' },
      relations: COMPOUND_RELATIONS.filter((r) => r.alias !== 'ontologyRelations').concat([
        { alias: 'compound', description: 'The full ChEBI entry', entity: 'compound', obo: 'chebi', type: 'hasOne' }
      ])
    }
  ]
}
