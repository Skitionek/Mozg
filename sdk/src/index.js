/**
 * A client for Mozg.
 *
 *   import { Mozg } from '@skitionek/mozg-sdk'
 *   const mozg = new Mozg({ url: 'http://localhost:4000' })
 *
 *   const { data } = await mozg.source('uniprot').from('protein')
 *     .where({ uniprotAccession: 'P04637' })
 *     .include('structures', 'pathways')
 *     .limit(10)
 *
 * No dependencies; it needs only a `fetch`, which Node 18+ and every browser
 * have.  The query is always sent as a GraphQL *variable*, never spliced into
 * query text, so nothing a caller passes can change what is asked.
 */

const DEFAULT_URL = 'http://localhost:4000'
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

const QUERY = 'query ($input: QueryInput!) { query(input: $input) { count data meta } }'
const INTROSPECT = 'query ($connection: ConnectionInput, $source: String) { introspect(connection: $connection, source: $source) { tables { name columns { name type nullable defaultValue isPrimaryKey } } } }'
const OBO_KEYS = '{ oboKeys { key label prefix form pattern field } }'
const ONTOLOGIES = '{ ontologies { name label url format obo loaded termCount error } }'
const ONTOLOGY_TERMS = 'query ($search: String!, $ontology: String, $url: String, $content: String, $format: TermFormat, $match: [OntologyMatch!], $limit: Int) { ontologyTerms(search: $search, ontology: $ontology, url: $url, content: $content, format: $format, match: $match, limit: $limit) { iri id label synonyms definition xrefs parents deprecated ontology } }'
const INGEST = 'mutation ($input: OntologyInput!) { ingestOntology(input: $input) { tripleCount classes { iri label subClassOf } objectProperties { iri label domain range relationType } dataProperties { iri label domain range } generatedTypeDefs } }'

const CATALOG_SUMMARY = 'name label description category driver selfHosted auth { required param header signup } entities { name description }'
const CATALOG_FULL = 'name label description category homepage docs license driver selfHosted auth { required param header signup } entities { name description columns fields { name obo } params { name in required description example obo } example relations { entity foreignKey localKey alias catalog type description limit where obo } links { name catalog entity localKey foreignKey obo description } }'

/** What went wrong, with enough to find it in the server's logs. */
export class MozgError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, errors?: object[], requestId?: string, cause?: unknown }} [details]
   */
  constructor (message, { code, status, errors, requestId, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'MozgError'
    /** The server's error code, e.g. DOWNSTREAM_ERROR (a database or API said no). */
    this.code = code
    /** The HTTP status, if there was an answer. */
    this.status = status
    /** Every GraphQL error in the answer. */
    this.errors = errors
    /** The request's id: the same appears in the server's log lines for it. */
    this.requestId = requestId
  }
}

/** `text` without the slashes it ends with.  A loop: /\/+$/ is quadratic on a long run of slashes. */
function withoutTrailingSlashes (text) {
  let end = text.length
  while (end > 0 && text[end - 1] === '/') end--
  return text.slice(0, end)
}

/** The server's root, from a URL that may end in /graphql (as MOZG_URL often does). */
function rootOf (url) {
  return withoutTrailingSlashes(String(url)).replace(/\/graphql$/, '')
}

