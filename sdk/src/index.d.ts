// Types for @skitionek/mozg-sdk.

export type Driver =
  | 'postgres' | 'mysql' | 'sqlite3' | 'neo4j' | 'arango' | 'biocyc' | 'api'
  | 'rest' | 'kegg' | 'openapi' | 'soap' | 'odata' | 'thrift' | 'elasticsearch'

export type SortDirection = 'asc' | 'desc'
export type RelationType = 'hasMany' | 'hasOne' | 'belongsTo'

/** How a value may name an ontology term. */
export type OntologyMatch = 'id' | 'label' | 'synonym' | 'xref'
/** Formats terms can be read from; `obo` is the compact OBO flat-file format. */
export type TermFormat = 'auto' | 'obo' | 'turtle' | 'rdfxml' | 'owlxml'
export type OntologyFormat = 'auto' | 'turtle' | 'rdfxml' | 'owlxml' | 'manchester'

/** Connection parameters for a database or API you give the credentials for. */
export interface ConnectionInput {
  driver: Driver
  /** Host (not needed for SQLite or REST). */
  host?: string
  port?: number
  /** Database name, SQLite file, base URL (REST/openapi), WSDL URL (soap) or IDL path (thrift). */
  database: string
  user?: string
  password?: string
  /** e.g. bolt, neo4j+s, http, https, mysqls */
  scheme?: string
  path?: string
  headers?: Record<string, string>
  apiKeyParam?: string
}

export interface RelationInput {
  entity: string
  localKey?: string
  foreignKey: string
  alias?: string
  ownerKey?: string
  type?: RelationType
  /** Resolve against another catalog source's connection. */
  catalog?: string
  select?: string[]
  where?: Record<string, unknown>
  limit?: number
  obo?: string
  /** Fetch all parents with one repeated filter, if the REST API takes that. */
  batch?: boolean
  relations?: RelationInput[]
}

/** Link the values of one result field to the terms of an ontology. */
export interface OntologyLinkInput {
  /** The result field; `a.b` follows related rows and lists. */
  field: string
  /** A configured ontology's name (see `mozg.ontologies()`), or … */
  ontology?: string
  /** … one fetched from a URL, or … */
  url?: string
  /** … given as text. */
  content?: string
  format?: TermFormat
  /** Ways a value may name a term, in order. Default: id, label, synonym, xref. */
  match?: OntologyMatch[]
  /** Where to put the term. Default: the field name plus `Term`. */
  as?: string
  /** OBO key of the identifiers, so `0005015` reads as `MONDO:0005015`. */
  obo?: string
  /** Also return definition, synonyms, cross-references and parents. */
  details?: boolean
}

/** What to run. Give a `source` or a `connection` and `from` — or a `view`. */
export interface QueryInput {
  /** A catalog source, e.g. `"uniprot"`. */
  source?: string
  connection?: Partial<ConnectionInput>
  /** The entity (table, label, path or catalog entity). */
  from?: string
  /** A materialised view, instead of the above. */
  view?: string
  select?: string[]
  where?: Record<string, unknown>
  relations?: RelationInput[]
  /** Catalog relations by name; dots go deeper. */
  include?: string[]
  link?: OntologyLinkInput[]
  apiKeys?: Record<string, string>
  raw?: boolean
  /** Read live data even if the server caches results. */
  fresh?: boolean
  limit?: number
  offset?: number
  orderBy?: string
  orderDirection?: SortDirection
}

/** How the answer was produced, when the server says. */
export interface ResultMeta {
  /** Result cache: `hit`, `miss`, `bypass` or `shared`. */
  cache?: 'hit' | 'miss' | 'bypass' | 'shared'
  ageMs?: number
  ttlMs?: number
  /** Present when the answer came from a materialised view. */
  view?: string
  refreshedAt?: string | null
  stale?: boolean
  refreshing?: boolean
  /** Rows that matched, before limit and offset (views). */
  total?: number
  truncated?: boolean
  error?: string | null
  [key: string]: unknown
}

export interface QueryResult<Row = Record<string, unknown>> {
  count: number
  data: Row[]
  meta?: ResultMeta | null
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
}
export interface TableInfo { name: string, columns: ColumnInfo[] }
export interface DatabaseSchema { tables: TableInfo[] }

