// "My Notebook" — a bottom sheet with Highlights / Notes / Bookmarks tabs (like the mobile app),
// spanning the whole book. Current-session items scroll to their mark; other-session items navigate
// to their page. Each item has a delete icon. Opens focused on a specific item when asked
// (e.g. tapping a bookmark opens the Bookmarks tab on that item).
import { el, ICONS } from './util.js'
import { getItems, subscribeItems, removeById, isCurrentSession } from './annotations.js'

let sheet = null
let backdrop = null
let activeTab = 'highlights'
let subscribed = false

const TABS = [['highlights', 'Highlights', 'highlight'], ['notes', 'Notes', 'note'], ['bookmarks', 'Bookmarks', 'bookmark']]
const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'))
const clip = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const dot = (color) => `<span class="nc-dot" style="background:var(--nc-${color})"></span>`
const tabForKind = (k) => (k === 'highlight' ? 'highlights' : k === 'note' ? 'notes' : 'bookmarks')

document.addEventListener('nc:open-notebook', (e) => openLibrary(e && e.detail && e.detail.focusId))

export function openLibrary(focusId) {
  if (focusId) { const a = getItems().find((x) => x.id === focusId); if (a) activeTab = tabForKind(a.kind) }
  if (sheet) { render(); if (focusId) setTimeout(() => focusItem(focusId), 60); return }
  backdrop = el('div', 'nc-backdrop'); backdrop.setAttribute('data-nc-skip', ''); backdrop.onclick = closeSheet
  sheet = el('div', 'nc-sheet'); sheet.setAttribute('data-nc-skip', '')
  const grip = el('div', 'nc-sheet__grip')
  const head = el('div', 'nc-sheet__head')
  head.appendChild(el('div', 'nc-panel__title', 'My Notebook'))
  const close = el('button', 'nc-iconbtn'); close.innerHTML = ICONS.close; close.onclick = closeSheet
  head.appendChild(close)
  const tabs = el('div', 'nc-sheet__tabs')
  for (const [key] of TABS) {
    const t = el('button', 'nc-tab'); t.dataset.tab = key
    t.onclick = () => { activeTab = key; render() }
    tabs.appendChild(t)
  }
  const body = el('div', 'nc-sheet__body')
  sheet.append(grip, head, tabs, body)
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
  if (m) { closeSheet(); m.scrollIntoView({ behavior: 'smooth', block: 'center' }); const t = m.closest('p, li, h1, h2, h3, h4, blockquote') || m; t.classList.add('nc-flash'); setTimeout(() => t.classList.remove('nc-flash'), 1600) }
}
function focusItem(id) {
  const node = sheet && sheet.querySelector(`.nc-panel__item[data-annot-id="${esc(id)}"]`)
  if (!node) return
  node.scrollIntoView({ block: 'center' })
  node.classList.add('nc-panel__item--focus'); setTimeout(() => node.classList.remove('nc-panel__item--focus'), 2400)
}

function itemFor(a) {
  const item = el('div', 'nc-panel__item')
  item.dataset.annotId = a.id
  const main = el('button', 'nc-panel__main')
  main.innerHTML = (a.kind === 'note' ? '' : dot(a.kind === 'bookmark' ? 'accent' : (a.color || 'amber')))
    + escapeHtml(clip(a.ref, 90))
    + (a.kind === 'note' && a.body ? `<div class="nc-panel__q" style="margin-top:.2rem">${escapeHtml(clip(a.body, 130))}</div>` : '')
    + (isCurrentSession(a) ? '' : '<div class="nc-panel__sess">Open in its session ↗</div>')
  main.onclick = () => { if (isCurrentSession(a)) scrollToMark(a.id); else if (a.href) window.location.href = a.href }
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
  const kind = (TABS.find((x) => x[0] === activeTab) || TABS[0])[2]
  const list = items.filter((a) => a.kind === kind)
  const body = sheet.querySelector('.nc-sheet__body')
  body.innerHTML = ''
  if (!list.length) { body.appendChild(el('div', 'nc-panel__empty', `No ${activeTab} yet — select text in the reading to add some.`)); return }
  list.forEach((a) => body.appendChild(itemFor(a)))
}
