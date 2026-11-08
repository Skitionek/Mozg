'use strict'

/**
 * Deployment options read from the environment.
 *
 * Kept in one place so every option has one parser, one default and one
 * description; the Helm chart's `config` values map onto these names one to
 * one (deploy/helm/mozg/templates/deployment.yaml).
 *
 * Values are read when asked for, not at require time, so a test (or an
 * embedding application) that sets an option afterwards is honoured.
 */

/**
 * A non-negative integer option.  Anything unset, empty or not a number falls
 * back to `fallback` rather than silently becoming 0 — `Number('')` is 0 and
 * `Number('abc')` is NaN, and neither is what an operator meant.
 */
function intOption (name, fallback, env = process.env) {
  const raw = env[name]
  if (raw == null || String(raw).trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

/** A boolean option: 1/true/yes/on and 0/false/no/off, any case. */
function boolOption (name, fallback, env = process.env) {
  const raw = env[name]
  if (raw == null || String(raw).trim() === '') return fallback
  const text = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return fallback
}

/** One of a fixed set of words, else the fallback. */
function enumOption (name, allowed, fallback, env = process.env) {
  const raw = env[name]
  if (raw == null) return fallback
  const text = String(raw).trim().toLowerCase()
  return allowed.includes(text) ? text : fallback
}

/** Every option with its default, for documentation and the /healthz report. */
const OPTIONS = {
  // Result cache for outbound HTTP (how fresh a repeated query is).
  MOZG_HTTP_CACHE_TTL_MS: 0,
  MOZG_HTTP_CACHE_MAX_ENTRIES: 500,
  // Clients kept for databases: one pool per distinct connection.
  MOZG_CONNECTION_CACHE_MAX: 32,
  MOZG_CONNECTION_IDLE_MS: 10 * 60_000,
  // Parsed ontologies kept in memory.
  MOZG_ONTOLOGY_CACHE_MAX: 20,
  // How long a loaded ontology's terms are kept before it is read again.
  MOZG_ONTOLOGY_TTL_MS: 24 * 60 * 60_000
}

module.exports = { intOption, boolOption, enumOption, OPTIONS }