export interface CatalogParam {
  name: string
  in: string
  required: boolean
  description: string | null
  example: unknown
  obo: string[]
}
export interface CatalogRelation {
  entity: string
  foreignKey: string
  localKey: string | null
  alias: string | null
  catalog: string | null
  type: RelationType
  description: string | null
  limit: number | null
  where: unknown
  obo: string | null
}
export interface CatalogLink {
  name: string
  catalog: string
  entity: string
  localKey: string
  foreignKey: string
  obo: string
  description: string | null
}
/** In a catalog summary only `name` and `description` are present; ask for one source by name for the rest. */
export interface CatalogEntity {
  name: string
  description: string | null
  columns?: string[]
  fields?: Array<{ name: string, obo: string | null }>
  params?: CatalogParam[]
  example?: unknown
  relations?: CatalogRelation[]
  links?: CatalogLink[]
}
export interface CatalogEntry {
  name: string
  label: string
  description: string | null
  category: string | null
  homepage?: string | null
  docs?: string | null
  license?: string | null
  driver: Driver
  selfHosted: boolean
  auth: { required: boolean, param: string | null, header: string | null, signup: string | null } | null
  entities: CatalogEntity[]
}

export interface OboKey {
  key: string
  label: string
  prefix: string
  form: string
  pattern: string
  field: string | null
}

export interface OntologyInfo {
  name: string
  label: string | null
  url: string
  format: string | null
  obo: string | null
  loaded: boolean
  termCount: number | null
  error: string | null
}

export interface OntologyTerm {
  iri: string
  id: string | null
  label: string | null
  synonyms: string[]
  definition: string | null
  xrefs: string[]
  parents: string[]
  deprecated: boolean
  ontology: string
}

/** The term a linked value resolved to, written into the row. */
export interface LinkedTerm {
  iri: string
  id: string | null
  label: string | null
  matchedBy: OntologyMatch
  ontology: string
  /** Set when several current terms matched. */
  ambiguous?: number
  deprecated?: true
  /** With `details: true`. */
  definition?: string | null
  synonyms?: string[]
  xrefs?: string[]
  parents?: string[]
}

export interface ViewInfo {
  name: string
  description: string | null
  source: string | null
  from: string | null
  /** Null until the first refresh. */
  columns: string[] | null
  rowCount: number | null
  truncated: boolean | null
  refreshedAt: string | null
  ageMs: number | null
  ttlMs: number | null
  everyMs: number | null
  stale: boolean | null
  refreshing: boolean
  lastDurationMs: number | null
  error: string | null
}

export interface OntologyResult {
  tripleCount: number
  classes: Array<{ iri: string, label: string | null, subClassOf: string[] }>
  objectProperties: Array<{ iri: string, label: string | null, domain: string[], range: string[], relationType: string }>
  dataProperties: Array<{ iri: string, label: string | null, domain: string[], range: string | null }>
  generatedTypeDefs: string
}

export interface OntologyInput {
  content?: string
  url?: string
  format?: OntologyFormat
  validate?: boolean
  connection?: ConnectionInput
}

export interface MozgOptions {
  /** Where Mozg is. Default `http://localhost:4000`; a trailing `/graphql` is fine. */
  url?: string
  /** Another fetch: a proxy, a test, an older runtime. */
  fetch?: typeof fetch
  /** Sent with every request. */
  headers?: Record<string, string>
  /** Per request. Default 120000: Mozg is slow by design. */
  timeoutMs?: number
  /** Extra attempts after a network failure or a 429/502/503/504. Default 2; reads only. */
  retries?: number
}

export interface RequestOptions {
  signal?: AbortSignal
  /** Set false to never retry (always false for mutations). */
  retry?: boolean
}

export type StreamEvent =
  | { type: 'envelope', count: number, data: unknown }
  | { type: 'chunk', ref: string, value: unknown }
  | { type: 'error', error: string }

export interface StreamResult<Row = Record<string, unknown>> {
  count: number
  data: Row[]
  /** Failures after the stream began. Related records that failed are `{ error }` objects in the rows. */
  errors: string[]
}

/** What went wrong, with enough to find it in the server's logs. */
export class MozgError extends Error {
  constructor (message: string, details?: { code?: string, status?: number, errors?: object[], requestId?: string, cause?: unknown })
  /** The server's error code, e.g. `DOWNSTREAM_ERROR`: a database or API said no. */
  code?: string
  /** The HTTP status, if there was an answer. */
  status?: number
  /** Every GraphQL error in the answer. */
  errors?: Array<{ message: string, path?: Array<string | number>, extensions?: Record<string, unknown> }>
  /** The request's id: the same appears in the server's log lines for it. */
  requestId?: string
}

export class Mozg {
  constructor (options?: MozgOptions)
  readonly url: string

