'use strict'

/**
 * The MCP endpoint, POST /mcp.
 *
 * Model Context Protocol over Streamable HTTP, in both of the forms clients
 * speak today:
 *
 *   modern  (2026-07-28)  Stateless.  Every request carries its protocol
 *           version and the client's capabilities in `_meta`, plus the
 *           MCP-Protocol-Version and Mcp-Method (and Mcp-Name) headers, which
 *           are checked against the body.  There is no handshake;
 *           `server/discover` says what the server is.
 *   legacy  (2025-03-26 to 2025-11-25)  The `initialize` handshake.  Mozg keeps
 *           no session across requests, so it mints no Mcp-Session-Id; a legacy
 *           request is recognised by carrying no per-request `_meta`.
 *
 * A request is answered by the rules of the era it comes from, so one endpoint
 * serves old and new clients at once, as the specification's compatibility
 * section describes for a dual-era server.
 *
 * Every answer is a single JSON object.  Mozg sends no progress or log
 * notifications, so a response stream would carry nothing a response does not,
 * and there is no GET stream: GET and DELETE are answered 405, which both
 * eras accept as "this server has no stream for you".
 *
 *   MOZG_MCP                   on | off                        (default on)
 *   MOZG_MCP_ALLOWED_ORIGINS   comma-separated origins a browser page may call
 *                              from, or *.  Default: none.
 *   MOZG_MCP_MAX_RESULT_BYTES  size cap of a tool result       (default 100000)
 */

const { buildTools, callTool, describe } = require('./tools')
const { boolOption, intOption } = require('../config')
const { logger, recordMcp, recordMcpTool } = require('../telemetry')
const { redactCredentials } = require('../errors')
const { version } = require('../../package.json')

const MODERN_VERSIONS = ['2026-07-28']
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS]

const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo'
}

// JSON-RPC, and the codes the specification reserves for MCP (-32020 to -32099).
const CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022
}

const SERVER_INFO = { name: 'mozg', title: 'Mozg', version }

const INSTRUCTIONS = [
  'Mozg answers questions across many databases, mostly life-science ones, with one query shape.',
  'Start with the catalog tool: find a source, then ask for it by name to see its entities and, for each field and parameter, the identifier space (OBO key) it carries.',
  'Two fields with the same key and value name the same thing, so related entities can be fetched in one query with include; the catalog lists the links.',
  'Then call query with source, from and where. introspect describes a SQL or graph database you hold credentials for; obo_keys explains identifier spaces; ontologies and ontology_terms look ontology terms up by label, synonym or identifier.',
  'Answers are capped in size: narrow with where, select and limit rather than asking for everything. Some sources are slow.'
].join(' ')

/** How long a client may reuse the tool list and the discovery answer. */
const TOOLS_TTL_MS = 300_000
const DISCOVER_TTL_MS = 3_600_000

const MAX_BODY_BYTES = 1_000_000

/** Methods named in metrics; anything else is "other", so a caller cannot make up labels. */
const KNOWN_METHODS = new Set(['initialize', 'ping', 'server/discover', 'tools/list', 'tools/call'])

/** A request that cannot be served; becomes a JSON-RPC error and an HTTP status. */
class McpFailure extends Error {
  constructor (status, code, message, data) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

// ── Settings ────────────────────────────────────────────────────────────────

function parseOrigins (text) {
  return String(text || '').split(',').map((o) => o.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean)
}

function mcpSettings (env = process.env) {
  return {
    enabled: boolOption('MOZG_MCP', true, env),
    allowedOrigins: parseOrigins(env.MOZG_MCP_ALLOWED_ORIGINS),
    maxResultBytes: Math.max(1000, intOption('MOZG_MCP_MAX_RESULT_BYTES', 100_000, env))
  }
}

// ── Wire helpers ────────────────────────────────────────────────────────────

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  error: { code, message, ...(data === undefined ? {} : { data }) }
})

