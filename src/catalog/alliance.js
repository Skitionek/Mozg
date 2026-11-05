'use strict'

/**
 * Alliance of Genome Resources — one API over the model-organism databases:
 * MGI (mouse), RGD (rat), SGD (yeast), ZFIN (zebrafish), WormBase
 * (C. elegans), FlyBase (Drosophila) and Xenbase (frog), plus human genes via
 * HGNC.  Gene ids are prefixed CURIEs: HGNC:11998, MGI:98834, RGD:3889,
 * ZFIN:ZDB-GENE-990415-270, WB:WBGene00000912, FB:FBgn0000490, SGD:S000001855.
 * API docs: https://www.alliancegenome.org/swagger-ui/
 */

const xrefs = (gene, prefix) => (gene.crossReferences || [])
  .map((x) => x.referencedCurie)
  .filter((c) => c && c.startsWith(`${prefix}:`))
  .map((c) => c.slice(prefix.length + 1))
const firstXref = (prefix) => (r) => xrefs(r.gene || {}, prefix)[0] || null
const taxonNumber = (curie) => (curie ? Number(String(curie).replace(/^NCBITaxon:/, '')) : null)
const note = (gene, type) => ((gene.relatedNotes || []).find((n) => n.noteType && n.noteType.name === type) || {}).freeText || null
const pmids = (r) => (r.pubmedPublications || []).map((p) => String(p.referencedCurie || '').replace(/^PMID:/, '')).filter(Boolean)

const GENE_FIELDS = {
  geneId: 'gene.primaryExternalId',
  symbol: 'gene.geneSymbol.displayText',
  name: 'gene.geneFullName.displayText',
  species: 'gene.taxon.name',
  taxonId: (r) => taxonNumber(r.gene && r.gene.taxon && r.gene.taxon.curie),
  geneType: 'gene.geneType.name',
  synonyms: 'gene.geneSynonyms[].displayText',
  description: (r) => note(r.gene || {}, 'automated_gene_description') || note(r.gene || {}, 'MOD_provided_gene_description'),
  dataProvider: 'gene.dataProvider.abbreviation',
  chromosome: 'gene.geneGenomicLocationAssociations[0].geneGenomicLocationAssociationObject.name',
  start: 'gene.geneGenomicLocationAssociations[0].start',
  end: 'gene.geneGenomicLocationAssociations[0].end',
  strand: 'gene.geneGenomicLocationAssociations[0].strand',
  // The gene-centric reference protein when the member database names one,
  // otherwise the first UniProtKB cross-reference.
  uniprotAccession: (r) => {
    const curie = r.gene && r.gene.gcrpCrossReference && r.gene.gcrpCrossReference.referencedCurie
    if (curie && curie.startsWith('UniProtKB:')) return curie.slice('UniProtKB:'.length)
    return xrefs(r.gene || {}, 'UniProtKB')[0] || null
  },
  ncbiGeneId: firstXref('NCBI_Gene'),
  ensemblGeneId: firstXref('ENSEMBL'),
  hgncId: (r) => {
    const id = r.gene && r.gene.primaryExternalId
    return id && id.startsWith('HGNC:') ? id : null
  },
  flybaseGeneId: (r) => {
    const id = r.gene && r.gene.primaryExternalId
    return id && id.startsWith('FB:') ? id.slice(3) : null
  }
}

