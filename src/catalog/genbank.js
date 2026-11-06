'use strict'

/**
 * GenBank / RefSeq sequence records (NCBI Nucleotide and Protein databases),
 * via NCBI E-utilities.
 * API docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 *
 * Accessions work directly (NM_000546, NP_000537.3, MN908947); search uses
 * Entrez query syntax.  Shares NCBI's rate limit (3 req/s, 10 with
 * apiKeys: { genbank: "…" }).
 */

const { eutils } = require('./ncbi')

const { EUTILS, esearch, esummary, idList } = eutils

const MOLECULE_DBS = new Set(['nuccore', 'protein'])

function moleculeDb (params) {
  const db = params.db || 'nuccore'
  if (!MOLECULE_DBS.has(db)) throw new Error(`genbank: db must be nuccore or protein, got "${db}"`)
  return db
}

const SEQUENCE_FIELDS = {
  accession: 'caption',
  accessionVersion: 'accessionversion',
  gi: 'uid',
  title: 'title',
  length: 'slen',
  moleculeType: 'biomol',
  topology: 'topology',
  sourceDb: 'sourcedb',
  organism: 'organism',
  taxonId: 'taxid',
  strain: 'strain',
  createDate: 'createdate',
  updateDate: 'updatedate'
}

const SEQUENCE_RELATIONS = [
  { alias: 'taxonomy', description: 'The source organism (NCBI Taxonomy)', catalog: 'ncbi-gene', entity: 'taxonomy', obo: 'ncbitaxon', type: 'hasOne' }
]

const DB_PARAM = { description: 'nuccore (nucleotide, default) or protein', default: 'nuccore' }

module.exports = {
  name: 'genbank',
  label: 'GenBank / RefSeq sequences',
  description: 'Nucleotide and protein sequence records from GenBank, RefSeq, EMBL and DDBJ (INSDC) via NCBI E-utilities: accession, title, length, molecule type, organism and dates.',
  category: 'Genes & genomes',
  homepage: 'https://www.ncbi.nlm.nih.gov/genbank/',
  docs: 'https://www.ncbi.nlm.nih.gov/books/NBK25499/',
  license: 'No restrictions on use of GenBank data (NCBI policy); submitters may claim patent/copyright on some sequences',
  driver: 'api',
  ...EUTILS,
  entities: [
    {
      name: 'sequence',
      description: 'One sequence record by accession (or GI), or several',
      params: {
        accession: { required: true, description: 'Accession(.version) or GI, e.g. NM_000546.6, or a list of them' },
        db: DB_PARAM
      },
      resolve: (params, ctx) => esummary(ctx, moleculeDb(params), idList(params.accession)),
      fields: SEQUENCE_FIELDS,
      example: { accession: 'NM_000546.6' },
      relations: SEQUENCE_RELATIONS
    },
    {
      name: 'sequences',
      description: 'Sequence records matching an Entrez query',
      params: {
        term: { required: true, description: 'Entrez query, e.g. "TP53[gene] AND human[orgn] AND refseq[filter] AND biomol_mrna[prop]"' },
        db: DB_PARAM
      },
      resolve: async (params, ctx) => {
        const db = moleculeDb(params)
        return esummary(ctx, db, await esearch(ctx, db, params.term))
      },
      fields: SEQUENCE_FIELDS,
      example: { term: 'TP53[gene] AND human[orgn] AND refseq[filter] AND biomol_mrna[prop]' },
      relations: SEQUENCE_RELATIONS
    }
  ]
}
