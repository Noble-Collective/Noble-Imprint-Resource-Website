// "My Notebook" — a bottom sheet with Highlights / Notes / Bookmarks tabs (like the mobile app),
// spanning the whole book. Current-session items scroll to their mark; other-session items navigate
// to their page. Each item has a delete icon. Opens focused on a specific item when asked
// (e.g. tapping a bookmark opens the Bookmarks tab on that item). Includes search, session grouping,
// and Markdown export of everything saved in the book.
import { el, ICONS } from './util.js'
import { getItems, subscribeItems, removeById, isCurrentSession, isOrphaned } from './annotations.js'

let sheet = null
let backdrop = null
let activeTab = 'highlights'
let subscribed = false
let query = ''

const TABS = [['highlights', 'Highlights', 'highlight'], ['notes', 'Notes', 'note'], ['bookmarks', 'Bookmarks', 'bookmark']]
const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'))
const clip = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const dot = (color) => `<span class="nc-dot" style="background:var(--nc-${color})"></span>`
const tabForKind = (k) => (k === 'highlight' ? 'highlights' : k === 'note' ? 'notes' : 'bookmarks')
const matches = (a, q) => !q || (`${a.ref || ''} ${a.body || ''}`).toLowerCase().includes(q)

document.addEventListener('nc:open-notebook', (e) => openLibrary(e && e.detail && e.detail.focusId))

export function openLibrary(focusId) {
  if (focusId) { const a = getItems().find((x) => x.id === focusId); if (a) activeTab = tabForKind(a.kind) }
  if (sheet) { render(); if (focusId) setTimeout(() => focusItem(focusId), 60); return }
  backdrop = el('div', 'nc-backdrop'); backdrop.setAttribute('data-nc-skip', ''); backdrop.onclick = closeSheet
  sheet = el('div', 'nc-sheet'); sheet.setAttribute('data-nc-skip', '')
  const grip = el('div', 'nc-sheet__grip')
  const head = el('div', 'nc-sheet__head')
  head.appendChild(el('div', 'nc-panel__title', 'My Notebook'))
  const exportBtn = el('button', 'nc-iconbtn nc-sheet__export'); exportBtn.title = 'Export this book’s notes (Markdown)'
  exportBtn.innerHTML = ICONS.download; exportBtn.onclick = exportMarkdown
  const close = el('button', 'nc-iconbtn'); close.title = 'Close'; close.innerHTML = ICONS.close; close.onclick = closeSheet
  head.append(exportBtn, close)
  const tabs = el('div', 'nc-sheet__tabs')
  for (const [key] of TABS) {
    const t = el('button', 'nc-tab'); t.dataset.tab = key
    t.onclick = () => { activeTab = key; render() }
    tabs.appendChild(t)
  }
  const search = el('div', 'nc-sheet__search')
  const input = el('input', 'nc-search'); input.type = 'search'; input.placeholder = 'Search your notes…'; input.value = query
  input.setAttribute('data-nc-skip', '')
  input.addEventListener('input', () => { query = input.value.trim().toLowerCase(); renderBody() })
  search.appendChild(input)
  const body = el('div', 'nc-sheet__body')
  sheet.append(grip, head, tabs, search, body)
  document.body.append(backdrop, sheet)
  requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open') })
  render()
  if (!subscribed) { subscribeItems(() => render()); subscribed = true }
  if (focusId) setTimeout(() => focusItem(focusId), 300)
}

function closeSheet() {
  const s = sheet; const b = backdrop
  sheet = null; backdrop = null
  s?.classList.remove('open'); b?.classList.remove('open')
  setTimeout(() => { s?.remove(); b?.remove() }, 260)
}

function scrollToMark(id) {
  const m = document.querySelector(`mark[data-annot-id="${esc(id)}"], .nc-bm-marker[data-annot-id="${esc(id)}"]`)
  if (!m) return
  closeSheet()
  // Wait a frame so the closing sheet doesn't interrupt the smooth scroll, then jump + emphasize.
  requestAnimationFrame(() => {
    m.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = m.closest('p, li, h1, h2, h3, h4, h5, blockquote') || m
    t.classList.remove('nc-jumpflash')
    void t.offsetWidth // restart the animation if the same item is clicked again
    t.classList.add('nc-jumpflash')
    setTimeout(() => t.classList.remove('nc-jumpflash'), 2600)
  })
}
function focusItem(id) {
  const node = sheet && sheet.querySelector(`.nc-panel__item[data-annot-id="${esc(id)}"]`)
  if (!node) return
  node.scrollIntoView({ block: 'center' })
  node.classList.add('nc-panel__item--focus'); setTimeout(() => node.classList.remove('nc-panel__item--focus'), 2400)
}

