// Highlights, notes, and positioned bookmarks on the reading content — the superset feature set,
// built on the shared anchor module. Selection -> floating toolbar (colors / note / bookmark / copy);
// clicking a painted mark -> edit (recolor / remove) or note popover.
import { seriesLocator, bibleLocator } from '@noble-collective/userdata/core'
import { getClient, onUser } from './firebase.js'
import { el, ICONS, HIGHLIGHT_COLORS, warn, debounce } from './util.js'
import { buildIndex, selectionToNorm, rangeToNorm, anchorFromNorm, anchorToDomRange, paintRange, unpaint } from './anchor-dom.js'

let CTX = null
let ROOT = null
let clickRoot = null
let wired = false
let items = []          // annotations for the CURRENT unit (painted), derived from allAnnots
let allAnnots = []      // the full live snapshot across all books (from onAnnotations)
let annUnsub = null     // active onAnnotations subscription teardown (per signed-in session)
let pendingSel = null
let toolbar = null
let toolbarMode = null
let editOutside = null
let notePop = null
const listeners = []

const orphaned = new Set() // current-session items whose anchor no longer resolves (content changed)
const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.round(performance.now()))
const onChange = (cb) => listeners.push(cb)
const emitChange = () => listeners.forEach((cb) => { try { cb(items) } catch (e) { warn(e) } })
export const getItems = () => items
export const subscribeItems = onChange
export const removeById = (id) => { const a = items.find((x) => x.id === id); if (a) removeAnnot(a) }
export const isCurrentSession = (a) => !!(a && a.locator && CTX && sameUnit(a.locator))
export const isOrphaned = (id) => orphaned.has(id)

// ---- corpus helpers: the reader works over both series sessions and Bible chapters ----
const isBible = () => !!(CTX && CTX.corpus === 'bible')
// osisRef prefix for the current Bible chapter, e.g. "Prov.1." — used to scope items to this page.
const chapterOsisPrefix = () => `${CTX.osisBook}.${CTX.chapter}.`
// Does a locator belong to the currently displayed unit (this session / this chapter)?
function sameUnit(loc) {
  if (!loc) return false
  if (isBible()) return loc.corpus === 'bible' && typeof loc.osisRef === 'string' && loc.osisRef.startsWith(chapterOsisPrefix())
  return loc.sessionFile === CTX.sessionFile
}
// Does a locator belong to the current "book" set (the notebook spans the whole book/Bible book)?
function inThisBookSet(loc) {
  if (!loc) return false
  if (isBible()) return loc.corpus === 'bible' && typeof loc.osisRef === 'string' && loc.osisRef.startsWith(`${CTX.osisBook}.`)
  return loc.bookPath === CTX.bookPath
}
// Title stored on each annotation for list views ("which session"/"which chapter").
const unitTitle = () => (isBible() ? (CTX.title || `${CTX.bookName} ${CTX.chapter}`) : pageSessionTitle())

// One-time wiring (selectionchange + auth subscription) + first attach.
export function initAnnotations(ctx) {
  if (!wired) {
    wired = true
    document.addEventListener('selectionchange', debounce(onSelChange, 130)) // single global listener
    onUser((u, client) => manageAnnotationSub(client)) // live subscription on sign-in/out (Phase 2.6)
    window.__ncGetItems = getItems // read-only debug hook (the user's own annotations) + E2E assertions
  }
  attachAnnotations(ctx)
}

// LIVE cross-surface sync: subscribe to the whole annotations collection so a highlight/note/
// bookmark made in another product (Coram Deo, the app) appears here within ~a second, no reload.
// One subscription per signed-in session (all books); in-book AJAX nav re-filters the cached
// snapshot rather than re-subscribing. Torn down on sign-out (client === null).
function manageAnnotationSub(client) {
  if (annUnsub) { annUnsub(); annUnsub = null } // never leak a listener across auth changes
  if (!client) {
    document.querySelectorAll('.nc-bm-marker').forEach((m) => m.remove())
    items.forEach((a) => unpaint(a.id))
    allAnnots = []; items = []; emitChange()
    return
  }
  annUnsub = client.onAnnotations((rows) => {
    allAnnots = rows || [] // snapshot REPLACES the slice (never append); local writes echo by id
    refreshItemsFromSnapshot()
  }, (e) => warn('annotations subscription', e))
}

