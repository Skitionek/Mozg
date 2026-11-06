'use strict'

/**
 * AlphaFold Protein Structure Database — predicted structures for UniProt
 * proteins, from Google DeepMind and EMBL-EBI.
 * API docs: https://alphafold.ebi.ac.uk/api-docs
 *
 * A prediction request for an accession returns the canonical model first,
 * followed by one model per isoform (`P04637-2`, …).
 */

const upper = (v) => (v == null ? v : String(v).toUpperCase())
const baseAccession = (v) => (v == null ? null : String(v).replace(/-\d+$/, ''))

module.exports = {
  name: 'alphafold',
  label: 'AlphaFold DB',
  description: 'AlphaFold Protein Structure Database: 200M+ predicted protein structures with per-residue confidence (pLDDT) and links to model files, keyed by UniProt accession.',
  category: 'Proteins & structures',
  homepage: 'https://alphafold.ebi.ac.uk',
  docs: 'https://alphafold.ebi.ac.uk/api-docs',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://alphafold.ebi.ac.uk/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  // An accession AlphaFold has no model for is answered with 400, not 404.
  emptyStatus: [400, 404],
  entities: [
    {
      name: 'prediction',
      description: 'AlphaFold models for a UniProt protein — the canonical sequence first, then isoforms',
      path: '/prediction/{uniprotAccession}',
      params: {
        uniprotAccession: { description: 'UniProtKB accession, e.g. P04637', transform: upper }
      },
      fields: {
        modelId: 'modelEntityId|entryId',
        uniprotAccession: (r) => baseAccession(r.uniprotAccession),
        isoformAccession: 'uniprotAccession',
        entryName: 'uniprotId',
        description: 'uniprotDescription',
        symbol: 'gene',
        organism: 'organismScientificName',
        taxonId: 'taxId',
        reviewed: 'isUniProtReviewed',
        sequenceStart: 'sequenceStart',
        sequenceEnd: 'sequenceEnd',
        meanPlddt: 'globalMetricValue',
        fractionVeryHighConfidence: 'fractionPlddtVeryHigh',
        fractionConfident: 'fractionPlddtConfident',
        fractionLowConfidence: 'fractionPlddtLow',
        fractionVeryLowConfidence: 'fractionPlddtVeryLow',
        modelVersion: 'latestVersion',
        modelCreatedDate: (r) => (r.modelCreatedDate ? String(r.modelCreatedDate).slice(0, 10) : null),
        cifUrl: 'cifUrl',
        pdbUrl: 'pdbUrl',
        paeImageUrl: 'paeImageUrl',
        paeDocUrl: 'paeDocUrl',
        sequence: 'sequence|uniprotSequence'
      },
      example: { uniprotAccession: 'P04637' },
      relations: [
        { alias: 'protein', description: 'The UniProtKB entry this model predicts', catalog: 'uniprot', entity: 'protein', obo: 'uniprot', type: 'hasOne' },
        { alias: 'experimentalStructures', description: 'Experimental PDB structures of the same protein, for comparison (PDBe SIFTS)', catalog: 'pdbe', entity: 'bestStructures', obo: 'uniprot', type: 'hasMany' },
        { alias: 'domains', description: 'InterPro entries matched on the protein', catalog: 'interpro', entity: 'proteinEntries', obo: 'uniprot', type: 'hasMany' }
      ]
    }
  ]
}
