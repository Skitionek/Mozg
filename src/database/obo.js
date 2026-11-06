'use strict'

/**
 * OBO keys: what kind of identifier a field or parameter holds.
 *
 * An OBO key is the prefix of an identifier space as the OBO community
 * registers it in the Bioregistry (https://bioregistry.io) — the same prefix
 * OBO files use in `xref: <prefix>:<id>` lines: `uniprot`, `ensembl`,
 * `ncbigene`, `chebi`, `mondo`, …  Annotating fields with these keys gives
 * Mozg one rule that replaces most hand-written joins:
 *
 *     two fields with the same OBO key and the same value name the same thing.
 *
 * For that rule to hold, every keyed value must be written one way, whatever
 * source it came from.  Each key therefore has a canonical form, and the api
 * driver normalises keyed fields to it:
 *
 *   - `curie` keys are written as OBO-style CURIEs with the registry's
 *     preferred prefix — `CHEBI:15365`, `GO:0006915`, `HP:0001250`,
 *     `HGNC:11998` — because that is how their own authorities write them;
 *   - `local` keys are written as the bare local identifier — `P04637`,
 *     `ENSG00000141510` (unversioned), `7157`, `rs28934578`.
 *
 * A field may also hold CURIEs from several identifier spaces (a `diseaseId`
 * can be MONDO, EFO, Orphanet or OMIM).  Its key is `*`: each value carries
 * its own prefix, which names its key.
 */