// Derive the current unit's painted set from the live snapshot + repaint. Re-resolves anchors
// against the CURRENT rendered text every time (offsets are a paint-time artifact — see §7a).
function refreshItemsFromSnapshot() {
  if (!CTX) { items = []; emitChange(); return }
  items = allAnnots.filter((a) => a.locator && inThisBookSet(a.locator))
  if (ROOT) repaintAll()
  emitChange()
}

// Per-session (re)attach. The live subscription persists across in-book AJAX nav (it's user-scoped,
// all books), so we just re-bind the click handler to the new content and re-filter/repaint the
// cached snapshot for the new unit — no network, no new listener.
export function attachAnnotations(ctx) {
  hideToolbar(); closeNotePop()
  document.querySelectorAll('.nc-bm-marker').forEach((m) => m.remove())
  items.forEach((a) => unpaint(a.id))
  if (clickRoot) clickRoot.removeEventListener('click', onContentClick)
  CTX = ctx
  ROOT = ctx.root
  clickRoot = ROOT
  ROOT.addEventListener('click', onContentClick)
  refreshItemsFromSnapshot()
}

// ---------- locator + display ----------
// Build the shared-SDK locator for a new annotation. Series → seriesLocator; Bible → bibleLocator
// keyed to the verse the selection STARTS in (osisRef = book.chapter.verse). The textAnchor is
// computed over the whole chapter, so it resolves reliably on this renderer; the osisRef pins the
// verse for cross-surface use (Coram Deo / the app resolve via the quote within that verse).
function locFor(anchor, verse) {
  if (isBible()) {
    const osisRef = `${CTX.osisBook}.${CTX.chapter}.${verse || 1}`
    const extra = { textAnchor: anchor, contentVersion: CTX.contentVersion || undefined }
    if (CTX.translation) extra.translation = CTX.translation
    return bibleLocator({ osisRef }, extra)
  }
  return seriesLocator(CTX.bookPath, CTX.sessionFile, { textAnchor: anchor, contentVersion: CTX.contentVersion || undefined })
}
function displayFor(text) {
  const quote = (text || '').trim()
  const ref = quote.length > 60 ? quote.slice(0, 57) + '…' : quote
  const href = location.pathname + passageHash(quote)
  return { ref, href }
}
// The current session's title (document.title is "Session — Book"), stored on each annotation so
// list views can show "which session" without re-resolving.
const pageSessionTitle = () => (document.title || '').split(' — ')[0].trim()

// Which Bible verse does a DOM range START in? Non-audio chapters wrap verses in
// `.bible-verse[id="vN"]`; audio-enabled chapters render flat paragraphs with inline <sup>N</sup>
// verse numbers, so we take the number of the last <sup> at or before the range start. Defaults 1.
function startVerseOf(range) {
  if (!range) return 1
  const node = range.startContainer
  const startEl = node.nodeType === 3 ? node.parentElement : node
  const bv = startEl && startEl.closest && startEl.closest('.bible-verse[id]')
  if (bv) { const n = parseInt(String(bv.id).replace(/^v/, ''), 10); if (n > 0) return n }
  let best = 1
  for (const sup of ROOT.querySelectorAll('.bible-paragraph sup, .bible-verse .verse-num, sup')) {
    // sup is at/before the range start if the start node follows it in document order.
    const rel = sup.compareDocumentPosition(node)
    if (sup === node || sup.contains(node) || (rel & Node.DOCUMENT_POSITION_FOLLOWING)) {
      const n = parseInt(sup.textContent, 10); if (n > 0) best = n
    } else break
  }
  return best
}

