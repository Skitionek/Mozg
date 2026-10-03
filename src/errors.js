'use strict'

const { GraphQLError } = require('graphql')

// Drivers sometimes echo a whole connection string back in their error text.
// Strip the password component before any message leaves the process.
const URI_CREDENTIALS = /\/\/([^:/?#@\s]+):([^@/?#\s]+)@/g

function redactCredentials (message) {
  return String(message).replace(URI_CREDENTIALS, '//$1:***@')
}

/**
 * Yoga replaces every unexpected error with the string "Unexpected error."
 * Mozg asks callers to bring their own credentials, so the driver's own
 * message — permission denied, host unreachable, no such table — is the only
 * part of the response that tells them what to fix.  Surface it, minus any
 * credentials it carries.
 */
function maskError (error, message) {
  const original = error && error.originalError ? error.originalError : error

  if (original instanceof Error && original.message) {
    return new GraphQLError(redactCredentials(original.message), {
      nodes: error && error.nodes,
      path: error && error.path,
      extensions: { code: 'DOWNSTREAM_ERROR' }
    })
  }

  return new GraphQLError(redactCredentials(message))
}

module.exports = { maskError, redactCredentials }