function newRequestId () {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Drop keys whose value is undefined, so `{ limit: undefined }` is not sent. */
function defined (object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
}

export class Mozg {
  /**
   * @param {object} [options]
   * @param {string} [options.url]        where Mozg is (default http://localhost:4000); a trailing /graphql is fine
   * @param {typeof fetch} [options.fetch]  another fetch, for a proxy, a test or an older runtime
   * @param {Record<string, string>} [options.headers]  sent with every request
   * @param {number} [options.timeoutMs]  per request (default 120000: Mozg is slow by design)
   * @param {number} [options.retries]    extra attempts after a network failure or a 429/502/503/504 (default 2; reads only)
   */
  constructor ({ url = DEFAULT_URL, fetch = globalThis.fetch, headers = {}, timeoutMs = 120_000, retries = 2 } = {}) {
    if (typeof fetch !== 'function') throw new TypeError('Mozg needs a fetch function: pass one as the fetch option on this runtime')
    this.url = rootOf(url)
    this.headers = headers
    this.timeoutMs = timeoutMs
    this.retries = retries
    this.fetch = fetch.bind(globalThis)
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  /**
   * One HTTP request, with a timeout and, for reads, retries.  Returns the
   * response and the id the request carried.
   */
  async #send (path, init, { signal, retry = true } = {}) {
    const requestId = newRequestId()
    const attempts = retry ? this.retries : 0
    let last
    for (let attempt = 0; attempt <= attempts; attempt++) {
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
      const onAbort = () => controller.abort()
      if (signal) {
        if (signal.aborted) controller.abort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
      try {
        const response = await this.fetch(this.url + path, {
          ...init,
          headers: { 'X-Request-Id': requestId, ...this.headers, ...init.headers },
          signal: controller.signal
        })
        if (RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
          const wait = Number(response.headers.get('retry-after'))
          last = new MozgError(`Mozg answered ${response.status}`, { status: response.status, requestId })
          await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait * 1000, 15_000) : 250 * 2 ** attempt)
          continue
        }
        return { response, requestId: response.headers.get('x-request-id') || requestId }
      } catch (err) {
        if (signal && signal.aborted) throw new MozgError('The request was cancelled', { requestId, cause: err })
        last = new MozgError(
          timedOut ? `Mozg did not answer within ${this.timeoutMs} ms` : `Cannot reach Mozg at ${this.url}: ${err.message}`,
          { requestId, cause: err }
        )
        if (timedOut || attempt >= attempts) throw last
        await sleep(250 * 2 ** attempt)
      } finally {
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
      }
    }
    throw last
  }

  /**
   * Run a GraphQL document and return its `data`.
   * @param {string} query
   * @param {Record<string, unknown>} [variables]
   * @param {{ signal?: AbortSignal, retry?: boolean }} [options]  retry: false for a mutation
   */
  async graphql (query, variables = {}, options = {}) {
    const { response, requestId } = await this.#send('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables })
    }, options)

    let payload
    try {
      payload = await response.json()
    } catch (err) {
      throw new MozgError(`Mozg answered ${response.status} with something that is not JSON`, { status: response.status, requestId, cause: err })
    }
    if (payload.errors && payload.errors.length) {
      const [first] = payload.errors
      throw new MozgError(first.message, {
        code: first.extensions && first.extensions.code,
        status: response.status,
        errors: payload.errors,
        requestId
      })
    }
    if (!response.ok) throw new MozgError(`Mozg answered ${response.status}`, { status: response.status, requestId })
    return payload.data
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Run a query.  `input` is a QueryInput: a `source` (or `connection`) and
   * `from`, with `where`, `select`, `include`, `relations`, `link`, `limit`,
   * `offset`, `orderBy`, `fresh` ….
   * @returns {Promise<{ count: number, data: object[], meta?: object }>}
   */
  async query (input, options) {
    const data = await this.graphql(QUERY, { input: defined(input) }, options)
    return data.query
  }

  /** Start a query on a catalog source: `mozg.source('uniprot').from('protein').where({…})`. */
  source (name) {
    return new QueryBuilder(this, { source: name })
  }

  /** Start a query on a database you give the connection for. */
  connect (connection) {
    return new QueryBuilder(this, { connection })
  }

  /**
   * Run a query and read the answer as it arrives (see {@link Mozg#streamAll}).
   * Yields `{ type: 'envelope', count, data }` first, then `{ type: 'chunk',
   * ref, value }` as each related record resolves, and `{ type: 'error',
   * error }` if the query fails after it began.
   *
   * From a browser, this works only from a page served by Mozg itself: /stream,
   * unlike /graphql, sends no CORS headers.
   * @returns {AsyncGenerator<object>}
   */
  async * stream (input, { signal } = {}) {
    const { response, requestId } = await this.#send('/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
      body: JSON.stringify(defined(input))
    }, { signal, retry: false })

    if (!response.ok) {
      let message = `Mozg answered ${response.status}`
      try { message = (await response.json()).error || message } catch { /* keep the status */ }
      throw new MozgError(message, { status: response.status, requestId })
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const parse = (line) => {
      const text = line.trim()
      if (!text) return null
      const chunk = /^\/\* (\$\d+) \*\/ (.*)$/s.exec(text)
      if (chunk) return { type: 'chunk', ref: chunk[1], value: JSON.parse(chunk[2]) }
      const body = JSON.parse(text)
      if (body && typeof body === 'object' && 'error' in body && !('count' in body)) return { type: 'error', error: body.error }
      return { type: 'envelope', count: body.count, data: body.data }
    }

    // A reader, not `for await`: web streams are not async-iterable everywhere.
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const event = parse(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          if (event) yield event
        }
      }
    } finally {
      reader.releaseLock()
    }
    buffer += decoder.decode()
    const last = parse(buffer)
    if (last) yield last
  }

  /**
   * Run a query through /stream and wait for the whole, assembled answer:
   * `{ count, data, errors }`, with every related record in place.
   * `errors` lists failures after the stream began; related records that
   * failed are `{ error }` objects in the rows, as in a /graphql answer.
   */
  async streamAll (input, options) {
    const events = []
    for await (const event of this.stream(input, options)) events.push(event)
    return assembleStream(events)
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  /** The tables and columns of a database, or of a catalog source (`{ source }`). */
  async introspect ({ connection, source } = {}, options) {
    return (await this.graphql(INTROSPECT, defined({ connection, source }), options)).introspect
  }

  /**
   * The catalog of sources.  With a `name`, one source in full (its entities,
   * parameters, relations and links); without, a summary of each.
   */
  async catalog ({ name, category, driver, detail } = {}, options) {
    const full = detail ? detail === 'full' : Boolean(name)
    const query = `query ($name: String, $category: String, $driver: Driver) { catalog(name: $name, category: $category, driver: $driver) { ${full ? CATALOG_FULL : CATALOG_SUMMARY} } }`
    return (await this.graphql(query, defined({ name, category, driver }), options)).catalog
  }

  /** The identifier spaces (OBO keys) Mozg joins on. */
  async oboKeys (options) {
    return (await this.graphql(OBO_KEYS, {}, options)).oboKeys
  }

  /** The ontologies the operator configured for linking, and whether each has loaded. */
  async ontologies (options) {
    return (await this.graphql(ONTOLOGIES, {}, options)).ontologies
  }

  /** Search an ontology's terms: a configured `ontology`, or a `url` / `content` of your own. */
  async ontologyTerms ({ search, ontology, url, content, format, match, limit }, options) {
    return (await this.graphql(ONTOLOGY_TERMS, defined({ search, ontology, url, content, format, match, limit }), options)).ontologyTerms
  }

  /** Parse an OWL ontology into the GraphQL schema it describes. */
  async ingestOntology (input, options) {
    return (await this.graphql(INGEST, { input: defined(input) }, { ...options, retry: false })).ingestOntology
  }

  // ── The server itself ─────────────────────────────────────────────────────

  /** `{ status: 'ok', version }` — touches no upstream. */
  async health (options) {
    const { response, requestId } = await this.#send('/healthz', { method: 'GET' }, options)
    if (!response.ok) throw new MozgError(`Mozg answered ${response.status}`, { status: response.status, requestId })
    return response.json()
  }

  /** The Prometheus metrics, as text.  Absent if the operator moved them to another port. */
  async metrics (options) {
    const { response, requestId } = await this.#send('/metrics', { method: 'GET' }, options)
    if (!response.ok) throw new MozgError(`Mozg answered ${response.status}`, { status: response.status, requestId })
    return response.text()
  }
}

