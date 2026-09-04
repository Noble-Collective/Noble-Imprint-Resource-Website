// "My Library" slide-out panel: this session's highlights, notes, bookmarks, and answers, each
// clickable to scroll to it. Mirrors Coram Deo's My Library sectioning.
import { el, ICONS } from './util.js'
import { getItems, subscribeItems } from './annotations.js'
import { getAnswers, scrollToQuestion, onAnswers } from './answers.js'

let panel = null
let backdrop = null

const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'))

export function openLibrary() {
  if (panel) { closeLibrary(); return }
  backdrop = el('div', 'nc-backdrop'); backdrop.setAttribute('data-nc-skip', ''); backdrop.onclick = closeLibrary
  panel = el('div', 'nc-panel'); panel.setAttribute('data-nc-skip', '')
  const head = el('div', 'nc-panel__head')
  head.appendChild(el('div', 'nc-panel__title', 'My Library'))
  const close = el('button', 'nc-iconbtn'); close.innerHTML = ICONS.close; close.onclick = closeLibrary
  head.appendChild(close)
  const body = el('div', 'nc-panel__body')
  panel.append(head, body)
  document.body.append(backdrop, panel)
  requestAnimationFrame(() => { backdrop.classList.add('open'); panel.classList.add('open') })
  const rerender = () => { if (body.isConnected) render(body) }
  render(body)
  subscribeItems(rerender)
  onAnswers(rerender)
}

function closeLibrary() {
  const p = panel; const b = backdrop
  panel = null; backdrop = null
  p?.classList.remove('open'); b?.classList.remove('open')
  setTimeout(() => { p?.remove(); b?.remove() }, 240)
}

function scrollToMark(id) {
  const m = document.querySelector(`mark[data-annot-id="${esc(id)}"], .nc-bm-marker[data-annot-id="${esc(id)}"]`)
  if (m) { closeLibrary(); m.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(m) }
}
function flash(node) {
  const target = node.closest('p, li, h1, h2, h3, h4, blockquote') || node
  target.classList.add('nc-flash'); setTimeout(() => target.classList.remove('nc-flash'), 1600)
}

function itemBtn(inner, onClick) {
  const b = el('button', 'nc-panel__item')
  b.innerHTML = inner
  b.onclick = onClick
  return b
}
function clip(s, n) { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }

function section(body, title, els) {
  const sec = el('div', 'nc-panel__section')
  sec.appendChild(el('div', 'nc-panel__h', `${title} (${els.length})`))
  if (els.length === 0) sec.appendChild(el('div', 'nc-panel__empty', 'None yet.'))
  else els.forEach((e) => sec.appendChild(e))
  body.appendChild(sec)
}

function render(body) {
  body.innerHTML = ''
  const items = getItems()
  const hl = items.filter((a) => a.kind === 'highlight')
  const notes = items.filter((a) => a.kind === 'note')
  const bms = items.filter((a) => a.kind === 'bookmark')
  const answers = [...getAnswers().entries()].filter(([, v]) => v)

  section(body, 'Highlights', hl.map((a) => itemBtn(
    `<span class="nc-dot" style="background:var(--nc-${a.color || 'amber'})"></span>${escapeHtml(clip(a.ref, 90))}`,
    () => scrollToMark(a.id),
  )))
  section(body, 'Notes', notes.map((a) => itemBtn(
    `<div class="nc-panel__q">${escapeHtml(clip(a.ref, 70))}</div>${escapeHtml(clip(a.body, 120))}`,
    () => scrollToMark(a.id),
  )))
  section(body, 'Bookmarks', bms.map((a) => itemBtn(
    `<span class="nc-dot" style="background:var(--nc-accent)"></span>${escapeHtml(clip(a.ref, 90))}`,
    () => scrollToMark(a.id),
  )))
  section(body, 'Answers', answers.map(([id, v]) => itemBtn(
    `<div class="nc-panel__q">Reflection answer</div>${escapeHtml(clip(v, 120))}`,
    () => { closeLibrary(); scrollToQuestion(id) },
  )))
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