// Bioregistry prefix → how its identifiers are written.
//   prefix:  preferred CURIE prefix (Bioregistry `preferred_prefix`)
//   form:    'curie' or 'local' — the canonical way Mozg writes values
//   pattern: the local part, as the Bioregistry validates it
//   number:  canonical values are numbers
//   synonyms: other prefixes seen in the wild for the same space
const KEYS = {
  uniprot: { label: 'UniProtKB accession', prefix: 'uniprot', form: 'local', pattern: /^([OPQ]\d[A-Z0-9]{3}\d|[A-NR-Z]\d([A-Z][A-Z0-9]{2}\d){1,2})$/, upper: true, synonyms: ['uniprotkb', 'sp', 'swissprot'] },
  ensembl: { label: 'Ensembl stable id', prefix: 'ensembl', form: 'local', pattern: /^ENS[A-Z]*[FPTGE]\d{11}$/, unversion: true },
  ncbigene: { label: 'NCBI Gene id', prefix: 'NCBIGene', form: 'local', pattern: /^\d+$/, synonyms: ['entrez', 'geneid', 'ncbi.gene', 'entrezgene'] },
  hgnc: { label: 'HGNC gene id', prefix: 'HGNC', form: 'curie', pattern: /^\d{1,5}$/ },
  'hgnc.symbol': { label: 'HGNC gene symbol', prefix: 'hgnc.symbol', form: 'local', pattern: /^[A-Za-z0-9_@-]+$/ },
  ncbitaxon: { label: 'NCBI Taxonomy id', prefix: 'NCBITaxon', form: 'local', pattern: /^\d+$/, number: true, synonyms: ['taxon', 'taxid', 'ncbi_taxid'] },
  pdb: { label: 'PDB entry', prefix: 'pdb', form: 'local', pattern: /^[0-9][A-Z0-9]{3}$/, upper: true },
  chembl: { label: 'ChEMBL id (molecule, target, assay or document)', prefix: 'chembl', form: 'local', pattern: /^CHEMBL\d+$/, upper: true },
  'chembl.compound': { label: 'ChEMBL molecule', prefix: 'chembl.compound', form: 'local', pattern: /^CHEMBL\d+$/, upper: true },
  'chembl.target': { label: 'ChEMBL target', prefix: 'chembl.target', form: 'local', pattern: /^CHEMBL\d+$/, upper: true },
  'chembl.assay': { label: 'ChEMBL assay', prefix: 'chembl.assay', form: 'local', pattern: /^CHEMBL\d+$/, upper: true },
  'chembl.document': { label: 'ChEMBL document', prefix: 'chembl.document', form: 'local', pattern: /^CHEMBL\d+$/, upper: true },
  'pubchem.compound': { label: 'PubChem compound id (CID)', prefix: 'pubchem.compound', form: 'local', pattern: /^\d+$/, number: true, synonyms: ['pubchem', 'cid'] },
  inchikey: { label: 'Standard InChIKey', prefix: 'inchikey', form: 'local', pattern: /^[A-Z]{14}-[A-Z]{10}(-[A-Z])?$/, upper: true, synonyms: ['inchi_key'] },
  chebi: { label: 'ChEBI entity', prefix: 'CHEBI', form: 'curie', pattern: /^\d+$/ },
  pubmed: { label: 'PubMed id', prefix: 'pubmed', form: 'local', pattern: /^\d+$/, synonyms: ['pmid', 'med'] },
  pmc: { label: 'PubMed Central id', prefix: 'pmc', form: 'local', pattern: /^PMC\d+$/, upper: true, synonyms: ['pmcid'] },
  doi: { label: 'Digital object identifier', prefix: 'doi', form: 'local', pattern: /^10\.\d{2,9}\/.+$/, lower: true },
  dbsnp: { label: 'dbSNP reference SNP id', prefix: 'dbsnp', form: 'local', pattern: /^rs\d+$/, lower: true, synonyms: ['rs'] },
  go: { label: 'Gene Ontology term', prefix: 'GO', form: 'curie', pattern: /^\d{7}$/ },
  reactome: { label: 'Reactome stable id', prefix: 'reactome', form: 'local', pattern: /^R-[A-Z]{3}-\d+(-\d+)?$/, upper: true },
  interpro: { label: 'InterPro entry', prefix: 'interpro', form: 'local', pattern: /^IPR\d{6}$/, upper: true },
  mondo: { label: 'MONDO disease', prefix: 'MONDO', form: 'curie', pattern: /^\d{7}$/ },
  efo: { label: 'Experimental Factor Ontology term', prefix: 'EFO', form: 'curie', pattern: /^\d{7}$/ },
  orpha: { label: 'Orphanet rare disease', prefix: 'ORPHA', form: 'curie', pattern: /^\d+$/, synonyms: ['orphanet', 'ordo'] },
  omim: { label: 'OMIM entry', prefix: 'OMIM', form: 'curie', pattern: /^\d+$/, synonyms: ['mim'] },
  doid: { label: 'Disease Ontology term', prefix: 'DOID', form: 'curie', pattern: /^\d+$/ },
  hp: { label: 'Human Phenotype Ontology term', prefix: 'HP', form: 'curie', pattern: /^\d{7}$/, synonyms: ['hpo'] },
  uberon: { label: 'UBERON anatomy term', prefix: 'UBERON', form: 'curie', pattern: /^\d+$/ },
  cl: { label: 'Cell Ontology term', prefix: 'CL', form: 'curie', pattern: /^\d{7}$/ },
  ncit: { label: 'NCI Thesaurus concept', prefix: 'NCIT', form: 'curie', pattern: /^[A-Z]+\d+$/ },
  mesh: { label: 'MeSH descriptor or concept', prefix: 'mesh', form: 'local', pattern: /^[CDQ]\d+$/, upper: true },
  clinicaltrials: { label: 'ClinicalTrials.gov study', prefix: 'clinicaltrials', form: 'local', pattern: /^NCT\d{8}$/, upper: true, synonyms: ['nct'] },
  string: { label: 'STRING protein id (taxon.protein)', prefix: 'string', form: 'local', pattern: /^\d+\.\S+$/ },
  rnacentral: { label: 'RNAcentral id', prefix: 'rnacentral', form: 'local', pattern: /^URS[0-9A-F]{10}(_\d+)?$/ },
  rhea: { label: 'Rhea reaction', prefix: 'RHEA', form: 'curie', pattern: /^\d{5,}$/ },
  'clinvar.variation': { label: 'ClinVar variation id', prefix: 'clinvar.variation', form: 'local', pattern: /^\d+$/, synonyms: ['clinvar'] },
  lipidmaps: { label: 'LIPID MAPS id', prefix: 'lipidmaps', form: 'local', pattern: /^LM[A-Z]{2}\d{4}[0-9A-Za-z]{4,6}$/, upper: true },
  rxnorm: { label: 'RxNorm concept (RxCUI)', prefix: 'rxnorm', form: 'local', pattern: /^\d{1,7}$/, synonyms: ['rxcui'] },
  ec: { label: 'Enzyme Commission number', prefix: 'EC', form: 'local', pattern: /^\d{1,2}(\.(\d{1,3}|-|n\d+)){0,3}$/ },
  mgi: { label: 'MGI marker', prefix: 'MGI', form: 'curie', pattern: /^\d+$/ },
  rgd: { label: 'RGD gene', prefix: 'RGD', form: 'curie', pattern: /^\d+$/ },
  // These four write their identifiers without a prefix (FBgn0000490,
  // ZDB-GENE-990415-8, WBGene00006763, S000002493), so the bare form is canonical.
  zfin: { label: 'ZFIN entity', prefix: 'ZFIN', form: 'local', pattern: /^ZDB-\w+-\d+-\d+$/ },
  wormbase: { label: 'WormBase entity', prefix: 'WB', form: 'local', pattern: /^WB[A-Z][a-z]+\d+$/, synonyms: ['wb'] },
  flybase: { label: 'FlyBase entity', prefix: 'FB', form: 'local', pattern: /^FB[a-z]{2}\d{7}$/, synonyms: ['fb'] },
  sgd: { label: 'SGD entity', prefix: 'SGD', form: 'local', pattern: /^S\d+$/ },
  biosample: { label: 'BioSamples accession', prefix: 'biosample', form: 'local', pattern: /^SAM[NED][A-Z]?\d+$/, upper: true },
  bioproject: { label: 'BioProject / ENA study accession', prefix: 'bioproject', form: 'local', pattern: /^PRJ[DEN][A-Z]\d+$/, upper: true },
  geo: { label: 'GEO series, sample, platform or dataset', prefix: 'geo', form: 'local', pattern: /^G(PL|SM|SE|DS)\d+$/, upper: true },
  'pride.project': { label: 'PRIDE / ProteomeXchange project', prefix: 'pride.project', form: 'local', pattern: /^P(X|R)D\d{6}$/, upper: true },
  refseq: { label: 'RefSeq accession', prefix: 'refseq', form: 'local', pattern: /^(((AC|AP|NC|NG|NM|NP|NR|NT|NW|WP|XM|XP|XR|YP|ZP)_\d+)|(NZ_[A-Z]{2,4}\d+))(\.\d+)?$/ },
  'uniprot.isoform': { label: 'UniProtKB isoform', prefix: 'uniprot.isoform', form: 'local', pattern: /^([OPQ]\d[A-Z0-9]{3}\d|[A-NR-Z]\d([A-Z][A-Z0-9]{2}\d){1,2})-\d+$/ },
  hmdb: { label: 'HMDB metabolite', prefix: 'hmdb', form: 'local', pattern: /^HMDB\d+$/, upper: true },
  drugbank: { label: 'DrugBank drug', prefix: 'drugbank', form: 'local', pattern: /^DB\d{5}$/, upper: true },
  cas: { label: 'CAS registry number', prefix: 'cas', form: 'local', pattern: /^\d{1,7}-\d{2}-\d$/ }
}

