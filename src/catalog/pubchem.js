'use strict'

/**
 * PubChem — NCBI's open chemistry database: 100M+ compounds with structures,
 * computed properties, synonyms, bioassay results and literature links.
 * API docs: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
 *
 * Usage policy: at most 5 requests per second and 400 per minute; requests
 * beyond that are throttled and repeat offenders blocked.
 */

// One property list for every compound lookup, so all three return the same row shape.
const PROPERTIES = [
  'Title', 'IUPACName', 'MolecularFormula', 'MolecularWeight', 'ExactMass', 'SMILES',
  'ConnectivitySMILES', 'InChI', 'InChIKey', 'XLogP', 'TPSA', 'HBondDonorCount',
  'HBondAcceptorCount', 'RotatableBondCount', 'Charge', 'HeavyAtomCount'
].join(',')

const num = (key) => (r) => (r[key] == null || r[key] === '' ? null : Number(r[key]))

const COMPOUND_FIELDS = {
  pubchemCid: 'CID',
  name: 'Title',
  iupacName: 'IUPACName',
  formula: 'MolecularFormula',
  mass: num('MolecularWeight'),
  exactMass: num('ExactMass'),
  smiles: 'SMILES',
  connectivitySmiles: 'ConnectivitySMILES',
  inchi: 'InChI',
  inchiKey: 'InChIKey',
  xlogp: 'XLogP',
  tpsa: 'TPSA',
  hbondDonors: 'HBondDonorCount',
  hbondAcceptors: 'HBondAcceptorCount',
  rotatableBonds: 'RotatableBondCount',
  charge: 'Charge',
  heavyAtoms: 'HeavyAtomCount'
}

const COMPOUND_RELATIONS = [
  { alias: 'synonyms', description: 'Names, trade names and registry numbers for this compound', entity: 'synonyms', obo: 'pubchem.compound', type: 'hasMany' },
  { alias: 'bioactivities', description: 'Bioassay outcomes recorded for this compound (first 100; query the entity directly for all)', entity: 'bioactivities', obo: 'pubchem.compound', type: 'hasMany', limit: 100 },
  { alias: 'literature', description: 'PubMed articles linked to this compound (first 100; query the entity directly for all)', entity: 'literature', obo: 'pubchem.compound', type: 'hasMany', limit: 100 },
  { alias: 'chembl', description: 'The same structure in ChEMBL (by InChIKey)', catalog: 'chembl', entity: 'moleculeByInchiKey', obo: 'inchikey', type: 'hasOne' },
  { alias: 'lipidmaps', description: 'The same structure in LIPID MAPS, for lipids (by InChIKey)', catalog: 'lipidmaps', entity: 'compoundByInchiKey', obo: 'inchikey', type: 'hasOne' }
]

const PROPERTY_ROWS = 'PropertyTable.Properties'

