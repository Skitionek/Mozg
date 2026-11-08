'use strict'

/**
 * Check a value against the small subset of JSON Schema the MCP tools use.
 *
 * Tool arguments come from a language model, so they are checked before they
 * reach a resolver, and a failure says which argument is wrong and why — the
 * message goes back to the model so that it can correct itself.
 *
 * Supported keywords: type (one name or a list), enum, properties, required,
 * additionalProperties (false, or a schema), items, minimum, maximum,
 * minItems, maxItems, minLength.  Anything else is ignored: the schemas here
 * are written for this validator, and the tests check each tool against it.
 */

const TYPE_CHECKS = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null
}

function describeType (value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (Number.isInteger(value)) return 'an integer'
  return `a ${typeof value}`
}

/**
 * @param {*} value
 * @param {object} schema
 * @param {string} [path]  where in the arguments `value` sits, for messages
 * @returns {string[]}  what is wrong, empty when nothing is
 */
function validate (value, schema, path = '') {
  const where = path || 'arguments'
  const problems = []

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => TYPE_CHECKS[type](value))) {
      problems.push(`${where} must be ${types.join(' or ')}, not ${describeType(value)}`)
      return problems
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${where} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`)
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) problems.push(`${where} must be at least ${schema.minimum}`)
    if (schema.maximum != null && value > schema.maximum) problems.push(`${where} must be at most ${schema.maximum}`)
  }

  if (typeof value === 'string' && schema.minLength != null && value.length < schema.minLength) {
    problems.push(`${where} must not be empty`)
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) problems.push(`${where} needs at least ${schema.minItems} item(s)`)
    if (schema.maxItems != null && value.length > schema.maxItems) problems.push(`${where} takes at most ${schema.maxItems} item(s)`)
    if (schema.items) value.forEach((item, i) => problems.push(...validate(item, schema.items, `${path}[${i}]`)))
  }

  if (TYPE_CHECKS.object(value)) {
    const properties = schema.properties || {}
    for (const name of schema.required || []) {
      if (!Object.hasOwn(value, name) || value[name] === undefined) {
        problems.push(`${path ? `${path}.` : ''}${name} is required`)
      }
    }
    for (const [name, item] of Object.entries(value)) {
      const itemPath = path ? `${path}.${name}` : name
      if (Object.hasOwn(properties, name)) {
        problems.push(...validate(item, properties[name], itemPath))
      } else if (schema.additionalProperties === false) {
        problems.push(`${itemPath} is not an argument of this tool (known: ${Object.keys(properties).join(', ') || 'none'})`)
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        problems.push(...validate(item, schema.additionalProperties, itemPath))
      }
    }
  }

  return problems
}

module.exports = { validate }
