'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { resolveStaticFile, contentTypeFor } = require('../src/static')

const DIRS = {
  publicDir: path.join(__dirname, '..', 'public'),
  examplesDir: path.join(__dirname, '..', 'examples')
}

describe('resolveStaticFile: normal requests', () => {
  test('serves the index page for the site root', () => {
    // Given a request for /
    const pathname = '/'

    // When it is resolved
    const resolved = resolveStaticFile(pathname, DIRS)

    // Then it maps to the public index page
    assert.equal(resolved, path.join(DIRS.publicDir, 'index.html'))
  })

  test('serves a file from the examples directory', () => {
    // Given a request under /examples/
    const pathname = '/examples/queries.json'

    // When it is resolved
    const resolved = resolveStaticFile(pathname, DIRS)

    // Then it maps into the examples directory
    assert.equal(resolved, path.join(DIRS.examplesDir, 'queries.json'))
  })

  test('collapses duplicate slashes', () => {
    // Given a request with repeated separators
    const pathname = '//examples//queries.json'

    // When it is resolved
    const resolved = resolveStaticFile(pathname, DIRS)

    // Then it still maps to the intended file
    assert.equal(resolved, path.join(DIRS.examplesDir, 'queries.json'))
  })
})

describe('resolveStaticFile: requests that try to escape the root', () => {
  const escapes = [
    '/../package.json',
    '/../../etc/passwd',
    '/examples/../package.json',
    '/examples/../../package.json',
    '/%2e%2e/package.json',
    '/examples/%2e%2e/%2e%2e/package.json',
    '/....//package.json',
    '/examples/subdir/../../../package.json'
  ]

  for (const pathname of escapes) {
    test(`refuses ${pathname}`, () => {
      // Given a request that points outside the served directories
      // When it is resolved
      const resolved = resolveStaticFile(pathname, DIRS)

      // Then nothing is served, or it stays inside a served root
      if (resolved !== null) {
        const insidePublic = resolved.startsWith(path.resolve(DIRS.publicDir) + path.sep)
        const insideExamples = resolved.startsWith(path.resolve(DIRS.examplesDir) + path.sep)
        assert.ok(insidePublic || insideExamples, `escaped to ${resolved}`)
      }
    })
  }

  test('refuses a malformed percent-escape instead of throwing', () => {
    // Given a path with an invalid escape sequence
    const pathname = '/%E0%A4%A'

    // When it is resolved
    const resolved = resolveStaticFile(pathname, DIRS)

    // Then it is simply refused
    assert.equal(resolved, null)
  })
})

describe('contentTypeFor', () => {
  test('maps known extensions', () => {
    // Given file names with extensions the server knows
    // When their content type is looked up
    // Then the mapped type is returned
    assert.equal(contentTypeFor('a/b/index.html'), 'text/html')
    assert.equal(contentTypeFor('queries.json'), 'application/json')
    assert.equal(contentTypeFor('blog.ttl'), 'text/turtle')
  })

  test('falls back to a binary type for unknown extensions', () => {
    // Given a file with an unmapped extension
    // When its content type is looked up
    // Then a generic binary type is returned
    assert.equal(contentTypeFor('archive.tar.zst'), 'application/octet-stream')
  })
})
