// The reader annotation layer: bridges the DOM and the shared anchor module.
//
// buildIndex() walks the content's visible text into rawText + a node map, and produces a NORMALIZED
// string (same fold rules as @noble-collective/userdata's normalize) with two-way index maps
// (norm<->raw). We then use the shared computeAnchor/resolveAnchor over that normalized string, and
// translate the resulting offsets back into a DOM Range to paint <mark>s. Rebuilding the index per
// paint keeps it correct as the DOM mutates (marks contain their text, so normalized text is stable).
import { computeAnchor, resolveAnchor, normalize } from '@noble-collective/userdata/core'

const DASHES = /[‐-―−]/
const SINGLE_Q = /[‘’‚‛]/
const DOUBLE_Q = /[“”„‟]/

// Skip injected chrome (marked with data-nc-skip) and non-text elements, but NOT our highlight
// <mark>s — those contain real reading text and must stay in the index.
function skip(node) {
  for (let el = node.parentNode; el && el !== document.body; el = el.parentNode) {
    if (el.nodeType !== 1) continue
    const t = el.tagName
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'BUTTON') return true
    if (el.hasAttribute && el.hasAttribute('data-nc-skip')) return true
  }
  return false
}

/** Normalize raw text (mirrors the package normalize) while tracking norm<->raw index maps. */
function normalizeWithMap(raw) {
  const nfc = raw.normalize('NFC')
  const src = nfc.length === raw.length ? nfc : raw // keep 1:1 with DOM when NFC changes length
  let out = ''
  const n2r = []
  const r2n = new Array(src.length + 1).fill(0)
  let prevSpace = false
  let prev = ''
  for (let j = 0; j < src.length; j++) {
    r2n[j] = out.length
    let ch = src[j]
    if (DASHES.test(ch)) ch = '-'
    else if (SINGLE_Q.test(ch)) ch = "'"
    else if (DOUBLE_Q.test(ch)) ch = '"'
    else if (ch === '…') { for (const c of '...') { out += c; n2r.push(j) } prevSpace = false; prev = '.'; continue }
    else if (ch === ' ') ch = ' '
    if (/\s/.test(ch)) {
      if (prevSpace || out.length === 0) continue
      out += ' '; n2r.push(j); prevSpace = true; prev = ' '; continue
    }
    if (ch === '-' && prev === '-') continue
    out += ch; n2r.push(j); prevSpace = false; prev = ch
  }
  while (out.endsWith(' ')) { out = out.slice(0, -1); n2r.pop() }
  r2n[src.length] = out.length
  for (let j = src.length - 1; j >= 0; j--) if (r2n[j] == null) r2n[j] = r2n[j + 1]
  return { text: out, n2r, r2n }
}

export function buildIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  let rawText = ''
  const nodeMap = []
  let n
  while ((n = walker.nextNode())) {
    const start = rawText.length
    rawText += n.nodeValue
    nodeMap.push({ node: n, start, end: rawText.length })
  }
  const { text, n2r, r2n } = normalizeWithMap(rawText)
  return { root, rawText, nodeMap, norm: text, n2r, r2n }
}

/** Locate a raw offset within the node map -> {node, offset}. */
function rawToNode(idx, nodeMap) {
  for (const m of nodeMap) if (idx >= m.start && idx <= m.end) return { node: m.node, offset: idx - m.start }
  const last = nodeMap[nodeMap.length - 1]
  return last ? { node: last.node, offset: last.node.length } : null
}

function nodeToRaw(node, offset, nodeMap) {
  for (const m of nodeMap) if (m.node === node) return m.start + Math.min(offset, m.node.length)
  return null
}

/** Current DOM selection -> a {start,end} range in normalized space (or null). */
export function selectionToNorm(index) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!index.root.contains(range.commonAncestorContainer)) return null
  let rs = nodeToRaw(range.startContainer, range.startOffset, index.nodeMap)
  let re = nodeToRaw(range.endContainer, range.endOffset, index.nodeMap)
  if (rs == null || re == null) return null
  if (rs > re) [rs, re] = [re, rs]
  const ns = index.r2n[rs]
  const ne = index.r2n[re]
  if (ns == null || ne == null || ns >= ne) return null
  const rect = range.getBoundingClientRect()
  return { start: ns, end: ne, rect }
}

