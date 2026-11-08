'use strict'

/**
 * Structured logging.
 *
 * One JSON object per line on stdout (stderr for warnings and errors), the
 * shape every log pipeline ingests without a parser.  In a terminal it reads as
 * plain text instead.  Every line written while a request is being served
 * carries that request's id, so one request can be followed across the access
 * log, the query log and any outbound-call warnings.
 *
 *   MOZG_LOG_LEVEL   error | warn | info | debug     (default info)
 *   MOZG_LOG_FORMAT  json | text                     (default json; text on a TTY)
 *   MOZG_SLOW_QUERY_MS  log queries slower than this at warn (default 10000; 0 = off)
 *
 * Credentials must never reach a log line.  Messages pass through the same
 * redaction as error responses, and callers log the *names* of `where` keys,
 * never their values.
 */

const { AsyncLocalStorage } = require('node:async_hooks')
const crypto = require('node:crypto')
const { enumOption } = require('./config')
const { redactCredentials } = require('./errors')

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }
const context = new AsyncLocalStorage()

/** Accept a caller's request id only if it is short and plain: it goes into every log line. */
function sanitizeRequestId (value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value) ? value : null
}

function newRequestId () {
  return crypto.randomBytes(8).toString('hex')
}

/** The request this code is running for, if any. */
function currentContext () {
  return context.getStore()
}

/** Run `fn` with `fields` (e.g. { requestId }) attached to every log line it causes. */
function withContext (fields, fn) {
  return context.run({ ...(context.getStore() || {}), ...fields }, fn)
}

function createLogger ({ env = process.env, stdout = process.stdout, stderr = process.stderr, now = () => new Date() } = {}) {
  const level = enumOption('MOZG_LOG_LEVEL', Object.keys(LEVELS), 'info', env)
  const format = enumOption('MOZG_LOG_FORMAT', ['json', 'text'], stdout.isTTY ? 'text' : 'json', env)

  function write (name, message, fields) {
    if (LEVELS[name] > LEVELS[level]) return
    const record = { ...(context.getStore() || {}), ...(fields || {}) }
    // Messages may carry a connection string a driver echoed back.
    const text = redactCredentials(message)
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') record[key] = redactCredentials(value)
    }
    const stream = LEVELS[name] <= LEVELS.warn ? stderr : stdout
    if (format === 'json') {
      stream.write(JSON.stringify({ ts: now().toISOString(), level: name, msg: text, ...record }) + '\n')
    } else {
      const rest = Object.entries(record).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')
      stream.write(`${now().toISOString()} ${name.toUpperCase().padEnd(5)} ${text}${rest ? ' ' + rest : ''}\n`)
    }
  }

  return {
    level,
    format,
    error: (message, fields) => write('error', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    info: (message, fields) => write('info', message, fields),
    debug: (message, fields) => write('debug', message, fields),
    /** True when a line at this level would be written; lets a caller skip building expensive fields. */
    enabled: (name) => LEVELS[name] <= LEVELS[level]
  }
}

module.exports = { createLogger, withContext, currentContext, sanitizeRequestId, newRequestId, LEVELS }
