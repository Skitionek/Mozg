'use strict'

/**
 * A small Prometheus metrics registry.
 *
 * Counters, gauges and histograms with labels, rendered in the Prometheus text
 * exposition format (version 0.0.4).  Written here rather than pulled in as a
 * dependency because Mozg needs only these three instruments, and every
 * dependency is one more thing to audit and keep patched.
 *
 * Two rules keep a registry from becoming a leak of its own:
 *
 *   - label *names* are fixed when an instrument is declared;
 *   - label *values* that come from callers (a host name, a source name) go
 *     through `bounded()`, which admits a fixed number of distinct values and
 *     folds the rest into "other".  An unbounded label set is a series per
 *     caller-chosen string, which is how a metrics endpoint exhausts memory.
 */

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120]

/** Escape a label value per the text format: backslash, double quote, newline. */
function escapeLabel (value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function escapeHelp (text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

function formatNumber (n) {
  if (n === Infinity) return '+Inf'
  if (n === -Infinity) return '-Inf'
  if (Number.isNaN(n)) return 'NaN'
  return String(n)
}

/** `{a="1",b="2"}` for a label set, in declaration order; empty for none. */
function labelString (names, values, extra = '') {
  const parts = names.map((name, i) => `${name}="${escapeLabel(values[i])}"`)
  if (extra) parts.push(extra)
  return parts.length ? `{${parts.join(',')}}` : ''
}

class Instrument {
  constructor (name, help, labelNames = []) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) throw new Error(`invalid metric name: ${name}`)
    for (const label of labelNames) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label) || label.startsWith('__')) throw new Error(`invalid label name: ${label}`)
    }
    this.name = name
    this.help = help
    this.labelNames = labelNames
    this.series = new Map()
  }

  /** Label values in declaration order, from either an array or an object. */
  keyOf (labels) {
    if (Array.isArray(labels)) {
      if (labels.length !== this.labelNames.length) throw new Error(`${this.name} takes ${this.labelNames.length} label(s)`)
      return labels.map(String)
    }
    return this.labelNames.map((name) => String((labels || {})[name] ?? ''))
  }

  header (type) {
    return `# HELP ${this.name} ${escapeHelp(this.help)}\n# TYPE ${this.name} ${type}\n`
  }
}

class Counter extends Instrument {
  inc (labels, amount = 1) {
    if (amount < 0) throw new Error('a counter only goes up')
    const values = this.keyOf(labels)
    const id = values.join('\u0000')
    const entry = this.series.get(id)
    if (entry) entry.value += amount
    else this.series.set(id, { values, value: amount })
  }

  render () {
    let out = this.header('counter')
    for (const { values, value } of this.series.values()) {
      out += `${this.name}${labelString(this.labelNames, values)} ${formatNumber(value)}\n`
    }
    return out
  }
}

class Gauge extends Instrument {
  /**
   * @param {string} name
   * @param {string} help
   * @param {string[]} [labelNames]
   * @param {() => Array<[object|string[], number]>|number} [collect]  read at scrape time
   */
  constructor (name, help, labelNames, collect) {
    super(name, help, labelNames)
    this.collect = collect
  }

  set (labels, value) {
    const values = this.keyOf(labels)
    this.series.set(values.join('\u0000'), { values, value })
  }

  inc (labels, amount = 1) {
    const values = this.keyOf(labels)
    const id = values.join('\u0000')
    const entry = this.series.get(id)
    if (entry) entry.value += amount
    else this.series.set(id, { values, value: amount })
  }

  dec (labels, amount = 1) {
    this.inc(labels, -amount)
  }

  render () {
    let out = this.header('gauge')
    let samples = [...this.series.values()].map(({ values, value }) => [values, value])
    if (this.collect) {
      let collected
      try {
        collected = this.collect()
      } catch (err) {
        collected = [] // a failing collector must not take the whole scrape down
        if (this.onError) this.onError(this.name, err)
      }
      samples = typeof collected === 'number' ? [[[], collected]] : (collected || []).map(([labels, value]) => [this.keyOf(labels), value])
    }
    for (const [values, value] of samples) {
      out += `${this.name}${labelString(this.labelNames, values)} ${formatNumber(value)}\n`
    }
    return out
  }
}

