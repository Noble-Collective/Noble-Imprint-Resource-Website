// "Continue reading" — records each session view as shared activity, and renders a resume strip on
// the home page. Storage lives in the shared SDK (recordActivity/listActivity), so other readers
// (Coram Deo, the app) can offer the same feature from the same data.
import { seriesLocator } from '@noble-collective/userdata/core'
import { getClient, onUser } from './firebase.js'
import { el, warn } from './util.js'
import { continueCards, activityTitles } from './signin-model.js'

const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// On a session page: record that it was viewed (session title + book title + resume URL).
// Re-entrant: records the CURRENT session immediately if signed in (so AJAX in-book nav updates
// "Continue reading"), and subscribes to auth exactly once (for the initial sign-in).
let recCtx = null
let recWired = false
async function recordNow(client) {
  client = client || getClient()
  if (!client || !recCtx || !recCtx.bookPath || !recCtx.sessionFile) return
  const { title, bookTitle } = activityTitles(document.title)
  try {
    await client.recordActivity(seriesLocator(recCtx.bookPath, recCtx.sessionFile, { bookKey: recCtx.bookKey || undefined }), {
      title,
      bookTitle,
      href: location.pathname,
      // Lets the shared Home dashboard say "On the website" (Collective-Shared core/dashboard.ts).
      source: 'resources-web',
    })
  } catch (e) { warn('recordActivity', e) }
}
export function recordReading(ctx) {
  recCtx = ctx
  recordNow()
  if (!recWired) { recWired = true; onUser((u, client) => recordNow(client)) }
}

// On the home page: a "Continue reading" strip — the most recently-viewed session per book.
// LIVE (Phase 2.6): subscribes to activity so viewing a session in another product (Coram Deo,
// the app) updates the strip here without a reload. One subscription per signed-in session.
let actUnsub = null
export function mountContinueReading() {
  const main = document.querySelector('.main')
  if (!main) return
  onUser((u, client) => {
    if (actUnsub) { actUnsub(); actUnsub = null } // never leak across auth changes
    document.querySelector('.nc-continue')?.remove()
    if (!client) return
    actUnsub = client.onActivity((acts) => renderContinue(main, acts || []), (e) => warn('activity subscription', e))
  })
}

// Rebuild the strip from the whole snapshot (REPLACE, never append). res-flow-3: cover, where it was
// last read (the app vs here), a "session n of N" bar, the sync note. signin-model.js continueCards
// decides what's shown (only real data); window.__NC_SHELF = the server's per-book covers + order.
const DEVICE_ICONS = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  laptop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M1 20h22"/></svg>',
}
const SYNC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4M6 22v-4h4"/></svg>'

function renderContinue(main, acts) {
  document.querySelector('.nc-continue')?.remove()
  const cards = continueCards(acts, window.__NC_SHELF || [], Date.now(), -new Date().getTimezoneOffset())
  if (!cards.length) return
  const sec = el('section', 'nc-continue')
  sec.setAttribute('data-nc-skip', '')
  sec.setAttribute('aria-label', 'Continue reading')
  sec.innerHTML = `<div class="nc-continue__head"><h2 class="nc-continue__title">Continue reading</h2>`
    + `<span class="nc-continue__sync">${SYNC_ICON}Synced with the Noble Imprint app</span></div>`
  const row = el('div', 'nc-continue__row')
  for (const c of cards) {
    const card = el('a', 'nc-continue__card')
    card.href = c.href
    const cover = c.cover ? `<img class="nc-continue__cover" src="${escapeHtml(c.cover)}" alt="" loading="lazy">` : '<span class="nc-continue__cover nc-continue__cover--none"></span>'
    const where = c.where ? `<div class="nc-continue__where">${DEVICE_ICONS[c.device] || ''}${escapeHtml(c.where)} · ${escapeHtml(c.when)}</div>` : ''
    const bar = c.progress
      ? `<div class="nc-continue__bar" role="img" aria-label="Session ${c.progress.n} of ${c.progress.total}" title="Session ${c.progress.n} of ${c.progress.total}"><i style="width:${Math.round((100 * c.progress.n) / c.progress.total)}%"></i></div>`
      : ''
    card.innerHTML = cover + `<div class="nc-continue__info"><div class="nc-continue__book">${escapeHtml(c.bookTitle || 'Continue')}</div>`
      + `<div class="nc-continue__sess">${escapeHtml(c.title)}</div>${where}${bar}</div>`
    row.appendChild(card)
  }
  sec.appendChild(row)
  // The "Continue reading" slot: under the page title + subtitle and the library search box (where the
  // signed-out prompt sits).
  const sub = main.querySelector(':scope > .nc-libsearch') || main.querySelector(':scope > .page-subtitle')
  if (sub) sub.after(sec)
  else main.insertBefore(sec, main.firstChild)
}
