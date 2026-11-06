'use strict'

/**
 * Text clean-up shared by catalog entries.
 */

/**
 * Plain text from a source's HTML-formatted description (InterPro abstracts,
 * Reactome summations).  Tags and comments are removed until none remain, so
 * input built to survive a single pass — `<scr<script>ipt>` — cannot leave a
 * tag behind, and an unterminated `<!--` takes the rest of the text with it.
 *
 * This is presentation, not a security boundary: Mozg returns data as JSON,
 * and its query builder escapes everything it renders.
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
function stripTags (text) {
  if (text == null) return null
  let out = String(text)
  let previous
  do {
    previous = out
    out = out.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<[/!]?[A-Za-z][^<>]*>/g, '')
  } while (out !== previous)
  return out.replace(/\s+/g, ' ').trim()
}

module.exports = { stripTags }
