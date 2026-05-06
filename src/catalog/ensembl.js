'use strict'

/**
 * Ensembl – genome browser and annotation database.
 * Reference: https://www.ensembl.org/
 * API docs:  https://rest.ensembl.org/documentation
 *
 * No credentials required. Rate limit: 15 req/sec (REST); higher with a key.
 * Requires Accept: application/json header (included in connection.headers).
 *
 * Species names use Ensembl binomial format: homo_sapiens, mus_musculus, etc.
 * Gene stable IDs: ENSG00000139618 (human BRCA2)
 * Transcript IDs:  ENST00000380152
 * Protein IDs:     ENSP00000369497
 *
 * Key where parameters:
 *  - /info/species:        no required params
 *  - /lookup/symbol/{species}/{symbol}: expand=1 to include transcripts
 *  - /sequence/id/{id}:   type (genomic|cds|cdna|protein), expand_5prime, expand_3prime
 *  - /xrefs/id/{id}:      db_type (core), external_db (e.g. HGNC)
 *  - /variation/homo_sapiens/{rsid}: no required extra params
 *
 * Relationship map:
 *  - /lookup/symbol/{species}/{symbol} → /xrefs/id/{id}  (stable gene ID, hasMany)
 *  - /lookup/symbol/{species}/{symbol} → /sequence/id/{id} (stable ID, belongsTo)
 */
module.exports = {
  name: 'ensembl',
  label: 'Ensembl (REST)',
  description: 'Ensembl genome browser REST API for vertebrate genomes. Provides gene/transcript/protein lookups, sequence retrieval, variant annotation and cross-database references. Species IDs use binomial underscore format (e.g. homo_sapiens).',
  driver: 'rest',
  connection: {
    database: 'https://rest.ensembl.org',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  },
  entities: [
    {
      name: '/info/species',
      columns: ['species', 'name', 'common_name', 'display_name', 'taxon_id', 'assembly', 'release', 'division', 'groups'],
      relations: []
    },
    {
      name: '/info/genomes',
      columns: ['name', 'display_name', 'organism', 'taxonomy_id', 'assembly_name', 'assembly_accession', 'genebuild', 'division'],
      relations: []
    },
    {
      // Fetch gene by stable ID: /lookup/id/ENSG00000139618
      name: '/lookup/id',
      columns: ['id', 'display_name', 'species', 'object_type', 'biotype', 'description', 'start', 'end', 'strand', 'seq_region_name', 'assembly_name', 'Transcript'],
      relations: [
        { entity: '/xrefs/id', foreignKey: 'id', type: 'hasMany', alias: 'xrefs' },
        { entity: '/uniprotkb/search', foreignKey: 'id', type: 'hasOne', alias: 'uniprotEntry', catalog: 'uniprot' },
        { entity: '/data/query', foreignKey: 'id', type: 'hasMany', alias: 'reactomePathways', catalog: 'reactome' },
        { entity: '/find/ko', foreignKey: 'id', type: 'hasMany', alias: 'keggOrthology', catalog: 'kegg' }
      ]
    },
    {
      // Fetch sequence by stable ID: /sequence/id/ENSG00000139618
      name: '/sequence/id',
      columns: ['id', 'seq', 'molecule', 'query', 'version', 'desc'],
      relations: [
        { entity: '/lookup/id', foreignKey: 'id', type: 'belongsTo', alias: 'gene' }
      ]
    },
    {
      // Cross-database references: /xrefs/id/ENSG00000139618
      name: '/xrefs/id',
      columns: ['primary_id', 'display_id', 'dbname', 'db_display_name', 'description', 'info_type', 'info_text', 'synonyms'],
      relations: []
    },
    {
      // Variant annotation: /variation/homo_sapiens/rs699
      name: '/variation/homo_sapiens',
      columns: ['name', 'mappings', 'ambiguity', 'var_class', 'synonyms', 'source', 'minor_allele', 'minor_allele_freq', 'minor_allele_count', 'clinical_significance'],
      relations: [
        { entity: '/lookup/id', foreignKey: 'id', type: 'belongsTo', alias: 'gene' }
      ]
    }
  ]
}
