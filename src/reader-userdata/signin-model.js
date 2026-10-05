// Pure pieces of the sign-in experience (web sign-in plan P3, Collective-Shared
// plans/2026-10-05-common-web-sign-in.md §2a/§2b): this site's copy, the "Get the app" link, the held
// action, and the home "Continue reading" cards. No Firebase here, so it's unit-tested directly.
import { continueCandidates, dashboardBookKey, relativeWhen, isRelayEmail, CONNECTED_ACCOUNTS } from '@noble-collective/userdata/core'

// /sign-in page panel (res-flow-2). The benefit line is this site's own (§2a), never the app's.
export const PAGE_COPY = {
  eyebrow: 'Noble Imprint Resources',
  title: 'Sign in',
  benefit: 'Sign in to pick up any book where you left off on any device, with your highlights, notes, bookmarks and answers.',
  fine: 'Use the same sign-in as the Noble Imprint app and everything lines up.',
}

export const HELD_KINDS = ['highlight', 'note', 'bookmark', 'answer']

// The in-place sheet (res-flow-phone-sheet): named after the action that opened it, else plain.
export function sheetCopy(kind) {
  // eyebrow '' = none (the controller's default copy is the /sign-in page's, which has one).
  if (!HELD_KINDS.includes(kind)) return { eyebrow: '', title: 'Sign in', benefit: PAGE_COPY.benefit, fine: PAGE_COPY.fine }
  return {
    eyebrow: '',
    title: `Sign in to save this ${kind}`,
    benefit: `Sign in to save this ${kind} and pick up this book where you left off, here or in the Noble Imprint app.`,
    fine: kind === 'answer' ? 'Your answer box opens as soon as you sign in.' : `Your ${kind} is kept and saved as soon as you sign in.`,
  }
}

export const APP_STORE_URL = 'https://apps.apple.com/app/id6745697286'
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.noblecollective.noble_imprint'

/** "Get the app": Google Play on Android, else the App Store (iPhone/iPad, and its web listing on desktop). */
export function appLink(ua) {
  return /Android/i.test(String(ua || '')) ? PLAY_URL : APP_STORE_URL
}

/**
 * The action a signed-out reader tried (Highlight/Note/Bookmark/Answer). Kept in memory while the
 * sign-in sheet is open; completed exactly once after a successful sign-in; discarded on cancel or
 * failure. A newer hold replaces an older one.
 */
export function createHeld() {
  let held = null
  return {
    hold(kind, run) { held = { kind, run } },
    kind: () => (held ? held.kind : null),
    discard() { held = null },
    async complete() {
      const h = held
      held = null
      if (!h) return
      try { await h.run() } catch (e) { console.warn('[reader-userdata]', 'held action', e) }
    },
  }
}

/** The account button's initials (res-flow-3 "JW"): first + last word of a name, else one letter. */
export function initialsOf(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  if (s.includes('@')) return s[0].toUpperCase()
  const words = s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
  if (!words.length) return s[0].toUpperCase()
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return (first + last).toUpperCase()
}

/** An Apple Hide-My-Email address is shown as "Hidden by Apple" (contract copy), never raw. */
export function displayEmail(email) {
  return isRelayEmail(email) ? CONNECTED_ACCOUNTS.hiddenByApple : String(email || '')
}

/** The activity doc's titles from the session page's tab title ("Session — Book | Site"). */
export function activityTitles(docTitle) {
  const [sessionTitle, bookTitle] = String(docTitle || '').replace(/\s+\|\s+Noble Collective Resources\s*$/, '').split(' — ')
  return { title: (sessionTitle || '').trim() || 'Session', bookTitle: (bookTitle || '').trim() || undefined }
}

export function signedInToast(name) {
  const n = String(name || '').trim()
  return n ? `Signed in as ${n}. Your library is in sync.` : 'Signed in. Your library is in sync.'
}

const WHERE = {
  app: ['On your phone', 'phone'],
  'resources-web': ['Here', 'laptop'],
  'coram-deo': ['On Coram Deo', 'laptop'],
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Home "Continue reading" cards (res-flow-3): the newest read per book (the shared dashboard
 * candidates + book key, so the app and this site agree), at most 6. `shelf` = the server's per-book data
 * (signin-page.js shelfFromTree). Only real data is shown: the source label comes from the activity
 * doc, the bar only when the session is numbered in a book on the shelf. Items this site can't link
 * to (the app's Bible reads, hidden books) are dropped.
 */
export function continueCards(acts, shelf, now, tzOffsetMinutes = 0) {
  const items = continueCandidates({ activity: acts || [] })
  const seen = new Set()
  const byKey = new Map()
  const byPath = new Map()
  for (const b of shelf || []) {
    if (b.key) byKey.set(b.key, b)
    if (b.path) byPath.set(b.path, b)
  }
  const out = []
  for (const it of items) {
    const loc = it.locator || {}
    const book = loc.corpus === 'series' ? (loc.bookKey && byKey.get(loc.bookKey)) || byPath.get(loc.bookPath) || null : null
    let href = it.href || null
    if (!href && book && book.key && loc.sessionFile) {
      href = `/s/${encodeURIComponent(book.key)}/${encodeURIComponent(String(loc.sessionFile).replace(/\.md$/, ''))}`
    }
    // Linkable first, THEN one per book: an app-only Bible read mustn't hide a linkable one.
    if (!href) continue
    const bookId = dashboardBookKey(loc)
    if (seen.has(bookId)) continue
    seen.add(bookId)
    const [where, device] = WHERE[it.source] || [null, null]
    const n = book && loc.sessionFile ? book.order[loc.sessionFile] : undefined
    // The shelf's title is the book's real one (older web docs stored the tab title's site suffix).
    out.push({
      href,
      title: it.title || '',
      bookTitle: (book && book.title) || it.bookTitle || '',
      cover: (book && book.cover) || null,
      where,
      device,
      when: cap(relativeWhen(it.at, now, tzOffsetMinutes)),
      progress: n && book.total ? { n, total: book.total } : null,
    })
    if (out.length >= 6) break
  }
  return out
}
