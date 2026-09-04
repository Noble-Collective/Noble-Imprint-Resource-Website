// Reader per-user data layer (convergence Phase 1a) — answers + bookmarks.
//
// Bundled by esbuild into src/public/js/reader-userdata-bundle.js (see `npm run build:reader`) and
// loaded on session pages ONLY when FEATURE_USER_DATA is on. Entirely additive and self-contained:
// it initializes its OWN named Firebase app ('readerApp') on the shared convergence project
// (noble-imprint-463519), separate from the site's compat admin app. Any failure is swallowed so
// the (server-rendered) reading experience is never affected.
//
// Auth: Google popup. Store: client-direct Firestore via @noble-collective/userdata, under the
// security rules deployed to that project. Content keys come from window.__READER_CTX.

import { initializeApp } from 'firebase/app'
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence, connectAuthEmulator,
} from 'firebase/auth'
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { createUserDataClient } from '@noble-collective/userdata/client'
import { seriesLocator } from '@noble-collective/userdata/core'

// Public web config for the shared project (safe to embed — it's a client key).
const READER_CONFIG = {
  apiKey: 'AIzaSyC3dwU9dR59QncPWsSgHG2CQxg4_jVqbrc',
  authDomain: 'noble-imprint-463519.firebaseapp.com',
  projectId: 'noble-imprint-463519',
  appId: '1:160156401404:web:39385683295e00348de179',
  messagingSenderId: '160156401404',
  storageBucket: 'noble-imprint-463519.firebasestorage.app',
}

const SAVE_DEBOUNCE_MS = 900

const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
const debounce = (fn, ms) => {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}
const warn = (...a) => console.warn('[reader-userdata]', ...a)

function injectStyles() {
  const css = `
  .nc-bar{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin:0 0 1.4rem;padding:.6rem .85rem;
    border:1px solid rgba(0,0,0,.1);border-radius:8px;background:rgba(0,0,0,.02);font-size:.9rem}
  .nc-bar__msg{color:#555}
  .nc-bar__spacer{flex:1 1 auto}
  .nc-btn{cursor:pointer;border:1px solid rgba(0,0,0,.15);background:#fff;border-radius:6px;padding:.35rem .7rem;
    font:inherit;font-size:.85rem;color:#222}
  .nc-btn:hover{background:#f3f3f3}
  .nc-btn--primary{background:var(--accent,#2a6);color:#fff;border-color:transparent}
  .nc-bookmark[aria-pressed="true"]{background:var(--accent,#2a6);color:#fff;border-color:transparent}
  .nc-answer{margin:.5rem 0 .2rem}
  .nc-answer__ta{width:100%;box-sizing:border-box;min-height:3.2rem;padding:.55rem .65rem;border:1px solid rgba(0,0,0,.18);
    border-radius:6px;font:inherit;font-size:.95rem;resize:vertical;background:#fff}
  .nc-answer__ta:disabled{background:#f6f6f6;color:#999}
  .nc-answer__status{display:block;margin-top:.15rem;font-size:.75rem;color:#999;min-height:1em}
  `
  document.head.appendChild(el('style')).textContent = css
}

function buildBar(host) {
  const bar = el('div', 'nc-bar')
  const msg = el('span', 'nc-bar__msg', 'Sign in to save your answers and bookmarks.')
  const spacer = el('span', 'nc-bar__spacer')
  const bookmarkBtn = el('button', 'nc-btn nc-bookmark', '☆ Bookmark')
  bookmarkBtn.setAttribute('aria-pressed', 'false')
  bookmarkBtn.style.display = 'none'
  const signInBtn = el('button', 'nc-btn nc-btn--primary', 'Sign in with Google')
  const signOutBtn = el('button', 'nc-btn', 'Sign out')
  signOutBtn.style.display = 'none'
  bar.append(msg, spacer, bookmarkBtn, signInBtn, signOutBtn)
  host.insertBefore(bar, host.firstChild)
  return { bar, msg, bookmarkBtn, signInBtn, signOutBtn }
}

function collectQuestions() {
  const map = new Map()
  document.querySelectorAll('.question-block[data-question-id]').forEach((block) => {
    const id = block.getAttribute('data-question-id')
    if (!id || map.has(id)) return
    const wrap = el('div', 'nc-answer')
    const ta = el('textarea', 'nc-answer__ta')
    ta.rows = 2
    ta.placeholder = 'Sign in to write your answer…'
    ta.disabled = true
    const status = el('span', 'nc-answer__status', '')
    wrap.append(ta, status)
    block.appendChild(wrap)
    map.set(id, { ta, status })
  })
  return map
}

