'use strict'

/**
 * ChEMBL — manually curated database of bioactive molecules with drug-like
 * properties: compounds, their targets, measured activities, approved drug
 * mechanisms and indications.
 * API docs: https://chembl.gitbook.io/chembl-interface-documentation/web-services/chembl-data-web-services
 *
 * Molecules and targets share one id space (CHEMBL25 is aspirin, CHEMBL203
 * is EGFR), so both are exposed as `chemblId`; where a row refers to both,
 * the molecule keeps `chemblId`/`moleculeChemblId` and the target uses
 * `targetChemblId`.
 */

const num = (path) => (r) => {
  const v = path.split('.').reduce((o, k) => (o == null ? null : o[k]), r)
  return v == null || v === '' ? null : Number(v)
}
const flag = (path) => (r) => {
  const v = r[path]
  return v == null ? null : Boolean(v)
}

const MOLECULE_FIELDS = {
  chemblId: 'molecule_chembl_id',
  name: 'pref_name',
  maxPhase: num('max_phase'),
  moleculeType: 'molecule_type',
  firstApproval: 'first_approval',
  therapeutic: flag('therapeutic_flag'),
  oral: flag('oral'),
  withdrawn: flag('withdrawn_flag'),
  blackBoxWarning: flag('black_box_warning'),
  inchiKey: 'molecule_structures.standard_inchi_key',
  inchi: 'molecule_structures.standard_inchi',
  smiles: 'molecule_structures.canonical_smiles',
  formula: 'molecule_properties.full_molformula',
  mass: num('molecule_properties.full_mwt'),
  alogp: num('molecule_properties.alogp'),
  psa: num('molecule_properties.psa'),
  hba: 'molecule_properties.hba',
  hbd: 'molecule_properties.hbd',
  ro5Violations: 'molecule_properties.num_ro5_violations',
  atcCodes: 'atc_classifications',
  synonyms: (r) => [...new Set((r.molecule_synonyms || []).map((s) => s.molecule_synonym).filter(Boolean))],
  parentChemblId: 'molecule_hierarchy.parent_chembl_id'
}

