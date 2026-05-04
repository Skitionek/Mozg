'use strict'

function assertSafeCypherIdentifier (value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid Cypher identifier: expected non-empty string')
  }

  // Strict identifier validation to prevent Cypher injection via `alias` and
  // other interpolated identifier-like fields.
  //
  // Cypher identifiers can technically be backtick-escaped to include almost
  // any character. However, since callers use user-provided values here (GraphQL
  // input), accepting arbitrary escaped identifiers would still permit query
  // structure manipulation (e.g. `AS foo) RETURN ...`). We therefore only allow
  // unescaped, conventional identifiers.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid Cypher identifier: ${value}`)
  }

  return value
}

function escapeCypherLabel (label) {
  if (typeof label !== 'string') {
    throw new Error('Invalid Cypher label')
  }
  return `\`${label.replace(/`/g, '``')}\``
}

module.exports = {
  assertSafeCypherIdentifier,
  escapeCypherLabel
}
