'use strict'

/**
 * UniProt — the universal protein knowledgebase (Swiss-Prot + TrEMBL).
 * API docs: https://www.uniprot.org/help/api
 *
 * UniProtKB entries cross-reference almost every other resource, which makes
 * `protein` the natural hub for joining genes, structures, pathways,
 * interactions and drug targets together.
 */

const xrefs = (record, database) => (record.uniProtKBCrossReferences || []).filter((x) => x.database === database)
const xrefProperty = (xref, key) => ((xref.properties || []).find((p) => p.key === key) || {}).value
const firstXref = (database) => (record) => {
  const [x] = xrefs(record, database)
  return x ? x.id : null
}
const unversioned = (id) => (id ? String(id).replace(/\.\d+$/, '') : null)

// Fields shared by every entity that returns UniProtKB entries.
const PROTEIN_FIELDS = {
  uniprotAccession: 'primaryAccession',
  entryName: 'uniProtkbId',
  reviewed: (r) => (r.entryType ? r.entryType.includes('reviewed (Swiss-Prot)') : null),
  name: 'proteinDescription.recommendedName.fullName.value|proteinDescription.submissionNames[0].fullName.value',
  symbol: 'genes[0].geneName.value|genes[0].orderedLocusNames[0].value',
  synonyms: 'genes[0].synonyms[].value',
  organism: 'organism.scientificName',
  taxonId: 'organism.taxonId',
  length: 'sequence.length',
  mass: 'sequence.molWeight',
  annotationScore: 'annotationScore',
  function: (r) => {
    const c = (r.comments || []).find((x) => x.commentType === 'FUNCTION')
    return c && c.texts && c.texts[0] ? c.texts[0].value : null
  },
  subcellularLocations: (r) => [...new Set((r.comments || [])
    .filter((x) => x.commentType === 'SUBCELLULAR LOCATION')
    .flatMap((x) => (x.subcellularLocations || []).map((l) => l.location && l.location.value))
    .filter(Boolean))],
  keywords: 'keywords[].name',
  ensemblGeneId: (r) => {
    const [x] = xrefs(r, 'Ensembl')
    return x ? unversioned(xrefProperty(x, 'GeneId')) : null
  },
  ncbiGeneId: firstXref('GeneID'),
  hgncId: firstXref('HGNC'),
  keggId: firstXref('KEGG'),
  stringId: firstXref('STRING'),
  chemblId: firstXref('ChEMBL'),
  pdbIds: (r) => xrefs(r, 'PDB').map((x) => x.id),
  reactomeIds: (r) => xrefs(r, 'Reactome').map((x) => x.id),
  sequence: 'sequence.value'
}

// Builds a UniProt query string from the friendlier where keys.
function searchQuery (params) {
  const terms = []
  if (params.query) terms.push(`(${params.query})`)
  if (params.symbol) terms.push(`gene_exact:${params.symbol}`)
  if (params.ensemblGeneId) terms.push(`xref:ensembl-${params.ensemblGeneId}`)
  if (params.ncbiGeneId) terms.push(`xref:geneid-${params.ncbiGeneId}`)
  if (params.stringId) terms.push(`xref:string-${params.stringId}`)
  if (params.taxonId) terms.push(`organism_id:${params.taxonId}`)
  if (params.reviewed != null) terms.push(`reviewed:${params.reviewed}`)
  if (terms.length === 0) throw new Error('uniprot/proteins needs at least one of query, symbol, ensemblGeneId, ncbiGeneId, stringId or taxonId')
  return { query: terms.join(' AND '), format: 'json' }
}

