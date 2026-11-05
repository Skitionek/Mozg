'use strict'

/**
 * DGIdb — the Drug–Gene Interaction Database: drug–gene interactions and
 * druggable-gene categories aggregated from 40+ sources (ChEMBL, DrugBank,
 * CIViC, OncoKB, FDA, PharmGKB/ClinPGx, …), with an interaction score.
 * API docs: https://dgidb.org/api (GraphQL)
 *
 * DGIdb identifies genes by HGNC CURIE in lower case ("hgnc:3236") and drugs
 * by whichever vocabulary normalized them ("rxcui:282388", "chembl:CHEMBL941",
 * "iuphar.ligand:…"); fields below split those into the canonical ids.
 */

const curieId = (prefix) => (id) => {
  if (!id) return null
  const [ns, ...rest] = String(id).split(':')
  return ns.toLowerCase() === prefix ? rest.join(':') : null
}
const hgncId = (id) => {
  const local = curieId('hgnc')(id)
  return local ? `HGNC:${local}` : null
}

const INTERACTION_SELECTION = `
  interactionScore
  interactionTypes { type directionality }
  publications { pmid }
  sources { sourceDbName }`

const INTERACTION_FIELDS = {
  symbol: 'gene.name',
  hgncId: (r) => hgncId(r.gene && r.gene.conceptId),
  geneName: 'gene.longName',
  drugName: 'drug.name',
  drugConceptId: 'drug.conceptId',
  chemblId: (r) => curieId('chembl')(r.drug && r.drug.conceptId),
  rxcui: (r) => curieId('rxcui')(r.drug && r.drug.conceptId),
  approved: 'drug.approved',
  interactionScore: 'interactionScore',
  interactionTypes: 'interactionTypes[].type',
  directionality: 'interactionTypes[0].directionality',
  sources: 'sources[].sourceDbName',
  pmids: (r) => (r.publications || []).map((p) => String(p.pmid))
}

