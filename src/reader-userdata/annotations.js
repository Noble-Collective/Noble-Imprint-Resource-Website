// Highlights, notes, and positioned bookmarks on the reading content — the superset feature set,
// built on the shared anchor module. Selection -> floating toolbar (colors / note / bookmark / copy);
// clicking a painted mark -> edit (recolor / remove) or note popover.
import { seriesLocator } from '@noble-collective/userdata/core'
import { getClient, onUser } from './firebase.js'
import { el, ICONS, HIGHLIGHT_COLORS, warn, debounce } from './util.js'
import { buildIndex, selectionToNorm, anchorFromNorm, anchorToDomRange, paintRange, unpaint } from './anchor-dom.js'

let CTX = null
let ROOT = null
let items = []
let pendingSel = null
let toolbar = null
let notePop = null
const listeners = []

const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.round(performance.now()))
const onChange = (cb) => listeners.push(cb)
const emitChange = () => listeners.forEach((cb) => { try { cb(items) } catch (e) { warn(e) } })
export const getItems = () => items
export const subscribeItems = onChange

export function initAnnotations(ctx) {
  CTX = ctx
  ROOT = ctx.root
  document.addEventListener('selectionchange', debounce(onSelChange, 130))
  ROOT.addEventListener('click', onContentClick)
  onUser(async (u, client) => {
    clearAll()
    if (!client) { emitChange(); return }
    try {
      const all = await client.listAnnotations()
      items = all.filter((a) => a.locator && a.locator.bookPath === CTX.bookPath && a.locator.sessionFile === CTX.sessionFile)
      repaintAll()
      emitChange()
    } catch (e) { warn('load annotations', e) }
  })
}

function clearAll() {
  hideToolbar(); closeNotePop()
  items.forEach((a) => unpaint(a.id))
  document.querySelectorAll('.nc-bm-marker').forEach((m) => m.remove())
  items = []
}

// ---------- locator + display ----------
function locFor(anchor) {
  return seriesLocator(CTX.bookPath, CTX.sessionFile, { textAnchor: anchor, contentVersion: CTX.contentVersion || undefined })
}
function displayFor(text) {
  const quote = (text || '').trim()
  const ref = quote.length > 60 ? quote.slice(0, 57) + '…' : quote
  const frag = encodeURIComponent(quote.slice(0, 40))
  const href = location.pathname + (frag ? `#:~:text=${frag}` : '')
  return { ref, href }
}

// ---------- selection -> toolbar ----------
function onSelChange() {
  if (!getClient()) { hideToolbar(); return }
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideToolbar(); return }
  if (!ROOT.contains(sel.getRangeAt(0).commonAncestorContainer)) { hideToolbar(); return }
  const idx = buildIndex(ROOT)
  const info = selectionToNorm(idx)
  if (!info) { hideToolbar(); return }
  pendingSel = { anchor: anchorFromNorm(idx, info.start, info.end), text: idx.norm.slice(info.start, info.end), rect: info.rect }
  showCreateToolbar(info.rect)
}