// ── Builders ─────────────────────────────────────────────────────────────────

/**
 * An immutable query under construction.  Every method returns a new builder.
 * It is also awaitable: `await mozg.source('x').from('y')` runs it.
 */
export class QueryBuilder {
  constructor (client, input = {}) {
    this.client = client
    this.input = input
  }

  #with (patch) {
    return new QueryBuilder(this.client, { ...this.input, ...patch })
  }

  from (entity) { return this.#with({ from: entity }) }
  /** Filter on the entity's parameters or columns; calls merge. */
  where (conditions) { return this.#with({ where: { ...this.input.where, ...conditions } }) }
  select (...columns) { return this.#with({ select: columns.flat() }) }
  /** Catalog relations to follow, by name; dots go deeper: `'mechanisms.target'`. */
  include (...paths) { return this.#with({ include: [...(this.input.include || []), ...paths.flat()] }) }
  /** An explicit relation (RelationInput); calls add up. */
  relation (relation) { return this.#with({ relations: [...(this.input.relations || []), relation] }) }
  /** Link a result field's values to ontology terms (OntologyLinkInput); calls add up. */
  link (...specs) { return this.#with({ link: [...(this.input.link || []), ...specs.flat()] }) }
  limit (n) { return this.#with({ limit: n }) }
  offset (n) { return this.#with({ offset: n }) }
  orderBy (column, direction) { return this.#with({ orderBy: column, orderDirection: direction }) }
  /** API keys by source name, for the sources that take one. */
  apiKeys (keys) { return this.#with({ apiKeys: { ...this.input.apiKeys, ...keys } }) }
  /** Rows exactly as the source sent them. */
  raw (on = true) { return this.#with({ raw: on }) }
  /** Read live data even if the server caches results. */
  fresh (on = true) { return this.#with({ fresh: on }) }

  /** The QueryInput this builds. */
  toInput () { return defined(this.input) }

  run (options) { return this.client.query(this.toInput(), options) }
  stream (options) { return this.client.stream(this.toInput(), options) }
  streamAll (options) { return this.client.streamAll(this.toInput(), options) }

  then (onFulfilled, onRejected) { return this.run().then(onFulfilled, onRejected) }
  catch (onRejected) { return this.run().catch(onRejected) }
  finally (onFinally) { return this.run().finally(onFinally) }
}

// ── Streams ──────────────────────────────────────────────────────────────────

const PLACEHOLDER = /^\$\d+$/

/**
 * Put a stream's events together: the envelope's `data` is a placeholder
 * (`"$1"`) or rows, and each chunk resolves one, possibly into more
 * placeholders.
 *
 * The protocol marks a placeholder as any string of the form `"$N"`, so a cell
 * that is itself exactly `"$5"` cannot be told from one.  A string is replaced
 * only if the stream sent a chunk for it; anything else is data and is kept.
 * (A cell equal to a ref that was sent would still be replaced: where rows can
 * hold such values, use `query()`, which has no such ambiguity.)
 * @param {object[]} events  from {@link Mozg#stream}
 * @returns {{ count: number, data: unknown, errors: string[] }}
 */
export function assembleStream (events) {
  const chunks = new Map()
  const errors = []
  let envelope = null
  for (const event of events) {
    if (event.type === 'envelope') envelope = event
    else if (event.type === 'chunk') chunks.set(event.ref, event.value)
    else if (event.type === 'error') errors.push(event.error)
  }
  if (!envelope) throw new MozgError(errors[0] || 'The stream ended before Mozg said anything')

  const seen = new Set()
  const resolve = (value) => {
    if (typeof value === 'string' && PLACEHOLDER.test(value) && chunks.has(value)) {
      if (seen.has(value)) return null
      seen.add(value)
      const resolved = resolve(chunks.get(value))
      seen.delete(value)
      return resolved
    }
    if (Array.isArray(value)) return value.map(resolve)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]))
    return value
  }
  return { count: envelope.count, data: resolve(envelope.data), errors }
}
