'use strict';

/**
 * Lifelike Elasticsearch – full-text search index for the Lifelike platform.
 * Reference: https://github.com/biosustain/lifelike
 * Elasticsearch: https://www.elastic.co/guide/en/elasticsearch/reference/current/rest-apis.html
 *
 * Lifelike uses Elasticsearch 7.x for indexing and searching biomedical content
 * including annotated PDF documents, enrichment tables, maps and knowledge graph
 * entity annotations. This catalog entry connects to a Lifelike-instance's
 * Elasticsearch service.
 *
 * No credentials required for default dev deployments.
 * Set user + password for secured clusters.
 *
 * Key where parameters:
 *  - q:       Lucene query string (simple GET search)
 *  - size:    number of results (default 10)
 *  - from:    offset for pagination
 *  - _body:   JSON string — full Elasticsearch query DSL body (triggers POST /_search)
 *
 * Example queries:
 *  Simple search: from "lifelike/_doc" where: { q: "BRCA1", size: "10" }
 *  DSL search:    from "lifelike" where: { _body: '{"query":{"match":{"name":"apoptosis"}},"size":5}' }
 *
 * Relationship map:
 *  - lifelike/_doc  →  Chemical  (entity_id → eid, belongsTo lifelike graph node, catalog: lifelike)
 *  - lifelike/_doc  →  /esummary.fcgi  (ncbi_id → id, hasMany NCBI records, catalog: ncbi)
 */
module.exports = {
  name: 'lifelike-elasticsearch',
  label: 'Lifelike Elasticsearch',
  description: 'Full-text search index for the Lifelike knowledge graph platform. Searches annotations, documents and entity records indexed from the Lifelike Neo4j graph. Pass where._body for Elasticsearch DSL queries or where.q for simple searches.',
  driver: 'elasticsearch',
  connection: {
    database: 'http://localhost:9200',
  },
  entities: [
    {
      // Search all Lifelike content (documents, maps, enrichment tables, entities)
      // where: { q: "glucose metabolism", size: "10" }
      // or DSL: where: { _body: '{"query":{"multi_match":{"query":"glucose","fields":["name","text"]}}}' }
      name: 'lifelike',
      columns: ['_id', '_score', 'id', 'name', 'type', 'entity_type', 'description', 'data_source', 'synonyms', 'highlight'],
      relations: [
        { entity: 'Chemical', foreignKey: 'id', type: 'belongsTo', alias: 'graphNode', catalog: 'lifelike' },
        { entity: '/esummary.fcgi', foreignKey: 'ncbi_id', type: 'hasMany', alias: 'ncbiRecords', catalog: 'ncbi' },
      ],
    },
    {
      // Entity annotations index (annotated entities from documents)
      name: 'annotations',
      columns: ['_id', '_score', 'entity_id', 'entity_name', 'entity_type', 'data_source', 'document_id', 'text_context'],
      relations: [
        { entity: '/lookup/descriptor', foreignKey: 'entity_name', type: 'belongsTo', alias: 'meshDescriptor', catalog: 'mesh' },
        { entity: '/terms', foreignKey: 'entity_name', type: 'belongsTo', alias: 'chebiTerm', catalog: 'chebi' },
      ],
    },
  ],
};
