'use strict'

/**
 * RCSB PDB — the US Protein Data Bank's Data API.
 * API docs: https://data.rcsb.org/redoc/index.html
 *
 * Entries (`1TUP`) contain polymer entities (one per distinct chain sequence),
 * which carry the UniProt mapping (SIFTS), and non-polymer components
 * (ligands) identified by chemical component id (`HEM`).
 */

const GRAPHQL_URL = 'https://data.rcsb.org/graphql'

const upper = (v) => (v == null ? v : String(v).toUpperCase())
const date = (v) => (v ? String(v).slice(0, 10) : null)

// The REST polymer_entity record and the GraphQL selection below share one
// shape, so both entities use these fields.
const POLYMER_ENTITY_FIELDS = {
  pdbId: 'rcsb_polymer_entity_container_identifiers.entry_id',
  entityId: 'rcsb_polymer_entity_container_identifiers.entity_id',
  description: 'rcsb_polymer_entity.pdbx_description',
  polymerType: 'entity_poly.rcsb_entity_polymer_type',
  chainIds: (r) => (r.entity_poly && r.entity_poly.pdbx_strand_id ? r.entity_poly.pdbx_strand_id.split(',') : []),
  length: 'entity_poly.rcsb_sample_sequence_length',
  formulaWeight: 'rcsb_polymer_entity.formula_weight',
  ecNumber: 'rcsb_polymer_entity.pdbx_ec',
  uniprotAccession: 'rcsb_polymer_entity_container_identifiers.uniprot_ids[0]',
  uniprotAccessions: (r) => (r.rcsb_polymer_entity_container_identifiers && r.rcsb_polymer_entity_container_identifiers.uniprot_ids) || [],
  taxonId: 'rcsb_entity_source_organism[0].ncbi_taxonomy_id',
  organism: 'rcsb_entity_source_organism[0].ncbi_scientific_name',
  sequence: 'entity_poly.pdbx_seq_one_letter_code_can'
}

const POLYMER_ENTITY_GRAPHQL = `query ($id: String!) {
  entry(entry_id: $id) {
    polymer_entities {
      rcsb_polymer_entity_container_identifiers { entry_id entity_id uniprot_ids }
      rcsb_polymer_entity { pdbx_description formula_weight pdbx_ec }
      entity_poly { rcsb_entity_polymer_type pdbx_strand_id rcsb_sample_sequence_length pdbx_seq_one_letter_code_can }
      rcsb_entity_source_organism { ncbi_taxonomy_id ncbi_scientific_name }
    }
  }
}`

const POLYMER_ENTITY_RELATIONS = [
  { alias: 'protein', description: 'The UniProtKB entry this polymer entity maps to (SIFTS)', catalog: 'uniprot', entity: 'protein', obo: 'uniprot', type: 'hasOne' },
  { alias: 'alphafold', description: 'AlphaFold prediction for the mapped UniProt protein', catalog: 'alphafold', entity: 'prediction', obo: 'uniprot', type: 'hasOne' },
  { alias: 'domains', description: 'InterPro entries matched on the mapped UniProt protein', catalog: 'interpro', entity: 'proteinEntries', obo: 'uniprot', type: 'hasMany' },
  { alias: 'entry', description: 'The PDB entry this entity belongs to', entity: 'entry', obo: 'pdb', type: 'hasOne' },
  { alias: 'taxonomy', description: 'Source organism taxonomy', catalog: 'uniprot', entity: 'taxonomy', obo: 'ncbitaxon', type: 'hasOne' }
]