module.exports = {
  name: 'pubchem',
  label: 'PubChem',
  description: 'NCBI open chemistry database: 100M+ compounds with structures, computed properties, synonyms, bioassay outcomes and literature links.',
  category: 'Chemistry & drugs',
  homepage: 'https://pubchem.ncbi.nlm.nih.gov',
  docs: 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest',
  license: 'Public domain (US Government work); some depositor data carries its own terms',
  driver: 'api',
  connection: {
    database: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 4, maxConcurrent: 2 },
  entities: [
    {
      name: 'compound',
      description: 'One compound by PubChem CID, with computed properties',
      path: `/compound/cid/{pubchemCid}/property/${PROPERTIES}/JSON`,
      params: {
        pubchemCid: { description: 'PubChem compound id, e.g. 2244 (aspirin)' }
      },
      rows: PROPERTY_ROWS,
      fields: COMPOUND_FIELDS,
      example: { pubchemCid: 2244 },
      relations: COMPOUND_RELATIONS
    },
    {
      name: 'compoundByName',
      description: 'Compounds whose name or synonym is exactly this (several when the name is ambiguous)',
      path: `/compound/name/{name}/property/${PROPERTIES}/JSON`,
      params: {
        name: { description: 'Compound name or synonym, e.g. aspirin' }
      },
      rows: PROPERTY_ROWS,
      fields: COMPOUND_FIELDS,
      example: { name: 'aspirin' },
      relations: COMPOUND_RELATIONS
    },
    {
      name: 'compoundByInchiKey',
      description: 'Compounds with this standard InChIKey',
      path: `/compound/inchikey/{inchiKey}/property/${PROPERTIES}/JSON`,
      params: {
        inchiKey: { description: 'Standard InChIKey, e.g. BSYNRYMUTXBXSQ-UHFFFAOYSA-N' }
      },
      rows: PROPERTY_ROWS,
      fields: COMPOUND_FIELDS,
      example: { inchiKey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N' },
      relations: COMPOUND_RELATIONS
    },
    {
      name: 'synonyms',
      description: 'Every name PubChem knows a compound by, one per row (most common first)',
      path: '/compound/cid/{pubchemCid}/synonyms/JSON',
      params: {
        pubchemCid: { description: 'PubChem compound id, e.g. 2244' }
      },
      rows: (body) => ((body && body.InformationList && body.InformationList.Information) || [])
        .flatMap((info) => (info.Synonym || []).map((synonym) => ({ CID: info.CID, synonym }))),
      fields: {
        pubchemCid: 'CID',
        synonym: 'synonym'
      },
      example: { pubchemCid: 2244 },
      relations: []
    },
    {
      name: 'bioactivities',
      description: 'Bioassay outcomes for a compound: one row per tested substance per assay, with target gene where known',
      path: '/compound/cid/{pubchemCid}/assaysummary/JSON',
      params: {
        pubchemCid: { description: 'PubChem compound id, e.g. 2244' },
        outcome: { in: 'filter', field: 'outcome', description: 'Keep only this activity outcome: Active, Inactive, Inconclusive or Unspecified' }
      },
      rows: (body) => {
        const table = body && body.Table
        if (!table || !table.Columns || !table.Row) return []
        const columns = table.Columns.Column
        return table.Row.map((row) => Object.fromEntries(columns.map((c, i) => [c, row.Cell[i]])))
      },
      fields: {
        aid: num('AID'),
        sid: num('SID'),
        pubchemCid: num('CID'),
        outcome: 'Activity Outcome',
        targetAccession: (r) => r['Target Accession'] || null,
        ncbiGeneId: (r) => r['Target GeneID'] || null,
        activityValue: num('Activity Value [uM]'),
        activityName: (r) => r['Activity Name'] || null,
        assayName: 'Assay Name',
        assayType: 'Assay Type',
        pmid: (r) => r['PubMed ID'] || null
      },
      example: { pubchemCid: 2244, outcome: 'Active' },
      relations: [
        { alias: 'gene', description: 'The NCBI gene of the assay target', catalog: 'ncbi-gene', entity: 'gene', obo: 'ncbigene', type: 'hasOne' },
        { alias: 'article', description: 'The publication describing the assay', catalog: 'pubmed', entity: 'article', obo: 'pubmed', type: 'hasOne' }
      ]
    },
    {
      name: 'literature',
      description: 'PubMed ids of articles that mention a compound, one per row',
      path: '/compound/cid/{pubchemCid}/xrefs/PubMedID/JSON',
      params: {
        pubchemCid: { description: 'PubChem compound id, e.g. 2244' }
      },
      rows: (body) => ((body && body.InformationList && body.InformationList.Information) || [])
        .flatMap((info) => (info.PubMedID || []).map((pmid) => ({ CID: info.CID, pmid: String(pmid) }))),
      fields: {
        pubchemCid: 'CID',
        pmid: 'pmid'
      },
      example: { pubchemCid: 2244 },
      relations: [
        { alias: 'article', description: 'The PubMed record', catalog: 'pubmed', entity: 'article', obo: 'pubmed', type: 'hasOne' },
        { alias: 'europepmc', description: 'The Europe PMC record (abstract, citations, open-access full text)', catalog: 'europepmc', entity: 'article', obo: 'pubmed', type: 'hasOne' }
      ]
    }
  ]
}
