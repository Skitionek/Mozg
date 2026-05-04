'use strict';

const { URL } = require('node:url');

/**
 * Default timeout for ontology fetch requests (10 seconds)
 */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Maximum allowed response size (10 MB)
 */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/**
 * Allowed protocols for ontology URLs
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Private IP ranges (IPv4) that should be blocked to prevent SSRF
 */
const PRIVATE_IP_RANGES = [
  // Loopback
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] },
  // Private Class A
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },
  // Private Class B
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },
  // Private Class C
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] },
  // Link-local
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] },
  // Carrier-grade NAT
  { start: [100, 64, 0, 0], end: [100, 127, 255, 255] },
];

/**
 * Convert IP address string to array of numbers
 */
function parseIPv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return nums;
}

/**
 * Check if an IP address is within a given range
 */
function isInRange(ip, range) {
  for (let i = 0; i < 4; i++) {
    if (ip[i] < range.start[i]) return false;
    if (ip[i] > range.end[i]) return false;
    if (ip[i] > range.start[i] && ip[i] < range.end[i]) return true;
  }
  return true;
}

/**
 * Check if a hostname is a private IP address
 */
function isPrivateIP(hostname) {
  const ip = parseIPv4(hostname);
  if (!ip) return false;
  return PRIVATE_IP_RANGES.some((range) => isInRange(ip, range));
}

/**
 * Validate a URL for ontology fetching to prevent SSRF attacks
 *
 * @param {string} urlString - The URL to validate
 * @throws {Error} If the URL is invalid or not allowed
 */
function validateOntologyUrl(urlString) {
  let parsed;

  try {
    parsed = new URL(urlString);
  } catch (err) {
    throw new Error(`Invalid URL: ${err.message}`, { cause: err });
  }

  // Check protocol
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(
      `Protocol '${parsed.protocol}' is not allowed. Only ${ALLOWED_PROTOCOLS.join(', ')} are permitted.`
    );
  }

  // Check for private IPs
  if (isPrivateIP(parsed.hostname)) {
    throw new Error(`Access to private IP addresses is not allowed: ${parsed.hostname}`);
  }

  // Check for localhost variations
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '[::]' ||
    hostname === '[::1]'
  ) {
    throw new Error(`Access to localhost is not allowed: ${parsed.hostname}`);
  }

  return parsed;
}

/**
 * Fetch a URL with timeout and size limits to prevent SSRF abuse
 *
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @param {number} options.timeout - Request timeout in milliseconds (default: 10000)
 * @param {number} options.maxSize - Maximum response size in bytes (default: 10MB)
 * @returns {Promise<{ text: string, contentType: string }>}
 */
async function secureFetch(url, options = {}) {
  // Validate the URL first
  validateOntologyUrl(url);

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxSize = options.maxSize ?? MAX_RESPONSE_SIZE;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await globalThis.fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      // Limit redirects to prevent redirect loops
      ...(options.redirect !== undefined ? { redirect: options.redirect } : {}),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ontology from ${url}: ${response.status} ${response.statusText}`);
    }

    // Check content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
      throw new Error(`Response size (${contentLength} bytes) exceeds maximum allowed size (${maxSize} bytes)`);
    }

    // Read response in chunks to enforce size limit
    const reader = response.body.getReader();
    const chunks = [];
    let totalSize = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > maxSize) {
          throw new Error(`Response size exceeds maximum allowed size (${maxSize} bytes)`);
        }

        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Combine chunks into text
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(Buffer.concat(chunks));

    return {
      text,
      contentType: response.headers.get('content-type'),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  validateOntologyUrl,
  secureFetch,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_SIZE,
};