const PROTEIN_RELATIONS = [
  { alias: 'structures', description: 'Experimental PDB structures mapped to this protein, best coverage first (PDBe SIFTS; top 50 — query pdbe/bestStructures for all)', catalog: 'pdbe', entity: 'bestStructures', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasMany', limit: 50 },
  { alias: 'alphafold', description: 'AlphaFold predicted structure', catalog: 'alphafold', entity: 'prediction', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' },
  { alias: 'domains', description: 'InterPro families, domains and sites matched on this protein', catalog: 'interpro', entity: 'proteinEntries', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasMany' },
  { alias: 'goAnnotations', description: 'Gene Ontology annotations (QuickGO)', catalog: 'quickgo', entity: 'annotations', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasMany' },
  { alias: 'pathways', description: 'Reactome pathways this protein participates in', catalog: 'reactome', entity: 'pathwaysForProtein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasMany' },
  { alias: 'interactions', description: 'Curated molecular interactions (IntAct)', catalog: 'intact', entity: 'interactions', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasMany' },
  { alias: 'reactions', description: 'Biochemical reactions catalysed (Rhea)', catalog: 'rhea', entity: 'reactions', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasMany' },
  { alias: 'drugTargets', description: 'ChEMBL drug targets that include this protein', catalog: 'chembl', entity: 'targetsForProtein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasMany' },
  { alias: 'gene', description: 'The Ensembl gene encoding this protein', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'target', description: 'Open Targets target record (tractability, safety, disease associations)', catalog: 'opentargets', entity: 'target', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'taxonomy', description: 'Taxonomy node of the source organism', entity: 'taxonomy', localKey: 'taxonId', foreignKey: 'taxonId', type: 'hasOne' }
]

module.exports = {
  name: 'uniprot',
  label: 'UniProt',
  description: 'Universal protein knowledgebase: sequences, function, localisation and cross-references for 250M+ proteins. Reviewed (Swiss-Prot) entries are manually curated.',
  category: 'Proteins & structures',
  homepage: 'https://www.uniprot.org',
  docs: 'https://www.uniprot.org/help/api',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://rest.uniprot.org',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 10, maxConcurrent: 4 },
  entities: [
    {
      name: 'protein',
      description: 'One UniProtKB entry by accession',
      path: '/uniprotkb/{uniprotAccession}',
      params: {
        uniprotAccession: { description: 'UniProtKB accession, e.g. P04637' }
      },
      query: { format: 'json' },
      fields: PROTEIN_FIELDS,
      example: { uniprotAccession: 'P04637' },
      relations: PROTEIN_RELATIONS
    },
    {
      name: 'proteins',
      description: 'UniProtKB entries matching a gene, organism or free query',
      path: '/uniprotkb/search',
      params: {
        symbol: { description: 'Exact gene symbol, e.g. TP53' },
        taxonId: { description: 'NCBI taxonomy id of the organism, e.g. 9606' },
        ensemblGeneId: { description: 'Proteins cross-referenced to this Ensembl gene' },
        ncbiGeneId: { description: 'Proteins cross-referenced to this NCBI gene' },
        stringId: { description: 'Proteins cross-referenced to this STRING id, e.g. 9606.ENSP00000269305' },
        reviewed: { description: 'true for Swiss-Prot only, false for TrEMBL only' },
        query: { description: 'Raw UniProt query syntax, ANDed with the above — https://www.uniprot.org/help/query-fields' }
      },
      query: searchQuery,
      rows: 'results',
      fields: PROTEIN_FIELDS,
      paginate: { limit: 'size', max: 500 },
      example: { symbol: 'TP53', taxonId: 9606, reviewed: true },
      relations: PROTEIN_RELATIONS
    },
    {
      name: 'taxonomy',
      description: 'A node of the UniProt taxonomy',
      path: '/taxonomy/{taxonId}',
      params: {
        taxonId: { description: 'NCBI taxonomy id, e.g. 9606' }
      },
      query: { format: 'json' },
      fields: {
        taxonId: 'taxonId',
        scientificName: 'scientificName',
        commonName: 'commonName',
        mnemonic: 'mnemonic',
        rank: 'rank',
        parentTaxonId: 'parent.taxonId',
        lineage: 'lineage[].scientificName',
        reviewedProteinCount: 'statistics.reviewedProteinCount',
        unreviewedProteinCount: 'statistics.unreviewedProteinCount'
      },
      example: { taxonId: 9606 },
      relations: [
        { alias: 'parent', description: 'Parent taxon', entity: 'taxonomy', localKey: 'parentTaxonId', foreignKey: 'taxonId', type: 'hasOne' }
      ]
    }
  ]
}