// Every spelling of every prefix (lower-cased) → its key.
const PREFIX_TO_KEY = new Map()
for (const [key, spec] of Object.entries(KEYS)) {
  for (const p of [key, spec.prefix, ...(spec.synonyms || [])]) PREFIX_TO_KEY.set(p.toLowerCase(), key)
}

/**
 * The canonical field name for each key, and the key of each canonical field
 * name.  These are the identifier names catalog entries already share
 * (src/catalog/README.md), so most fields need no annotation at all.
 */
const FIELD_KEYS = {
  // More specific names first: the suffix convention takes the first match.
  moleculeChemblId: 'chembl.compound',
  parentChemblId: 'chembl.compound',
  targetChemblId: 'chembl.target',
  assayChemblId: 'chembl.assay',
  documentChemblId: 'chembl.document',
  uniprotAccession: 'uniprot',
  ensemblGeneId: 'ensembl',
  ncbiGeneId: 'ncbigene',
  hgncId: 'hgnc',
  taxonId: 'ncbitaxon',
  pdbId: 'pdb',
  chemblId: 'chembl',
  pubchemCid: 'pubchem.compound',
  inchiKey: 'inchikey',
  chebiId: 'chebi',
  pmid: 'pubmed',
  pmcid: 'pmc',
  doi: 'doi',
  rsId: 'dbsnp',
  goId: 'go',
  reactomeId: 'reactome',
  interproId: 'interpro',
  hpoId: 'hp',
  mondoId: 'mondo',
  efoId: 'efo',
  uberonId: 'uberon',
  omimId: 'omim',
  nctId: 'clinicaltrials',
  stringId: 'string',
  rnacentralId: 'rnacentral',
  meshId: 'mesh',
  rheaId: 'rhea',
  clinvarId: 'clinvar.variation',
  lmId: 'lipidmaps',
  rxcui: 'rxnorm',
  ecNumber: 'ec',
  diseaseId: '*'
}

