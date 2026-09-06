// Highlights, notes, and positioned bookmarks on the reading content — the superset feature set,
// built on the shared anchor module. Selection -> floating toolbar (colors / note / bookmark / copy);
// clicking a painted mark -> edit (recolor / remove) or note popover.
import { seriesLocator } from '@noble-collective/userdata/core'
import { getClient, onUser } from './firebase.js'
import { el, ICONS, HIGHLIGHT_COLORS, warn, debounce } from './util.js'
import { buildIndex, selectionToNorm, anchorFromNorm, anchorToDomRange, paintRange, unpaint } from './anchor-dom.js'

let CTX = null
let ROOT = null
let clickRoot = null
let wired = false
let items = []
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
export const isCurrentSession = (a) => !!(a && a.locator && CTX && a.locator.sessionFile === CTX.sessionFile)
export const isOrphaned = (id) => orphaned.has(id)

// One-time wiring (selectionchange + auth subscription) + first attach.
export function initAnnotations(ctx) {
  if (!wired) {
    wired = true
    document.addEventListener('selectionchange', debounce(onSelChange, 130)) // single global listener
    onUser((u, client) => reloadForBook(client)) // reload the whole-book set on sign-in/out
  }
  attachAnnotations(ctx)
}

// Per-session (re)attach. Within the same book (the only case AJAX nav produces) the whole-book
// item set is unchanged, so we just re-bind the click handler to the new content and repaint the
// new session's marks — no network reload. A different book triggers a fresh load.
export function attachAnnotations(ctx) {
  hideToolbar(); closeNotePop()
  const sameBook = !!(CTX && ctx.bookPath === CTX.bookPath)
  document.querySelectorAll('.nc-bm-marker').forEach((m) => m.remove())
  items.forEach((a) => unpaint(a.id))
  if (clickRoot) clickRoot.removeEventListener('click', onContentClick)
  CTX = ctx
  ROOT = ctx.root
  clickRoot = ROOT
  ROOT.addEventListener('click', onContentClick)
  const client = getClient()
  if (!sameBook) { items = []; if (client) { reloadForBook(client); return } }
  repaintAll()
  emitChange()
}

async function reloadForBook(client) {
  hideToolbar(); closeNotePop()
  document.querySelectorAll('.nc-bm-marker').forEach((m) => m.remove())
  items.forEach((a) => unpaint(a.id))
  if (!client) { items = []; emitChange(); return }
  try {
    const all = await client.listAnnotations()
    // Whole book (so the notebook spans every session); only current-session items are painted.
    items = all.filter((a) => a.locator && a.locator.bookPath === CTX.bookPath)
    repaintAll()
    emitChange()
  } catch (e) { warn('load annotations', e) }
}

// ---------- locator + display ----------
function locFor(anchor) {
  return seriesLocator(CTX.bookPath, CTX.sessionFile, { textAnchor: anchor, contentVersion: CTX.contentVersion || undefined })
}
function displayFor(text) {
  const quote = (text || '').trim()
  const ref = quote.length > 60 ? quote.slice(0, 57) + '…' : quote
  const frag = textFrag(quote)
  const href = location.pathname + (frag ? `#:~:${frag}` : '')
  return { ref, href }
}
// The current session's title (document.title is "Session — Book"), stored on each annotation so
// list views can show "which session" without re-resolving.
const pageSessionTitle = () => (document.title || '').split(' — ')[0].trim()

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
  pendingSel = { anchor: anchorFromNorm(idx, info.start, info.end), text: idx.norm.slice(info.start, info.end), raw: sel.toString(), rect: info.rect }
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
  const id = uuid()
  const { ref, href } = displayFor(sel.raw || sel.text)
  const annot = { id, kind: 'highlight', color, locator: locFor(sel.anchor), ref, href, title: pageSessionTitle() }
  items.push(annot); paintOne(annot); emitChange()
  try { await getClient().putAnnotation(annot) } catch (e) { warn('save highlight', e) }
}
async function recolor(annot, color) {
  hideToolbar()
  annot.color = color
  unpaint(annot.id); paintOne(annot); emitChange()
  try { await getClient().putAnnotation({ id: annot.id, kind: 'highlight', color, locator: annot.locator, ref: annot.ref, href: annot.href, title: annot.title }) } catch (e) { warn('recolor', e) }
}
async function removeAnnot(annot) {
  hideToolbar(); closeNotePop()
  unpaint(annot.id)
  document.querySelectorAll(`.nc-bm-marker[data-annot-id="${cssEsc(annot.id)}"]`).forEach((m) => m.remove())
  items = items.filter((a) => a.id !== annot.id); emitChange()
  try { await getClient().deleteAnnotation(annot.id) } catch (e) { warn('remove', e) }
}
async function createBookmark() {
  if (!getClient()) return needSignIn()
  if (existingBookmarkForSelection()) { hideToolbar(); return } // one bookmark per line
  const sel = pendingSel
  if (!sel) return
  hideToolbar(); window.getSelection()?.removeAllRanges()
  const id = uuid()
  const { ref, href } = displayFor(sel.raw || sel.text)
  const annot = { id, kind: 'bookmark', locator: locFor(sel.anchor), ref, href, title: pageSessionTitle() }
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
// Build a #:~:text= directive that actually matches on load. The naive slice(0,60) broke two
// rules: (1) Chrome only scrolls when the match ends on a WORD boundary, so a mid-word cut
// silently no-ops; (2) long / multi-block selections need textStart,textEnd, not one truncated
// run. We also percent-encode '-' (encodeURIComponent misses it, and the directive grammar treats
// '-' as a prefix/suffix delimiter); '&' and ',' are already handled by encodeURIComponent.
function fragEnc(s) { return encodeURIComponent(s).replace(/-/g, '%2D') }
function textFrag(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (t.length <= 160) return 'text=' + fragEnc(t)
  const start = t.slice(0, 70).replace(/\s+\S*$/, '') || t.slice(0, 70)   // back off to last whole word
  const end = t.slice(-70).replace(/^\S*\s+/, '') || t.slice(-70)          // forward to next whole word
  return 'text=' + fragEnc(start) + ',' + fragEnc(end)
}
function passageUrl(text) {
  const frag = textFrag(text)
  return location.origin + location.pathname + (frag ? `#:~:${frag}` : '')
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
  openNotePopover(rect, { anchor: sel.anchor, text: sel.text, raw: sel.raw }, null)
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
  const id = uuid()
  const { ref, href } = displayFor(sel.raw || sel.text)
  const annot = { id, kind: 'note', body, locator: locFor(sel.anchor), ref, href, title: pageSessionTitle() }
  items.push(annot); paintOne(annot); emitChange()
  try { await getClient().putAnnotation(annot) } catch (e) { warn('note', e) }
}

// ---------- painting ----------
export function repaintAll() {
  document.querySelectorAll('.nc-bm-marker').forEach((m) => m.remove())
  items.forEach((a) => unpaint(a.id))
  orphaned.clear()
  items.forEach((a) => {
    const isCurrent = a.locator && a.locator.sessionFile === CTX.sessionFile
    const placed = paintOne(a)
    // A current-session item that won't paint has lost its anchor (the text changed) → orphaned.
    if (isCurrent && !placed) orphaned.add(a.id)
  })
}
function paintOne(annot) {
  const anchor = annot.locator?.textAnchor
  if (!anchor) return false
  if (annot.locator.sessionFile !== CTX.sessionFile) return false // only paint the current session
  const idx = buildIndex(ROOT)
  const range = anchorToDomRange(idx, anchor)
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