const INTERACTION_RELATIONS = [
  { alias: 'molecule', description: 'The drug in ChEMBL, when DGIdb normalized it to a ChEMBL id', catalog: 'chembl', entity: 'molecule', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasOne' },
  { alias: 'rxnorm', description: 'The drug in RxNorm, when DGIdb normalized it to an RxCUI', catalog: 'rxnorm', entity: 'concept', localKey: 'rxcui', foreignKey: 'rxcui', type: 'hasOne' },
  { alias: 'gene', description: 'HGNC record of the gene', catalog: 'hgnc', entity: 'gene', localKey: 'hgncId', foreignKey: 'hgncId', type: 'hasOne' },
  { alias: 'drugs', description: 'DGIdb drug record (approval, attributes)', entity: 'drug', localKey: 'drugName', foreignKey: 'name', type: 'hasOne' }
]

// DGIdb matches names loosely ("aspirin" also finds "ASPIRIN TRELAMINE");
// prefer exact matches when there are any.
const exactFirst = (nodes, name) => {
  const wanted = String(name).toLowerCase()
  const exact = nodes.filter((n) => String(n.name).toLowerCase() === wanted)
  return exact.length ? exact : nodes
}

module.exports = {
  name: 'dgidb',
  label: 'DGIdb',
  description: 'Drug–Gene Interaction Database: drug–gene interactions and druggable-gene categories aggregated from 40+ sources, with interaction types, scores and supporting publications.',
  category: 'Chemistry & drugs',
  homepage: 'https://dgidb.org',
  docs: 'https://dgidb.org/api',
  license: 'MIT (DGIdb); aggregated sources keep their own terms',
  driver: 'api',
  connection: {
    database: 'https://dgidb.org/api',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 3, maxConcurrent: 2 },
  entities: [
    {
      name: 'interactionsForGene',
      description: 'Drugs known to interact with a gene, one row per drug–gene interaction',
      path: '/graphql',
      params: {
        symbol: { description: 'HGNC gene symbol, e.g. EGFR' }
      },
      graphql: {
        query: `query ($names: [String!]) {
          genes(names: $names) { nodes { name longName conceptId
            interactions { ${INTERACTION_SELECTION} drug { name conceptId approved } } } }
        }`,
        variables: (p) => ({ names: [String(p.symbol).toUpperCase()] })
      },
      rows: (body) => ((body && body.data && body.data.genes && body.data.genes.nodes) || [])
        .flatMap((gene) => (gene.interactions || []).map((i) => ({ ...i, gene }))),
      fields: INTERACTION_FIELDS,
      example: { symbol: 'EGFR' },
      relations: INTERACTION_RELATIONS
    },
    {
      name: 'interactionsForDrug',
      description: 'Genes a drug is known to interact with, one row per drug–gene interaction',
      path: '/graphql',
      params: {
        name: { description: 'Drug name, e.g. imatinib' }
      },
      graphql: {
        query: `query ($names: [String!]) {
          drugs(names: $names) { nodes { name conceptId approved
            interactions { ${INTERACTION_SELECTION} gene { name longName conceptId } } } }
        }`,
        variables: (p) => ({ names: [String(p.name).toUpperCase()] })
      },
      rows: (body, params) => exactFirst((body && body.data && body.data.drugs && body.data.drugs.nodes) || [], params.name)
        .flatMap((drug) => (drug.interactions || []).map((i) => ({ ...i, drug }))),
      fields: INTERACTION_FIELDS,
      example: { name: 'imatinib' },
      relations: [
        ...INTERACTION_RELATIONS,
        { alias: 'protein', description: 'Reviewed human UniProt entry for the gene', catalog: 'uniprot', entity: 'proteins', localKey: 'symbol', foreignKey: 'symbol', where: { taxonId: 9606, reviewed: true }, type: 'hasOne' }
      ]
    },
    {
      name: 'gene',
      description: 'A gene\'s druggability: DGIdb gene categories (kinase, druggable genome, clinically actionable…)',
      path: '/graphql',
      params: {
        symbol: { description: 'HGNC gene symbol, e.g. EGFR' }
      },
      graphql: {
        query: `query ($names: [String!]) {
          genes(names: $names) { nodes { name longName conceptId geneCategories { name } } }
        }`,
        variables: (p) => ({ names: [String(p.symbol).toUpperCase()] })
      },
      rows: 'data.genes.nodes',
      fields: {
        symbol: 'name',
        name: 'longName',
        hgncId: (r) => hgncId(r.conceptId),
        categories: 'geneCategories[].name'
      },
      example: { symbol: 'EGFR' },
      relations: [
        { alias: 'interactions', description: 'Drugs interacting with this gene', entity: 'interactionsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
        { alias: 'hgnc', description: 'HGNC record of the gene', catalog: 'hgnc', entity: 'gene', localKey: 'hgncId', foreignKey: 'hgncId', type: 'hasOne' }
      ]
    },
    {
      name: 'drug',
      description: 'A drug\'s DGIdb record: approval status, anti-neoplastic / immunotherapy flags and attributes such as drug class',
      path: '/graphql',
      params: {
        name: { description: 'Drug name, e.g. imatinib' }
      },
      graphql: {
        query: `query ($names: [String!]) {
          drugs(names: $names) { nodes { name conceptId approved immunotherapy antiNeoplastic drugAttributes { name value } } }
        }`,
        variables: (p) => ({ names: [String(p.name).toUpperCase()] })
      },
      rows: (body, params) => exactFirst((body && body.data && body.data.drugs && body.data.drugs.nodes) || [], params.name),
      fields: {
        name: 'name',
        conceptId: 'conceptId',
        chemblId: (r) => curieId('chembl')(r.conceptId),
        rxcui: (r) => curieId('rxcui')(r.conceptId),
        approved: 'approved',
        immunotherapy: 'immunotherapy',
        antiNeoplastic: 'antiNeoplastic',
        drugClasses: (r) => [...new Set((r.drugAttributes || []).filter((a) => a.name === 'Drug Class').map((a) => a.value))],
        approvalYear: (r) => {
          const a = (r.drugAttributes || []).find((x) => x.name === 'Year of Approval')
          return a ? Number(a.value) : null
        }
      },
      example: { name: 'imatinib' },
      relations: [
        { alias: 'interactions', description: 'Genes this drug interacts with', entity: 'interactionsForDrug', localKey: 'name', foreignKey: 'name', type: 'hasMany' },
        { alias: 'molecule', description: 'The drug in ChEMBL', catalog: 'chembl', entity: 'molecule', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasOne' },
        { alias: 'rxnorm', description: 'The drug in RxNorm', catalog: 'rxnorm', entity: 'concept', localKey: 'rxcui', foreignKey: 'rxcui', type: 'hasOne' }
      ]
    }
  ]
}