// Identifier spaces that name diseases.  A `diseaseId` *field* holds a CURIE
// from any of them (key `*`); a `diseaseId` *parameter* accepts these.
const DISEASE_KEYS = ['mondo', 'efo', 'orpha', 'omim', 'doid', 'ncit', 'mesh']

// Gene identifiers of the model-organism databases (Alliance of Genome
// Resources, GO, Monarch), written as CURIEs: HGNC:11998, MGI:98834, …
const GENE_CURIE_KEYS = ['hgnc', 'mgi', 'rgd', 'zfin', 'wormbase', 'flybase', 'sgd']

// OBO ontologies served by the Ontology Lookup Service and Monarch.
const ONTOLOGY_KEYS = ['go', 'chebi', 'hp', 'mondo', 'efo', 'uberon', 'cl', 'doid', 'ncit']

// Parameters whose accepted keys differ from their field convention.
const PARAM_KEYS = {
  diseaseId: DISEASE_KEYS
}

// Keys that refine another: a ChEMBL id is a molecule, target, assay or
// document id, and a value keyed only `chembl` may be any of them.
const PARENT_KEY = {
  'chembl.compound': 'chembl',
  'chembl.target': 'chembl',
  'chembl.assay': 'chembl',
  'chembl.document': 'chembl'
}

const CANONICAL_FIELD = { ...Object.fromEntries(Object.entries(FIELD_KEYS).filter(([, k]) => k !== '*').reverse().map(([f, k]) => [k, f])), 'chembl.compound': 'chemblId', 'chembl.target': 'chemblId' }

/**
 * The key a name carries by convention: the canonical names themselves, and
 * names that end in one (`partnerUniprotAccession`, `targetChemblId`), with
 * an optional plural `s` for lists (`pdbIds`, `pmids`).
 */
function conventionalKey (name) {
  if (typeof name !== 'string') return null
  if (Object.hasOwn(FIELD_KEYS, name)) return FIELD_KEYS[name]
  for (const [field, key] of Object.entries(FIELD_KEYS)) {
    const cap = field[0].toUpperCase() + field.slice(1)
    if (name === `${field}s`) return key
    if (name.length > cap.length && (name.endsWith(cap) || name.endsWith(`${cap}s`))) return key
  }
  return null
}

/**
 * The OBO key of a field of an entity: an explicit `entity.obo[field]`
 * annotation (null switches the convention off), else the convention.
 */
function fieldKey (entity, field) {
  if (entity && entity.obo && Object.hasOwn(entity.obo, field)) {
    const key = entity.obo[field]
    // A list of keys on a field means a CURIE from any of them.
    return Array.isArray(key) ? '*' : key
  }
  return conventionalKey(field)
}

/**
 * Every key a field's values can have: its one key, or for a CURIE-valued
 * field (`*`) the identifier spaces it is annotated with — a `diseaseId`
 * holds disease ontology CURIEs.  Empty when nothing is known.
 */
function fieldKeys (entity, field) {
  if (entity && entity.obo && Array.isArray(entity.obo[field])) return entity.obo[field]
  const key = fieldKey(entity, field)
  if (key == null) return []
  if (key === '*') return PARAM_KEYS[field] || []
  return [key]
}

/**
 * The OBO key(s) a parameter accepts: an explicit `params[name].obo` (a key,
 * a list of keys, or `*`), else the convention for its name.
 * @returns {string[]} empty when the parameter is not an identifier
 */
function paramKeys (entity, name) {
  const spec = entity && entity.params && entity.params[name]
  const declared = spec && Object.hasOwn(spec, 'obo') ? spec.obo : undefined
  // SQL and graph entries annotate columns, which double as their filters.
  const explicit = declared !== undefined ? declared : (entity && entity.obo && Object.hasOwn(entity.obo, name) ? entity.obo[name] : undefined)
  const keys = explicit !== undefined ? explicit : (PARAM_KEYS[name] || conventionalKey(name))
  if (keys == null) return []
  return Array.isArray(keys) ? keys : [keys]
}