/** A counter whose value is read from elsewhere at scrape time (a cache's own tally). */
class CollectedCounter extends Instrument {
  constructor (name, help, labelNames, collect) {
    super(name, help, labelNames)
    this.collect = collect
  }

  render () {
    let out = this.header('counter')
    let collected
    try {
      collected = this.collect()
    } catch (err) {
      collected = []
      if (this.onError) this.onError(this.name, err)
    }
    const samples = typeof collected === 'number' ? [[[], collected]] : (collected || [])
    for (const [labels, value] of samples) {
      out += `${this.name}${labelString(this.labelNames, this.keyOf(labels))} ${formatNumber(value)}\n`
    }
    return out
  }
}

class Histogram extends Instrument {
  constructor (name, help, labelNames, buckets = DEFAULT_BUCKETS) {
    super(name, help, labelNames)
    if (labelNames.includes('le')) throw new Error('"le" is reserved for histogram buckets')
    this.buckets = [...buckets].sort((a, b) => a - b)
  }

  observe (labels, value) {
    const values = this.keyOf(labels)
    const id = values.join('\u0000')
    let entry = this.series.get(id)
    if (!entry) {
      entry = { values, counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 }
      this.series.set(id, entry)
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) entry.counts[i]++
    }
    entry.sum += value
    entry.count++
  }

  /** Start a timer; the returned function observes the elapsed seconds and returns them. */
  startTimer (labels) {
    const start = process.hrtime.bigint()
    return (finalLabels = labels) => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9
      this.observe(finalLabels, seconds)
      return seconds
    }
  }

  render () {
    let out = this.header('histogram')
    for (const { values, counts, sum, count } of this.series.values()) {
      this.buckets.forEach((bound, i) => {
        out += `${this.name}_bucket${labelString(this.labelNames, values, `le="${formatNumber(bound)}"`)} ${counts[i]}\n`
      })
      out += `${this.name}_bucket${labelString(this.labelNames, values, 'le="+Inf"')} ${count}\n`
      out += `${this.name}_sum${labelString(this.labelNames, values)} ${formatNumber(sum)}\n`
      out += `${this.name}_count${labelString(this.labelNames, values)} ${count}\n`
    }
    return out
  }
}

class Registry {
  /** @param {{ onCollectError?: (name: string, err: Error) => void }} [options] */
  constructor ({ onCollectError } = {}) {
    this.instruments = new Map()
    this.onCollectError = onCollectError
  }

  register (instrument) {
    if (this.instruments.has(instrument.name)) throw new Error(`metric already registered: ${instrument.name}`)
    instrument.onError = this.onCollectError
    this.instruments.set(instrument.name, instrument)
    return instrument
  }

  counter (name, help, labelNames) { return this.register(new Counter(name, help, labelNames)) }
  gauge (name, help, labelNames, collect) { return this.register(new Gauge(name, help, labelNames, collect)) }
  collectedCounter (name, help, labelNames, collect) { return this.register(new CollectedCounter(name, help, labelNames, collect)) }
  histogram (name, help, labelNames, buckets) { return this.register(new Histogram(name, help, labelNames, buckets)) }

  /** Every instrument in the text exposition format. */
  render () {
    return [...this.instruments.values()].map((i) => i.render()).join('')
  }

  /** Forget every recorded series (tests). Collected gauges are untouched: they hold no state here. */
  reset () {
    for (const instrument of this.instruments.values()) instrument.series.clear()
  }
}

/**
 * Admit at most `max` distinct values of a caller-influenced label; everything
 * past that reads as `overflow`.  The set is per call site.
 */
function bounded (max = 50, overflow = 'other') {
  const seen = new Set()
  return (value) => {
    const text = String(value ?? '')
    if (seen.has(text)) return text
    if (seen.size < max) {
      seen.add(text)
      return text
    }
    return overflow
  }
}

module.exports = { Registry, Counter, Gauge, Histogram, CollectedCounter, bounded, escapeLabel, DEFAULT_BUCKETS }