// Split a multi-verse Bible selection into one anchor PER VERSE (over the chapter index), so we can
// store a highlight the way Coram Deo does: one doc per verse, tied by a shared groupId. Returns
// null for a single-verse selection (or the audio path, which has no per-verse `.bible-verse[id]`
// wrappers) → the caller then stores a single doc.
const inVerseNum = (node) => !!(node && node.parentElement && node.parentElement.closest('sup, .verse-num'))
// The sub-range of `range` that lies within verse element `v`, bounded by TEXT nodes (rangeToNorm
// can't map element-container boundaries) and excluding the verse-number <sup> so the quote is prose.
function verseSubRange(v, range) {
  const w = document.createTreeWalker(v, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (inVerseNum(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const nodes = []; let n; while ((n = w.nextNode())) nodes.push(n)
  if (!nodes.length) return null
  const sub = document.createRange()
  if (v.contains(range.startContainer) && !inVerseNum(range.startContainer)) sub.setStart(range.startContainer, range.startOffset)
  else sub.setStart(nodes[0], 0)
  if (v.contains(range.endContainer)) sub.setEnd(range.endContainer, range.endOffset)
  else { const last = nodes[nodes.length - 1]; sub.setEnd(last, last.length) }
  try { return sub.collapsed ? null : sub } catch { return null }
}
function computeVerseAnchors(idx, range) {
  if (!range) return null
  const verseEls = [...ROOT.querySelectorAll('.bible-verse[id]')].filter((v) => {
    try { return range.intersectsNode(v) } catch { return false }
  })
  if (verseEls.length <= 1) return null
  const out = []
  for (const v of verseEls) {
    const sub = verseSubRange(v, range)
    if (!sub) continue
    const nr = rangeToNorm(idx, sub)
    if (!nr || nr.start >= nr.end) continue
    const verseNum = parseInt(String(v.id).replace(/^v/, ''), 10)
    if (!(verseNum > 0)) continue
    out.push({ verse: verseNum, anchor: anchorFromNorm(idx, nr.start, nr.end), quote: idx.norm.slice(nr.start, nr.end) })
  }
  return out.length > 1 ? out : null
}

// ---- whole-verse (no-anchor) Bible annotations — Coram Deo's canonical model ----
// Notes and bookmarks on the Bible are stored at the VERSE level: no textAnchor, a DETERMINISTIC id
// per verse (so they converge with CD and never duplicate across products), and translation-AGNOSTIC
// (a verse mark shows in both BSB and KJV). Phrase HIGHLIGHTS stay anchored + translation-scoped
// (locFor / createHighlight). Series notes/bookmarks (prose, no verses) are unaffected — anchored.
function verseLocFor(verse) {
  const osisRef = `${CTX.osisBook}.${CTX.chapter}.${verse || 1}`
  return bibleLocator({ osisRef }) // no textAnchor, no translation → cross-fills verseId
}
// Deterministic verse-annotation id — MUST match Coram Deo (userdata-adapter.ts hl__/bm__/nt__).
const VERSE_ID_PREFIX = { highlight: 'hl', bookmark: 'bm', note: 'nt' }
const verseAnnId = (kind, verseId) => `${VERSE_ID_PREFIX[kind]}__${verseId}`
const verseNumFromOsis = (osisRef) => { const m = /\.(\d+)$/.exec(osisRef || ''); return m ? parseInt(m[1], 10) : 0 }
// A DOM range over verse `v`'s prose (text nodes, excluding the verse-number <sup>) — used to paint a
// whole-verse (no-anchor) mark. Same node walk as verseSubRange.
function verseProseRange(v) {
  const w = document.createTreeWalker(v, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (inVerseNum(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const nodes = []; let n; while ((n = w.nextNode())) nodes.push(n)
  if (!nodes.length) return null
  const r = document.createRange()
  r.setStart(nodes[0], 0)
  const last = nodes[nodes.length - 1]; r.setEnd(last, last.length)
  return r.collapsed ? null : r
}
// A DOM range covering verse `num`'s prose, handling BOTH Bible renderings:
//  - non-audio: a `.bible-verse[id="vN"]` wrapper → its prose (verseProseRange).
//  - audio-enabled: flat `.bible-paragraph` with inline `<sup>N</sup>` and NO per-verse wrapper →
//    the run from just after this verse's <sup> to just before the next <sup> (or the paragraph end).
function verseRange(num) {
  const v = ROOT.querySelector(`.bible-verse[id="v${num}"]`)
  if (v) return verseProseRange(v)
  const sups = [...ROOT.querySelectorAll('.bible-content sup')]
  const startSup = sups.find((s) => parseInt(s.textContent, 10) === num)
  if (!startSup) return null
  const nextSup = sups[sups.indexOf(startSup) + 1] || null
  const r = document.createRange()
  try {
    r.setStartAfter(startSup)
    if (nextSup) r.setEndBefore(nextSup)
    else { const para = startSup.closest('.bible-paragraph') || startSup.parentElement; r.setEnd(para, para.childNodes.length) }
  } catch { return null }
  return r.collapsed ? null : r
}

// ---------- selection -> toolbar ----------
function onSelChange() {
  const sel = window.getSelection()
  const inContent = sel && sel.rangeCount > 0 && ROOT.contains(sel.getRangeAt(0).commonAncestorContainer)
  // Show the toolbar even when signed out — Copy works for everyone; Highlight/Note/Bookmark then
  // prompt sign-in (see needSignIn). This makes the reader feel alive before you have an account.
  const valid = sel && !sel.isCollapsed && inContent
  if (!valid) {
    // A collapsed selection (e.g. a click on a highlight) must NOT dismiss the edit toolbar —
    // that caused the flash-and-hide. The edit toolbar is dismissed by an outside click instead.
    if (toolbarMode !== 'edit') hideToolbar()
    return
  }
  const idx = buildIndex(ROOT)
  const info = selectionToNorm(idx)
  if (!info) { if (toolbarMode !== 'edit') hideToolbar(); return }
  // `text` = normalized (for the anchor). `raw` = the actual rendered selection — used for the
  // display quote + the #:~:text= share fragment, which must match the page's ORIGINAL text
  // (curly quotes, em-dashes, whitespace) or the browser won't scroll to it.
  const range = sel.getRangeAt(0)
  pendingSel = {
    anchor: anchorFromNorm(idx, info.start, info.end), text: idx.norm.slice(info.start, info.end),
    raw: sel.toString(), rect: info.rect,
    verse: isBible() ? startVerseOf(range) : undefined,
    verseAnchors: isBible() ? computeVerseAnchors(idx, range) : null, // multi-verse → per-verse docs
  }
  showCreateToolbar(info.rect)
}

function swatch(color, onClick, active) {
  const b = el('button', `nc-swatch nc-swatch--${color}`)
  b.type = 'button'
  const label = color.charAt(0).toUpperCase() + color.slice(1)
  b.setAttribute('data-tip', label); b.setAttribute('aria-label', label + ' highlight')
  if (active) b.setAttribute('aria-pressed', 'true')
  b.appendChild(el('span'))
  b.onmousedown = (e) => e.preventDefault()
  b.onclick = (e) => { e.stopPropagation(); onClick() }
  return b
}
function tbBtn(icon, title, onClick, danger) {
  const b = el('button', 'nc-toolbar__btn' + (danger ? ' nc-toolbar__btn--danger' : ''))
  b.type = 'button'; b.setAttribute('data-tip', title); b.setAttribute('aria-label', title); b.innerHTML = icon
  b.onmousedown = (e) => e.preventDefault()
  b.onclick = (e) => { e.stopPropagation(); onClick() }
  return b
}
function buildToolbar(children) {
  hideToolbar()
  toolbar = el('div', 'nc-toolbar')
  toolbar.setAttribute('data-nc-skip', '')
  children.forEach((c) => toolbar.appendChild(c))
  document.body.appendChild(toolbar)
}
function positionToolbar(rect) {
  const w = toolbar.offsetWidth || 240
  const h = toolbar.offsetHeight || 44
  let left = rect.left + rect.width / 2
  left = Math.max(w / 2 + 8, Math.min(left, window.innerWidth - w / 2 - 8))
  let top = rect.top - h - 8
  if (top < 8) top = rect.bottom + 8
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8))
  toolbar.style.left = left + 'px'
  toolbar.style.top = top + 'px'
}
function hideToolbar() {
  toolbar?.remove(); toolbar = null; toolbarMode = null
  if (editOutside) { document.removeEventListener('mousedown', editOutside, true); editOutside = null }
}

// The bookmark id already on the current selection's block (a line can hold only one), or null.
function existingBookmarkForSelection() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  if (isBible()) {
    // One bookmark per VERSE on the Bible.
    const id = verseAnnId('bookmark', verseLocFor(startVerseOf(sel.getRangeAt(0))).verseId)
    return items.some((a) => a.id === id) ? id : null
  }
  let block = sel.getRangeAt(0).startContainer
  if (block.nodeType !== 1) block = block.parentNode
  while (block && block !== ROOT && !/^(P|LI|H1|H2|H3|H4|H5|BLOCKQUOTE|DIV)$/.test(block.tagName)) block = block.parentNode
  const m = block && block !== ROOT && block.querySelector && block.querySelector('.nc-bm-marker[data-annot-id]')
  return m ? m.dataset.annotId : null
}

function showCreateToolbar(rect) {
  const kids = HIGHLIGHT_COLORS.map((c) => swatch(c, () => createHighlight(c)))
  kids.push(el('span', 'nc-toolbar__div'))
  kids.push(tbBtn(ICONS.note, 'Add note', () => startNote(rect)))
  // A line holds at most one bookmark: if it already has one, the button is filled and toggles it off.
  const existingBm = existingBookmarkForSelection()
  if (existingBm) {
    const bm = tbBtn(ICONS.bookmarkFill, 'Remove bookmark', () => { hideToolbar(); removeById(existingBm) })
    bm.classList.add('nc-toolbar__btn--on')
    kids.push(bm)
  } else {
    kids.push(tbBtn(ICONS.bookmark, 'Bookmark', () => createBookmark()))
  }
  kids.push(tbBtn(ICONS.copy, 'Copy', () => copySelection()))
  kids.push(tbBtn(ICONS.share, 'Share link', () => { const s = pendingSel; hideToolbar(); shareUrl(passageUrl(s && (s.raw || s.text)), s && s.rect) }))
  buildToolbar(kids)
  toolbarMode = 'create'
  positionToolbar(rect)
}
function showEditToolbar(rect, annot) {
  const kids = HIGHLIGHT_COLORS.map((c) => swatch(c, () => recolor(annot, c), annot.color === c))
  kids.push(el('span', 'nc-toolbar__div'))
  kids.push(tbBtn(ICONS.share, 'Share link', () => {
    // Build the fragment from the mark's CURRENT rendered text (raw) so it matches the page.
    const m = document.querySelector(`mark[data-annot-id="${cssEsc(annot.id)}"]`)
    hideToolbar()
    shareUrl(m ? passageUrl(m.textContent) : location.origin + (annot.href || location.pathname), rect)
  }))
  kids.push(tbBtn(ICONS.trash, 'Remove', () => removeAnnot(annot), true))
  buildToolbar(kids)
  toolbarMode = 'edit'
  positionToolbar(rect)
  editOutside = (e) => { if (toolbar && !toolbar.contains(e.target) && !e.target.closest('mark[data-annot-id]')) hideToolbar() }
  setTimeout(() => document.addEventListener('mousedown', editOutside, true), 0)
}

// Signed out: creating anything needs an account — nudge to sign in (Copy stays free).
function needSignIn() {
  hideToolbar()
  document.dispatchEvent(new CustomEvent('nc:need-signin'))
}

// ---------- create / edit ----------
async function createHighlight(color) {
  if (!getClient()) return needSignIn()
  const sel = pendingSel
  if (!sel) return
  hideToolbar(); window.getSelection()?.removeAllRanges()
  const client = getClient()
  const { href } = displayFor(sel.raw || sel.text)
  // Multi-verse Bible highlight → one doc PER VERSE sharing a groupId (Coram Deo's verse-keyed
  // model), so it paints, edits, and deletes as a single entity on every surface.
  if (sel.verseAnchors && sel.verseAnchors.length > 1) {
    const groupId = uuid()
    const created = sel.verseAnchors.map((va) => ({
      id: uuid(), kind: 'highlight', color, groupId,
      locator: locFor(va.anchor, va.verse),
      ref: va.quote && va.quote.length > 60 ? va.quote.slice(0, 57) + '…' : (va.quote || sel.text),
      href, title: unitTitle(),
    }))
    created.forEach((a) => { items.push(a); paintOne(a) })
    emitChange()
    // Write the group in parallel so the live snapshot converges to all members at once (a
    // sequential loop would let an intermediate snapshot briefly wipe not-yet-written members).
    await Promise.all(created.map((a) => client.putAnnotation(a).catch((e) => warn('save highlight', e))))
    return
  }
  const id = uuid()
  const ref = displayFor(sel.raw || sel.text).ref
  const annot = { id, kind: 'highlight', color, locator: locFor(sel.anchor, sel.verse), ref, href, title: unitTitle() }
  items.push(annot); paintOne(annot); emitChange()
  try { await client.putAnnotation(annot) } catch (e) { warn('save highlight', e) }
}
// A multi-verse highlight is N docs sharing a groupId — recolor/remove operate on the whole group.
function groupMembers(annot) {
  return annot && annot.groupId ? items.filter((a) => a.groupId === annot.groupId) : (annot ? [annot] : [])
}
async function recolor(annot, color) {
  hideToolbar()
  const members = groupMembers(annot)
  const client = getClient()
  for (const m of members) { m.color = color; unpaint(m.id); paintOne(m) }
  emitChange()
  for (const m of members) {
    try { await client.putAnnotation({ id: m.id, kind: 'highlight', color, groupId: m.groupId, locator: m.locator, ref: m.ref, href: m.href, title: m.title }) } catch (e) { warn('recolor', e) }
  }
}
async function removeAnnot(annot) {
  hideToolbar(); closeNotePop()
  const members = groupMembers(annot)
  const ids = new Set(members.map((m) => m.id))
  for (const m of members) {
    unpaint(m.id)
    document.querySelectorAll(`.nc-bm-marker[data-annot-id="${cssEsc(m.id)}"]`).forEach((el2) => el2.remove())
  }
  items = items.filter((a) => !ids.has(a.id)); emitChange()
  const client = getClient()
  await Promise.all(members.map((m) => client.deleteAnnotation(m.id).catch((e) => warn('remove', e))))
}
async function createBookmark() {
  if (!getClient()) return needSignIn()
  const sel = pendingSel
  if (!sel) return
  hideToolbar(); window.getSelection()?.removeAllRanges()
  const { ref, href } = displayFor(sel.raw || sel.text)
  let annot
  if (isBible()) {
    // Verse-level (Coram Deo model): one bookmark per verse, deterministic id, no anchor.
    const locator = verseLocFor(sel.verse)
    const id = verseAnnId('bookmark', locator.verseId)
    if (items.some((a) => a.id === id)) return // already bookmarked (one per verse)
    annot = { id, kind: 'bookmark', locator, ref, href, title: unitTitle() }
  } else {
    if (existingBookmarkForSelection()) return // one bookmark per line (series)
    annot = { id: uuid(), kind: 'bookmark', locator: locFor(sel.anchor, sel.verse), ref, href, title: unitTitle() }
  }
  items.push(annot); paintOne(annot); emitChange()
  try { await getClient().putAnnotation(annot) } catch (e) { warn('save bookmark', e) }
}
function copySelection() {
  const t = pendingSel?.text || ''
  const rect = pendingSel?.rect
  hideToolbar()
  try { navigator.clipboard?.writeText(t) } catch (e) { warn('copy', e) }
  showToast('Copied', rect)
}

// A deep link to a passage: the session URL + a native text-fragment that scrolls to & highlights it.
// Split a selection into word-bounded start[/end] pieces for a passage link. A fixed slice(0,60)
// broke matching two ways: (1) native scroll-to-text only fires when the match ends on a WORD
// boundary, so a mid-word cut no-ops; (2) long / multi-block selections need start+end, not one
// truncated run. So we back off each side to a whole word.
function fragEnc(s) { return encodeURIComponent(s).replace(/-/g, '%2D') } // encodeURIComponent misses '-'
function fragParts(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (t.length <= 160) return { start: t, end: null }
  const start = t.slice(0, 70).replace(/\s+\S*$/, '') || t.slice(0, 70)   // back off to last whole word
  const end = t.slice(-70).replace(/^\S*\s+/, '') || t.slice(-70)          // forward to next whole word
  return { start, end }
}
// A shareable passage URL. We carry the text TWICE:
//  (1) our own `?ncq=` QUERY param (start[|end]) — the reader reads it on load and scrolls+flashes
//      the passage in every browser. It's a query param, NOT a fragment, on purpose: browsers strip
//      the native `:~:text=` directive from the URL before script can read it, and share sheets
//      (notably Safari's) drop the whole `#…` fragment — query params survive both. The server
//      ignores unknown query params.
//  (2) the native `#:~:text=` directive too, so desktop browsers that keep it also highlight for free.
function ncqParam(p) { return 'ncq=' + fragEnc(p.start) + (p.end ? '|' + fragEnc(p.end) : '') }
function nativeFrag(p) { return '#:~:text=' + fragEnc(p.start) + (p.end ? ',' + fragEnc(p.end) : '') }
function passageUrl(text) {
  const p = fragParts(text)
  if (!p) return location.origin + location.pathname
  const sep = location.search ? '&' : '?'
  return location.origin + location.pathname + sep + ncqParam(p) + nativeFrag(p)
}
// Relative variant (path + query + fragment) for stored notebook links.
function passageHash(text) {
  const p = fragParts(text)
  if (!p) return ''
  return '?' + ncqParam(p) + nativeFrag(p)
}
async function shareUrl(url, rect) {
  if (navigator.share) {
    try { await navigator.share({ title: document.title, url }); return } catch { /* cancelled or unsupported → copy */ }
  }
  try { await navigator.clipboard.writeText(url); showToast('Link copied', rect) } catch { showToast('Couldn’t copy link', rect) }
}

// Brief floating confirmation (e.g. after Copy) near the selection.
function showToast(msg, rect) {
  const t = el('div', 'nc-toast', msg)
  t.setAttribute('data-nc-skip', '')
  document.body.appendChild(t)
  const r = rect || { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0 }
  t.style.left = Math.round(r.left + (r.width || 0) / 2) + 'px'
  t.style.top = Math.round(r.top - 6) + 'px'
  requestAnimationFrame(() => t.classList.add('nc-toast--show'))
  setTimeout(() => { t.classList.remove('nc-toast--show'); setTimeout(() => t.remove(), 220) }, 1100)
}

// ---------- notes ----------
function startNote(rect) {
  if (!getClient()) return needSignIn()
  const sel = pendingSel
  if (!sel) return
  hideToolbar()
  // Bible notes are one-per-verse: if this verse already has a note, edit it (pre-filled) instead of
  // silently overwriting it with a blank create.
  let existing = null
  if (isBible()) {
    const id = verseAnnId('note', verseLocFor(sel.verse).verseId)
    existing = items.find((a) => a.kind === 'note' && a.id === id) || null
  }
  openNotePopover(rect, { anchor: sel.anchor, text: sel.text, raw: sel.raw, verse: sel.verse }, existing)
}
function openNotePopover(rect, sel, existing) {
  closeNotePop()
  notePop = el('div', 'nc-note-pop')
  notePop.setAttribute('data-nc-skip', '')
  if (sel?.text) notePop.appendChild(el('div', 'nc-note-quote', sel.text.length > 120 ? sel.text.slice(0, 117) + '…' : sel.text))
  const ta = el('textarea')
  ta.placeholder = 'Add a note…'
  ta.value = existing?.body || ''
  notePop.appendChild(ta)
  const actions = el('div', 'nc-note-pop__actions')
  if (existing) {
    const del = el('button', 'nc-btn', 'Delete')
    del.onclick = () => { closeNotePop(); removeAnnot(existing) }
    actions.appendChild(del)
  }
  const cancel = el('button', 'nc-btn', 'Cancel')
  cancel.onclick = () => closeNotePop()
  const save = el('button', 'nc-btn nc-btn--primary', 'Save')
  save.onclick = () => saveNote(ta.value.trim(), sel, existing)
  actions.append(cancel, save)
  notePop.appendChild(actions)
  document.body.appendChild(notePop)
  const w = 270
  let left = rect.left + rect.width / 2
  left = Math.max(w / 2 + 8, Math.min(left, window.innerWidth - w / 2 - 8))
  notePop.style.left = left + 'px'
  notePop.style.top = Math.min(rect.bottom + 8, window.innerHeight - 200) + 'px'
  ta.focus()
}
function closeNotePop() { notePop?.remove(); notePop = null }
async function saveNote(body, sel, existing) {
  if (!body) { closeNotePop(); if (existing) removeAnnot(existing); return }
  closeNotePop(); window.getSelection()?.removeAllRanges()
  if (existing) {
    existing.body = body; emitChange()
    try { await getClient().putAnnotation({ id: existing.id, kind: 'note', body, locator: existing.locator, ref: existing.ref, href: existing.href, title: existing.title }) } catch (e) { warn('note', e) }
    return
  }
  const { ref, href } = displayFor(sel.raw || sel.text)
  let annot
  if (isBible()) {
    // Verse-level (Coram Deo model): one note per verse, deterministic id, no anchor.
    const locator = verseLocFor(sel.verse)
    annot = { id: verseAnnId('note', locator.verseId), kind: 'note', body, locator, ref, href, title: unitTitle() }
  } else {
    annot = { id: uuid(), kind: 'note', body, locator: locFor(sel.anchor, sel.verse), ref, href, title: unitTitle() }
  }
  // Deterministic id ⇒ replace any existing paint/item for this verse's note (upsert semantics).
  unpaint(annot.id); items = items.filter((a) => a.id !== annot.id)
  items.push(annot); paintOne(annot); emitChange()
  try { await getClient().putAnnotation(annot) } catch (e) { warn('note', e) }
}

// ---------- painting ----------
export function repaintAll() {
  document.querySelectorAll('.nc-bm-marker').forEach((m) => m.remove())
  // Unpaint EVERY existing mark, not just current items — a doc can leave `items` between live
  // snapshots (e.g. a group member deleted while another lingers), and its mark must not survive.
  const painted = new Set()
  document.querySelectorAll('mark[data-annot-id]').forEach((m) => painted.add(m.dataset.annotId))
  painted.forEach((id) => unpaint(id))
  orphaned.clear()
  items.forEach((a) => {
    const isCurrent = a.locator && sameUnit(a.locator)
    const placed = paintOne(a)
    // Only an ANCHOR-bearing item that fails to paint is "orphaned" (its text changed). A no-anchor
    // whole-verse mark that didn't paint is just on a render without per-verse wrappers (audio) —
    // it's verse-keyed, not lost.
    if (isCurrent && !placed && a.locator?.textAnchor) orphaned.add(a.id)
  })
}
function paintOne(annot) {
  const loc = annot.locator
  if (!sameUnit(loc)) return false // only paint items belonging to the current unit
  let range
  if (loc?.textAnchor) {
    range = anchorToDomRange(buildIndex(ROOT), loc.textAnchor)
  } else if (loc?.corpus === 'bible') {
    // Whole-verse (no-anchor) mark — Coram Deo's model. Paint over the verse's prose; verseRange
    // handles both the wrapped (non-audio) and flat inline-<sup> (audio) renderings.
    range = verseRange(verseNumFromOsis(loc.osisRef))
  }
  if (!range) return false
  if (annot.kind === 'highlight') {
    return paintRange(range, `nc-hl nc-hl--${annot.color || 'amber'}`, annot.id)
  } else if (annot.kind === 'note') {
    return paintRange(range, 'nc-hl nc-note-mark', annot.id)
  } else if (annot.kind === 'bookmark') {
    placeBookmarkMarker(range, annot)
    return true
  }
  return false
}
function placeBookmarkMarker(range, annot) {
  let block = range.startContainer
  while (block && block !== ROOT && !(block.nodeType === 1 && /^(P|LI|H1|H2|H3|H4|H5|BLOCKQUOTE|DIV)$/.test(block.tagName))) block = block.parentNode
  if (!block || block === ROOT) block = range.startContainer.parentNode
  const span = el('span', 'nc-bm-marker')
  span.setAttribute('data-nc-skip', '')
  span.dataset.annotId = annot.id
  span.title = 'Bookmark — open in notebook'
  span.innerHTML = ICONS.bookmarkFill
  span.onclick = (e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('nc:open-notebook', { detail: { focusId: annot.id } })) }
  block.insertBefore(span, block.firstChild)
}

// ---------- clicks on painted marks ----------
function onContentClick(e) {
  const mark = e.target.closest && e.target.closest('mark[data-annot-id]')
  if (!mark) return
  const annot = items.find((a) => a.id === mark.dataset.annotId)
  if (!annot) return
  e.stopPropagation()
  const rect = mark.getBoundingClientRect()
  if (annot.kind === 'note') openNotePopover(rect, { text: annot.ref }, annot)
  else showEditToolbar(rect, annot)
}

function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&') }
