'use strict'

const { stripTags } = require('../database/text')

/**
 * InterPro — protein families, domains and functional sites, integrating
 * Pfam, PROSITE, PANTHER, CDD, SMART and other member databases.
 * API docs: https://github.com/ProteinsWebTeam/interpro7-api/tree/master/docs
 *
 * An empty result is answered with 204 No Content.
 */

const upper = (v) => (v == null ? v : String(v).toUpperCase())

const stripHtml = (text) => (text == null ? null : stripTags(String(text).replace(/\[\[cite:[^\]]+\]\]/g, '')))

const locations = (r) => ((r.proteins && r.proteins[0] && r.proteins[0].entry_protein_locations) || [])
  .flatMap((loc) => (loc.fragments || []).map((f) => ({ start: f.start, end: f.end })))

const memberSignatures = (members) => Object.entries(members || {})
  .flatMap(([db, sigs]) => Object.keys(sigs || {}).map((acc) => `${db}:${acc}`))

module.exports = {
  name: 'interpro',
  label: 'InterPro',
  description: 'InterPro classifies proteins into families and predicts domains and important sites, integrating 13 member databases (Pfam, PROSITE, PANTHER, CDD, SMART, …) with GO annotations.',
  category: 'Proteins & structures',
  homepage: 'https://www.ebi.ac.uk/interpro/',
  docs: 'https://github.com/ProteinsWebTeam/interpro7-api/tree/master/docs',
  license: 'CC0 1.0',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/interpro/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  timeoutMs: 45_000,
  entities: [
    {
      name: 'proteinEntries',
      description: 'InterPro (or member-database) entries matched on one UniProt protein, with match positions',
      path: '/entry/{sourceDatabase}/protein/uniprot/{uniprotAccession}',
      params: {
        uniprotAccession: { description: 'UniProtKB accession, e.g. P04637', transform: upper },
        sourceDatabase: { default: 'interpro', description: 'interpro (default), or a member database: pfam, prosite, panther, cdd, smart, cathgene3d, …' }
      },
      // One page holds every entry for practically any protein.
      query: { page_size: 200 },
      rows: 'results',
      fields: {
        accession: 'metadata.accession',
        interproId: (r) => (r.metadata.source_database === 'interpro' ? r.metadata.accession : r.metadata.integrated),
        sourceDatabase: 'metadata.source_database',
        name: 'metadata.name',
        type: 'metadata.type',
        uniprotAccession: (r, params) => upper(params.uniprotAccession),
        start: (r) => (locations(r)[0] || {}).start || null,
        end: (r) => (locations(r)[0] || {}).end || null,
        locations,
        goIds: 'metadata.go_terms[].identifier',
        memberSignatures: (r) => memberSignatures(r.metadata.member_databases)
      },
      paginate: { limit: 'page_size', max: 200 },
      example: { uniprotAccession: 'P04637' },
      relations: [
        { alias: 'entry', description: 'Full InterPro entry (description, GO terms, literature)', entity: 'entry', obo: 'interpro', type: 'hasOne' },
        { alias: 'protein', description: 'The UniProtKB entry', catalog: 'uniprot', entity: 'protein', obo: 'uniprot', type: 'hasOne' }
      ]
    },
    {
      name: 'entry',
      description: 'One InterPro entry (family, domain, repeat or site)',
      path: '/entry/interpro/{interproId}',
      params: {
        interproId: { description: 'InterPro accession, e.g. IPR011615', transform: upper }
      },
      rows: 'metadata',
      fields: {
        interproId: 'accession',
        name: 'name.name',
        shortName: 'name.short',
        type: 'type',
        description: (r) => stripHtml(r.description && r.description[0] && (r.description[0].text || r.description[0])),
        goIds: 'go_terms[].identifier',
        goTerms: 'go_terms[].name',
        memberSignatures: (r) => memberSignatures(r.member_databases),
        parentId: (r) => (r.hierarchy && r.hierarchy.accession !== r.accession ? r.hierarchy.accession : null),
        overlapsWith: 'overlaps_with[].accession',
        proteinCount: 'counters.proteins',
        structureCount: 'counters.structures',
        representativePdbId: (r) => (r.representative_structure && r.representative_structure.accession ? upper(r.representative_structure.accession) : null),
        pmids: (r) => Object.values(r.literature || {}).map((ref) => ref.PMID).filter(Boolean).map(String)
      },
      example: { interproId: 'IPR011615' },
      relations: [
        { alias: 'reviewedProteins', description: 'Swiss-Prot proteins containing this entry', entity: 'reviewedProteins', obo: 'interpro', type: 'hasMany' },
        { alias: 'representativeStructure', description: 'Representative PDB structure', catalog: 'pdb', entity: 'entry', obo: 'pdb', type: 'hasOne' }
      ]
    },
    {
      name: 'reviewedProteins',
      description: 'Reviewed (Swiss-Prot) proteins that contain an InterPro entry',
      path: '/protein/reviewed/entry/interpro/{interproId}',
      params: {
        interproId: { description: 'InterPro accession, e.g. IPR011615', transform: upper }
      },
      rows: 'results',
      fields: {
        uniprotAccession: (r) => upper(r.metadata.accession),
        name: 'metadata.name',
        symbol: 'metadata.gene',
        length: 'metadata.length',
        taxonId: (r) => (r.metadata.source_organism && r.metadata.source_organism.taxId ? Number(r.metadata.source_organism.taxId) : null),
        organism: 'metadata.source_organism.scientificName',
        interproId: (r, params) => upper(params.interproId),
        start: 'entries[0].entry_protein_locations[0].fragments[0].start',
        end: 'entries[0].entry_protein_locations[0].fragments[0].end'
      },
      paginate: { limit: 'page_size', max: 200 },
      example: { interproId: 'IPR011615' },
      relations: [
        { alias: 'protein', description: 'The UniProtKB entry', catalog: 'uniprot', entity: 'protein', obo: 'uniprot', type: 'hasOne' },
        { alias: 'alphafold', description: 'AlphaFold prediction for the protein', catalog: 'alphafold', entity: 'prediction', obo: 'uniprot', type: 'hasOne' }
      ]
    }
  ]
}
