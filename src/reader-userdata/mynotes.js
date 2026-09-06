// "My Notes" page (/notes): everything the signed-in user has saved across ALL books —
// highlights, notes, bookmarks — grouped by book, searchable, with jump links + Markdown export.
// Rendered entirely client-side from the shared store, live via onAnnotations + onAnswers.
import { getClient, onUser } from './firebase.js'
import { el, warn, safeColor, dedupeGroups } from './util.js'

const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const clip = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const bookLabel = (bookPath) => (String(bookPath || '').split('/').filter(Boolean).pop() || 'Notes')
const KIND_LABEL = { highlight: 'Highlights', note: 'Notes', bookmark: 'Bookmarks' }
const KINDS = [['highlight', 'Highlights'], ['note', 'Notes'], ['bookmark', 'Bookmarks']]
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
function countLabel(ann, ans) {
  const parts = KINDS.map(([k, l]) => [dedupeGroups(ann.filter((a) => a.kind === k)).length, l.slice(0, -1).toLowerCase()])
    .filter(([n]) => n > 0).map(([n, w]) => plural(n, w))
  if (ans && ans.length) parts.push(plural(ans.length, 'answer'))
  return parts.join(' · ') || 'no notes'
}

// LIVE (Phase 2.6): subscribe to annotations + answers so notes saved in another product/device
// appear here without a reload. We wait for BOTH initial snapshots before the first render, and
// preserve the search query + focus across live re-renders so typing isn't interrupted.
let mnUnsubs = []
let mnAnnots = null
let mnAnswers = null
export function mountMyNotes() {
  const host = document.getElementById('nc-mynotes')
  if (!host) return
  onUser((u, client) => {
    mnUnsubs.forEach((fn) => { try { fn() } catch { /* ignore */ } }); mnUnsubs = []
    mnAnnots = null; mnAnswers = null
    if (!client) {
      host.innerHTML = ''
      host.appendChild(el('p', 'nc-mynotes__empty', 'Sign in to see your notes across all books.'))
      const b = el('button', 'nc-btn nc-btn--primary', 'Sign in')
      b.onclick = () => document.dispatchEvent(new CustomEvent('nc:need-signin'))
      host.appendChild(b)
      return
    }
    host.innerHTML = '<p class="text-muted">Loading…</p>'
    mnUnsubs.push(client.onAnnotations((rows) => { mnAnnots = rows || []; maybeRenderMyNotes(host) }, (e) => warn('mynotes annotations', e)))
    mnUnsubs.push(client.onAnswers((rows) => { mnAnswers = rows || []; maybeRenderMyNotes(host) }, (e) => warn('mynotes answers', e)))
  })
}

function maybeRenderMyNotes(host) {
  if (mnAnnots == null || mnAnswers == null) return // hold until both initial snapshots land
  const prev = host.querySelector('.nc-search')
  const q = prev ? prev.value : ''
  const wasFocused = prev === document.activeElement
  render(host, mnAnnots, mnAnswers)
  const next = host.querySelector('.nc-search')
  if (next && q) { next.value = q; next.dispatchEvent(new Event('input')) }
  if (next && wasFocused) next.focus()
}