const MOLECULE_RELATIONS = [
  { alias: 'mechanisms', description: 'Mechanisms of action of this drug', entity: 'mechanisms', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasMany' },
  { alias: 'indications', description: 'Diseases this drug is approved or in trials for', entity: 'indications', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasMany' },
  { alias: 'activities', description: 'Measured bioactivities of this molecule', entity: 'activities', localKey: 'chemblId', foreignKey: 'moleculeChemblId', type: 'hasMany' },
  { alias: 'parent', description: 'Parent compound (salt-stripped form)', entity: 'molecule', localKey: 'parentChemblId', foreignKey: 'chemblId', type: 'hasOne' },
  { alias: 'pubchem', description: 'The same structure in PubChem (by InChIKey)', catalog: 'pubchem', entity: 'compoundByInchiKey', localKey: 'inchiKey', foreignKey: 'inchiKey', type: 'hasOne' },
  { alias: 'drug', description: 'Open Targets drug record (indications, linked targets, warnings)', catalog: 'opentargets', entity: 'drug', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasOne' },
  { alias: 'clinicalTrials', description: 'ClinicalTrials.gov studies with this drug as an intervention', catalog: 'clinicaltrials', entity: 'studies', localKey: 'name', foreignKey: 'intervention', type: 'hasMany' },
  { alias: 'labels', description: 'FDA drug labels for this generic name', catalog: 'openfda', entity: 'labels', localKey: 'name', foreignKey: 'genericName', type: 'hasMany' },
  { alias: 'rxnorm', description: 'RxNorm concept for this drug name', catalog: 'rxnorm', entity: 'drug', localKey: 'name', foreignKey: 'name', type: 'hasOne' },
  { alias: 'geneInteractions', description: 'Drug–gene interactions aggregated by DGIdb', catalog: 'dgidb', entity: 'interactionsForDrug', localKey: 'name', foreignKey: 'name', type: 'hasMany' }
]

const TARGET_FIELDS = {
  chemblId: 'target_chembl_id',
  name: 'pref_name',
  targetType: 'target_type',
  organism: 'organism',
  taxonId: 'tax_id',
  uniprotAccession: 'target_components[0].accession',
  uniprotAccessions: 'target_components[].accession',
  symbol: (r) => {
    const [component] = r.target_components || []
    const synonym = component && (component.target_component_synonyms || []).find((s) => s.syn_type === 'GENE_SYMBOL')
    return synonym ? synonym.component_synonym : null
  }
}

const TARGET_RELATIONS = [
  { alias: 'activities', description: 'Measured bioactivities against this target', entity: 'activities', localKey: 'chemblId', foreignKey: 'targetChemblId', type: 'hasMany' },
  { alias: 'drugs', description: 'Drug mechanisms acting on this target', entity: 'mechanisms', localKey: 'chemblId', foreignKey: 'targetChemblId', type: 'hasMany' },
  { alias: 'protein', description: 'UniProt entry of the (first) target component', catalog: 'uniprot', entity: 'protein', localKey: 'uniprotAccession', foreignKey: 'uniprotAccession', type: 'hasOne' },
  { alias: 'gene', description: 'HGNC gene record for the target symbol', catalog: 'hgnc', entity: 'geneBySymbol', localKey: 'symbol', foreignKey: 'symbol', type: 'hasOne' },
  { alias: 'geneInteractions', description: 'Drug–gene interactions for the target gene (DGIdb)', catalog: 'dgidb', entity: 'interactionsForGene', localKey: 'symbol', foreignKey: 'symbol', type: 'hasMany' },
  { alias: 'taxonomy', description: 'Taxonomy of the target organism', catalog: 'uniprot', entity: 'taxonomy', localKey: 'taxonId', foreignKey: 'taxonId', type: 'hasOne' }
]

const PAGINATE = { limit: 'limit', offset: 'offset', max: 1000 }

module.exports = {
  name: 'chembl',
  label: 'ChEMBL',
  description: 'Manually curated database of bioactive drug-like molecules: 2.4M compounds, their protein targets, 20M+ measured activities, and the mechanisms and indications of approved and clinical drugs.',
  category: 'Chemistry & drugs',
  homepage: 'https://www.ebi.ac.uk/chembl/',
  docs: 'https://chembl.gitbook.io/chembl-interface-documentation/web-services/chembl-data-web-services',
  license: 'CC BY-SA 3.0',
  driver: 'api',
  connection: {
    database: 'https://www.ebi.ac.uk/chembl/api/data',
    headers: { Accept: 'application/json' }
  },
  rateLimit: { requestsPerSecond: 5, maxConcurrent: 4 },
  entities: [
    {
      name: 'molecule',
      description: 'One compound or drug by ChEMBL id',
      path: '/molecule/{chemblId}.json',
      params: {
        chemblId: { description: 'ChEMBL molecule id, e.g. CHEMBL25 (aspirin)' }
      },
      fields: MOLECULE_FIELDS,
      example: { chemblId: 'CHEMBL25' },
      relations: MOLECULE_RELATIONS
    },
    {
      name: 'moleculeByInchiKey',
      description: 'The ChEMBL compound with this standard InChIKey',
      path: '/molecule/{inchiKey}.json',
      params: {
        inchiKey: { description: 'Standard InChIKey, e.g. BSYNRYMUTXBXSQ-UHFFFAOYSA-N' }
      },
      fields: MOLECULE_FIELDS,
      example: { inchiKey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N' },
      relations: MOLECULE_RELATIONS
    },
    {
      name: 'molecules',
      description: 'Compounds matching a name or synonym (full-text search, best match first)',
      path: '/molecule/search.json',
      params: {
        name: { name: 'q', description: 'Name, synonym or trade name, e.g. imatinib' }
      },
      rows: 'molecules',
      fields: { ...MOLECULE_FIELDS, score: 'score' },
      paginate: PAGINATE,
      example: { name: 'imatinib' },
      relations: MOLECULE_RELATIONS
    },
    {
      name: 'target',
      description: 'One drug target (protein, complex, family…) by ChEMBL id',
      path: '/target/{chemblId}.json',
      params: {
        chemblId: { description: 'ChEMBL target id, e.g. CHEMBL203 (EGFR)' }
      },
      fields: TARGET_FIELDS,
      example: { chemblId: 'CHEMBL203' },
      relations: TARGET_RELATIONS
    },
    {
      name: 'targetsForProtein',
      description: 'ChEMBL targets that include this UniProt protein as a component (single protein, complexes, families)',
      path: '/target.json',
      params: {
        uniprotAccession: { name: 'target_components__accession', description: 'UniProtKB accession, e.g. P00533' }
      },
      rows: 'targets',
      fields: TARGET_FIELDS,
      paginate: PAGINATE,
      example: { uniprotAccession: 'P00533' },
      relations: TARGET_RELATIONS
    },
    {
      name: 'targets',
      description: 'Targets matching a name or gene symbol (full-text search)',
      path: '/target/search.json',
      params: {
        name: { name: 'q', description: 'Target name or gene symbol, e.g. cyclooxygenase' }
      },
      rows: 'targets',
      fields: { ...TARGET_FIELDS, score: 'score' },
      paginate: PAGINATE,
      example: { name: 'cyclooxygenase' },
      relations: TARGET_RELATIONS
    },
    {
      name: 'activities',
      description: 'Measured bioactivities (IC50, Ki, EC50…) for a target and/or a molecule',
      path: '/activity.json',
      params: {
        targetChemblId: { description: 'ChEMBL target id, e.g. CHEMBL203' },
        moleculeChemblId: { description: 'ChEMBL molecule id, e.g. CHEMBL941' },
        standardType: { description: 'Activity type, e.g. IC50, Ki, EC50' },
        minPchembl: { description: 'Minimum pChEMBL value (−log10 molar potency), e.g. 7' }
      },
      query: (p) => {
        if (!p.targetChemblId && !p.moleculeChemblId) {
          throw new Error('chembl/activities needs targetChemblId or moleculeChemblId')
        }
        return {
          target_chembl_id: p.targetChemblId,
          molecule_chembl_id: p.moleculeChemblId,
          standard_type: p.standardType,
          pchembl_value__gte: p.minPchembl
        }
      },
      rows: 'activities',
      fields: {
        activityId: 'activity_id',
        moleculeChemblId: 'molecule_chembl_id',
        moleculeName: 'molecule_pref_name',
        targetChemblId: 'target_chembl_id',
        targetName: 'target_pref_name',
        targetOrganism: 'target_organism',
        standardType: 'standard_type',
        relation: 'standard_relation',
        value: num('standard_value'),
        units: 'standard_units',
        pchembl: num('pchembl_value'),
        assayChemblId: 'assay_chembl_id',
        assayType: 'assay_type',
        assayDescription: 'assay_description',
        documentChemblId: 'document_chembl_id',
        year: 'document_year',
        smiles: 'canonical_smiles'
      },
      paginate: PAGINATE,
      example: { targetChemblId: 'CHEMBL203', standardType: 'IC50' },
      relations: [
        { alias: 'molecule', description: 'The measured compound', entity: 'molecule', localKey: 'moleculeChemblId', foreignKey: 'chemblId', type: 'hasOne' },
        { alias: 'target', description: 'The target it was measured against', entity: 'target', localKey: 'targetChemblId', foreignKey: 'chemblId', type: 'hasOne' },
        { alias: 'document', description: 'Publication or dataset the measurement comes from', entity: 'document', localKey: 'documentChemblId', foreignKey: 'documentChemblId', type: 'hasOne' }
      ]
    },
    {
      name: 'mechanisms',
      description: 'Curated mechanisms of action of approved and clinical drugs, by drug or by target',
      path: '/mechanism.json',
      params: {
        chemblId: { description: 'ChEMBL molecule id of the drug, e.g. CHEMBL25' },
        targetChemblId: { description: 'ChEMBL target id, e.g. CHEMBL203 — drugs acting on it' }
      },
      query: (p) => {
        if (!p.chemblId && !p.targetChemblId) throw new Error('chembl/mechanisms needs chemblId or targetChemblId')
        return { molecule_chembl_id: p.chemblId, target_chembl_id: p.targetChemblId }
      },
      rows: 'mechanisms',
      fields: {
        mechanismId: 'mec_id',
        chemblId: 'molecule_chembl_id',
        targetChemblId: 'target_chembl_id',
        mechanismOfAction: 'mechanism_of_action',
        actionType: 'action_type',
        maxPhase: num('max_phase'),
        directInteraction: flag('direct_interaction'),
        diseaseEfficacy: flag('disease_efficacy'),
        pmids: (r) => (r.mechanism_refs || []).filter((x) => x.ref_type === 'PubMed').map((x) => String(x.ref_id))
      },
      paginate: PAGINATE,
      example: { chemblId: 'CHEMBL25' },
      relations: [
        { alias: 'molecule', description: 'The drug', entity: 'molecule', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasOne' },
        { alias: 'target', description: 'The target the drug acts on', entity: 'target', localKey: 'targetChemblId', foreignKey: 'chemblId', type: 'hasOne' }
      ]
    },
    {
      name: 'indications',
      description: 'Diseases a drug is approved for or investigated in, with the highest clinical phase reached',
      path: '/drug_indication.json',
      params: {
        chemblId: { name: 'molecule_chembl_id', description: 'ChEMBL molecule id of the drug, e.g. CHEMBL25' }
      },
      rows: 'drug_indications',
      fields: {
        indicationId: 'drugind_id',
        chemblId: 'molecule_chembl_id',
        diseaseId: 'efo_id',
        disease: 'efo_term',
        meshId: 'mesh_id',
        meshHeading: 'mesh_heading',
        maxPhase: num('max_phase_for_ind'),
        nctIds: (r) => (r.indication_refs || [])
          .filter((x) => x.ref_type === 'ClinicalTrials')
          .flatMap((x) => String(x.ref_id).split(','))
          .map((s) => s.trim())
          .filter(Boolean)
      },
      paginate: PAGINATE,
      example: { chemblId: 'CHEMBL25' },
      relations: [
        { alias: 'molecule', description: 'The drug', entity: 'molecule', localKey: 'chemblId', foreignKey: 'chemblId', type: 'hasOne' },
        { alias: 'disease', description: 'Open Targets disease record', catalog: 'opentargets', entity: 'disease', localKey: 'diseaseId', foreignKey: 'diseaseId', type: 'hasOne' },
        { alias: 'diseaseTerm', description: 'The EFO term in the Ontology Lookup Service', catalog: 'ols', entity: 'term', localKey: 'diseaseId', foreignKey: 'termId', where: { ontology: 'efo' }, type: 'hasOne' },
        { alias: 'mesh', description: 'The MeSH heading for the indication', catalog: 'mesh', entity: 'descriptor', localKey: 'meshId', foreignKey: 'meshId', type: 'hasOne' }
      ]
    },
    {
      name: 'document',
      description: 'A publication or deposited dataset that ChEMBL activities were extracted from',
      path: '/document/{documentChemblId}.json',
      params: {
        documentChemblId: { description: 'ChEMBL document id, e.g. CHEMBL1134862' }
      },
      fields: {
        documentChemblId: 'document_chembl_id',
        pmid: (r) => (r.pubmed_id == null ? null : String(r.pubmed_id)),
        doi: 'doi',
        title: 'title',
        journal: 'journal',
        year: 'year',
        documentType: 'doc_type'
      },
      example: { documentChemblId: 'CHEMBL1134862' },
      relations: [
        { alias: 'article', description: 'The PubMed record', catalog: 'pubmed', entity: 'article', localKey: 'pmid', foreignKey: 'pmid', type: 'hasOne' },
        { alias: 'activities', description: 'Activities extracted from this document', entity: 'activitiesInDocument', localKey: 'documentChemblId', foreignKey: 'documentChemblId', type: 'hasMany' }
      ]
    },
    {
      name: 'activitiesInDocument',
      description: 'Bioactivities extracted from one publication or dataset',
      path: '/activity.json',
      params: {
        documentChemblId: { name: 'document_chembl_id', description: 'ChEMBL document id, e.g. CHEMBL1134862' }
      },
      rows: 'activities',
      fields: {
        activityId: 'activity_id',
        moleculeChemblId: 'molecule_chembl_id',
        targetChemblId: 'target_chembl_id',
        targetName: 'target_pref_name',
        standardType: 'standard_type',
        relation: 'standard_relation',
        value: num('standard_value'),
        units: 'standard_units',
        pchembl: num('pchembl_value'),
        assayChemblId: 'assay_chembl_id'
      },
      paginate: PAGINATE,
      example: { documentChemblId: 'CHEMBL1134862' },
      relations: [
        { alias: 'molecule', description: 'The measured compound', entity: 'molecule', localKey: 'moleculeChemblId', foreignKey: 'chemblId', type: 'hasOne' },
        { alias: 'target', description: 'The target it was measured against', entity: 'target', localKey: 'targetChemblId', foreignKey: 'chemblId', type: 'hasOne' }
      ]
    }
  ]
}
