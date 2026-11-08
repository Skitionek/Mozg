'use strict'

/**
 * Which SOAP operations Mozg will run.
 *
 * A WSDL does not say whether an operation reads or changes data, and the
 * graphql-mesh SOAP handler exposes every one as a mutation.  Naming an
 * operation in `from` therefore *runs* it — `DeleteAccount` as readily as
 * `GetAccount` — and with caller-supplied connections that is anyone's call to
 * make.  Every other driver is read-only through Mozg; SOAP now is too, unless
 * an operator says otherwise.
 *
 * An operation runs when
 *   - its first word is an unambiguous read verb (`GetUser`, `ListOrders`,
 *     `SearchGenes` — not `Getaway`, not `NumberToWords`), or
 *   - it matches MOZG_SOAP_OPERATIONS: a comma-separated list of operation
 *     names, `*` standing for any run of characters, matched without regard to
 *     case — `NumberToWords`, `Calc*`, or `*` for everything (the behaviour
 *     before this policy).  Helm: `mozg.soapOperations`.
 *
 * Anything else is refused before it reaches the service, with a message that
 * says how to allow it.
 */

const READ_WORDS = new Set([
  'get', 'list', 'find', 'search', 'query', 'read', 'lookup', 'fetch', 'describe',
  'count', 'check', 'is', 'has', 'validate', 'retrieve', 'show', 'view', 'browse', 'resolve'
])

/** The operation's first word: `GetUser` → `Get`, `list_orders` → `list`, `Getaway` → `Getaway`. */
function firstWord (name) {
  const match = /^[A-Za-z][a-z]*/.exec(String(name))
  return match ? match[0] : ''
}

function patternToRegExp (pattern) {
  const escaped = pattern.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/** The operator's allow-list, parsed fresh so a changed environment is honoured. */
function allowedPatterns (env = process.env) {
  return String(env.MOZG_SOAP_OPERATIONS || '').split(',').map((p) => p.trim()).filter(Boolean).map(patternToRegExp)
}

/** True when Mozg will run the operation (`name` is its short name, without service and port prefixes). */
function isAllowed (name, env = process.env) {
  if (READ_WORDS.has(firstWord(name).toLowerCase())) return true
  return allowedPatterns(env).some((re) => re.test(name))
}

/** Throw unless the operation may run. */
function assertSoapOperationAllowed (name, env = process.env) {
  if (isAllowed(name, env)) return
  throw new Error(
    `SOAP operation "${name}" was not run: Mozg cannot tell a SOAP operation that reads from one that changes data, ` +
    'so it runs only those named like reads (Get…, List…, Search…) or allowed by the operator. ' +
    `To allow it, set MOZG_SOAP_OPERATIONS=${name} (Helm: mozg.soapOperations); several are comma-separated and * is a wildcard.`
  )
}

module.exports = { assertSoapOperationAllowed, isAllowed, firstWord, READ_WORDS }