function swatch(color, onClick, active) {
  const b = el('button', `nc-swatch nc-swatch--${color}`)
  b.type = 'button'
  if (active) b.setAttribute('aria-pressed', 'true')
  b.appendChild(el('span'))
  b.onmousedown = (e) => e.preventDefault()
  b.onclick = (e) => { e.stopPropagation(); onClick() }
  return b
}
function tbBtn(icon, title, onClick, danger) {
  const b = el('button', 'nc-toolbar__btn' + (danger ? ' nc-toolbar__btn--danger' : ''))
  b.type = 'button'; b.title = title; b.innerHTML = icon
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
function hideToolbar() { toolbar?.remove(); toolbar = null }

function showCreateToolbar(rect) {
  const kids = HIGHLIGHT_COLORS.map((c) => swatch(c, () => createHighlight(c)))
  kids.push(el('span', 'nc-toolbar__div'))
  kids.push(tbBtn(ICONS.note, 'Add note', () => startNote(rect)))
  kids.push(tbBtn(ICONS.bookmark, 'Bookmark', () => createBookmark()))
  kids.push(tbBtn(ICONS.copy, 'Copy', () => copySelection()))
  buildToolbar(kids)
  positionToolbar(rect)
}
function showEditToolbar(rect, annot) {
  const kids = HIGHLIGHT_COLORS.map((c) => swatch(c, () => recolor(annot, c), annot.color === c))
  kids.push(el('span', 'nc-toolbar__div'))
  kids.push(tbBtn(ICONS.trash, 'Remove', () => removeAnnot(annot), true))
  buildToolbar(kids)
  positionToolbar(rect)
}

// ---------- create / edit ----------
async function createHighlight(color) {
  const sel = pendingSel
  if (!sel) return
  hideToolbar(); window.getSelection()?.removeAllRanges()
  const id = uuid()
  const { ref, href } = displayFor(sel.text)
  const annot = { id, kind: 'highlight', color, locator: locFor(sel.anchor), ref, href }
  items.push(annot); paintOne(annot); emitChange()
  try { await getClient().putAnnotation(annot) } catch (e) { warn('save highlight', e) }
}
async function recolor(annot, color) {
  hideToolbar()
  annot.color = color
  unpaint(annot.id); paintOne(annot); emitChange()
  try { await getClient().putAnnotation({ id: annot.id, kind: 'highlight', color, locator: annot.locator, ref: annot.ref, href: annot.href }) } catch (e) { warn('recolor', e) }
}
async function removeAnnot(annot) {
  hideToolbar(); closeNotePop()
  unpaint(annot.id)
  document.querySelectorAll(`.nc-bm-marker[data-annot-id="${cssEsc(annot.id)}"]`).forEach((m) => m.remove())
  items = items.filter((a) => a.id !== annot.id); emitChange()
  try { await getClient().deleteAnnotation(annot.id) } catch (e) { warn('remove', e) }
}
async function createBookmark() {
  const sel = pendingSel
  if (!sel) return
  hideToolbar(); window.getSelection()?.removeAllRanges()
  const id = uuid()
  const { ref, href } = displayFor(sel.text)
  const annot = { id, kind: 'bookmark', locator: locFor(sel.anchor), ref, href }
  items.push(annot); paintOne(annot); emitChange()
  try { await getClient().putAnnotation(annot) } catch (e) { warn('save bookmark', e) }
}
function copySelection() {
  const t = pendingSel?.text || ''
  hideToolbar()
  try { navigator.clipboard?.writeText(t) } catch (e) { warn('copy', e) }
}

// ---------- notes ----------
function startNote(rect) {
  const sel = pendingSel
  if (!sel) return
  hideToolbar()
  openNotePopover(rect, { anchor: sel.anchor, text: sel.text }, null)
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
    try { await getClient().putAnnotation({ id: existing.id, kind: 'note', body, locator: existing.locator, ref: existing.ref, href: existing.href }) } catch (e) { warn('note', e) }
    return
  }
  const id = uuid()
  const { ref, href } = displayFor(sel.text)
  const annot = { id, kind: 'note', body, locator: locFor(sel.anchor), ref, href }
  items.push(annot); paintOne(annot); emitChange()
  try { await getClient().putAnnotation(annot) } catch (e) { warn('note', e) }
}

// ---------- painting ----------
export function repaintAll() {
  document.querySelectorAll('.nc-bm-marker').forEach((m) => m.remove())
  items.forEach((a) => unpaint(a.id))
  items.forEach(paintOne)
}
function paintOne(annot) {
  const anchor = annot.locator?.textAnchor
  if (!anchor) return
  const idx = buildIndex(ROOT)
  const range = anchorToDomRange(idx, anchor)
  if (!range) return
  if (annot.kind === 'highlight') {
    paintRange(range, `nc-hl nc-hl--${annot.color || 'amber'}`, annot.id)
  } else if (annot.kind === 'note') {
    paintRange(range, 'nc-hl nc-note-mark', annot.id)
  } else if (annot.kind === 'bookmark') {
    placeBookmarkMarker(range, annot)
  }
}
function placeBookmarkMarker(range, annot) {
  let block = range.startContainer
  while (block && block !== ROOT && !(block.nodeType === 1 && /^(P|LI|H1|H2|H3|H4|H5|BLOCKQUOTE|DIV)$/.test(block.tagName))) block = block.parentNode
  if (!block || block === ROOT) block = range.startContainer.parentNode
  const span = el('span', 'nc-bm-marker')
  span.setAttribute('data-nc-skip', '')
  span.dataset.annotId = annot.id
  span.title = 'Bookmark — click to remove'
  span.innerHTML = ICONS.bookmarkFill
  span.onclick = (e) => { e.stopPropagation(); removeAnnot(annot) }
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
