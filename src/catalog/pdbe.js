'use strict'

/**
 * PDBe — the Protein Data Bank in Europe, and its SIFTS residue-level mapping
 * between PDB chains and UniProt sequences.
 * API docs: https://www.ebi.ac.uk/pdbe/api/doc/
 *
 * Every PDBe response is an object keyed by the identifier that was asked
 * for (`{ "P04637": [ … ] }`, `{ "1tup": [ … ] }`), in whatever case PDBe
 * prefers, so rows are read from the single top-level value.
 */

const upper = (v) => (v == null ? v : String(v).toUpperCase())
const lower = (v) => (v == null ? v : String(v).toLowerCase())

// The one value of a single-key object, whatever case the key came back in.
const onlyValue = (body) => {
  if (!body || typeof body !== 'object') return []
  const keys = Object.keys(body)
  return keys.length ? body[keys[0]] : []
}

module.exports = {
  name: 'pdbe',
  label: 'PDBe',
  description: 'Protein Data Bank in Europe: structure summaries, bound ligands, and SIFTS mappings that tie PDB chains to UniProt residues — including the best structures covering any UniProt protein.',
  category: 'Proteins & structures',
  homepage: 'https://www.ebi.ac.uk/pdbe/',
  docs: 'https://www.ebi.ac.uk/pdbe/api/doc/',
  license: 'CC0 1.0 (PDB data); EMBL-EBI terms of use',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/pdbe/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  entities: [
    {
      name: 'bestStructures',
      description: 'PDB chains covering a UniProt protein, best first (by coverage, then resolution)',
      path: '/mappings/best_structures/{uniprotAccession}',
      params: {
        uniprotAccession: { description: 'UniProtKB accession, e.g. P04637', transform: upper }
      },
      rows: onlyValue,
      fields: {
        pdbId: (r) => upper(r.pdb_id),
        chainId: 'chain_id',
        uniprotAccession: (r, params) => upper(params.uniprotAccession),
        coverage: 'coverage',
        resolution: 'resolution',
        experimentalMethod: 'experimental_method',
        taxonId: 'tax_id',
        uniprotStart: 'unp_start',
        uniprotEnd: 'unp_end',
        chainStart: 'start',
        chainEnd: 'end'
      },
      example: { uniprotAccession: 'P04637' },
      relations: [
        { alias: 'entry', description: 'The RCSB PDB entry for this structure', catalog: 'pdb', entity: 'entry', localKey: 'pdbId', foreignKey: 'pdbId', type: 'hasOne' },
        { alias: 'summary', description: 'PDBe summary of this structure', entity: 'entry', localKey: 'pdbId', foreignKey: 'pdbId', type: 'hasOne' },
        { alias: 'ligands', description: 'Small molecules bound in this structure', entity: 'ligands', localKey: 'pdbId', foreignKey: 'pdbId', type: 'hasMany' }
      ]
    },
    {
      name: 'entry',
      description: 'PDBe summary of one PDB entry',
      path: '/pdb/entry/summary/{pdbId}',
      params: {
        pdbId: { description: 'Four-character PDB id, e.g. 1TUP', transform: lower }
      },
      rows: onlyValue,
      fields: {
        pdbId: (r, params) => upper(params.pdbId),
        title: 'title',
        experimentalMethods: 'experimental_method',
        depositionDate: (r) => (r.deposition_date ? `${r.deposition_date.slice(0, 4)}-${r.deposition_date.slice(4, 6)}-${r.deposition_date.slice(6, 8)}` : null),
        releaseDate: (r) => (r.release_date ? `${r.release_date.slice(0, 4)}-${r.release_date.slice(4, 6)}-${r.release_date.slice(6, 8)}` : null),
        authors: 'entry_authors',
        polypeptideEntityCount: 'number_of_entities.polypeptide',
        dnaEntityCount: 'number_of_entities.dna',
        rnaEntityCount: 'number_of_entities.rna',
        ligandEntityCount: 'number_of_entities.ligand',
        preferredAssembly: (r) => {
          const a = (r.assemblies || []).find((x) => x.preferred) || (r.assemblies || [])[0]
          return a ? `${a.name} (${a.form})` : null
        },
        relatedStructures: 'related_structures'
      },
      example: { pdbId: '1TUP' },
      relations: [
        { alias: 'rcsb', description: 'The same entry in the RCSB Data API', catalog: 'pdb', entity: 'entry', localKey: 'pdbId', foreignKey: 'pdbId', type: 'hasOne' },
        { alias: 'ligands', description: 'Small molecules bound in this structure', entity: 'ligands', localKey: 'pdbId', foreignKey: 'pdbId', type: 'hasMany' },
        { alias: 'uniprotMappings', description: 'Chain-to-UniProt residue mappings', entity: 'uniprotMappings', localKey: 'pdbId', foreignKey: 'pdbId', type: 'hasMany' }
      ]
    },
    {
      name: 'ligands',
      description: 'Small molecules (ligands, ions) bound in a PDB entry, one row per bound instance',
      path: '/pdb/entry/ligand_monomers/{pdbId}',
      params: {
        pdbId: { description: 'Four-character PDB id, e.g. 4HHB', transform: lower }
      },
      rows: onlyValue,
      fields: {
        pdbId: (r, params) => upper(params.pdbId),
        compId: 'chem_comp_id',
        name: 'chem_comp_name',
        weight: 'weight',
        chainId: 'chain_id',
        entityId: 'entity_id',
        residueNumber: 'author_residue_number'
      },
      example: { pdbId: '4HHB' },
      relations: [
        { alias: 'component', description: 'Chemical component dictionary entry (formula, InChIKey, SMILES)', catalog: 'pdb', entity: 'chemicalComponent', localKey: 'compId', foreignKey: 'compId', type: 'hasOne' }
      ]
    },
    {
      name: 'uniprotMappings',
      description: 'SIFTS mappings from the chains of a PDB entry to UniProt residue ranges',
      path: '/mappings/uniprot/{pdbId}',
      params: {
        pdbId: { description: 'Four-character PDB id, e.g. 1TUP', transform: lower }
      },
      rows: (body) => {
        const mapped = onlyValue(body)
        const uniprot = (mapped && mapped.UniProt) || {}
        return Object.entries(uniprot).flatMap(([accession, info]) =>
          (info.mappings || []).map((m) => ({ ...m, accession, identifier: info.identifier, name: info.name })))
      },
      fields: {
        pdbId: (r, params) => upper(params.pdbId),
        uniprotAccession: 'accession',
        entryName: 'name|identifier',
        entityId: 'entity_id',
        chainId: 'chain_id',
        uniprotStart: 'unp_start',
        uniprotEnd: 'unp_end',
        chainStart: 'start.residue_number',
        chainEnd: 'end.residue_number',
        identity: 'identity',
        coverage: 'coverage'
      },
      example: { pdbId: '1TUP' },
      relations: [
        { alias: 'protein', description: 'The mapped UniProtKB entry', catalog: 'uniprot', entity: 'protein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' }
      ]
    }
  ]
}
