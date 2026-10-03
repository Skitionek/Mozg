'use strict'

const { readFileSync } = require('node:fs')
const { join, resolve, sep } = require('node:path')

const MIME_MAP = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  ttl: 'text/turtle',
  owl: 'application/rdf+xml',
  rdf: 'application/rdf+xml',
  txt: 'text/plain'
}

function contentTypeFor (filePath) {
  const extension = filePath.split('.').pop().toLowerCase()
  return MIME_MAP[extension] || 'application/octet-stream'
}

/**
 * Resolve `relativePath` inside `rootDir`, or return null when it would land
 * outside it.
 *
 * Deleting '..' from the string is not a containment check — `resolve` is what
 * decides where a path actually lands, so the comparison is made against the
 * resolved result.
 */
function resolveWithinRoot (rootDir, relativePath) {
  const root = resolve(rootDir)
  const target = resolve(join(root, relativePath))

  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

/**
 * Map a request path to the file that should answer it.
 *
 * @param {string} pathname  URL path, possibly percent-encoded
 * @param {{publicDir: string, examplesDir: string}} dirs
 * @returns {string|null} absolute file path, or null if the request escapes
 */
function resolveStaticFile (pathname, dirs) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // A malformed escape sequence is not a path we can serve.
    return null
  }

  const collapsed = decoded.replace(/\/+/g, '/')

  if (collapsed.startsWith('/examples/')) {
    return resolveWithinRoot(dirs.examplesDir, collapsed.slice('/examples/'.length))
  }

  return resolveWithinRoot(dirs.publicDir, collapsed === '/' ? 'index.html' : collapsed)
}

function respondNotFound (res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not found')
}

function serveFile (filePath, res) {
  let content
  try {
    content = readFileSync(filePath)
  } catch {
    respondNotFound(res)
    return
  }

  res.writeHead(200, { 'Content-Type': `${contentTypeFor(filePath)}; charset=utf-8` })
  res.end(content)
}

function serveStatic (pathname, res, dirs) {
  const filePath = resolveStaticFile(pathname, dirs)

  if (filePath === null) {
    respondNotFound(res)
    return
  }

  serveFile(filePath, res)
}

module.exports = { serveStatic, resolveStaticFile, contentTypeFor }