function render(host, annots, answers) {
  host.innerHTML = ''
  const bar = el('div', 'nc-mynotes__bar')
  const search = el('input', 'nc-search'); search.type = 'search'; search.placeholder = 'Search all your notes…'
  const count = el('span', 'nc-mynotes__count', `${annots.length + answers.length} saved`)
  const exportBtn = el('button', 'nc-mn-export', 'Export'); exportBtn.title = 'Export all as Markdown'; exportBtn.onclick = () => exportMarkdown(annots, answers)
  bar.append(search, count, exportBtn)
  host.appendChild(bar)
  const listWrap = el('div', 'nc-mynotes__list')
  host.appendChild(listWrap)

  const books = (typeof window !== 'undefined' && window.__NC_BOOKS) || {}
  const bookKey = (x) => (x.locator && x.locator.bookPath) || '?'
  const draw = (q) => {
    listWrap.innerHTML = ''
    const annMatch = annots.filter((a) => !q || (`${a.ref || ''} ${a.body || ''} ${a.title || ''}`).toLowerCase().includes(q))
    const ansMatch = answers.filter((a) => !q || (`${a.answer || ''} ${a.questionText || ''} ${a.sessionTitle || ''}`).toLowerCase().includes(q))
    if (!annMatch.length && !ansMatch.length) {
      listWrap.appendChild(el('div', 'nc-panel__empty', q ? `Nothing matches “${q}”.` : 'Nothing saved yet — highlight text or answer a question while reading.'))
      return
    }
    const byBook = new Map()
    const push = (k, kind, x) => { if (!byBook.has(k)) byBook.set(k, { ann: [], ans: [] }); byBook.get(k)[kind].push(x) }
    for (const a of annMatch) push(bookKey(a), 'ann', a)
    for (const a of ansMatch) push(bookKey(a), 'ans', a)
    for (const [bookPath, groups] of byBook) {
      const meta = books[bookPath] || {}
      const d = el('details', 'nc-mn-book')
      d.open = !!q || byBook.size === 1
      const sum = el('summary', 'nc-mn-book__sum')
      const cover = el('span', 'nc-mn-book__cover' + (meta.cover ? '' : ' nc-mn-book__cover--none'))
      if (meta.cover) { const img = el('img'); img.src = '/cover/' + meta.cover; img.alt = ''; img.loading = 'lazy'; cover.appendChild(img) }
      sum.appendChild(cover)
      const info = el('div', 'nc-mn-book__info')
      info.appendChild(el('div', 'nc-mn-book__title', meta.title || bookLabel(bookPath)))
      info.appendChild(el('div', 'nc-mn-book__count', countLabel(groups.ann, groups.ans)))
      sum.appendChild(info)
      sum.appendChild(el('span', 'nc-mn-book__chevron'))
      d.appendChild(sum)
      const body = el('div', 'nc-mn-book__body')
      for (const [kind, label] of KINDS) {
        const grp = dedupeGroups(groups.ann.filter((a) => a.kind === kind))
        if (!grp.length) continue
        body.appendChild(el('div', 'nc-mn-kind', label))
        grp.forEach((a) => body.appendChild(itemRow(a)))
      }
      if (groups.ans.length) {
        body.appendChild(el('div', 'nc-mn-kind', 'Answers'))
        groups.ans.forEach((a) => body.appendChild(answerRow(a)))
      }
      d.appendChild(body)
      listWrap.appendChild(d)
    }
  }
  search.addEventListener('input', () => draw(search.value.trim().toLowerCase()))
  draw('')
}

function sessLabel(x) { return x.title || x.sessionTitle ? `<div class="nc-mynotes__sess">${escapeHtml(x.title || x.sessionTitle)}</div>` : '' }

function itemRow(a) {
  const row = el('a', 'nc-mynotes__item')
  row.href = a.href || '#'
  const dotColor = a.kind === 'bookmark' ? 'accent' : safeColor(a.color || 'amber')
  row.innerHTML = (a.kind === 'note' ? '' : `<span class="nc-dot" style="background:var(--nc-${dotColor})"></span>`)
    + escapeHtml(clip(a.ref, 130))
    + (a.kind === 'note' && a.body ? `<div class="nc-mynotes__body">${escapeHtml(clip(a.body, 180))}</div>` : '')
    + sessLabel(a)
  return row
}

function answerRow(a) {
  const row = el('a', 'nc-mynotes__item')
  row.href = a.href || '#'
  row.innerHTML = (a.questionText ? `<div class="nc-mynotes__q">${escapeHtml(clip(a.questionText, 130))}</div>` : '')
    + `<div class="nc-mynotes__ans">${escapeHtml(clip(a.answer, 220))}</div>`
    + sessLabel(a)
  return row
}

function exportMarkdown(annots, answers) {
  if (!annots.length && !answers.length) return
  const books = (typeof window !== 'undefined' && window.__NC_BOOKS) || {}
  const byBook = new Map()
  const ensure = (k) => { if (!byBook.has(k)) byBook.set(k, { ann: [], ans: [] }); return byBook.get(k) }
  for (const a of annots) ensure((a.locator && a.locator.bookPath) || '?').ann.push(a)
  for (const a of answers) ensure((a.locator && a.locator.bookPath) || '?').ans.push(a)
  const lines = ['# My Notebooks', '']
  for (const [bookPath, groups] of byBook) {
    lines.push(`## ${(books[bookPath] && books[bookPath].title) || bookLabel(bookPath)}`, '')
    for (const kind of ['highlight', 'note', 'bookmark']) {
      const group = dedupeGroups(groups.ann.filter((a) => a.kind === kind))
      if (!group.length) continue
      lines.push(`### ${KIND_LABEL[kind]}`)
      for (const a of group) lines.push(kind === 'note' ? `- “${(a.ref || '').trim()}” — ${(a.body || '').trim()}` : `- “${(a.ref || '').trim()}”`)
      lines.push('')
    }
    if (groups.ans.length) {
      lines.push('### Answers')
      for (const a of groups.ans) lines.push(`- ${a.questionText ? `**${a.questionText.trim()}** — ` : ''}${(a.answer || '').trim()}`)
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