function send (res, status, body, headers = {}) {
  if (res.headersSent) return res.end()
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    ...(text ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    'Cache-Control': 'no-store',
    ...headers
  })
  return res.end(text)
}

/** Decode the Base64 form a header uses for a value that is not plain ASCII (=?base64?…?=). */
function decodeHeaderValue (value) {
  const match = /^=\?base64\?(.*)\?=$/.exec(value)
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : value
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        settled = true
        return reject(new McpFailure(413, CODE.INVALID_REQUEST, `The request is larger than ${MAX_BODY_BYTES} bytes`))
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')) } })
    req.on('error', (err) => { if (!settled) { settled = true; reject(err) } })
  })
}

// ── The handler ─────────────────────────────────────────────────────────────

/**
 * @param {{ schema: import('graphql').GraphQLSchema, env?: object }} options
 */
function createMcpHandler ({ schema, env = process.env }) {
  const settings = mcpSettings(env)
  const tools = buildTools({ schema, maxBytes: settings.maxResultBytes })
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const listedTools = tools.map(describe)

  const meta = () => ({ [META.serverInfo]: SERVER_INFO })

  // ── What each method answers ──

  const modernMethods = {
    'server/discover': () => ({
      resultType: 'complete',
      supportedVersions: SUPPORTED_VERSIONS,
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
      ttlMs: DISCOVER_TTL_MS,
      cacheScope: 'public',
      _meta: meta()
    }),
    'tools/list': () => ({
      resultType: 'complete',
      tools: listedTools,
      ttlMs: TOOLS_TTL_MS,
      cacheScope: 'public',
      _meta: meta()
    }),
    'tools/call': async (params) => ({ resultType: 'complete', ...(await runTool(params)), _meta: meta() })
  }

  const legacyMethods = {
    ping: () => ({}),
    'tools/list': () => ({ tools: listedTools }),
    'tools/call': (params) => runTool(params)
  }

  async function runTool (params) {
    const name = params && params.name
    if (typeof name !== 'string') throw new McpFailure(200, CODE.INVALID_PARAMS, 'tools/call needs params.name')
    const tool = toolsByName.get(name)
    if (!tool) throw new McpFailure(200, CODE.INVALID_PARAMS, `Unknown tool: ${name}`)
    const args = params.arguments === undefined ? {} : params.arguments
    if (!isObject(args)) throw new McpFailure(200, CODE.INVALID_PARAMS, 'params.arguments must be an object')

    const started = Date.now()
    const result = await callTool(tool, args)
    const outcome = result.isError ? 'error' : 'ok'
    recordMcpTool(name, outcome)
    // The tool and how it went, never its arguments: they can hold credentials and personal data.
    logger.info('mcp tool', { tool: name, outcome, durationMs: Date.now() - started })
    return result
  }

  function initialize (params) {
    if (!isObject(params) || typeof params.protocolVersion !== 'string') {
      throw new McpFailure(200, CODE.INVALID_PARAMS, 'initialize needs params.protocolVersion')
    }
    if (!isObject(params.capabilities)) throw new McpFailure(200, CODE.INVALID_PARAMS, 'initialize needs params.capabilities')
    // Agree to the client's version when it is one Mozg knows; otherwise offer the newest legacy one.
    const negotiated = LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : LEGACY_VERSIONS[0]
    return {
      protocolVersion: negotiated,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS
    }
  }

  // ── Modern requests ──

  function checkModernHeaders (req, message, version) {
    const header = (name) => req.headers[name]
    const mismatch = (text) => new McpFailure(400, CODE.HEADER_MISMATCH, `Header mismatch: ${text}`)

    if (header('mcp-protocol-version') === undefined) throw mismatch('the MCP-Protocol-Version header is missing')
    if (header('mcp-protocol-version') !== version) {
      throw mismatch(`MCP-Protocol-Version header value '${header('mcp-protocol-version')}' does not match the body value '${version}'`)
    }
    if (header('mcp-method') === undefined) throw mismatch('the Mcp-Method header is missing')
    if (header('mcp-method') !== message.method) {
      throw mismatch(`Mcp-Method header value '${header('mcp-method')}' does not match the body value '${message.method}'`)
    }
  }

  async function serveModern (req, message, version) {
    checkModernHeaders(req, message, version)
    const clientMeta = message.params._meta
    if (!isObject(clientMeta[META.clientCapabilities])) {
      throw new McpFailure(400, CODE.INVALID_PARAMS, `The request is missing the required _meta field "${META.clientCapabilities}"`)
    }

    const method = Object.hasOwn(modernMethods, message.method) ? modernMethods[message.method] : null
    if (!method) throw new McpFailure(404, CODE.METHOD_NOT_FOUND, `Method not found: ${message.method}`)

    if (message.method === 'tools/call' && typeof message.params.name === 'string') {
      const named = req.headers['mcp-name']
      if (named === undefined) throw new McpFailure(400, CODE.HEADER_MISMATCH, 'Header mismatch: the Mcp-Name header is missing')
      if (decodeHeaderValue(named) !== message.params.name) {
        throw new McpFailure(400, CODE.HEADER_MISMATCH, `Header mismatch: Mcp-Name header value '${decodeHeaderValue(named)}' does not match the body value '${message.params.name}'`)
      }
    }

    return rpcResult(message.id, await method(message.params))
  }

  // ── Legacy requests ──

  async function serveLegacy (message) {
    if (message.method === 'initialize') return rpcResult(message.id, initialize(message.params))
    const method = Object.hasOwn(legacyMethods, message.method) ? legacyMethods[message.method] : null
    if (!method) throw new McpFailure(200, CODE.METHOD_NOT_FOUND, `Method not found: ${message.method}`)
    return rpcResult(message.id, await method(message.params))
  }

  // ── Telling the eras apart ──

  function unsupported (requested) {
    return new McpFailure(400, CODE.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested })
  }

  /** @returns {{ era: 'modern' | 'legacy', version?: string }} */
  function classify (req, message) {
    if (message.method === 'initialize') return { era: 'legacy' }

    const clientMeta = isObject(message.params) && isObject(message.params._meta) ? message.params._meta : null
    const declared = clientMeta ? clientMeta[META.protocolVersion] : undefined
    if (declared !== undefined) {
      if (typeof declared !== 'string') throw new McpFailure(400, CODE.INVALID_PARAMS, `_meta "${META.protocolVersion}" must be a string`)
      if (MODERN_VERSIONS.includes(declared)) return { era: 'modern', version: declared }
      if (LEGACY_VERSIONS.includes(declared)) return { era: 'legacy', version: declared }
      throw unsupported(declared)
    }

    // No per-request metadata.  Older clients say their version in a header, and the oldest in none.
    const header = req.headers['mcp-protocol-version']
    if (header === undefined || LEGACY_VERSIONS.includes(header)) return { era: 'legacy', version: header }
    if (MODERN_VERSIONS.includes(header)) {
      throw new McpFailure(400, CODE.INVALID_PARAMS, `The request is missing the required _meta field "${META.protocolVersion}"`)
    }
    throw unsupported(header)
  }

  // ── HTTP ──

  /** Browsers may call only from an origin the operator named; clients that are not browsers send none. */
  function originOf (req) {
    const origin = req.headers.origin
    if (origin === undefined) return { ok: true }
    const allowed = settings.allowedOrigins
    if (allowed.includes('*') || allowed.includes(String(origin).replace(/\/+$/, '').toLowerCase())) return { ok: true, origin }
    return { ok: false }
  }

  async function dispatch (req, res) {
    const origin = originOf(req)
    if (!origin.ok) {
      return send(res, 403, rpcError(undefined, CODE.INVALID_REQUEST, 'This origin is not allowed to call the MCP endpoint (see MOZG_MCP_ALLOWED_ORIGINS)'))
    }
    if (origin.origin) {
      res.setHeader('Access-Control-Allow-Origin', settings.allowedOrigins.includes('*') ? '*' : origin.origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
    }

    if (req.method === 'OPTIONS') {
      return send(res, 204, undefined, {
        Allow: 'POST, OPTIONS',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
        'Access-Control-Max-Age': '600'
      })
    }
    if (req.method !== 'POST') {
      // No GET stream and no sessions to delete: see the file comment.
      return send(res, 405, rpcError(undefined, CODE.INVALID_REQUEST, 'The MCP endpoint takes POST only'), { Allow: 'POST, OPTIONS' })
    }
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return send(res, 415, rpcError(undefined, CODE.INVALID_REQUEST, 'Send the request as application/json'))
    }

    const text = await readBody(req)
    let message
    try {
      message = JSON.parse(text)
    } catch {
      throw new McpFailure(400, CODE.PARSE_ERROR, 'The request body is not valid JSON')
    }
    if (Array.isArray(message)) {
      throw new McpFailure(400, CODE.INVALID_REQUEST, 'Batches are not supported: send one JSON-RPC message per request')
    }
    if (!isObject(message) || message.jsonrpc !== '2.0') {
      throw new McpFailure(400, CODE.INVALID_REQUEST, 'The body is not a JSON-RPC 2.0 message')
    }
    if (typeof message.method !== 'string') {
      throw new McpFailure(400, CODE.INVALID_REQUEST, 'Clients send requests and notifications only, not responses')
    }

    // A notification needs no answer beyond "received".
    if (!Object.hasOwn(message, 'id')) {
      recordMcp('-', 'notification', 'ok')
      return send(res, 202)
    }
    if (typeof message.id !== 'string' && !Number.isInteger(message.id)) {
      throw new McpFailure(400, CODE.INVALID_REQUEST, 'A request id must be a string or an integer')
    }
    if (message.params !== undefined && !isObject(message.params)) {
      throw new McpFailure(400, CODE.INVALID_PARAMS, 'params must be an object')
    }

    const label = KNOWN_METHODS.has(message.method) ? message.method : 'other'
    let era = 'unknown'
    try {
      const kind = classify(req, message)
      era = kind.era
      if (kind.era === 'modern') {
        // The metadata is required, so every modern request has params with _meta; classify saw to that.
        const body = await serveModern(req, message, kind.version)
        recordMcp(era, label, body.result.isError ? 'tool_error' : 'ok')
        return send(res, 200, body)
      }
      const body = await serveLegacy(message)
      recordMcp(era, label, body.result.isError ? 'tool_error' : 'ok')
      return send(res, 200, body)
    } catch (err) {
      recordMcp(era, label, 'error')
      if (err instanceof McpFailure) {
        // An error about this request is the answer to it, so it carries the request's id.
        return send(res, err.status, rpcError(message.id, err.code, err.message, err.data))
      }
      logger.error('mcp request failed', { method: message.method, error: redactCredentials(err.message) })
      return send(res, 500, rpcError(message.id, CODE.INTERNAL_ERROR, 'Internal error'))
    }
  }

  /** Serve one request on the MCP endpoint. */
  async function handle (req, res) {
    try {
      await dispatch(req, res)
    } catch (err) {
      if (err instanceof McpFailure) {
        recordMcp('unknown', 'other', 'error')
        return send(res, err.status, rpcError(undefined, err.code, err.message, err.data), err.status === 413 ? { Connection: 'close' } : {})
      }
      logger.error('mcp request failed', { error: redactCredentials(err.message) })
      return send(res, 500, rpcError(undefined, CODE.INTERNAL_ERROR, 'Internal error'))
    }
  }

  return { enabled: settings.enabled, settings, handle, tools: listedTools }
}

module.exports = { createMcpHandler, mcpSettings, SUPPORTED_VERSIONS, MODERN_VERSIONS, LEGACY_VERSIONS, SERVER_INFO, INSTRUCTIONS }
