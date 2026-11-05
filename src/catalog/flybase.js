'use strict'

/**
 * FlyBase — the Drosophila genetics and genomics database.
 * API docs: https://flybase.github.io/api/swagger-ui/
 *
 * FlyBase's public API is small: automated gene summaries and sequences.
 * The gene record here combines the two — the sequence endpoint's FASTA
 * header carries the symbol, location and cross-references — and points at
 * the Alliance of Genome Resources for orthology and phenotypes.
 *
 * FlyBase ids: FBgn0000490 (gene), FBtr… (transcript), FBpp… (polypeptide).
 */

// The sequence header is "key=value; key=value; …".
function parseHeader (description) {
  const out = {}
  for (const part of String(description || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function locationOf (loc) {
  const m = /^([^:]+):(?:complement\()?(\d+)\.\.(\d+)/.exec(loc || '')
  return m ? { chromosome: m[1], start: Number(m[2]), end: Number(m[3]), strand: /complement/.test(loc) ? -1 : 1 } : {}
}

module.exports = {
  name: 'flybase',
  label: 'FlyBase',
  description: 'Drosophila genetics and genomics: gene summaries, genomic locations, cross-references and sequences for D. melanogaster. FlyBase ids use the FBgn/FBtr/FBpp prefixes.',
  category: 'Genes & genomes',
  homepage: 'https://flybase.org',
  docs: 'https://flybase.github.io/api/swagger-ui/',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://api.flybase.org/api/v1.0',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 2 },
  entities: [
    {
      name: 'gene',
      description: 'One Drosophila gene: symbol, location, cross-references and the FlyBase automated summary',
      params: {
        flybaseGeneId: { in: 'query', required: true, description: 'FlyBase gene id, e.g. FBgn0000490 (dpp)' }
      },
      resolve: async (params, ctx) => {
        const id = encodeURIComponent(params.flybaseGeneId)
        const [summary, sequence] = await Promise.all([
          ctx.request(`/gene/summaries/auto/${id}`),
          ctx.request(`/sequence/id/${id}/FBgn`)
        ])
        const summaryRow = summary && summary.resultset && summary.resultset.result && summary.resultset.result[0]
        const sequenceRow = sequence && sequence.resultset && sequence.resultset.result && sequence.resultset.result[0]
        if (!summaryRow && !sequenceRow) return []
        const header = parseHeader(sequenceRow && sequenceRow.description)
        return [{
          id: params.flybaseGeneId,
          summary: summaryRow ? String(summaryRow.summary || '').trim() : null,
          header,
          location: header.loc || null,
          ...locationOf(header.loc)
        }]
      },
      fields: {
        flybaseGeneId: 'id',
        symbol: 'header.name',
        species: 'header.species',
        location: 'location',
        chromosome: 'chromosome',
        start: 'start',
        end: 'end',
        strand: 'strand',
        annotationId: (r) => ((r.header.dbxref || '').split(',').find((x) => x.startsWith('FlyBase_Annotation_IDs:')) || '').replace('FlyBase_Annotation_IDs:', '') || null,
        crossReferences: (r) => (r.header.dbxref ? r.header.dbxref.split(',') : []),
        release: 'header.release',
        summary: 'summary',
        allianceGeneId: (r) => `FB:${r.id}`
      },
      example: { flybaseGeneId: 'FBgn0000490' },
      relations: [
        { alias: 'alliance', description: 'Alliance of Genome Resources gene record', catalog: 'alliance', entity: 'gene', localKey: 'allianceGeneId', foreignKey: 'geneId', type: 'hasOne' },
        { alias: 'orthologs', description: 'Orthologues in human and other model organisms (Alliance)', catalog: 'alliance', entity: 'orthologs', localKey: 'allianceGeneId', foreignKey: 'geneId', type: 'hasMany' },
        { alias: 'phenotypes', description: 'Phenotype annotations (Alliance)', catalog: 'alliance', entity: 'phenotypes', localKey: 'allianceGeneId', foreignKey: 'geneId', type: 'hasMany' }
      ]
    },
    {
      name: 'sequence',
      description: 'FASTA sequence of a FlyBase feature (gene region, transcript, CDS or polypeptide)',
      path: '/sequence/id/{flybaseId}/{type}',
      params: {
        flybaseId: { description: 'FlyBase id, e.g. FBgn0000490, FBtr0077619, FBpp0077302' },
        type: { default: 'FBgn', description: 'Sequence type: FBgn (gene region), FBtr (transcript), CDS, FBpp (polypeptide), exon, intron, five_prime_utr, three_prime_utr' }
      },
      rows: 'resultset.result',
      fields: {
        flybaseId: 'id',
        description: 'description',
        location: (r) => parseHeader(r.description).loc || null,
        length: (r) => (r.sequence ? r.sequence.length : null),
        sequence: 'sequence'
      },
      example: { flybaseId: 'FBgn0000490' },
      relations: []
    },
    {
      name: 'regionSequence',
      description: 'Genomic sequence of a region of a Drosophila genome',
      path: '/sequence/region/{species}/{region}',
      params: {
        region: { description: 'Region as arm:start..end, e.g. 2L:2428372..2428500' },
        species: { default: 'dmel', description: 'FlyBase species abbreviation, e.g. dmel' }
      },
      rows: 'resultset.result',
      fields: {
        region: (r, params) => params.region,
        description: 'description',
        length: (r) => (r.sequence ? r.sequence.length : null),
        sequence: 'sequence'
      },
      example: { region: '2L:2428372..2428500' },
      relations: []
    }
  ]
}