module.exports = {
  name: 'pdb',
  label: 'RCSB PDB',
  description: 'RCSB Protein Data Bank: experimentally determined 3D structures of proteins, nucleic acids and complexes — entries, polymer entities with their UniProt mappings, assemblies and ligands.',
  category: 'Proteins & structures',
  homepage: 'https://www.rcsb.org',
  docs: 'https://data.rcsb.org/redoc/index.html',
  license: 'CC0 1.0',
  driver: 'api',
  connection: {
    database: 'https://data.rcsb.org/rest/v1/core',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'entry',
      description: 'One PDB entry (a deposited structure)',
      path: '/entry/{pdbId}',
      params: {
        pdbId: { description: 'Four-character PDB id, e.g. 1TUP', transform: upper }
      },
      fields: {
        pdbId: 'rcsb_id',
        title: 'struct.title',
        keywords: 'struct_keywords.pdbx_keywords',
        experimentalMethod: 'exptl[0].method',
        resolution: 'rcsb_entry_info.resolution_combined[0]',
        molecularWeight: 'rcsb_entry_info.molecular_weight',
        depositedAtomCount: 'rcsb_entry_info.deposited_atom_count',
        polymerEntityCount: 'rcsb_entry_info.polymer_entity_count',
        polymerEntityIds: 'rcsb_entry_container_identifiers.polymer_entity_ids',
        nonPolymerEntityIds: 'rcsb_entry_container_identifiers.non_polymer_entity_ids',
        assemblyIds: 'rcsb_entry_container_identifiers.assembly_ids',
        ligandIds: 'rcsb_entry_info.nonpolymer_bound_components',
        depositionDate: (r) => date(r.rcsb_accession_info && r.rcsb_accession_info.deposit_date),
        releaseDate: (r) => date(r.rcsb_accession_info && r.rcsb_accession_info.initial_release_date),
        revisionDate: (r) => date(r.rcsb_accession_info && r.rcsb_accession_info.revision_date),
        pmid: (r) => {
          const id = (r.rcsb_entry_container_identifiers && r.rcsb_entry_container_identifiers.pubmed_id) ||
            (r.rcsb_primary_citation && r.rcsb_primary_citation.pdbx_database_id_PubMed)
          return id != null ? String(id) : null
        },
        doi: 'rcsb_primary_citation.pdbx_database_id_DOI',
        citationTitle: 'rcsb_primary_citation.title',
        journal: 'rcsb_primary_citation.rcsb_journal_abbrev|rcsb_primary_citation.journal_abbrev',
        year: 'rcsb_primary_citation.year',
        authors: 'rcsb_primary_citation.rcsb_authors'
      },
      example: { pdbId: '1TUP' },
      relations: [
        { alias: 'polymerEntities', description: 'Distinct polymer chains with their UniProt mappings', entity: 'polymerEntities', obo: 'pdb', type: 'hasMany' },
        { alias: 'ligands', description: 'Bound small molecules (PDBe)', catalog: 'pdbe', entity: 'ligands', obo: 'pdb', type: 'hasMany' },
        { alias: 'uniprotMappings', description: 'Chain-to-UniProt residue mappings (PDBe SIFTS)', catalog: 'pdbe', entity: 'uniprotMappings', obo: 'pdb', type: 'hasMany' },
        { alias: 'publication', description: 'Primary citation in PubMed', catalog: 'pubmed', entity: 'article', obo: 'pubmed', type: 'hasOne' }
      ]
    },
    {
      name: 'polymerEntities',
      description: 'Every polymer entity (distinct chain) of a PDB entry',
      path: null,
      params: {
        pdbId: { required: true, description: 'Four-character PDB id, e.g. 1TUP' }
      },
      resolve: async (params, ctx) => {
        const body = await ctx.request(GRAPHQL_URL, {
          method: 'POST',
          body: { query: POLYMER_ENTITY_GRAPHQL, variables: { id: upper(params.pdbId) } }
        })
        if (body && Array.isArray(body.errors) && body.errors.length && !(body.data && body.data.entry)) {
          throw new Error(`pdb/polymerEntities: ${body.errors.map((e) => e.message).join('; ')}`)
        }
        return (body && body.data && body.data.entry && body.data.entry.polymer_entities) || []
      },
      fields: POLYMER_ENTITY_FIELDS,
      example: { pdbId: '1TUP' },
      relations: POLYMER_ENTITY_RELATIONS
    },
    {
      name: 'polymerEntity',
      description: 'One polymer entity (distinct chain sequence) of a PDB entry',
      path: '/polymer_entity/{pdbId}/{entityId}',
      params: {
        pdbId: { description: 'Four-character PDB id, e.g. 4HHB', transform: upper },
        entityId: { description: 'Entity number within the entry, e.g. 1' }
      },
      fields: POLYMER_ENTITY_FIELDS,
      example: { pdbId: '4HHB', entityId: 1 },
      relations: POLYMER_ENTITY_RELATIONS
    },
    {
      name: 'assembly',
      description: 'A biological assembly of a PDB entry (the likely functional form)',
      path: '/assembly/{pdbId}/{assemblyId}',
      params: {
        pdbId: { description: 'Four-character PDB id, e.g. 4HHB', transform: upper },
        assemblyId: { description: 'Assembly number, usually 1', default: 1 }
      },
      fields: {
        pdbId: 'rcsb_assembly_container_identifiers.entry_id',
        assemblyId: 'rcsb_assembly_container_identifiers.assembly_id',
        oligomericState: 'rcsb_struct_symmetry[0].oligomeric_state',
        oligomericCount: 'pdbx_struct_assembly.oligomeric_count',
        stoichiometry: 'rcsb_struct_symmetry[0].stoichiometry',
        symmetry: 'rcsb_struct_symmetry[0].symbol',
        symmetryType: 'rcsb_struct_symmetry[0].type',
        polymerEntityInstanceCount: 'rcsb_assembly_info.polymer_entity_instance_count',
        method: 'pdbx_struct_assembly.method_details',
        details: 'pdbx_struct_assembly.details'
      },
      example: { pdbId: '4HHB', assemblyId: 1 },
      relations: [
        { alias: 'entry', description: 'The PDB entry this assembly belongs to', entity: 'entry', obo: 'pdb', type: 'hasOne' }
      ]
    },
    {
      name: 'chemicalComponent',
      obo: { chemblId: 'chembl.compound' },
      description: 'A chemical component (ligand, residue or ion) from the PDB Chemical Component Dictionary',
      path: '/chemcomp/{compId}',
      params: {
        compId: { description: 'Chemical component id, e.g. HEM or ATP', transform: upper }
      },
      fields: {
        compId: 'chem_comp.id',
        name: 'chem_comp.name',
        type: 'chem_comp.type',
        formula: 'chem_comp.formula',
        formulaWeight: 'chem_comp.formula_weight',
        inchiKey: 'rcsb_chem_comp_descriptor.InChIKey',
        inchi: 'rcsb_chem_comp_descriptor.InChI',
        smiles: 'rcsb_chem_comp_descriptor.SMILES_stereo|rcsb_chem_comp_descriptor.SMILES',
        drugbankId: 'rcsb_chem_comp_container_identifiers.drugbank_id',
        chemblId: (r) => {
          const rel = (r.rcsb_chem_comp_related || []).find((x) => x.resource_name === 'ChEMBL')
          return rel ? rel.resource_accession_code : null
        },
        synonyms: 'rcsb_chem_comp_synonyms[].name'
      },
      example: { compId: 'HEM' },
      relations: [
        { alias: 'compound', description: 'The PubChem compound with the same InChIKey', catalog: 'pubchem', entity: 'compoundByInchiKey', obo: 'inchikey', type: 'hasOne' },
        { alias: 'molecule', description: 'The ChEMBL molecule for this component', catalog: 'chembl', entity: 'molecule', obo: 'chembl.compound', type: 'hasOne' }
      ]
    }
  ]
}
