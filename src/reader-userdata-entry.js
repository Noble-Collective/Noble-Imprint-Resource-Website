// Reader per-user data layer (convergence) — entry point. Bundled by esbuild into
// src/public/js/reader-userdata-bundle.js and loaded on session pages only when FEATURE_USER_DATA
// is on. Wires the top bar + settings + answers + highlights/notes/bookmarks + library. Entirely
// additive and self-contained; any failure is swallowed so reading is never affected.
import { injectStyles } from './reader-userdata/styles.js'
import { applyCachedSettings, initSettings, toggleSettingsMenu } from './reader-userdata/settings.js'
import { initFirebase, onUser, signIn, doSignOut } from './reader-userdata/firebase.js'
import { initAnswers } from './reader-userdata/answers.js'
import { initAnnotations } from './reader-userdata/annotations.js'
import { openLibrary } from './reader-userdata/library.js'
import { el, ICONS, warn } from './reader-userdata/util.js'

function buildBar(root) {
  const bar = el('div', 'nc-bar')
  bar.setAttribute('data-nc-skip', '')
  const msg = el('span', 'nc-bar__msg', 'Sign in to save your highlights, notes & answers.')
  const spacer = el('span', 'nc-bar__spacer')
  const libBtn = el('button', 'nc-btn')
  libBtn.innerHTML = `${ICONS.list}<span>Library</span>`
  libBtn.style.display = 'none'
  libBtn.onclick = () => openLibrary()
  const gear = el('button', 'nc-iconbtn')
  gear.setAttribute('data-nc-settings-btn', '')
  gear.title = 'Reading settings'
  gear.innerHTML = ICONS.gear
  gear.onclick = () => toggleSettingsMenu(gear)
  const signInBtn = el('button', 'nc-btn nc-btn--primary', 'Sign in with Google')
  signInBtn.onclick = () => signIn()
  const signOutBtn = el('button', 'nc-btn', 'Sign out')
  signOutBtn.style.display = 'none'
  signOutBtn.onclick = () => doSignOut()
  bar.append(msg, spacer, libBtn, gear, signInBtn, signOutBtn)
  root.parentNode.insertBefore(bar, root)
  onUser((u) => {
    if (u) {
      msg.textContent = `Signed in as ${u.displayName || u.email}`
      signInBtn.style.display = 'none'; signOutBtn.style.display = ''; libBtn.style.display = ''
    } else {
      msg.textContent = 'Sign in to save your highlights, notes & answers.'
      signInBtn.style.display = ''; signOutBtn.style.display = 'none'; libBtn.style.display = 'none'
    }
  })
}

function boot() {
  const root = document.querySelector('.session-content')
  if (!root) return
  const ctx = window.__READER_CTX
  ctx.root = root
  injectStyles()
  initFirebase()
  initSettings()
  buildBar(root)
  initAnswers(ctx)
  initAnnotations(ctx)
}

try {
  const ctx = window.__READER_CTX
  if (ctx && ctx.bookPath && ctx.sessionFile) {
    applyCachedSettings() // instant theme/text-size, before sign-in
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { boot() } catch (e) { warn(e) } })
    else boot()
  }
} catch (e) { warn('bootstrap', e) }
