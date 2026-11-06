'use strict'

/**
 * IntAct — curated molecular interactions from the literature (IMEx
 * consortium), each with its detection method, interaction type, MI score and
 * source publication.
 * API docs: https://www.ebi.ac.uk/intact/ws/interaction/swagger-ui/index.html
 *
 * Interaction records name both participants (A and B); rows are oriented so
 * that `partner*` is always the molecule that is not the queried protein.
 */

const upper = (v) => (v == null ? v : String(v).toUpperCase())

// "Q9UER7 (uniprotkb)" → { id: "Q9UER7", db: "uniprotkb" }
const parseId = (value) => {
  const m = String(value || '').match(/^(\S+)\s+\(([^)]+)\)$/)
  return m ? { id: m[1], db: m[2] } : { id: value || null, db: null }
}

const UNIPROT = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/

// Which side of the interaction is the partner of the queried protein.
const side = (r, params) => {
  const asked = upper(params.uniprotAccession)
  const a = parseId(r.idA).id
  return a && upper(a).replace(/-\d+$/, '') === asked ? 'B' : 'A'
}

const partner = (key) => (r, params) => r[`${key}${side(r, params)}`]

module.exports = {
  name: 'intact',
  label: 'IntAct',
  description: 'IntAct molecular interaction database: expert-curated protein–protein, protein–nucleic acid and protein–small molecule interactions from the literature, with experimental evidence and MI scores.',
  category: 'Interactions & pathways',
  homepage: 'https://www.ebi.ac.uk/intact/',
  docs: 'https://www.ebi.ac.uk/intact/ws/interaction/swagger-ui/index.html',
  license: 'CC BY 4.0',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/intact/ws',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 4, maxConcurrent: 2 },
  timeoutMs: 45_000,
  entities: [
    {
      name: 'interactions',
      description: 'Curated binary interactions of one protein (25 per page unless limit is given), each oriented towards the partner',
      path: '/interaction/findInteractions/{uniprotAccession}',
      params: {
        uniprotAccession: { description: 'UniProtKB accession, e.g. P04637', transform: upper }
      },
      query: { page: 0, pageSize: 25 },
      rows: 'content',
      fields: {
        interactionId: 'ac',
        uniprotAccession: (r, params) => upper(params.uniprotAccession),
        partnerId: (r, params) => parseId(partner('id')(r, params)).id,
        partnerDatabase: (r, params) => parseId(partner('id')(r, params)).db,
        partnerUniprotAccession: (r, params) => {
          const { id, db } = parseId(partner('id')(r, params))
          return db === 'uniprotkb' && UNIPROT.test(id) ? id.replace(/-\d+$/, '') : null
        },
        partnerSymbol: partner('molecule'),
        partnerName: partner('description'),
        partnerType: partner('type'),
        partnerTaxonId: partner('taxId'),
        partnerOrganism: partner('species'),
        interactionType: 'type',
        detectionMethod: 'detectionMethod',
        miScore: 'intactMiscore',
        hostOrganism: 'hostOrganism',
        negative: 'negative',
        affectedByMutation: 'affectedByMutation',
        pmid: (r) => (r.publicationPubmedIdentifier ? String(r.publicationPubmedIdentifier) : null),
        firstAuthor: (r) => (r.firstAuthor ? String(r.firstAuthor).trim() : null)
      },
      paginate: { limit: 'pageSize', page: 'page', pageBase: 0, max: 100 },
      example: { uniprotAccession: 'P04637' },
      relations: [
        { alias: 'partner', description: 'The partner\'s UniProtKB entry, when the partner is a protein', catalog: 'uniprot', entity: 'protein', localKey: 'partnerUniprotAccession', obo: 'uniprot', type: 'hasOne' },
        { alias: 'partnerInteractions', description: 'The partner\'s own interactions', entity: 'interactions', localKey: 'partnerUniprotAccession', obo: 'uniprot', type: 'hasMany' },
        { alias: 'publication', description: 'The publication the interaction was curated from', catalog: 'europepmc', entity: 'article', obo: 'pubmed', type: 'hasOne' }
      ]
    }
  ]
}
