// "Notebook" slide-out panel: the whole BOOK's highlights, notes, bookmarks, and (current-session)
// answers. Current-session items scroll to their mark; other-session items navigate to their page.
// Each item has a delete icon. Opens focused on a specific item when requested (e.g. a bookmark tap).
import { el, ICONS } from './util.js'
import { getItems, subscribeItems, removeById, isCurrentSession } from './annotations.js'
import { getAnswers, scrollToQuestion, onAnswers } from './answers.js'

let panel = null
let backdrop = null
let subscribed = false

const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'))
const clip = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const dot = (color) => `<span class="nc-dot" style="background:var(--nc-${color})"></span>`

// Bookmark taps (and other callers) ask to open the notebook focused on an item.
document.addEventListener('nc:open-notebook', (e) => openLibrary(e && e.detail && e.detail.focusId))

export function openLibrary(focusId) {
  if (panel) { if (focusId) focusItem(focusId); else closeLibrary(); return }
  backdrop = el('div', 'nc-backdrop'); backdrop.setAttribute('data-nc-skip', ''); backdrop.onclick = closeLibrary
  panel = el('div', 'nc-panel'); panel.setAttribute('data-nc-skip', '')
  const head = el('div', 'nc-panel__head')
  head.appendChild(el('div', 'nc-panel__title', 'My Notebook'))
  const close = el('button', 'nc-iconbtn'); close.innerHTML = ICONS.close; close.onclick = closeLibrary
  head.appendChild(close)
  const body = el('div', 'nc-panel__body')
  panel.append(head, body)
  document.body.append(backdrop, panel)
  requestAnimationFrame(() => { backdrop.classList.add('open'); panel.classList.add('open') })
  const rerender = () => { if (body.isConnected) render(body) }
  render(body)
  if (!subscribed) { subscribeItems(rerender); onAnswers(rerender); subscribed = true }
  if (focusId) setTimeout(() => focusItem(focusId), 280)
}

function closeLibrary() {
  const p = panel; const b = backdrop
  panel = null; backdrop = null
  p?.classList.remove('open'); b?.classList.remove('open')
  setTimeout(() => { p?.remove(); b?.remove() }, 240)
}

function focusItem(id) {
  const node = panel && panel.querySelector(`.nc-panel__item[data-annot-id="${esc(id)}"]`)
  if (!node) return
  node.scrollIntoView({ block: 'center' })
  node.classList.add('nc-panel__item--focus')
  setTimeout(() => node.classList.remove('nc-panel__item--focus'), 2400)
}

function scrollToMark(id) {
  const m = document.querySelector(`mark[data-annot-id="${esc(id)}"], .nc-bm-marker[data-annot-id="${esc(id)}"]`)
  if (m) { closeLibrary(); m.scrollIntoView({ behavior: 'smooth', block: 'center' }); const t = m.closest('p, li, h1, h2, h3, h4, blockquote') || m; t.classList.add('nc-flash'); setTimeout(() => t.classList.remove('nc-flash'), 1600) }
}

function annotItem(a, dotHtml, body) {
  const item = el('div', 'nc-panel__item')
  item.dataset.annotId = a.id
  const main = el('button', 'nc-panel__main')
  main.innerHTML = (dotHtml || '') + escapeHtml(clip(a.ref, 90))
    + (body ? `<div class="nc-panel__q" style="margin-top:.2rem">${escapeHtml(clip(body, 120))}</div>` : '')
    + (isCurrentSession(a) ? '' : '<div class="nc-panel__sess">Open in its session ↗</div>')
  main.onclick = () => { if (isCurrentSession(a)) scrollToMark(a.id); else if (a.href) window.location.href = a.href }
  const del = el('button', 'nc-panel__del'); del.title = 'Delete'; del.innerHTML = ICONS.trash
  del.onclick = (e) => { e.stopPropagation(); removeById(a.id); render(panel.querySelector('.nc-panel__body')) }
  item.append(main, del)
  return item
}
function answerItem(id, v) {
  const item = el('div', 'nc-panel__item')
  const main = el('button', 'nc-panel__main')
  main.innerHTML = `<div class="nc-panel__q">Reflection answer</div>${escapeHtml(clip(v, 120))}`
  main.onclick = () => { closeLibrary(); scrollToQuestion(id) }
  item.append(main)
  return item
}

function section(body, title, els) {
  const sec = el('div', 'nc-panel__section')
  sec.appendChild(el('div', 'nc-panel__h', `${title} (${els.length})`))
  if (els.length === 0) sec.appendChild(el('div', 'nc-panel__empty', 'None yet.'))
  else els.forEach((e) => sec.appendChild(e))
  body.appendChild(sec)
}

function render(body) {
  if (!body) return
  body.innerHTML = ''
  const items = getItems()
  const hl = items.filter((a) => a.kind === 'highlight')
  const notes = items.filter((a) => a.kind === 'note')
  const bms = items.filter((a) => a.kind === 'bookmark')
  const answers = [...getAnswers().entries()].filter(([, v]) => v)
  section(body, 'Highlights', hl.map((a) => annotItem(a, dot(a.color || 'amber'))))
  section(body, 'Notes', notes.map((a) => annotItem(a, null, a.body)))
  section(body, 'Bookmarks', bms.map((a) => annotItem(a, dot('accent'))))
  section(body, 'Answers', answers.map(([id, v]) => answerItem(id, v)))
}