function main(ctx) {
  const host = document.querySelector('.session-content') || document.querySelector('#reading-content')
  if (!host) return
  injectStyles()
  const ui = buildBar(host)
  const questions = collectQuestions()

  const app = initializeApp(READER_CONFIG, 'readerApp')
  const auth = getAuth(app)
  // Target the dedicated converged database (NOT the app's legacy (default) DB), in the same
  // project so the uid is shared. Auto-detect long-polling avoids multi-second first-write stalls
  // on networks where Firestore's default streaming (WebChannel) transport is slow to establish.
  const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, 'collective-user-data')
  if (/[?&]ncEmu=1/.test(location.search)) {
    try { connectFirestoreEmulator(db, '127.0.0.1', 8080); connectAuthEmulator(auth, 'http://127.0.0.1:9099') } catch (e) { warn(e) }
  }
  setPersistence(auth, browserLocalPersistence).catch(() => {})

  const locFor = (questionId) =>
    seriesLocator(ctx.bookPath, ctx.sessionFile, { questionId, contentVersion: ctx.contentVersion || undefined })
  const bookmarkLoc = () => seriesLocator(ctx.bookPath, ctx.sessionFile)

  let client = null
  let bookmarkId = null

  ui.signInBtn.onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => warn('sign-in', e))
  ui.signOutBtn.onclick = () => signOut(auth).catch((e) => warn('sign-out', e))

  ui.bookmarkBtn.onclick = async () => {
    if (!client) return
    ui.bookmarkBtn.disabled = true
    try {
      if (bookmarkId) {
        await client.deleteAnnotation(bookmarkId)
        bookmarkId = null
      } else {
        bookmarkId = await client.putAnnotation({ kind: 'bookmark', locator: bookmarkLoc() })
      }
      paintBookmark()
    } catch (e) { warn('bookmark', e) } finally { ui.bookmarkBtn.disabled = false }
  }
  const paintBookmark = () => {
    const on = !!bookmarkId
    ui.bookmarkBtn.setAttribute('aria-pressed', String(on))
    ui.bookmarkBtn.textContent = on ? '★ Bookmarked' : '☆ Bookmark'
  }

  // Wire autosave on every answer field (guarded on being signed in).
  for (const [id, { ta, status }] of questions) {
    const save = debounce(async () => {
      if (!client) return
      status.textContent = 'Saving…'
      try {
        const v = ta.value.trim()
        if (v) await client.putAnswer(locFor(id), v)
        else await client.deleteAnswer(locFor(id))
        status.textContent = 'Saved'
      } catch (e) { warn('save answer', e); status.textContent = 'Save failed' }
    }, SAVE_DEBOUNCE_MS)
    ta.addEventListener('input', () => { status.textContent = 'Editing…'; save() })
  }

  const setSignedOut = () => {
    client = null
    bookmarkId = null
    ui.msg.textContent = 'Sign in to save your answers and bookmarks.'
    ui.signInBtn.style.display = ''
    ui.signOutBtn.style.display = 'none'
    ui.bookmarkBtn.style.display = 'none'
    for (const { ta, status } of questions.values()) {
      ta.disabled = true
      ta.placeholder = 'Sign in to write your answer…'
      status.textContent = ''
    }
  }

  const setSignedIn = async (user) => {
    client = createUserDataClient(db, user.uid)
    ui.msg.textContent = `Signed in as ${user.displayName || user.email}`
    ui.signInBtn.style.display = 'none'
    ui.signOutBtn.style.display = ''
    ui.bookmarkBtn.style.display = ''
    for (const { ta } of questions.values()) { ta.disabled = false; ta.placeholder = 'Write your answer…' }
    await Promise.all([loadAnswers(), loadBookmark()])
  }

  async function loadAnswers() {
    try {
      const answers = await client.listAnswers()
      const mine = new Map()
      for (const a of answers) {
        const l = a.locator || {}
        if (l.bookPath === ctx.bookPath && l.sessionFile === ctx.sessionFile && l.questionId) mine.set(l.questionId, a.answer)
      }
      for (const [id, { ta, status }] of questions) {
        if (mine.has(id)) { ta.value = mine.get(id); status.textContent = 'Saved' }
      }
    } catch (e) { warn('load answers', e) }
  }

  async function loadBookmark() {
    try {
      const list = await client.listAnnotations()
      const found = list.find((a) => a.kind === 'bookmark'
        && a.locator && a.locator.bookPath === ctx.bookPath && a.locator.sessionFile === ctx.sessionFile)
      bookmarkId = found ? found.id : null
      paintBookmark()
    } catch (e) { warn('load bookmark', e) }
  }

  onAuthStateChanged(auth, (user) => {
    if (user) setSignedIn(user).catch((e) => warn('signed-in', e))
    else setSignedOut()
  })
}

try {
  const ctx = window.__READER_CTX
  if (ctx && ctx.bookPath && ctx.sessionFile) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { main(ctx) } catch (e) { warn(e) } })
    else main(ctx)
  }
} catch (e) { warn('bootstrap', e) }
