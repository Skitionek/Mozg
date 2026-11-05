'use strict'

/**
 * Human Protein Atlas — where human proteins are: tissue and single-cell RNA
 * expression, antibody-based tissue staining, subcellular localisation,
 * blood concentration, secretome and cancer prognostics, gene by gene.
 * API docs: https://www.proteinatlas.org/about/help/dataaccess
 *
 * Record keys are the Atlas's own column titles ("RNA tissue specificity",
 * "Subcellular location"); a few contain dots, which the field path language
 * would read as nesting, so those are read with functions.
 */

const list = (value) => (value == null ? [] : [].concat(value))
const key = (name) => (r) => (Object.hasOwn(r, name) ? r[name] : null)

// "Cancer prognostics - Liver Hepatocellular Carcinoma (TCGA)": {…} — keep the prognostic ones.
function cancerPrognostics (r) {
  const prefix = 'Cancer prognostics - '
  return Object.entries(r)
    .filter(([k, v]) => k.startsWith(prefix) && v && v.is_prognostic)
    .map(([k, v]) => ({
      cancer: k.slice(prefix.length),
      prognosis: v['prognostic type'] || v.prognostic || null,
      pValue: v.p_val != null ? Number(v.p_val) : null
    }))
}

const SUMMARY_FIELDS = {
  ensemblGeneId: 'Ensembl',
  symbol: 'Gene',
  synonyms: (r) => list(r['Gene synonym']),
  name: 'Gene description',
  uniprotAccession: (r) => list(r.Uniprot)[0] || null,
  uniprotAccessions: (r) => list(r.Uniprot),
  chromosome: 'Chromosome',
  position: 'Position',
  proteinClasses: (r) => list(r['Protein class']),
  evidence: 'Evidence',
  rnaTissueSpecificity: 'RNA tissue specificity',
  rnaTissueDistribution: 'RNA tissue distribution',
  subcellularLocations: (r) => list(r['Subcellular location'])
}

module.exports = {
  name: 'proteinatlas',
  label: 'Human Protein Atlas',
  description: 'Tissue, single-cell, blood and cancer expression of every human protein-coding gene, with antibody-based subcellular localisation, secretome classification and cancer prognostic associations.',
  category: 'Expression & samples',
  homepage: 'https://www.proteinatlas.org',
  docs: 'https://www.proteinatlas.org/about/help/dataaccess',
  license: 'CC BY-SA 4.0',
  driver: 'api',
  connection: {
    database: 'https://www.proteinatlas.org',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 2 },
  timeoutMs: 45_000,
  entities: [
    {
      name: 'gene',
      description: 'Protein Atlas summary of one human gene',
      path: '/{ensemblGeneId}.json',
      params: {
        ensemblGeneId: { description: 'Ensembl gene id, e.g. ENSG00000141510' }
      },
      fields: {
        ...SUMMARY_FIELDS,
        biologicalProcesses: (r) => list(r['Biological process']),
        molecularFunctions: (r) => list(r['Molecular function']),
        diseaseInvolvement: (r) => list(r['Disease involvement']),
        rnaTissueSpecificNtpm: 'RNA tissue specific nTPM',
        rnaSingleCellTypeSpecificity: 'RNA single cell type specificity',
        rnaSingleCellTypeSpecificNcpm: 'RNA single cell type specific nCPM',
        rnaBloodCellSpecificity: 'RNA blood cell specificity',
        rnaBrainRegionalSpecificity: 'RNA brain regional specificity',
        rnaCancerSpecificity: 'RNA cancer specificity',
        rnaTissueCellTypeEnrichment: (r) => list(r['RNA tissue cell type enrichment']),
        proteinTissueSpecificity: 'Protein tissue specificity',
        subcellularMainLocations: (r) => list(r['Subcellular main location']),
        subcellularAdditionalLocations: (r) => list(r['Subcellular additional location']),
        secretomeLocation: 'Secretome location',
        bloodConcentrationImmunoassay: key('Blood concentration - Conc. blood IM [pg/L]'),
        bloodConcentrationMassSpec: key('Blood concentration - Conc. blood MS [pg/L]'),
        interactionCount: 'Interactions',
        antibodies: (r) => list(r.Antibody),
        reliabilityTissue: 'Reliability (IH)',
        reliabilitySubcellular: 'Reliability (IF)',
        cancerPrognostics
      },
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: [
        { alias: 'protein', description: 'UniProtKB protein', catalog: 'uniprot', entity: 'protein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' },
        { alias: 'ensembl', description: 'Ensembl gene record', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
        { alias: 'tissueExpression', description: 'Median expression per tissue (GTEx)', catalog: 'gtex', entity: 'expression', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' }
      ]
    },
    {
      name: 'genes',
      description: 'Human genes matching a Protein Atlas search (symbol, name, or advanced query such as "protein_class:FDA approved drug targets")',
      path: '/api/search_download.php',
      params: {
        q: { in: 'query', name: 'search', required: true, description: 'Search term, e.g. EGFR, or an Atlas advanced query' }
      },
      query: (params) => ({
        search: params.q,
        format: 'json',
        compress: 'no',
        columns: 'g,gs,eg,gd,up,chr,chrp,pc,pe,rnats,rnatd,scl'
      }),
      fields: SUMMARY_FIELDS,
      example: { q: 'EGFR' },
      relations: [
        { alias: 'gene', description: 'Full Protein Atlas record', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' }
      ]
    }
  ]
}
