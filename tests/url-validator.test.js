'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { validateOntologyUrl, secureFetch } = require('../src/ontology/url-validator')

describe('URL validation', () => {
  test('allows https URLs', () => {
    assert.doesNotThrow(() => {
      validateOntologyUrl('https://example.com/ontology.owl')
    })
  })

  test('allows http URLs', () => {
    assert.doesNotThrow(() => {
      validateOntologyUrl('http://example.com/ontology.owl')
    })
  })

  test('rejects file:// protocol', () => {
    assert.throws(
      () => validateOntologyUrl('file:///etc/passwd'),
      /Protocol 'file:' is not allowed/
    )
  })

  test('rejects ftp:// protocol', () => {
    assert.throws(
      () => validateOntologyUrl('ftp://example.com/file'),
      /Protocol 'ftp:' is not allowed/
    )
  })

  test('rejects data: protocol', () => {
    assert.throws(
      () => validateOntologyUrl('data:text/plain,hello'),
      /Protocol 'data:' is not allowed/
    )
  })

  test('rejects localhost hostname', () => {
    assert.throws(
      () => validateOntologyUrl('http://localhost/ontology.owl'),
      /Access to localhost is not allowed/
    )
  })

  test('rejects 127.0.0.1 loopback address', () => {
    assert.throws(
      () => validateOntologyUrl('http://127.0.0.1/ontology.owl'),
      /Access to private IP addresses is not allowed/
    )
  })

  test('rejects 127.0.0.2 loopback address', () => {
    assert.throws(
      () => validateOntologyUrl('http://127.0.0.2:8080/api'),
      /Access to private IP addresses is not allowed/
    )
  })

  test('rejects 10.0.0.1 private Class A address', () => {
    assert.throws(
      () => validateOntologyUrl('http://10.0.0.1/ontology.owl'),
      /Access to private IP addresses is not allowed/
    )
  })

  test('rejects 192.168.1.1 private Class C address', () => {
    assert.throws(
      () => validateOntologyUrl('http://192.168.1.1/ontology.owl'),
      /Access to private IP addresses is not allowed/
    )
  })

  test('rejects 172.16.0.1 private Class B address', () => {
    assert.throws(
      () => validateOntologyUrl('http://172.16.0.1/ontology.owl'),
      /Access to private IP addresses is not allowed/
    )
  })

  test('rejects 169.254.1.1 link-local address', () => {
    assert.throws(
      () => validateOntologyUrl('http://169.254.1.1/ontology.owl'),
      /Access to private IP addresses is not allowed/
    )
  })

  test('rejects 100.64.0.1 carrier-grade NAT address', () => {
    assert.throws(
      () => validateOntologyUrl('http://100.64.0.1/ontology.owl'),
      /Access to private IP addresses is not allowed/
    )
  })

  test('rejects 0.0.0.0 address', () => {
    assert.throws(
      () => validateOntologyUrl('http://0.0.0.0/ontology.owl'),
      /Access to localhost is not allowed/
    )
  })

  test('rejects [::] IPv6 loopback', () => {
    assert.throws(
      () => validateOntologyUrl('http://[::]/ontology.owl'),
      /Access to localhost is not allowed/
    )
  })

  test('rejects [::1] IPv6 loopback', () => {
    assert.throws(
      () => validateOntologyUrl('http://[::1]/ontology.owl'),
      /Access to localhost is not allowed/
    )
  })

  test('allows public IP address 8.8.8.8', () => {
    assert.doesNotThrow(() => {
      validateOntologyUrl('http://8.8.8.8/ontology.owl')
    })
  })

  test('allows public domain names', () => {
    assert.doesNotThrow(() => {
      validateOntologyUrl('https://www.w3.org/2002/07/owl.owl')
    })
  })

  test('rejects malformed URLs', () => {
    assert.throws(
      () => validateOntologyUrl('not a url'),
      /Invalid URL/
    )
  })

  test('allows URLs with query parameters', () => {
    assert.doesNotThrow(() => {
      validateOntologyUrl('https://example.com/ontology.owl?version=1.0')
    })
  })

  test('allows URLs with fragments', () => {
    assert.doesNotThrow(() => {
      validateOntologyUrl('https://example.com/ontology.owl#section')
    })
  })
})

describe('secureFetch', () => {
  test('rejects localhost URLs', async () => {
    await assert.rejects(
      () => secureFetch('http://localhost/test'),
      /Access to localhost is not allowed/
    )
  })

  test('rejects private IP addresses', async () => {
    await assert.rejects(
      () => secureFetch('http://192.168.1.1/test'),
      /Access to private IP addresses is not allowed/
    )
  })

  test('rejects file:// protocol', async () => {
    await assert.rejects(
      () => secureFetch('file:///etc/passwd'),
      /Protocol 'file:' is not allowed/
    )
  })

  test('throws timeout error for very short timeout', async () => {
    // Use a real public URL but with an extremely short timeout
    await assert.rejects(
      () => secureFetch('https://www.w3.org/2002/07/owl', { timeout: 1 }),
      /Request timeout after 1ms/
    )
  })

  test('throws error for invalid URLs', async () => {
    await assert.rejects(
      () => secureFetch('not a url'),
      /Invalid URL/
    )
  })
})