  graphql<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>, options?: RequestOptions): Promise<T>
  query<Row = Record<string, unknown>>(input: QueryInput, options?: RequestOptions): Promise<QueryResult<Row>>

  /** Start a query on a catalog source. */
  source<Row = Record<string, unknown>>(name: string): QueryBuilder<Row>
  /** Start a query on a database you give the connection for. */
  connect<Row = Record<string, unknown>>(connection: ConnectionInput): QueryBuilder<Row>
  /** Read a materialised view. */
  view<Row = Record<string, unknown>>(name: string): ViewBuilder<Row>

  stream (input: QueryInput, options?: RequestOptions): AsyncGenerator<StreamEvent, void, void>
  streamAll<Row = Record<string, unknown>>(input: QueryInput, options?: RequestOptions): Promise<StreamResult<Row>>

  introspect (target: { connection?: ConnectionInput, source?: string }, options?: RequestOptions): Promise<DatabaseSchema>
  catalog (filter?: { name?: string, category?: string, driver?: Driver, detail?: 'summary' | 'full' }, options?: RequestOptions): Promise<CatalogEntry[]>
  oboKeys (options?: RequestOptions): Promise<OboKey[]>
  ontologies (options?: RequestOptions): Promise<OntologyInfo[]>
  ontologyTerms (args: { search: string, ontology?: string, url?: string, content?: string, format?: TermFormat, match?: OntologyMatch[], limit?: number }, options?: RequestOptions): Promise<OntologyTerm[]>
  ingestOntology (input: OntologyInput, options?: RequestOptions): Promise<OntologyResult>

  views (options?: RequestOptions): Promise<ViewInfo[]>
  refreshView (name: string, options?: RequestOptions): Promise<ViewInfo>

  health (options?: RequestOptions): Promise<{ status: 'ok', version: string }>
  metrics (options?: RequestOptions): Promise<string>
}

/** An immutable query under construction; every method returns a new builder. Awaiting it runs it. */
export class QueryBuilder<Row = Record<string, unknown>> implements PromiseLike<QueryResult<Row>> {
  from (entity: string): QueryBuilder<Row>
  where (conditions: Record<string, unknown>): QueryBuilder<Row>
  select (...columns: Array<string | string[]>): QueryBuilder<Row>
  include (...paths: Array<string | string[]>): QueryBuilder<Row>
  relation (relation: RelationInput): QueryBuilder<Row>
  link (...specs: Array<OntologyLinkInput | OntologyLinkInput[]>): QueryBuilder<Row>
  limit (n: number): QueryBuilder<Row>
  offset (n: number): QueryBuilder<Row>
  orderBy (column: string, direction?: SortDirection): QueryBuilder<Row>
  apiKeys (keys: Record<string, string>): QueryBuilder<Row>
  raw (on?: boolean): QueryBuilder<Row>
  fresh (on?: boolean): QueryBuilder<Row>
  toInput (): QueryInput
  run (options?: RequestOptions): Promise<QueryResult<Row>>
  stream (options?: RequestOptions): AsyncGenerator<StreamEvent, void, void>
  streamAll (options?: RequestOptions): Promise<StreamResult<Row>>
  then<R1 = QueryResult<Row>, R2 = never>(onFulfilled?: ((value: QueryResult<Row>) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): Promise<R1 | R2>
  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<QueryResult<Row> | R>
  finally(onFinally?: (() => void) | null): Promise<QueryResult<Row>>
}

/** A read of a materialised view. Awaiting it runs it. */
export class ViewBuilder<Row = Record<string, unknown>> implements PromiseLike<QueryResult<Row>> {
  readonly name: string
  where (conditions: Record<string, unknown>): ViewBuilder<Row>
  select (...columns: Array<string | string[]>): ViewBuilder<Row>
  link (...specs: Array<OntologyLinkInput | OntologyLinkInput[]>): ViewBuilder<Row>
  limit (n: number): ViewBuilder<Row>
  offset (n: number): ViewBuilder<Row>
  orderBy (column: string, direction?: SortDirection): ViewBuilder<Row>
  toInput (): QueryInput
  run (options?: RequestOptions): Promise<QueryResult<Row>>
  info (options?: RequestOptions): Promise<ViewInfo>
  refresh (options?: RequestOptions): Promise<ViewInfo>
  then<R1 = QueryResult<Row>, R2 = never>(onFulfilled?: ((value: QueryResult<Row>) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): Promise<R1 | R2>
  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<QueryResult<Row> | R>
  finally(onFinally?: (() => void) | null): Promise<QueryResult<Row>>
}

/** Put a stream's events together into the answer {@link Mozg.streamAll} returns. */
export function assembleStream<Row = Record<string, unknown>>(events: StreamEvent[]): StreamResult<Row>
