'use strict';

/**
 * Lifelike Knowledge Graph – Neo4j graph database from biosustain/lifelike.
 * Reference: https://github.com/biosustain/lifelike
 *
 * Lifelike is an open-source knowledge graph platform that integrates
 * biomedical data from multiple databases into a single Neo4j graph.
 * This catalog describes the standard node labels and relationships
 * defined in the lifelike graph-db migration changelogs.
 *
 * Connection properties should be set per-installation:
 *  host:     Neo4j host (default: localhost)
 *  port:     7687 (Bolt)
 *  database: "neo4j" (or the name of your Lifelike db)
 *  user:     Neo4j username
 *  password: Neo4j password
 *  scheme:   "neo4j" | "neo4j+s" | "bolt" | "bolt+s"
 *
 * Node labels / data sources:
 *  db_CHEBI    Chemical Entities of Biological Interest
 *  db_GO       Gene Ontology (BiologicalProcess, MolecularFunction, CellularComponent)
 *  db_NCBI     NCBI gene and taxonomy nodes
 *  db_KEGG     KEGG pathways, KO entries, genes and genomes
 *  db_UniProt  UniProt reviewed protein sequences
 *  db_STRING   STRING protein–protein interaction data
 *  db_MESH     Medical Subject Headings (NLM)
 *  db_RegulonDB RegulonDB E. coli K-12 regulation data
 *  db_Enzyme   IUBMB Enzyme Commission (EC numbers)
 *
 * Relationship map:
 *  - Chemical      → Synonym        (HAS_SYNONYM)
 *  - Gene          → db_GO          (GO_LINK)
 *  - Gene          → Taxonomy       (HAS_TAXONOMY)
 *  - Protein       → Gene           (HAS_GENE)
 *  - Protein       → db_GO          (GO_LINK)
 *  - Taxonomy      → Taxonomy       (HAS_PARENT)
 *  - db_KEGG(Gene) → KO             (HAS_KO)
 *  - KO            → Pathway        (IN_PATHWAY)
 *  - db_MESH       → db_MESH        (HAS_PARENT, HAS_TREENUMBER, MAPPED_TO_DESCRIPTOR)
 */
