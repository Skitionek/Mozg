'use strict';

/**
 * RefSeq – NCBI Reference Sequence Database.
 * Reference: https://www.ncbi.nlm.nih.gov/refseq/
 * API docs:  https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/
 *
 * No credentials required. An api_key header raises the rate limit.
 * Uses the NCBI Datasets v2 REST API which returns JSON natively.
 *
 * RefSeq accession prefixes:
 *  - NC_  : complete genomic molecules (chromosomes)
 *  - NM_  : mRNA sequences
 *  - NP_  : protein sequences
 *  - NR_  : non-coding RNA
 *  - NG_  : genomic regions
 *  - XM_/XP_/XR_ : predicted model sequences
 *
 * Key endpoints:
 *  - /gene/id/{ids}/summary         – gene summary by NCBI Gene IDs
 *  - /gene/symbol/{symbols}/taxon/{taxon}/summary – by gene symbol
 *  - /genome/accession/{accessions}/summary – genome summary
 *  - /taxonomy/filtered_subtree     – taxonomy subtree
 *
 * Relationship map:
 *  - /gene/id/{id}/summary  →  /genome/accession/{acc}/summary  (genome accession, belongsTo)
 */
module.exports = {
  name: 'refseq',
  label: 'RefSeq / NCBI Datasets (REST)',
  description: 'NCBI Reference Sequence Database via the NCBI Datasets v2 API. Provides curated gene and genome summaries with RefSeq accessions (NC_, NM_, NP_, NR_, NG_ prefixes). No auth required; register for an API key to raise rate limits.',
  driver: 'rest',
  connection: {
    database: 'https://api.ncbi.nlm.nih.gov/datasets/v2',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Fetch by NCBI Gene ID: /gene/id/672/summary  (672 = BRCA2)
      name: '/gene/id',
      columns: ['gene_id', 'symbol', 'description', 'tax_id', 'taxname', 'type', 'chromosomes', 'location', 'orientation', 'exon_count', 'omim_ids', 'swiss_prot_accessions', 'ensembl_gene_ids', 'refseq_accessions', 'genomic_ranges'],
      relations: [
        { entity: '/genome/accession', foreignKey: 'chromosomes', type: 'belongsTo', alias: 'genome' },
        { entity: '/lookup/id', foreignKey: 'gene_id', type: 'hasOne', alias: 'ensemblGene', catalog: 'ensembl' },
      ],
    },
    {
      // Fetch by accession: /genome/accession/GCF_000001405.40/summary
      name: '/genome/accession',
      columns: ['accession', 'assembly_category', 'assembly_level', 'assembly_name', 'bioproject_accession', 'biosample_accession', 'paired_accession', 'organism', 'seq_length', 'submission_date', 'refseq_category', 'annotated', 'gc_count'],
      relations: [],
    },
    {
      // Fetch taxonomy: /taxonomy/9606
      name: '/taxonomy',
      columns: ['tax_id', 'sci_name', 'common_name', 'rank', 'parents', 'has_described_species_name', 'counts'],
      relations: [],
    },
  ],
};
