// "My Notes" page (/notes): everything the signed-in user has saved across ALL books —
// highlights, notes, bookmarks — grouped by book, searchable, with jump links + Markdown export.
// Rendered entirely client-side from the shared store (listAnnotations).
import { getClient, onUser } from './firebase.js'
import { el, warn } from './util.js'

const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const clip = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const bookLabel = (bookPath) => (String(bookPath || '').split('/').filter(Boolean).pop() || 'Notes')
const KIND_LABEL = { highlight: 'Highlights', note: 'Notes', bookmark: 'Bookmarks' }

export function mountMyNotes() {
  const host = document.getElementById('nc-mynotes')
  if (!host) return
  onUser(async (u, client) => {
    if (!client) {
      host.innerHTML = ''
      host.appendChild(el('p', 'nc-mynotes__empty', 'Sign in to see your notes across all books.'))
      const b = el('button', 'nc-btn nc-btn--primary', 'Sign in')
      b.onclick = () => document.dispatchEvent(new CustomEvent('nc:need-signin'))
      host.appendChild(b)
      return
    }
    host.innerHTML = '<p class="text-muted">Loading…</p>'
    let annots = []
    try { annots = await client.listAnnotations() } catch (e) { warn('mynotes', e); host.innerHTML = '<p class="text-muted">Could not load your notes.</p>'; return }
    render(host, annots)
  })
}

function render(host, annots) {
  host.innerHTML = ''
  const bar = el('div', 'nc-mynotes__bar')
  const search = el('input', 'nc-search'); search.type = 'search'; search.placeholder = 'Search all your notes…'
  const count = el('span', 'nc-mynotes__count', `${annots.length} saved`)
  const exportBtn = el('button', 'nc-btn', 'Export all'); exportBtn.onclick = () => exportMarkdown(annots)
  bar.append(search, count, exportBtn)
  host.appendChild(bar)
  const listWrap = el('div', 'nc-mynotes__list')
  host.appendChild(listWrap)

  const draw = (q) => {
    listWrap.innerHTML = ''
    const list = annots.filter((a) => !q || (`${a.ref || ''} ${a.body || ''}`).toLowerCase().includes(q))
    if (!list.length) {
      listWrap.appendChild(el('div', 'nc-panel__empty', q ? `No notes match “${q}”.` : 'No notes yet — highlight text while reading to save some.'))
      return
    }
    const byBook = new Map()
    for (const a of list) { const k = (a.locator && a.locator.bookPath) || '?'; if (!byBook.has(k)) byBook.set(k, []); byBook.get(k).push(a) }
    for (const [bookPath, items] of byBook) {
      const sec = el('div', 'nc-mynotes__book')
      sec.appendChild(el('div', 'nc-mynotes__book-title', bookLabel(bookPath)))
      items.forEach((a) => sec.appendChild(itemRow(a)))
      listWrap.appendChild(sec)
    }
  }
  search.addEventListener('input', () => draw(search.value.trim().toLowerCase()))
  draw('')
}

function itemRow(a) {
  const row = el('a', 'nc-mynotes__item')
  row.href = a.href || '#'
  const dotColor = a.kind === 'bookmark' ? 'accent' : (a.color || 'amber')
  row.innerHTML = (a.kind === 'note' ? '' : `<span class="nc-dot" style="background:var(--nc-${dotColor})"></span>`)
    + escapeHtml(clip(a.ref, 130))
    + (a.kind === 'note' && a.body ? `<div class="nc-mynotes__body">${escapeHtml(clip(a.body, 180))}</div>` : '')
  return row
}

function exportMarkdown(annots) {
  if (!annots.length) return
  const byBook = new Map()
  for (const a of annots) { const k = (a.locator && a.locator.bookPath) || '?'; if (!byBook.has(k)) byBook.set(k, []); byBook.get(k).push(a) }
  const lines = ['# My notes', '']
  for (const [bookPath, items] of byBook) {
    lines.push(`## ${bookLabel(bookPath)}`, '')
    for (const kind of ['highlight', 'note', 'bookmark']) {
      const group = items.filter((a) => a.kind === kind)
      if (!group.length) continue
      lines.push(`### ${KIND_LABEL[kind]}`)
      for (const a of group) lines.push(kind === 'note' ? `- “${(a.ref || '').trim()}” — ${(a.body || '').trim()}` : `- “${(a.ref || '').trim()}”`)
      lines.push('')
    }
  }
  const md = lines.join('\n')
  try {
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = el('a'); a.href = url; a.download = 'my-notes.md'; document.body.appendChild(a); a.click()
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 500)
  } catch (e) { try { navigator.clipboard.writeText(md) } catch { /* ignore */ } }
}
