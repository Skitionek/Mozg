/* The "Model" page's force graph (scripts/build-site.js embeds the data).
 *
 * Databases' entities hang off the identifier spaces and ontologies they share:
 * the graph is a drawing of Mozg's OBO-key joins.  Dependency-free: a small
 * force simulation drawn on a canvas, with a real DOM legend, controls and
 * table beside it, since a canvas is opaque to assistive technology.
 *
 * Identity is never colour alone: each database has a colour AND a node shape
 * (the chart palette has eight categorical slots and a force graph is a form
 * where any two colours can touch), and every entity is labelled.
 */
(function () {
  'use strict'

  const root = document.getElementById('model-graph')
  const dataEl = document.getElementById('model-data')
  if (!root || !dataEl) return

  const data = JSON.parse(dataEl.textContent)
  const MAX = data.maxSources
  const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'cross', 'triangleDown']
  const SVG_NS = 'http://www.w3.org/2000/svg'

  const el = (selector) => root.querySelector(selector)
  const stage = el('.model-stage')
  const canvas = el('canvas')
  const ctx = canvas.getContext('2d')
  const tooltip = el('.model-tooltip')
  const statusEl = el('.model-status')
  const detail = el('.model-detail')
  const legend = el('.model-legend')
  const tableBody = el('.model-table tbody')
  const presetBar = el('.model-presets')
  const picker = el('.model-picker-list')
  const optRelations = el('input[name="relations"]')
  const optUnshared = el('input[name="unshared"]')

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const coarse = window.matchMedia('(pointer: coarse)')
  const dark = window.matchMedia('(prefers-color-scheme: dark)')

  const sourceByName = new Map(data.sources.map((s) => [s.name, s]))
  const keyById = new Map(data.keys.map((k) => [k.id, k]))
  const entityById = new Map(data.entities.map((e) => [e.id, e]))

  // ── State ────────────────────────────────────────────────────────────────

  /** A database keeps its colour and shape (its slot) while others come and go. */
  const slotOf = new Map()
  let nodes = []
  let links = []
  const nodeById = new Map()
  const positions = new Map() // survives rebuilds, so changing the selection does not scramble the layout

  let hovered = null
  let selected = null
  let isolated = null // a database name whose neighbourhood is shown alone
  let dragging = null
  let panning = null
  let view = { k: 1, x: 0, y: 0 }
  let width = 0
  let height = 0
  let dpr = 1
  let alpha = 0
  let frame = 0
  let dirty = true
  let palette = null
  let hidden = 0
  let spreadUsed = 1 // the spread the layout was last settled at
  let viewTouched = false // the reader has panned or zoomed: stop refitting on resize

  const make = (tag, className, content) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (content != null) node.textContent = content
    return node
  }

  // ── Colours (CSS custom properties, so light and dark swap in one place) ─────

  function readPalette () {
    const css = window.getComputedStyle(stage)
    const get = (name) => css.getPropertyValue(name).trim()
    palette = {
      series: Array.from({ length: MAX }, (_, i) => get(`--m-s${i + 1}`)),
      surface: get('--m-surface'),
      ink: get('--m-ink'),
      ink2: get('--m-ink2'),
      muted: get('--m-muted'),
      line: get('--m-line'),
      ontology: get('--m-ontology'),
      space: get('--m-space'),
      accent: get('--m-accent'),
      font: css.fontFamily
    }
  }

  // ── Shapes ───────────────────────────────────────────────────────────────

  /** Vertices of the polygon for a shape of radius r around (0, 0), or null for a circle. */
  function polygon (shape, r) {
    const ngon = (n, rotate) => Array.from({ length: n }, (_, i) => {
      const a = rotate + (i * 2 * Math.PI) / n
      return [Math.cos(a) * r, Math.sin(a) * r]
    })
    switch (shape) {
      case 'square': return ngon(4, Math.PI / 4).map(([x, y]) => [x * 0.92, y * 0.92])
      case 'triangle': return ngon(3, -Math.PI / 2).map(([x, y]) => [x * 1.12, y * 1.12])
      case 'triangleDown': return ngon(3, Math.PI / 2).map(([x, y]) => [x * 1.12, y * 1.12])
      case 'diamond': return ngon(4, 0).map(([x, y]) => [x * 1.18, y * 1.18])
      case 'pentagon': return ngon(5, -Math.PI / 2)
      case 'hexagon': return ngon(6, 0)
      case 'cross': {
        const a = r * 1.15
        const b = r * 0.42
        return [[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]]
      }
      default: return null
    }
  }

  function tracePath (shape, x, y, r) {
    ctx.beginPath()
    const points = polygon(shape, r)
    if (!points) {
      ctx.arc(x, y, r, 0, Math.PI * 2)
      return
    }
    points.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)))
    ctx.closePath()
  }

  /** A small inline SVG of a shape in a slot's colour, for the legend and the picker. */
  function swatch (slot, size = 16) {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '-10 -10 20 20')
    svg.setAttribute('width', size)
    svg.setAttribute('height', size)
    svg.setAttribute('aria-hidden', 'true')
    const points = polygon(SHAPES[slot], 7.5)
    const shape = points ? document.createElementNS(SVG_NS, 'polygon') : document.createElementNS(SVG_NS, 'circle')
    if (points) shape.setAttribute('points', points.map((p) => p.join(',')).join(' '))
    else shape.setAttribute('r', 7.5)
    shape.style.fill = `var(--m-s${slot + 1})`
    svg.append(shape)
    return svg
  }

  // ── Building the graph from the selection ─────────────────────────────────────

  function hash (string) {
    let h = 2166136261
    for (let i = 0; i < string.length; i++) h = Math.imul(h ^ string.charCodeAt(i), 16777619)
    return ((h >>> 0) % 10007) / 10007
  }

  function measureKeyNode (node) {
    ctx.font = `600 12px ${palette.font}`
    node.w = Math.ceil(ctx.measureText(node.label).width) + 18
    node.h = 22
    node.r = Math.max(node.w, node.h) / 2
  }

  function build () {
    const names = [...slotOf.keys()]
    const chosen = new Set(names)
    const entities = data.entities.filter((e) => chosen.has(e.source))

    // Which databases carry each identifier space.
    const carriers = new Map()
    for (const entity of entities) {
      for (const key of new Set([...entity.returns, ...entity.accepts])) {
        if (!carriers.has(key)) carriers.set(key, new Set())
        carriers.get(key).add(entity.source)
      }
    }
    const minDatabases = optUnshared.checked ? 1 : 2
    const shownKeys = new Set([...carriers].filter(([, s]) => s.size >= minDatabases).map(([k]) => k))

    const nextNodes = []
    const nextLinks = []
    const visibleEntities = new Set()
    for (const entity of entities) {
      const through = [...new Set([...entity.returns, ...entity.accepts])].filter((k) => shownKeys.has(k))
      if (through.length) visibleEntities.add(entity.id)
    }
    // A relation can also bring an entity into the picture, when relations are shown.
    const relations = optRelations.checked
      ? data.relations.filter((r) => chosen.has(entityById.get(r.from).source) && chosen.has(entityById.get(r.to).source))
      : []
    for (const r of relations) {
      visibleEntities.add(r.from)
      visibleEntities.add(r.to)
    }
    hidden = entities.length - visibleEntities.size

    const reuse = (id, make) => {
      const node = make()
      const old = positions.get(id)
      if (old) Object.assign(node, { x: old.x, y: old.y, fx: old.fx, fy: old.fy })
      return node
    }

    let ki = 0
    for (const keyId of shownKeys) {
      const key = keyById.get(keyId)
      const angle = (ki++ / Math.max(1, shownKeys.size)) * Math.PI * 2
      const node = reuse(`key:${keyId}`, () => ({
        id: `key:${keyId}`,
        type: 'key',
        key,
        label: key.prefix,
        x: Math.cos(angle) * 170 * spread(),
        y: Math.sin(angle) * 170 * spread(),
        vx: 0,
        vy: 0,
        degree: 0
      }))
      measureKeyNode(node)
      nextNodes.push(node)
    }

    for (const entityId of visibleEntities) {
      const entity = entityById.get(entityId)
      const slot = slotOf.get(entity.source)
      const angle = ((slot + hash(entity.id) * 0.9) / MAX) * Math.PI * 2
      const radius = 380 + hash(`r${entity.id}`) * 120
      nextNodes.push(reuse(entityId, () => ({
        id: entityId,
        type: 'entity',
        entity,
        slot,
        label: entity.name,
        x: Math.cos(angle) * radius * spread(),
        y: Math.sin(angle) * radius * spread(),
        vx: 0,
        vy: 0,
        degree: 0,
        r: 8
      })))
    }

    nodeById.clear()
    for (const node of nextNodes) nodeById.set(node.id, node)

    for (const entityId of visibleEntities) {
      const entity = entityById.get(entityId)
      for (const keyId of new Set([...entity.returns, ...entity.accepts])) {
        if (!shownKeys.has(keyId)) continue
        const via = entity.returns.includes(keyId) ? (entity.accepts.includes(keyId) ? 'both' : 'returns') : 'accepts'
        nextLinks.push({ source: nodeById.get(entityId), target: nodeById.get(`key:${keyId}`), kind: 'key', via, len: 120, k: 0.35 })
      }
    }
    for (const r of relations) {
      nextLinks.push({ source: nodeById.get(r.from), target: nodeById.get(r.to), kind: 'relation', type: r.type, len: 190, k: 0.05 })
    }
    for (const link of nextLinks) {
      link.source.degree++
      link.target.degree++
    }
    // An entity joined to many identifier spaces is held loosely, so it can spread around the hub they form.
    for (const link of nextLinks) {
      if (link.kind === 'key') link.k = 0.4 / Math.pow(Math.max(1, link.source.type === 'entity' ? link.source.degree : link.target.degree), 0.6)
    }
    for (const node of nextNodes) {
      if (node.type === 'entity') node.r = 7 + Math.min(4, Math.sqrt(node.degree))
    }
    nodes = nextNodes
    links = nextLinks
    if (hovered && !nodeById.has(hovered.id)) hovered = null
    if (selected && !nodeById.has(selected.id)) selected = null
    if (isolated && !chosen.has(isolated)) isolated = null
  }

  // ── The force simulation ────────────────────────────────────────────────────

  /**
   * A pill is a wide rectangle, not a circle: push whatever touches it clear of
   * its edges, so no shape sits on a label and no two pills overlap.
   */
  function separatePill (p, q, a) {
    const strength = 0.5 * (a + 0.25)
    if (p.type === 'key' && q.type === 'key') {
      const ox = (p.w + q.w) / 2 + 14 - Math.abs(q.x - p.x)
      const oy = (p.h + q.h) / 2 + 10 - Math.abs(q.y - p.y)
      if (ox <= 0 || oy <= 0) return
      // Resolve along the axis with the smaller overlap.
      const alongX = ox < oy
      const sx = alongX ? Math.sign(q.x - p.x || 1) * ox * strength : 0
      const sy = alongX ? 0 : Math.sign(q.y - p.y || 1) * oy * strength
      if (p.fx == null) { p.vx -= sx * 0.5; p.vy -= sy * 0.5 }
      if (q.fx == null) { q.vx += sx * 0.5; q.vy += sy * 0.5 }
      return
    }
    const key = p.type === 'key' ? p : q
    const dot = key === p ? q : p
    const cx = Math.max(key.x - key.w / 2, Math.min(dot.x, key.x + key.w / 2))
    const cy = Math.max(key.y - key.h / 2, Math.min(dot.y, key.y + key.h / 2))
    let dx = dot.x - cx
    let dy = dot.y - cy
    let d = Math.hypot(dx, dy)
    const need = dot.r + 16
    if (d >= need) return
    if (d < 0.5) { dx = 0; dy = dot.y >= key.y ? 1 : -1; d = 1 }
    const push = (need - d) * strength
    if (dot.fx == null) { dot.vx += (dx / d) * push; dot.vy += (dy / d) * push }
    if (key.fx == null) { key.vx -= (dx / d) * push * 0.25; key.vy -= (dy / d) * push * 0.25 }
  }

  /** How roomy the layout is: smaller on a narrow screen, where marks keep their size. */
  function spread () {
    return Math.max(0.5, Math.min(1.25, Math.min(width, height * 1.1) / 640))
  }

  function tick () {
    const a = alpha
    const S = spreadUsed
    // On a tall, narrow frame, pull sideways harder than up and down, so the graph grows taller, not smaller.
    const aspect = Math.max(0.6, Math.min(1.7, height / (width || 1)))
    for (const l of links) {
      const s = l.source
      const t = l.target
      const dx = t.x - s.x
      const dy = t.y - s.y
      const d = Math.hypot(dx, dy) || 0.01
      const f = ((d - l.len * S) / d) * a * l.k
      if (s.fx == null) { s.vx += dx * f * 0.5; s.vy += dy * f * 0.5 }
      if (t.fx == null) { t.vx -= dx * f * 0.5; t.vy -= dy * f * 0.5 }
    }
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j]
        let dx = q.x - p.x
        let dy = q.y - p.y
        let d2 = dx * dx + dy * dy
        if (d2 > 640000) continue
        if (d2 < 1) { dx = hash(p.id) - 0.5; dy = hash(q.id) - 0.5; d2 = 1 }
        const d = Math.sqrt(d2)
        const both = p.type === 'key' && q.type === 'key'
        // Repel, and keep a clear gap between marks so labels have room.
        let push = ((both ? 22000 : 9000) * S * S * a) / d2
        const gap = p.r + q.r + (both ? 34 : 26)
        if (d < gap) push += (gap - d) * 0.12 * (a + 0.2)
        const ux = dx / d
        const uy = dy / d
        if (p.fx == null) { p.vx -= ux * push; p.vy -= uy * push }
        if (q.fx == null) { q.vx += ux * push; q.vy += uy * push }
        if (p.type === 'key' || q.type === 'key') separatePill(p, q, a)
      }
    }
    for (const n of nodes) {
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue }
      // Identifier spaces gather in the middle; databases ring them.
      const pull = n.type === 'key' ? 0.03 : 0.006
      n.vx -= n.x * pull * aspect * a
      n.vy -= (n.y * pull * a) / aspect
      n.vx *= 0.55
      n.vy *= 0.55
      n.x += n.vx
      n.y += n.vy
    }
  }

  function settle (ticks = 420) {
    spreadUsed = spread()
    alpha = 1
    for (let i = 0; i < ticks && alpha > 0.015; i++) {
      tick()
      alpha *= 0.985
    }
    alpha = 0
  }

  function reheat (value) {
    if (reducedMotion.matches) {
      // No animation: let the layout settle at once.
      alpha = Math.max(alpha, value)
      for (let i = 0; i < 60 && alpha > 0.015; i++) { tick(); alpha *= 0.96 }
      alpha = 0
      schedule()
      return
    }
    alpha = Math.max(alpha, value)
    schedule()
  }

  function remember () {
    for (const n of nodes) positions.set(n.id, { x: n.x, y: n.y, fx: n.fx, fy: n.fy })
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  function schedule () {
    dirty = true
    if (!frame) frame = window.requestAnimationFrame(loop)
  }

  function loop () {
    frame = 0
    if (alpha > 0.015) {
      tick()
      alpha *= 0.985
      if (alpha <= 0.015) { alpha = 0; remember() }
    }
    if (dirty || alpha > 0) draw()
    dirty = false
    if (alpha > 0) frame = window.requestAnimationFrame(loop)
  }

  /** The nodes lit up by the hover, the selection or an isolated database; null when nothing is. */
  function focusSet () {
    const anchor = hovered || selected
    if (anchor) {
      const set = new Set([anchor.id])
      for (const l of links) {
        if (l.source === anchor) set.add(l.target.id)
        else if (l.target === anchor) set.add(l.source.id)
      }
      // From a database's entity, light up the other databases reached through its identifier spaces.
      return set
    }
    if (isolated) {
      const set = new Set()
      for (const n of nodes) if (n.type === 'entity' && n.entity.source === isolated) set.add(n.id)
      for (const l of links) if (set.has(l.source.id) || set.has(l.target.id)) { set.add(l.source.id); set.add(l.target.id) }
      return set
    }
    return null
  }

  function toScreen (n) {
    return [n.x * view.k + view.x, n.y * view.k + view.y]
  }

  function roundRect (x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function draw () {
    if (!palette) readPalette()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!nodes.length) return
    const lit = focusSet()
    const dim = (id) => (lit && !lit.has(id) ? 0.14 : 1)

    ctx.save()
    ctx.translate(view.x, view.y)
    ctx.scale(view.k, view.k)

    // Declared relations: arrows between entities.
    for (const l of links) {
      if (l.kind !== 'relation') continue
      const on = !lit || (lit.has(l.source.id) && lit.has(l.target.id))
      ctx.globalAlpha = on ? 0.7 : 0.08
      ctx.strokeStyle = palette.ink2
      ctx.lineWidth = 1.4 / view.k
      const dx = l.target.x - l.source.x
      const dy = l.target.y - l.source.y
      const d = Math.hypot(dx, dy) || 1
      const ux = dx / d
      const uy = dy / d
      const x1 = l.source.x + ux * (l.source.r + 2)
      const y1 = l.source.y + uy * (l.source.r + 2)
      const x2 = l.target.x - ux * (l.target.r + 4)
      const y2 = l.target.y - uy * (l.target.r + 4)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      const head = 6 / view.k
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - ux * head - uy * head * 0.5, y2 - uy * head + ux * head * 0.5)
      ctx.lineTo(x2 - ux * head + uy * head * 0.5, y2 - uy * head - ux * head * 0.5)
      ctx.closePath()
      ctx.fillStyle = palette.ink2
      ctx.fill()
    }

    // Entity → identifier space, in the database's own colour.
    for (const l of links) {
      if (l.kind !== 'key') continue
      const entityNode = l.source.type === 'entity' ? l.source : l.target
      const on = !lit || (lit.has(l.source.id) && lit.has(l.target.id))
      ctx.globalAlpha = on ? (lit ? 0.95 : 0.42) : 0.05
      ctx.strokeStyle = palette.series[entityNode.slot]
      ctx.lineWidth = (on && lit ? 2.2 : 1.2) / view.k
      ctx.beginPath()
      ctx.moveTo(l.source.x, l.source.y)
      ctx.lineTo(l.target.x, l.target.y)
      ctx.stroke()
    }

    // Identifier spaces and ontologies: labelled pills.
    for (const n of nodes) {
      if (n.type !== 'key') continue
      ctx.globalAlpha = dim(n.id)
      roundRect(n.x - n.w / 2, n.y - n.h / 2, n.w, n.h, n.h / 2)
      ctx.fillStyle = n.key.ontology ? palette.ontology : palette.space
      ctx.fill()
      ctx.lineWidth = (n === hovered || n === selected ? 2.4 : 1.4) / view.k
      ctx.strokeStyle = n.key.ontology ? palette.accent : palette.muted
      ctx.stroke()
      ctx.fillStyle = palette.ink
      ctx.font = `600 12px ${palette.font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(n.label, n.x, n.y + 0.5)
    }

    // Entities: a shape in the database's colour, ringed in the surface colour.
    for (const n of nodes) {
      if (n.type !== 'entity') continue
      ctx.globalAlpha = dim(n.id)
      tracePath(SHAPES[n.slot], n.x, n.y, n.r)
      ctx.fillStyle = palette.series[n.slot]
      ctx.fill()
      ctx.lineWidth = 2 / view.k
      ctx.strokeStyle = palette.surface
      ctx.stroke()
      if (n === hovered || n === selected) {
        tracePath(SHAPES[n.slot], n.x, n.y, n.r + 3.5)
        ctx.lineWidth = 2 / view.k
        ctx.strokeStyle = palette.ink
        ctx.stroke()
      }
      if (n.fx != null) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, 2, 0, Math.PI * 2)
        ctx.fillStyle = palette.surface
        ctx.fill()
      }
    }

    // Entity labels, most connected first; one that would overlap another is skipped
    // unless it is lit (it is then always shown, and the table lists every entity).
    ctx.globalAlpha = 1
    ctx.font = `12px ${palette.font}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const placed = []
    for (const n of nodes) {
      if (n.type !== 'key') continue
      placed.push({ x: (n.x - n.w / 2 - 3) * view.k, y: (n.y - n.h / 2 - 2) * view.k, w: (n.w + 6) * view.k, h: (n.h + 4) * view.k })
    }
    const overlaps = (r) => placed.some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y)
    const labelled = nodes
      .filter((n) => n.type === 'entity')
      .sort((a, b) => ((lit && lit.has(b.id) ? 1000 : 0) + b.degree) - ((lit && lit.has(a.id) ? 1000 : 0) + a.degree))
    for (const n of labelled) {
      if (lit && !lit.has(n.id)) continue
      const w = ctx.measureText(n.label).width
      const [sx, sy] = [n.x + n.r + 5, n.y]
      const box = { x: sx - 2, y: sy - 8, w: w + 4, h: 16 }
      const screenBox = { x: box.x * view.k, y: box.y * view.k, w: box.w * view.k, h: box.h * view.k }
      if (!(lit && lit.has(n.id)) && overlaps(screenBox)) continue
      placed.push(screenBox)
      ctx.lineJoin = 'round'
      ctx.lineWidth = 4 / view.k
      ctx.strokeStyle = palette.surface
      ctx.strokeText(n.label, sx, sy)
      ctx.fillStyle = palette.ink
      ctx.fillText(n.label, sx, sy)
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // ── Layout of the view ────────────────────────────────────────────────────

  function fit () {
    if (!nodes.length || !width) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      const w = n.type === 'key' ? n.w / 2 : n.r + 90
      const h = n.type === 'key' ? n.h / 2 : n.r + 10
      minX = Math.min(minX, n.x - (n.type === 'key' ? w : n.r + 4))
      maxX = Math.max(maxX, n.x + w)
      minY = Math.min(minY, n.y - h)
      maxY = Math.max(maxY, n.y + h)
    }
    const pad = 24
    const k = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1), 1.5)
    view = { k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k }
    schedule()
  }

  function resize () {
    const rect = stage.getBoundingClientRect()
    const nextWidth = Math.max(280, Math.round(rect.width))
    // A phone gets a tall frame; anything wider a squarer one.  The viewport decides, not the
    // stage: beside the side panel and the contents column the stage is narrow on a desktop too.
    const phone = window.innerWidth < 640
    const nextHeight = Math.max(420, Math.round(phone ? Math.min(window.innerHeight * 0.78, nextWidth * 1.65) : Math.min(window.innerHeight * 0.8, 640)))
    const nextDpr = window.devicePixelRatio || 1
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return
    width = nextWidth
    height = nextHeight
    dpr = nextDpr
    canvas.style.height = `${height}px`
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    if (nodes.length && Math.abs(spread() - spreadUsed) / spreadUsed > 0.15) {
      settle(240)
      remember()
    }
    if (!viewTouched) fit()
    schedule()
  }

  // ── Describing nodes ────────────────────────────────────────────────────────

  function kindOf (key) {
    return key.ontology ? 'ontology' : 'identifier space'
  }

  /** What a node is, as { title, subtitle, lines[] }, for the tooltip and the detail panel. */
  function describe (node) {
    if (node.type === 'key') {
      const holders = nodes.filter((n) => n.type === 'entity' && links.some((l) => l.kind === 'key' && l.target === node && l.source === n))
      const dbs = new Set(holders.map((n) => n.entity.source))
      return {
        title: `${node.key.prefix} — ${node.key.label}`,
        subtitle: `${kindOf(node.key)}, carried by ${holders.length} ${holders.length === 1 ? 'entity' : 'entities'} in ${dbs.size} ${dbs.size === 1 ? 'database' : 'databases'} shown`,
        lines: [`Two entities that carry ${node.key.prefix} can be joined on it: same key and same value name the same thing.`],
        holders
      }
    }
    const e = node.entity
    const source = sourceByName.get(e.source)
    const lines = []
    if (e.description) lines.push(e.description.length > 220 ? `${e.description.slice(0, 217)}…` : e.description)
    if (e.returns.length) lines.push(`Returns: ${e.returns.map((k) => keyById.get(k).prefix).join(', ')}`)
    if (e.accepts.length) lines.push(`Accepts: ${e.accepts.map((k) => keyById.get(k).prefix).join(', ')}`)
    return { title: `${e.source} / ${e.name}`, subtitle: `${source.label} · ${source.category}`, lines }
  }

  function showTooltip (node, clientX, clientY) {
    const info = describe(node)
    tooltip.replaceChildren(make('strong', '', info.title), make('span', 'model-tooltip-sub', info.subtitle), ...info.lines.slice(0, 3).map((l) => make('span', 'model-tooltip-line', l)))
    tooltip.hidden = false
    const rect = stage.getBoundingClientRect()
    const x = Math.min(Math.max(8, clientX - rect.left + 14), rect.width - tooltip.offsetWidth - 8)
    const y = Math.min(Math.max(8, clientY - rect.top + 14), rect.height - tooltip.offsetHeight - 8)
    tooltip.style.transform = `translate(${x}px, ${y}px)`
  }

  function renderDetail () {
    detail.replaceChildren()
    if (!selected) {
      detail.append(make('p', 'model-hint', coarse.matches
        ? 'Tap a node to see what it connects. Use the table below for the full list.'
        : 'Select a node to see what it connects, or drag it to rearrange. Press Escape to clear. The table below lists everything.'))
      return
    }
    const info = describe(selected)
    detail.append(make('h3', '', info.title), make('p', 'model-detail-sub', info.subtitle))
    for (const line of info.lines) detail.append(make('p', '', line))
    if (selected.type === 'key') {
      const bySource = new Map()
      for (const h of info.holders) {
        if (!bySource.has(h.entity.source)) bySource.set(h.entity.source, [])
        bySource.get(h.entity.source).push(h)
      }
      const list = make('ul', 'model-chips')
      for (const [name, holders] of bySource) {
        const item = make('li')
        item.append(swatch(slotOf.get(name)), make('span', '', ` ${name}: `))
        holders.forEach((h, i) => {
          if (i) item.append(document.createTextNode(', '))
          item.append(button(h.entity.name, () => select(h), `Select ${h.entity.source} ${h.entity.name}`))
        })
        list.append(item)
      }
      detail.append(list)
    } else {
      const own = links.filter((l) => l.kind === 'key' && l.source === selected)
      if (own.length) {
        const list = make('ul', 'model-chips')
        for (const l of own) {
          const item = make('li')
          item.append(button(l.target.key.prefix, () => select(l.target), `Select ${l.target.key.label}`), make('span', '', ` (${l.via === 'both' ? 'returns and accepts' : l.via})`))
          list.append(item)
        }
        detail.append(list)
      }
      const related = links.filter((l) => l.kind === 'relation' && (l.source === selected || l.target === selected))
      if (related.length) {
        const list = make('ul', 'model-chips')
        for (const l of related) {
          const other = l.source === selected ? l.target : l.source
          const item = make('li', '', l.source === selected ? 'relates to ' : 'related from ')
          item.append(button(other.id, () => select(other), `Select ${other.id}`))
          list.append(item)
        }
        detail.append(make('p', 'model-detail-sub', 'Declared relations'), list)
      }
      const link = make('a', '', `${selected.entity.source} in the source reference`)
      // Encoded: the name comes from the page's embedded data, and belongs in the fragment, nowhere else.
      link.href = `sources.html#${encodeURIComponent(selected.entity.source)}`
      detail.append(make('p', '', ''))
      detail.lastChild.append(link)
    }
  }

  function button (label, onClick, name) {
    const b = make('button', 'model-link', label)
    b.type = 'button'
    if (name) b.setAttribute('aria-label', name)
    b.addEventListener('click', onClick)
    return b
  }

  function select (node) {
    selected = node
    renderDetail()
    schedule()
    renderTableSelection()
  }

  // ── The table: every entity and identifier space, reachable without a pointer ──

  function renderTable () {
    tableBody.replaceChildren()
    const keyNodes = nodes.filter((n) => n.type === 'key').sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    if (!keyNodes.length) {
      const row = make('tr')
      const cell = make('td', '', 'No identifier space is shared by two of the chosen databases. Choose more, or show the identifier spaces a single database uses.')
      cell.colSpan = 3
      row.append(cell)
      tableBody.append(row)
      return
    }
    for (const kn of keyNodes) {
      const row = make('tr')
      row.dataset.node = kn.id
      const first = make('th')
      first.scope = 'row'
      first.append(button(kn.key.prefix, () => select(kn), `Select ${kn.key.label}`), make('div', 'model-cell-sub', kn.key.label))
      const kind = make('td', '', kindOf(kn.key))
      const carried = make('td')
      const bySource = new Map()
      for (const l of links) {
        if (l.kind !== 'key' || l.target !== kn) continue
        const n = l.source
        if (!bySource.has(n.entity.source)) bySource.set(n.entity.source, [])
        bySource.get(n.entity.source).push(n)
      }
      for (const [name, list] of bySource) {
        const item = make('div', 'model-cell-db')
        item.append(swatch(slotOf.get(name), 14), make('strong', '', ` ${name} `))
        list.forEach((n, i) => {
          if (i) item.append(document.createTextNode(', '))
          item.append(button(n.entity.name, () => select(n), `Select ${n.entity.source} ${n.entity.name}`))
        })
        carried.append(item)
      }
      row.append(first, kind, carried)
      tableBody.append(row)
    }
  }

  function renderTableSelection () {
    for (const row of tableBody.querySelectorAll('tr[data-node]')) {
      row.classList.toggle('is-selected', Boolean(selected) && row.dataset.node === selected.id)
    }
  }

  // ── Legend, presets, picker ─────────────────────────────────────────────────

  function renderLegend () {
    legend.replaceChildren()
    for (const [name, slot] of [...slotOf].sort((a, b) => a[1] - b[1])) {
      const source = sourceByName.get(name)
      const shown = nodes.filter((n) => n.type === 'entity' && n.entity.source === name).length
      const item = make('li')
      const b = make('button', 'model-legend-item')
      b.type = 'button'
      b.setAttribute('aria-pressed', String(isolated === name))
      b.dataset.name = name
      b.append(swatch(slot, 18), make('span', 'model-legend-name', name), make('span', 'model-legend-count', `${shown} of ${source.entities}`))
      b.setAttribute('aria-label', `${source.label}: ${shown} of ${source.entities} entities shown. ${isolated === name ? 'Showing only this database; press to show all.' : 'Press to show only this database.'}`)
      b.addEventListener('click', () => {
        isolated = isolated === name ? null : name
        renderLegend()
        // The buttons were rebuilt: put the keyboard back where it was.
        legend.querySelector(`[data-name="${name}"]`).focus()
        schedule()
      })
      item.append(b)
      legend.append(item)
    }
    const keys = make('li', 'model-legend-keys')
    const sample = (className, label) => {
      const s = make('span', `model-key-sample ${className}`, label)
      return s
    }
    keys.append(sample('is-ontology', 'ontology'), sample('is-space', 'identifier space'))
    legend.append(keys)
  }

  /** Built once; afterwards only states change, so a keyboard user keeps their place. */
  function buildPicker () {
    picker.replaceChildren()
    const byCategory = new Map()
    for (const s of data.sources) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, [])
      byCategory.get(s.category).push(s)
    }
    for (const [category, sources] of byCategory) {
      const group = make('fieldset', 'model-picker-group')
      group.append(make('legend', '', category))
      for (const s of sources) {
        const label = make('label', 'model-picker-item')
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.value = s.name
        input.addEventListener('click', (event) => {
          // aria-disabled keeps the box focusable, so a keyboard user can land on it and learn why.
          if (input.getAttribute('aria-disabled') === 'true') {
            event.preventDefault()
            announce(`At most ${MAX} databases at a time. Remove one first.`)
          }
        })
        input.addEventListener('change', () => toggleSource(s.name, input.checked))
        label.append(input, document.createTextNode(` ${s.name}`), make('span', 'model-picker-count', `${s.entities}`))
        group.append(label)
      }
      picker.append(group)
    }
  }

  function syncPicker () {
    for (const input of picker.querySelectorAll('input')) {
      input.checked = slotOf.has(input.value)
      if (slotOf.size >= MAX && !input.checked) input.setAttribute('aria-disabled', 'true')
      else input.removeAttribute('aria-disabled')
    }
    el('.model-picker summary').firstChild.textContent = `Choose databases (${slotOf.size} of ${MAX})`
  }

  function buildPresets () {
    presetBar.replaceChildren()
    for (const preset of data.presets) {
      const b = button(preset.label, () => applyPreset(preset))
      b.className = 'model-preset'
      b.removeAttribute('aria-label')
      b.dataset.preset = preset.id
      b.title = preset.description
      presetBar.append(b)
    }
  }

  function syncPresets (activeId) {
    for (const b of presetBar.children) b.setAttribute('aria-pressed', String(b.dataset.preset === activeId))
  }

  function announce (message) {
    statusEl.textContent = message
  }

  // ── Changing the selection ──────────────────────────────────────────────────

  function refresh (message) {
    build()
    settle(260)
    remember()
    renderLegend()
    syncPicker()
    renderTable()
    renderDetail()
    fit()
    const shown = nodes.filter((n) => n.type === 'entity').length
    const spaces = nodes.filter((n) => n.type === 'key').length
    announce(message || `${slotOf.size} ${slotOf.size === 1 ? 'database' : 'databases'}, ${shown} entities, ${spaces} identifier spaces shown.` +
      (hidden ? ` ${hidden} ${hidden === 1 ? 'entity shares' : 'entities share'} no identifier space with the others and ${hidden === 1 ? 'is' : 'are'} not drawn.` : ''))
    schedule()
  }

  function toggleSource (name, on) {
    if (on) {
      if (slotOf.size >= MAX) return
      const used = new Set(slotOf.values())
      let slot = 0
      while (used.has(slot)) slot++
      slotOf.set(name, slot)
    } else {
      slotOf.delete(name)
    }
    syncPresets(null)
    refresh()
  }

  function applyPreset (preset) {
    slotOf.clear()
    positions.clear()
    preset.sources.forEach((name, i) => slotOf.set(name, i))
    selected = null
    isolated = null
    syncPresets(preset.id)
    refresh()
  }

  // ── Pointer and keyboard ──────────────────────────────────────────────────────

  function pointOf (event) {
    const rect = canvas.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    return { sx, sy, wx: (sx - view.x) / view.k, wy: (sy - view.y) / view.k }
  }

  /** The nearest node whose hit area (at least 24 px across) holds the pointer. */
  function hit (sx, sy) {
    let best = null
    let bestD = Infinity
    for (const n of nodes) {
      const [x, y] = toScreen(n)
      let d
      if (n.type === 'key') {
        const dx = Math.max(Math.abs(sx - x) - (n.w * view.k) / 2, 0)
        const dy = Math.max(Math.abs(sy - y) - (n.h * view.k) / 2, 0)
        d = Math.hypot(dx, dy)
        if (d > 4) continue
      } else {
        d = Math.hypot(sx - x, sy - y) - n.r * view.k
        if (d > Math.max(12 - n.r * view.k, 4)) continue
      }
      if (d < bestD) { best = n; bestD = d }
    }
    return best
  }

  canvas.addEventListener('pointermove', (event) => {
    const p = pointOf(event)
    if (dragging) {
      const moved = Math.hypot(p.sx - dragging.startX, p.sy - dragging.startY)
      if (moved > 4) dragging.moved = true
      if (dragging.moved) {
        dragging.node.fx = p.wx
        dragging.node.fy = p.wy
        reheat(0.3)
        tooltip.hidden = true
      }
      return
    }
    if (panning) {
      viewTouched = true
      view.x = panning.vx + (p.sx - panning.startX)
      view.y = panning.vy + (p.sy - panning.startY)
      schedule()
      return
    }
    const node = hit(p.sx, p.sy)
    if (node !== hovered) {
      hovered = node
      canvas.style.cursor = node ? 'pointer' : ''
      schedule()
    }
    if (node) showTooltip(node, event.clientX, event.clientY)
    else tooltip.hidden = true
  })

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType === 'touch') return
    const p = pointOf(event)
    const node = hit(p.sx, p.sy)
    canvas.setPointerCapture(event.pointerId)
    if (node) dragging = { node, startX: p.sx, startY: p.sy, moved: false }
    else panning = { startX: p.sx, startY: p.sy, vx: view.x, vy: view.y, moved: false }
    canvas.style.cursor = 'grabbing'
  })

  function endPointer (event) {
    const was = dragging || panning
    if (!was) return
    const p = pointOf(event)
    if (dragging) {
      if (!dragging.moved) select(dragging.node)
      else { dragging.node.fx = dragging.node.x; dragging.node.fy = dragging.node.y; remember() }
    } else if (Math.hypot(p.sx - panning.startX, p.sy - panning.startY) < 4) {
      selected = null
      renderDetail()
      renderTableSelection()
    }
    dragging = null
    panning = null
    canvas.style.cursor = hovered ? 'pointer' : ''
    schedule()
  }
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('pointercancel', () => { dragging = null; panning = null })
  canvas.addEventListener('pointerleave', () => { if (!dragging && !panning) { hovered = null; tooltip.hidden = true; schedule() } })

  // Touch keeps its normal scrolling, so a tap (a click from a touch) selects; a mouse selects on pointer up.
  canvas.addEventListener('click', (event) => {
    if (event.pointerType !== 'touch') return
    const p = pointOf(event)
    const node = hit(p.sx, p.sy)
    if (node) select(node)
  })

  canvas.addEventListener('dblclick', (event) => {
    const p = pointOf(event)
    const node = hit(p.sx, p.sy)
    if (node && node.fx != null) { node.fx = node.fy = null; reheat(0.4); remember() }
  })

  // A plain wheel scrolls the page; zooming takes Ctrl or ⌘, or the buttons.
  canvas.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const p = pointOf(event)
    zoomAt(p.sx, p.sy, Math.exp(-event.deltaY * 0.0025))
  }, { passive: false })

  function zoomAt (sx, sy, factor) {
    viewTouched = true
    const k = Math.min(3, Math.max(0.35, view.k * factor))
    const ratio = k / view.k
    view = { k, x: sx - (sx - view.x) * ratio, y: sy - (sy - view.y) * ratio }
    schedule()
  }

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (selected || isolated)) {
      selected = null
      isolated = null
      renderDetail()
      renderLegend()
      renderTableSelection()
      schedule()
    }
  })

  el('[data-action="zoom-in"]').addEventListener('click', () => zoomAt(width / 2, height / 2, 1.3))
  el('[data-action="zoom-out"]').addEventListener('click', () => zoomAt(width / 2, height / 2, 1 / 1.3))
  el('[data-action="fit"]').addEventListener('click', () => { viewTouched = false; fit() })
  el('[data-action="reset"]').addEventListener('click', () => {
    positions.clear()
    for (const n of nodes) n.fx = n.fy = null
    build()
    settle(420)
    remember()
    fit()
  })
  optRelations.addEventListener('change', () => refresh())
  optUnshared.addEventListener('change', () => refresh())

  new window.ResizeObserver(resize).observe(stage)
  dark.addEventListener('change', () => { palette = null; schedule() })
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) alpha = 0 })

  // ── Start ────────────────────────────────────────────────────────────────────

  // Shown first, then measured: a hidden figure has no width to fit to.
  root.classList.add('is-ready')
  readPalette()
  resize()
  const first = data.presets[0]
  first.sources.forEach((name, i) => slotOf.set(name, i))
  buildPresets()
  buildPicker()
  syncPresets(first.id)
  refresh()
  // Exposed for the tests, not as an API.
  root.__model = { get nodes () { return nodes }, get links () { return links }, slotOf, select, hit, toScreen, get view () { return view } }
})()