/** Build a TextAnchor from a normalized [start,end). */
export function anchorFromNorm(index, start, end) {
  return computeAnchor(index.norm, start, end)
}

/** Resolve a stored TextAnchor to a DOM Range in the current DOM (or null). */
export function anchorToDomRange(index, anchor) {
  const r = resolveAnchor(index.norm, anchor)
  if (!r) return null
  const rawStart = index.n2r[r.start]
  const rawEnd = index.n2r[r.end - 1] != null ? index.n2r[r.end - 1] + 1 : index.n2r[r.end]
  const a = rawToNode(rawStart, index.nodeMap)
  const b = rawToNode(rawEnd, index.nodeMap)
  if (!a || !b) return null
  const range = document.createRange()
  try { range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset) } catch { return null }
  return range
}

/**
 * Resolve a `#:~:text=` directive (textStart or textStart,textEnd) to a DOM Range in `root`.
 * Browser-independent — we find the text ourselves via the normalized index, so a shared link
 * jumps to the spot even where native scroll-to-text-fragment is unreliable (e.g. mobile Safari).
 */
export function textDirectiveToRange(root, startText, endText) {
  const qs = normalize(startText || '')
  if (!qs) return null
  const index = buildIndex(root)
  const s = index.norm.indexOf(qs)
  if (s < 0) return null
  let normStart = s
  let normEnd = s + qs.length
  if (endText) {
    const qe = normalize(endText)
    if (qe) {
      const e = index.norm.indexOf(qe, normEnd)
      if (e >= 0) normEnd = e + qe.length
    }
  }
  const rawStart = index.n2r[normStart]
  const rawEnd = index.n2r[normEnd - 1] != null ? index.n2r[normEnd - 1] + 1 : index.n2r[normEnd]
  const a = rawToNode(rawStart, index.nodeMap)
  const b = rawToNode(rawEnd, index.nodeMap)
  if (!a || !b) return null
  const range = document.createRange()
  try { range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset) } catch { return null }
  return range
}

/**
 * Parse our `#ncq=<start>[|<end>]` passage param out of location.hash → { startText, endText }.
 * We use our own param (not the native `:~:text=` directive) because browsers strip the directive
 * from location before script can read it. `[^&:]` also tolerates a trailing native directive if a
 * browser happens NOT to strip it (encoded parts never contain a literal '|' or ':').
 */
export function parseTextDirective(hash) {
  const m = (hash || '').match(/ncq=([^&:]+)/)
  if (!m) return null
  const segs = m[1].split('|').map((x) => { try { return decodeURIComponent(x) } catch { return x } }).filter(Boolean)
  if (!segs.length) return null
  return { startText: segs[0], endText: segs.length > 1 ? segs[segs.length - 1] : null }
}

/** Wrap a DOM Range's text in <mark> pieces sharing className + data-annot-id. */
export function paintRange(range, className, annotId) {
  const nodes = []
  const walker = document.createTreeWalker(
    range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => (range.intersectsNode(n) && !skip(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) },
  )
  let n
  while ((n = walker.nextNode())) nodes.push(n)
  const parts = []
  for (const node of nodes) {
    let s = 0
    let e = node.length
    if (node === range.startContainer) s = range.startOffset
    if (node === range.endContainer) e = range.endOffset
    if (s < e) parts.push({ node, s, e })
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const { node, s, e } = parts[i]
    let target = node
    if (e < node.length) node.splitText(e)
    if (s > 0) target = node.splitText(s)
    const mark = document.createElement('mark')
    mark.className = className
    mark.dataset.annotId = annotId
    target.parentNode.insertBefore(mark, target)
    mark.appendChild(target)
  }
  return parts.length > 0
}

export function unpaint(annotId) {
  document.querySelectorAll(`mark[data-annot-id="${cssEscape(annotId)}"]`).forEach((m) => {
    const parent = m.parentNode
    while (m.firstChild) parent.insertBefore(m.firstChild, m)
    parent.removeChild(m)
    parent.normalize()
  })
}

function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&') }
