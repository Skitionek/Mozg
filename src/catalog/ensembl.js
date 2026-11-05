'use strict'

/**
 * Ensembl — genome annotation for vertebrates (and, via Ensembl Genomes,
 * much else): genes, transcripts, variants, homologues and cross-references.
 * API docs: https://rest.ensembl.org/documentation
 *
 * Gene records name their HGNC id in the description
 * ("… [Source:HGNC Symbol;Acc:HGNC:11998]"), which is what lets a gene join
 * to HGNC without a second lookup.
 */

const stripSource = (description) => (description ? String(description).replace(/\s*\[Source:[^\]]*\]\s*$/, '') : null)
const hgncFromDescription = (description) => {
  const m = /Acc:(HGNC:\d+)/.exec(description || '')
  return m ? m[1] : null
}
const unversioned = (id) => (id ? String(id).replace(/\.\d+$/, '') : null)

const GENE_FIELDS = {
  ensemblGeneId: 'id',
  symbol: 'display_name|external_name',
  name: (r) => stripSource(r.description),
  biotype: 'biotype',
  species: 'species',
  chromosome: 'seq_region_name',
  start: 'start',
  end: 'end',
  strand: 'strand',
  assembly: 'assembly_name',
  canonicalTranscript: (r) => unversioned(r.canonical_transcript),
  version: 'version',
  hgncId: (r) => hgncFromDescription(r.description)
}