/** Fields of an entity that carry an OBO key, as { field: key }. */
function entityKeys (entity, columns) {
  const out = {}
  for (const field of columns) {
    const key = fieldKey(entity, field)
    if (key) out[field] = key
  }
  return out
}

/** The key named by a CURIE's prefix, or null. */
function keyOfCurie (value) {
  const m = typeof value === 'string' && value.match(/^([A-Za-z][\w.-]*)[:_](.+)$/)
  if (!m) return null
  return PREFIX_TO_KEY.get(m[1].toLowerCase()) || null
}

function stripPrefix (spec, key, text) {
  const m = text.match(/^([A-Za-z][\w.-]*):(.+)$/)
  if (m && PREFIX_TO_KEY.get(m[1].toLowerCase()) === key) return m[2]
  return text
}

function normalizeOne (key, value) {
  if (value == null || value === '') return null
  const spec = KEYS[key]
  if (!spec) return value

  let local = stripPrefix(spec, key, String(value).trim())
  if (key === 'doi') local = local.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  if (spec.unversion) local = local.replace(/\.\d+$/, '')
  if (spec.upper) local = local.toUpperCase()
  if (spec.lower) local = local.toLowerCase()

  // Values that do not look like this key's identifiers are left as they
  // came; verification reports them rather than Mozg rewriting them wrongly.
  if (!spec.pattern.test(local)) return value

  if (spec.form === 'curie') return `${spec.prefix}:${local}`
  if (spec.number) return Number(local)
  return local
}

/** A CURIE from an identifier space named by its own prefix (key `*`). */
function normalizeCurie (value) {
  if (value == null || value === '') return null
  const key = keyOfCurie(String(value))
  if (!key) return value
  const local = String(value).replace(/^[A-Za-z][\w.-]*[:_]/, '')
  const spec = KEYS[key]
  return spec.pattern.test(local) ? `${spec.prefix}:${local}` : value
}

/**
 * The canonical form of a value with the given key (lists element-wise).
 * Unrecognised values pass through unchanged.
 */
function normalize (key, value) {
  if (Array.isArray(value)) return value.map((v) => normalize(key, v))
  if (key === '*') return normalizeCurie(value)
  return normalizeOne(key, value)
}

/** True when a value is in its key's canonical form (lists: every element). */
function isCanonical (key, value) {
  if (value == null) return true
  if (Array.isArray(value)) return value.every((v) => isCanonical(key, v))
  if (key === '*') {
    const k = keyOfCurie(value)
    return Boolean(k) && normalizeCurie(value) === value && KEYS[k].pattern.test(String(value).split(':').slice(1).join(':'))
  }
  const spec = KEYS[key]
  if (!spec) return true
  const n = normalizeOne(key, value)
  if (n !== value) return false
  const local = spec.form === 'curie' ? String(value).slice(spec.prefix.length + 1) : String(value)
  return spec.pattern.test(local)
}

/**
 * The key a value actually belongs to — the field's key, or for `*` fields
 * the key named by the value's own prefix.
 */
function keyOfValue (key, value) {
  return key === '*' ? keyOfCurie(value) : key
}

/**
 * Whether a parameter accepting `accepted` keys can take a value of `key`.
 * A `*` value (a CURIE from any space) fits a parameter that accepts several
 * spaces; whether this particular value does is decided per value.
 */
function accepts (accepted, key) {
  if (key === '*') return accepted.includes('*') || accepted.length > 1
  if (accepted.includes('*') || accepted.includes(key)) return true
  // A refined key fits its parent and vice versa (a `chembl` id may be a molecule).
  return accepted.some((a) => PARENT_KEY[a] === key || PARENT_KEY[key] === a)
}

module.exports = {
  KEYS,
  DISEASE_KEYS,
  GENE_CURIE_KEYS,
  ONTOLOGY_KEYS,
  FIELD_KEYS,
  CANONICAL_FIELD,
  conventionalKey,
  fieldKey,
  fieldKeys,
  paramKeys,
  entityKeys,
  keyOfCurie,
  keyOfValue,
  normalize,
  isCanonical,
  accepts
}