module.exports = {
  name: 'alliance',
  label: 'Alliance of Genome Resources',
  description: 'Unified gene, orthology, phenotype and disease data from the model-organism databases (MGI, RGD, SGD, ZFIN, WormBase, FlyBase, Xenbase) and human (HGNC). Gene ids are CURIEs such as MGI:98834 or ZFIN:ZDB-GENE-990415-270.',
  category: 'Genes & genomes',
  homepage: 'https://www.alliancegenome.org',
  docs: 'https://www.alliancegenome.org/swagger-ui/',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://www.alliancegenome.org/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 3 },
  // An unknown gene id is a 400 ("No gene found with ID …").
  emptyStatus: [400, 404],
  timeoutMs: 45_000,
  entities: [
    {
      name: 'gene',
      description: 'One gene from any Alliance member database',
      path: '/gene/{geneId}',
      params: {
        geneId: { description: 'Gene CURIE, e.g. HGNC:11998, MGI:98834, ZFIN:ZDB-GENE-990415-270, WB:WBGene00000912, FB:FBgn0000490' }
      },
      fields: GENE_FIELDS,
      example: { geneId: 'MGI:98834' },
      relations: [
        { alias: 'orthologs', description: 'Orthologues in the other Alliance species', entity: 'orthologs', localKey: 'geneId', foreignKey: 'geneId', type: 'hasMany' },
        { alias: 'phenotypes', description: 'Phenotype annotations', entity: 'phenotypes', localKey: 'geneId', foreignKey: 'geneId', type: 'hasMany' },
        { alias: 'ensembl', description: 'Ensembl gene record', catalog: 'ensembl', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
        { alias: 'ncbiGene', description: 'NCBI Gene record', catalog: 'ncbi-gene', entity: 'gene', localKey: 'ncbiGeneId', foreignKey: 'ncbiGeneId', type: 'hasOne' },
        { alias: 'protein', description: 'Canonical UniProtKB protein', catalog: 'uniprot', entity: 'protein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' },
        { alias: 'hgnc', description: 'HGNC record (human genes only)', catalog: 'hgnc', entity: 'gene', localKey: 'hgncId', foreignKey: 'hgncId', type: 'hasOne' },
        { alias: 'flybase', description: 'FlyBase gene summary (fly genes only)', catalog: 'flybase', entity: 'gene', localKey: 'flybaseGeneId', foreignKey: 'flybaseGeneId', type: 'hasOne' }
      ]
    },
    {
      name: 'orthologs',
      description: 'Orthologues of a gene across Alliance species, from the DIOPT-style consensus of prediction methods',
      path: '/gene/{geneId}/orthologs',
      params: {
        geneId: { description: 'Gene CURIE, e.g. HGNC:11998' },
        species: { in: 'filter', field: 'orthologSpecies', description: 'Only orthologues in this species (scientific name), e.g. Mus musculus' }
      },
      rows: 'results',
      fields: {
        geneId: 'geneToGeneOrthologyGenerated.subjectGene.primaryExternalId',
        symbol: 'geneToGeneOrthologyGenerated.subjectGene.geneSymbol.displayText',
        orthologGeneId: 'geneToGeneOrthologyGenerated.objectGene.primaryExternalId',
        orthologSymbol: 'geneToGeneOrthologyGenerated.objectGene.geneSymbol.displayText',
        orthologSpecies: 'geneToGeneOrthologyGenerated.objectGene.taxon.name',
        orthologTaxonId: (r) => taxonNumber(r.geneToGeneOrthologyGenerated && r.geneToGeneOrthologyGenerated.objectGene && r.geneToGeneOrthologyGenerated.objectGene.taxon && r.geneToGeneOrthologyGenerated.objectGene.taxon.curie),
        confidence: 'geneToGeneOrthologyGenerated.confidence.name',
        isBestScore: (r) => ((r.geneToGeneOrthologyGenerated || {}).isBestScore || {}).name === 'Yes',
        isBestReverseScore: (r) => ((r.geneToGeneOrthologyGenerated || {}).isBestScoreReverse || {}).name === 'Yes',
        methodsMatched: 'geneToGeneOrthologyGenerated.predictionMethodsMatched[].name',
        methodsNotMatched: 'geneToGeneOrthologyGenerated.predictionMethodsNotMatched[].name'
      },
      paginate: { limit: 'limit', page: 'page', pageBase: 1, max: 500 },
      example: { geneId: 'HGNC:11998' },
      relations: [
        { alias: 'ortholog', description: 'The orthologous gene', entity: 'gene', localKey: 'orthologGeneId', foreignKey: 'geneId', type: 'hasOne' }
      ]
    },
    {
      name: 'phenotypes',
      description: 'Phenotype annotations of a gene (mutant phenotypes in model organisms, HPO for human)',
      path: '/gene/{geneId}/phenotypes',
      params: {
        geneId: { description: 'Gene CURIE, e.g. MGI:98834' }
      },
      rows: 'results',
      fields: {
        geneId: 'subject.primaryExternalId',
        phenotype: 'phenotypeStatement',
        phenotypeTermIds: (r) => [...new Set((r.primaryAnnotations || []).flatMap((a) => (a.phenotypeTerms || []).map((t) => t.curie)).filter(Boolean))],
        relation: 'relation.name',
        pmids
      },
      paginate: { limit: 'limit', page: 'page', pageBase: 1, max: 500 },
      example: { geneId: 'MGI:98834' },
      relations: [
        { alias: 'gene', description: 'The annotated gene', entity: 'gene', localKey: 'geneId', foreignKey: 'geneId', type: 'hasOne' }
      ]
    },
    {
      name: 'diseaseGenes',
      description: 'Genes annotated to a Disease Ontology term (or its descendants), across species',
      path: '/disease/{diseaseId}/genes',
      params: {
        diseaseId: { description: 'Disease Ontology CURIE, e.g. DOID:162 (cancer), DOID:1612 (breast cancer)' }
      },
      rows: 'results',
      fields: {
        diseaseId: 'object.curie',
        diseaseName: 'object.name',
        geneId: 'subject.primaryExternalId',
        symbol: 'subject.geneSymbol.displayText',
        species: 'subject.taxon.name',
        relation: 'generatedRelationString',
        evidenceCodes: 'evidenceCodes[].abbreviation',
        pmids
      },
      paginate: { limit: 'limit', page: 'page', pageBase: 1, max: 500 },
      example: { diseaseId: 'DOID:1612' },
      relations: [
        { alias: 'gene', description: 'The associated gene', entity: 'gene', localKey: 'geneId', foreignKey: 'geneId', type: 'hasOne' }
      ]
    }
  ]
}