const GENE_RELATIONS = [
  { alias: 'transcripts', description: 'Transcripts of this gene', entity: 'transcripts', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
  { alias: 'xrefs', description: 'Cross-references to other databases', entity: 'xrefs', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
  { alias: 'homologs', description: 'Orthologues in other species (Ensembl Compara)', entity: 'homologs', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
  { alias: 'hgnc', description: 'HGNC approved nomenclature record', catalog: 'hgnc', entity: 'gene', localKey: 'hgncId', foreignKey: 'hgncId', type: 'hasOne' },
  { alias: 'proteins', description: 'UniProtKB proteins encoded by this gene', catalog: 'uniprot', entity: 'proteins', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
  { alias: 'target', description: 'Open Targets target record', catalog: 'opentargets', entity: 'target', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'diseases', description: 'Diseases associated with this gene (Open Targets)', catalog: 'opentargets', entity: 'targetDiseases', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
  { alias: 'constraint', description: 'Loss-of-function and missense constraint (gnomAD)', catalog: 'gnomad', entity: 'geneConstraint', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'expression', description: 'Median expression per tissue (GTEx)', catalog: 'gtex', entity: 'expression', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasMany' },
  { alias: 'proteinAtlas', description: 'Human Protein Atlas summary', catalog: 'proteinatlas', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' },
  { alias: 'gwasAssociations', description: 'GWAS Catalog associations mapped to this gene', catalog: 'gwas', entity: 'associationsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
  { alias: 'clinvarVariants', description: 'ClinVar variants in this gene', catalog: 'clinvar', entity: 'variantsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
  { alias: 'drugInteractions', description: 'Drug–gene interactions (DGIdb)', catalog: 'dgidb', entity: 'interactionsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' }
]

const VARIANT_RELATIONS = [
  { alias: 'consequences', description: 'Predicted consequences per transcript (VEP)', entity: 'variantConsequences', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' },
  { alias: 'annotations', description: 'Aggregated variant annotation (MyVariant.info)', catalog: 'myvariant', entity: 'variantByRsId', localKey: 'rsId', foreignKey: 'rsId', type: 'hasOne' },
  { alias: 'gwasAssociations', description: 'GWAS Catalog associations for this variant', catalog: 'gwas', entity: 'associationsForVariant', localKey: 'rsId', foreignKey: 'rsId', type: 'hasMany' }
]

module.exports = {
  name: 'ensembl',
  label: 'Ensembl',
  description: 'Genome annotation for vertebrates and model organisms: genes, transcripts, variants with predicted consequences (VEP), orthologues (Compara) and cross-references. Species use Ensembl names such as homo_sapiens.',
  category: 'Genes & genomes',
  homepage: 'https://www.ensembl.org',
  docs: 'https://rest.ensembl.org/documentation',
  license: 'No restrictions (Ensembl data is freely available)',
  driver: 'api',
  connection: {
    database: 'https://rest.ensembl.org',
    headers: { Accept: 'application/json' }
  },
  // Ensembl allows 55 000 requests/hour (~15/s) per client.
  rateLimit: { requestsPerSecond: 12, maxConcurrent: 4 },
  // Unknown identifiers are a 400 ("ID '…' not found"), not a 404.
  emptyStatus: [400, 404],
  timeoutMs: 45_000,
  entities: [
    {
      name: 'gene',
      description: 'One gene by Ensembl stable id',
      path: '/lookup/id/{ensemblGeneId}',
      params: {
        ensemblGeneId: { description: 'Ensembl gene stable id, e.g. ENSG00000141510' }
      },
      fields: GENE_FIELDS,
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: GENE_RELATIONS
    },
    {
      name: 'geneBySymbol',
      description: 'One gene by symbol within a species',
      path: '/lookup/symbol/{species}/{symbol}',
      params: {
        symbol: { description: 'Gene symbol, e.g. TP53' },
        species: { default: 'homo_sapiens', description: 'Ensembl species name or alias, e.g. homo_sapiens, mus_musculus, human' }
      },
      fields: GENE_FIELDS,
      example: { symbol: 'TP53' },
      relations: GENE_RELATIONS
    },
    {
      name: 'transcripts',
      description: 'Transcripts of a gene',
      path: '/lookup/id/{ensemblGeneId}',
      params: {
        ensemblGeneId: { description: 'Ensembl gene stable id' }
      },
      query: { expand: 1 },
      rows: 'Transcript',
      fields: {
        transcriptId: 'id',
        ensemblGeneId: 'Parent',
        name: 'display_name',
        biotype: 'biotype',
        isCanonical: (r) => r.is_canonical === 1 || r.is_canonical === '1',
        chromosome: 'seq_region_name',
        start: 'start',
        end: 'end',
        strand: 'strand',
        length: 'length',
        proteinId: 'Translation.id'
      },
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: [
        { alias: 'gene', description: 'The parent gene', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' }
      ]
    },
    {
      name: 'genesInRegion',
      description: 'Genes overlapping a genomic region',
      path: '/overlap/region/{species}/{region}',
      params: {
        region: { description: 'Region as chromosome:start-end, e.g. 17:7661779-7687546 (max 5 Mb)' },
        species: { default: 'homo_sapiens', description: 'Ensembl species name' },
        biotype: { in: 'query', description: 'Only genes of this biotype, e.g. protein_coding' }
      },
      query: (params) => ({ feature: 'gene', biotype: params.biotype }),
      fields: {
        ensemblGeneId: 'id',
        symbol: 'external_name',
        name: (r) => stripSource(r.description),
        biotype: 'biotype',
        chromosome: 'seq_region_name',
        start: 'start',
        end: 'end',
        strand: 'strand',
        hgncId: (r) => hgncFromDescription(r.description)
      },
      example: { region: '17:7661779-7687546' },
      relations: [
        { alias: 'gene', description: 'Full gene record', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' }
      ]
    },
    {
      name: 'xrefs',
      description: 'Cross-references from an Ensembl gene to other databases',
      path: '/xrefs/id/{ensemblGeneId}',
      params: {
        ensemblGeneId: { description: 'Ensembl stable id (gene, transcript or protein)' },
        externalDb: { in: 'query', name: 'external_db', description: 'Restrict to one database, e.g. HGNC, EntrezGene, Uniprot/SWISSPROT' }
      },
      fields: {
        database: 'dbname',
        databaseName: 'db_display_name',
        primaryId: 'primary_id',
        displayId: 'display_id',
        description: 'description',
        infoType: 'info_type',
        synonyms: 'synonyms'
      },
      example: { ensemblGeneId: 'ENSG00000141510' },
      relations: []
    },
    {
      name: 'homologs',
      description: 'Orthologues (or paralogues) of a gene from Ensembl Compara',
      path: '/homology/id/{species}/{ensemblGeneId}',
      params: {
        ensemblGeneId: { description: 'Ensembl gene stable id' },
        species: { default: 'homo_sapiens', description: 'Species of the query gene' },
        targetSpecies: { in: 'query', name: 'target_species', description: 'Only homologues in this species, e.g. mus_musculus' },
        type: { in: 'query', default: 'orthologues', description: 'orthologues, paralogues, projections or all' }
      },
      query: { sequence: 'none' },
      rows: 'data[].homologies',
      fields: {
        ensemblGeneId: 'source.id',
        homologEnsemblGeneId: 'target.id',
        homologProteinId: 'target.protein_id',
        homologSpecies: 'target.species',
        homologTaxonId: 'target.taxon_id',
        type: 'type',
        taxonomyLevel: 'taxonomy_level',
        percentIdentity: 'target.perc_id',
        percentPositive: 'target.perc_pos',
        dnDs: 'dn_ds'
      },
      example: { ensemblGeneId: 'ENSG00000141510', targetSpecies: 'mus_musculus' },
      relations: [
        { alias: 'homolog', description: 'The homologous gene', entity: 'gene', localKey: 'homologEnsemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' }
      ]
    },
    {
      name: 'variant',
      description: 'A short variant by dbSNP id, with its genomic mapping',
      path: '/variation/{species}/{rsId}',
      params: {
        rsId: { description: 'dbSNP id, e.g. rs28934578' },
        species: { default: 'homo_sapiens', description: 'Ensembl species name' }
      },
      fields: {
        rsId: 'name',
        variantClass: 'var_class',
        mostSevereConsequence: 'most_severe_consequence',
        chromosome: 'mappings[0].seq_region_name',
        start: 'mappings[0].start',
        end: 'mappings[0].end',
        alleles: 'mappings[0].allele_string',
        ancestralAllele: 'mappings[0].ancestral_allele',
        assembly: 'mappings[0].assembly_name',
        minorAllele: 'minor_allele',
        minorAlleleFrequency: 'MAF',
        clinicalSignificance: 'clinical_significance',
        evidence: 'evidence',
        source: 'source'
      },
      example: { rsId: 'rs28934578' },
      relations: VARIANT_RELATIONS
    },
    {
      name: 'variantConsequences',
      description: 'Variant Effect Predictor consequences of a variant, one row per affected transcript',
      path: '/vep/{species}/id/{rsId}',
      params: {
        rsId: { description: 'dbSNP id or HGVS notation, e.g. rs28934578' },
        species: { default: 'human', description: 'Ensembl species name or alias' }
      },
      rows: (body) => (Array.isArray(body) ? body : [body])
        .flatMap((v) => (v.transcript_consequences || []).map((c) => ({ ...c, _variant: v }))),
      fields: {
        rsId: '_variant.id',
        transcriptId: 'transcript_id',
        ensemblGeneId: 'gene_id',
        symbol: 'gene_symbol',
        hgncId: 'hgnc_id',
        biotype: 'biotype',
        consequences: 'consequence_terms',
        impact: 'impact',
        variantAllele: 'variant_allele',
        aminoAcids: 'amino_acids',
        codons: 'codons',
        proteinStart: 'protein_start',
        siftPrediction: 'sift_prediction',
        siftScore: 'sift_score',
        polyphenPrediction: 'polyphen_prediction',
        polyphenScore: 'polyphen_score'
      },
      example: { rsId: 'rs28934578' },
      relations: [
        { alias: 'gene', description: 'The affected gene', entity: 'gene', localKey: 'ensemblGeneId', foreignKey: 'ensemblGeneId', type: 'hasOne' }
      ]
    }
  ]
}