function itemFor(a) {
  const orphan = isCurrentSession(a) && isOrphaned(a.id)
  const item = el('div', 'nc-panel__item' + (orphan ? ' nc-panel__item--orphan' : ''))
  item.dataset.annotId = a.id
  const main = el('button', 'nc-panel__main')
  main.innerHTML = (a.kind === 'note' ? '' : dot(a.kind === 'bookmark' ? 'accent' : (a.color || 'amber')))
    + escapeHtml(clip(a.ref, 90))
    + (a.kind === 'note' && a.body ? `<div class="nc-panel__q" style="margin-top:.2rem">${escapeHtml(clip(a.body, 130))}</div>` : '')
    + (orphan ? '<div class="nc-panel__orphan">Couldn’t find this on the page — the text may have changed.</div>' : '')
  main.onclick = () => { if (orphan) return; if (isCurrentSession(a)) scrollToMark(a.id); else if (a.href) window.location.href = a.href }
  const del = el('button', 'nc-panel__del'); del.title = 'Delete'; del.innerHTML = ICONS.trash
  del.onclick = (e) => { e.stopPropagation(); removeById(a.id); render() }
  item.append(main, del)
  return item
}

function render() {
  if (!sheet || !sheet.isConnected) return
  const items = getItems()
  sheet.querySelectorAll('.nc-tab').forEach((t) => {
    const [key, label, kind] = TABS.find((x) => x[0] === t.dataset.tab)
    const n = items.filter((a) => a.kind === kind).length
    t.textContent = `${label} (${n})`
    t.setAttribute('aria-selected', String(key === activeTab))
  })
  renderBody()
}

// Body only — the tab counts don't change on a keystroke, so search re-renders just this.
function renderBody() {
  if (!sheet || !sheet.isConnected) return
  const kind = (TABS.find((x) => x[0] === activeTab) || TABS[0])[2]
  const list = getItems().filter((a) => a.kind === kind && matches(a, query))
  const body = sheet.querySelector('.nc-sheet__body')
  body.innerHTML = ''
  if (!list.length) {
    body.appendChild(el('div', 'nc-panel__empty', query
      ? `No ${activeTab} match “${query}”.`
      : `No ${activeTab} yet — select text in the reading to add some.`))
    return
  }
  // Group: current session first, then elsewhere in the book.
  const here = list.filter((a) => isCurrentSession(a))
  const elsewhere = list.filter((a) => !isCurrentSession(a))
  const addGroup = (label, arr) => {
    if (!arr.length) return
    if (here.length && elsewhere.length) body.appendChild(el('div', 'nc-panel__group', label))
    arr.forEach((a) => body.appendChild(itemFor(a)))
  }
  addGroup('This session', here)
  addGroup('Elsewhere in this book', elsewhere)
}

// ---------- export ----------
function bookName() {
  const p = (window.__READER_CTX && window.__READER_CTX.bookPath) || ''
  const seg = p.split('/').filter(Boolean).pop() || 'notes'
  return seg
}
function exportMarkdown() {
  const items = getItems()
  if (!items.length) { flashExport('Nothing to export yet'); return }
  const lines = [`# My notes — ${bookName()}`, '']
  for (const [, label, kind] of TABS) {
    const group = items.filter((a) => a.kind === kind)
    if (!group.length) continue
    lines.push(`## ${label}`, '')
    for (const a of group) {
      if (kind === 'note') lines.push(`- “${(a.ref || '').trim()}” — ${(a.body || '').trim()}`)
      else lines.push(`- “${(a.ref || '').trim()}”`)
    }
    lines.push('')
  }
  const md = lines.join('\n')
  const name = `${bookName().replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-notes.md`
  try {
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click()
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 500)
    flashExport('Exported')
  } catch (e) {
    try { navigator.clipboard.writeText(md); flashExport('Copied to clipboard') } catch { flashExport('Export failed') }
  }
}
function flashExport(msg) {
  const btn = sheet && sheet.querySelector('.nc-sheet__export')
  if (!btn) return
  const old = btn.title; btn.title = msg
  btn.classList.add('nc-iconbtn--ok'); setTimeout(() => { btn.classList.remove('nc-iconbtn--ok'); btn.title = old }, 1600)
}