module.exports = {
  name: 'lifelike',
  label: 'Lifelike Knowledge Graph (Neo4j)',
  description: 'Lifelike integrated biomedical knowledge graph stored in Neo4j. Contains nodes from ChEBI, GO, NCBI (Gene & Taxonomy), KEGG, UniProt, STRING, MeSH, RegulonDB and Enzyme Commission. Connect to your own Lifelike Neo4j instance by supplying credentials.',
  driver: 'neo4j',
  connection: {
    host: 'localhost',
    database: 'neo4j',
    user: 'neo4j',
    password: 'password',
    scheme: 'bolt',
  },
  entities: [
    {
      // ChEBI chemical entities
      name: 'Chemical',
      columns: ['eid', 'name', 'definition', 'inchi', 'inchi_key', 'smiles', 'alt_id', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: '/terms', foreignKey: 'eid', type: 'belongsTo', alias: 'chebiEntry', catalog: 'chebi' },
      ],
    },
    {
      // Gene Ontology biological processes
      name: 'BiologicalProcess',
      columns: ['eid', 'name', 'description', 'alt_id', 'obsolete', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: '/ontology/term', foreignKey: 'eid', type: 'belongsTo', alias: 'goTerm', catalog: 'geneontology' },
      ],
    },
    {
      // Gene Ontology molecular functions
      name: 'MolecularFunction',
      columns: ['eid', 'name', 'description', 'alt_id', 'obsolete', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: '/ontology/term', foreignKey: 'eid', type: 'belongsTo', alias: 'goTerm', catalog: 'geneontology' },
      ],
    },
    {
      // Gene Ontology cellular components
      name: 'CellularComponent',
      columns: ['eid', 'name', 'description', 'alt_id', 'obsolete', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: '/ontology/term', foreignKey: 'eid', type: 'belongsTo', alias: 'goTerm', catalog: 'geneontology' },
      ],
    },
    {
      // NCBI Taxonomy nodes
      name: 'Taxonomy',
      columns: ['eid', 'name', 'rank', 'category', 'parent_id', 'species_id', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: 'Taxonomy', foreignKey: 'HAS_PARENT', type: 'belongsTo', alias: 'parent' },
        { entity: '/esummary.fcgi', foreignKey: 'eid', type: 'hasMany', alias: 'ncbiTaxonomy', catalog: 'ncbi' },
      ],
    },
    {
      // NCBI Gene nodes
      name: 'Gene',
      columns: ['eid', 'name', 'locus_tag', 'full_name', 'tax_id', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: 'Taxonomy', foreignKey: 'HAS_TAXONOMY', type: 'belongsTo', alias: 'taxonomy' },
        { entity: 'BiologicalProcess', foreignKey: 'GO_LINK', type: 'hasMany', alias: 'biologicalProcesses' },
        { entity: 'MolecularFunction', foreignKey: 'GO_LINK', type: 'hasMany', alias: 'molecularFunctions' },
        { entity: 'CellularComponent', foreignKey: 'GO_LINK', type: 'hasMany', alias: 'cellularComponents' },
        { entity: '/esummary.fcgi', foreignKey: 'eid', type: 'hasMany', alias: 'ncbiGeneInfo', catalog: 'ncbi' },
      ],
    },
    {
      // UniProt protein nodes
      name: 'Protein',
      columns: ['eid', 'name', 'tax_id', 'pathway', 'function', 'data_source', 'original_entity_types'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: 'Gene', foreignKey: 'HAS_GENE', type: 'hasMany', alias: 'genes' },
        { entity: 'Taxonomy', foreignKey: 'HAS_TAXONOMY', type: 'belongsTo', alias: 'taxonomy' },
        { entity: 'BiologicalProcess', foreignKey: 'GO_LINK', type: 'hasMany', alias: 'biologicalProcesses' },
        { entity: 'MolecularFunction', foreignKey: 'GO_LINK', type: 'hasMany', alias: 'molecularFunctions' },
        { entity: '/uniprotkb/search', foreignKey: 'eid', type: 'belongsTo', alias: 'uniprotEntry', catalog: 'uniprot' },
      ],
    },
    {
      // KEGG pathway nodes
      name: 'Pathway',
      columns: ['eid', 'name', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: '/get', foreignKey: 'eid', type: 'belongsTo', alias: 'keggEntry', catalog: 'kegg' },
      ],
    },
    {
      // KEGG Orthology (KO) nodes
      name: 'KO',
      columns: ['eid', 'name', 'definition', 'data_source'],
      relations: [
        { entity: 'Pathway', foreignKey: 'IN_PATHWAY', type: 'hasMany', alias: 'pathways' },
        { entity: '/find/ko', foreignKey: 'eid', type: 'belongsTo', alias: 'keggKO', catalog: 'kegg' },
      ],
    },
    {
      // MeSH topical descriptor nodes
      name: 'TopicalDescriptor',
      columns: ['eid', 'name', 'obsolete', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: 'TreeNumber', foreignKey: 'HAS_TREENUMBER', type: 'hasMany', alias: 'treeNumbers' },
        { entity: '/lookup/descriptor', foreignKey: 'name', type: 'belongsTo', alias: 'meshDescriptor', catalog: 'mesh' },
      ],
    },
    {
      // MeSH tree number nodes
      name: 'TreeNumber',
      columns: ['eid', 'obsolete', 'data_source'],
      relations: [
        { entity: 'TreeNumber', foreignKey: 'HAS_PARENT', type: 'belongsTo', alias: 'parent' },
      ],
    },
    {
      // RegulonDB gene nodes
      name: 'Operon',
      columns: ['eid', 'name', 'left_end_position', 'right_end_position', 'strand', 'data_source'],
      relations: [
        { entity: 'Gene', foreignKey: 'ELEMENT_OF', type: 'hasMany', alias: 'genes' },
        { entity: '/operons', foreignKey: 'name', type: 'belongsTo', alias: 'regulondbOperon', catalog: 'regulondb' },
      ],
    },
    {
      // Enzyme Commission (EC number) nodes
      name: 'EC_Number',
      columns: ['eid', 'name', 'code', 'activities', 'cofactors', 'data_source'],
      relations: [
        { entity: 'Synonym', foreignKey: 'HAS_SYNONYM', type: 'hasMany', alias: 'synonyms' },
        { entity: 'EC_Number', foreignKey: 'HAS_PARENT', type: 'belongsTo', alias: 'parent' },
        { entity: '/list/enzyme', foreignKey: 'code', type: 'belongsTo', alias: 'keggEnzyme', catalog: 'kegg' },
      ],
    },
    {
      // Synonym nodes shared across all entity types
      name: 'Synonym',
      columns: ['name', 'lowercase_name'],
      relations: [],
    },
  ],
};
