// "Continue reading" — records each session view as shared activity, and renders a resume strip on
// the home page. Storage lives in the shared SDK (recordActivity/listActivity), so other readers
// (Coram Deo, the app) can offer the same feature from the same data.
import { seriesLocator } from '@noble-collective/userdata/core'
import { getClient, onUser } from './firebase.js'
import { el, warn } from './util.js'

const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// On a session page: record that it was viewed (session title + book title + resume URL).
export function recordReading(ctx) {
  onUser(async (u, client) => {
    if (!client || !ctx || !ctx.bookPath || !ctx.sessionFile) return
    const [sessionTitle, bookTitle] = (document.title || '').split(' — ')
    try {
      await client.recordActivity(seriesLocator(ctx.bookPath, ctx.sessionFile), {
        title: (sessionTitle || 'Session').trim(),
        bookTitle: (bookTitle || '').trim() || undefined,
        href: location.pathname,
      })
    } catch (e) { warn('recordActivity', e) }
  })
}

// On the home page: a "Continue reading" strip — the most recently-viewed session per book.
export function mountContinueReading() {
  const main = document.querySelector('.main')
  if (!main) return
  onUser(async (u, client) => {
    document.querySelector('.nc-continue')?.remove()
    if (!client) return
    let acts
    try { acts = await client.listActivity() } catch (e) { warn('listActivity', e); return }
    if (!acts || !acts.length) return
    // newest per book
    const byBook = new Map()
    for (const a of acts) {
      const key = (a.locator && a.locator.bookPath) || a.id
      const prev = byBook.get(key)
      if (!prev || (a.viewedAt || 0) > (prev.viewedAt || 0)) byBook.set(key, a)
    }
    const list = [...byBook.values()].filter((a) => a.href).sort((x, y) => (y.viewedAt || 0) - (x.viewedAt || 0)).slice(0, 6)
    if (!list.length) return
    if (document.querySelector('.nc-continue')) return
    const sec = el('section', 'nc-continue')
    sec.setAttribute('data-nc-skip', '')
    sec.appendChild(el('div', 'nc-continue__title', 'Continue reading'))
    const row = el('div', 'nc-continue__row')
    for (const a of list) {
      const card = el('a', 'nc-continue__card')
      card.href = a.href
      card.innerHTML = `<div class="nc-continue__book">${escapeHtml(a.bookTitle || 'Continue')}</div>`
        + `<div class="nc-continue__sess">${escapeHtml(a.title || '')}</div>`
      row.appendChild(card)
    }
    sec.appendChild(row)
    main.insertBefore(sec, main.firstChild)
  })
}
