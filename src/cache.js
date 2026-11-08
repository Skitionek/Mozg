'use strict'

/**
 * A bounded least-recently-used cache with optional expiry.
 *
 * Mozg is a long-running process that builds things on demand from caller
 * input — a database pool per distinct connection, a parsed ontology per
 * distinct document, a response per distinct URL.  Left unbounded each of
 * those is a slow memory leak (or, for pools, a slow descriptor leak) that a
 * caller can drive by varying the input.  Every such store goes through this
 * class so it has a ceiling.
 *
 * A JavaScript Map iterates in insertion order, so recency is kept by
 * re-inserting a key on every read: the first key is always the least recently
 * used.  No linked list is needed.
 *
 * @template V
 */
class LruCache {
  /**
   * @param {object} [options]
   * @param {number} [options.max=100]     entries kept; 0 or less means unbounded
   * @param {number} [options.maxWeight=0] total weight kept; 0 or less means no weight limit
   * @param {(value: V) => number} [options.weigh]  an entry's weight (e.g. bytes); needed with maxWeight
   * @param {number} [options.ttlMs=0]     lifetime of an entry; 0 means it never expires
   * @param {boolean} [options.sliding=false]  a read renews the lifetime (idle expiry)
   * @param {(value: V, key: string, reason: 'lru'|'expired'|'delete'|'clear') => void} [options.onEvict]
   *        called when an entry leaves the cache, e.g. to close a connection;
   *        errors it throws (or rejects with) are swallowed so one failed close
   *        cannot break the caller that triggered the eviction
   * @param {() => number} [options.now]  clock, for tests
   */
  constructor ({ max = 100, maxWeight = 0, weigh, ttlMs = 0, sliding = false, onEvict, now = Date.now } = {}) {
    this.max = max
    this.maxWeight = maxWeight
    this.weigh = weigh
    this.weight = 0
    this.ttlMs = ttlMs
    this.sliding = sliding
    this.onEvict = onEvict
    this.now = now
    this.entries = new Map()
    this.stats = { hits: 0, misses: 0, evictions: 0, expirations: 0 }
  }

  get size () {
    return this.entries.size
  }

  /** The value for `key`, marking it most recently used; undefined if absent or expired. */
  get (key) {
    const entry = this.entries.get(key)
    if (!entry) {
      this.stats.misses++
      return undefined
    }
    if (this.#expired(entry)) {
      this.#remove(key, entry, 'expired')
      this.stats.expirations++
      this.stats.misses++
      return undefined
    }
    this.entries.delete(key)
    if (this.sliding && this.ttlMs > 0) entry.expires = this.now() + this.ttlMs
    this.entries.set(key, entry)
    this.stats.hits++
    return entry.value
  }

  /** Like get, but neither refreshes recency nor counts as a hit or a miss. */
  peek (key) {
    const entry = this.entries.get(key)
    return entry && !this.#expired(entry) ? entry.value : undefined
  }

  has (key) {
    return this.peek(key) !== undefined
  }

  /**
   * Store a value, evicting the least recently used entries beyond `max`.
   * @param {string} key
   * @param {V} value
   * @param {{ ttlMs?: number }} [options]  a lifetime for this entry alone
   */
  set (key, value, { ttlMs } = {}) {
    const previous = this.entries.get(key)
    if (previous) {
      this.entries.delete(key)
      this.weight -= previous.weight
      if (previous.value !== value) this.#notify(previous.value, key, 'delete')
    }
    const weight = this.weigh ? this.weigh(value) : 0
    // A value heavier than the whole budget can never fit; storing it would
    // only evict everything else on its way out.
    if (this.maxWeight > 0 && weight > this.maxWeight) return this
    const life = ttlMs != null ? ttlMs : this.ttlMs
    this.entries.set(key, { value, weight, expires: life > 0 ? this.now() + life : Infinity })
    this.weight += weight
    this.#trim()
    return this
  }

  /** The cached value for `key`, building and storing it with `make()` on a miss. */
  getOrSet (key, make, options) {
    const hit = this.get(key)
    if (hit !== undefined) return hit
    const value = make()
    this.set(key, value, options)
    return value
  }

  delete (key) {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.#remove(key, entry, 'delete')
    return true
  }

  /** Drop every expired entry; returns how many went.  Cheap enough to call on a timer. */
  prune () {
    let dropped = 0
    for (const [key, entry] of [...this.entries]) {
      if (this.#expired(entry)) {
        this.#remove(key, entry, 'expired')
        this.stats.expirations++
        dropped++
      }
    }
    return dropped
  }

  /** Remove everything, telling `onEvict` about each entry. */
  clear () {
    const all = [...this.entries]
    this.entries.clear()
    this.weight = 0
    for (const [key, entry] of all) this.#notify(entry.value, key, 'clear')
  }

  /**
   * Empty the cache and hand back the values *without* calling `onEvict`, for
   * a caller that wants to close them itself and wait for each to finish.
   */
  drain () {
    const values = this.values()
    this.entries.clear()
    this.weight = 0
    return values
  }

  /** Live values, least recently used first. */
  values () {
    return [...this.entries.values()].filter((e) => !this.#expired(e)).map((e) => e.value)
  }

  keys () {
    return [...this.entries.entries()].filter(([, e]) => !this.#expired(e)).map(([k]) => k)
  }

  #expired (entry) {
    return entry.expires <= this.now()
  }

  #remove (key, entry, reason) {
    this.entries.delete(key)
    this.weight -= entry.weight
    this.#notify(entry.value, key, reason)
  }

  #trim () {
    while (this.#overBudget()) {
      const [key, entry] = this.entries.entries().next().value
      this.entries.delete(key)
      this.weight -= entry.weight
      this.stats.evictions++
      this.#notify(entry.value, key, 'lru')
    }
  }

  #overBudget () {
    if (this.entries.size === 0) return false
    return (this.max > 0 && this.entries.size > this.max) ||
      (this.maxWeight > 0 && this.weight > this.maxWeight)
  }

  #notify (value, key, reason) {
    if (!this.onEvict) return
    try {
      const result = this.onEvict(value, key, reason)
      if (result && typeof result.catch === 'function') result.catch(() => {})
    } catch { /* a failed close must not break the caller */ }
  }
}

module.exports = { LruCache }
