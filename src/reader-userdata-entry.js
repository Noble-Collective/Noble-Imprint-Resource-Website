// Reader per-user data layer (convergence) — entry point. Bundled by esbuild into
// src/public/js/reader-userdata-bundle.js and loaded on session pages only when FEATURE_USER_DATA
// is on. Injects a control cluster (Notebook · Settings · Account) into the site's sticky top nav
// (Coram-Deo-style), then wires settings + answers + highlights/notes/bookmarks + notebook.
// Entirely additive and self-contained; any failure is swallowed so reading is never affected.
import { injectStyles } from './reader-userdata/styles.js'
import { applyCachedSettings, initSettings, toggleSettingsMenu } from './reader-userdata/settings.js'
import { initFirebase, onUser, getUser, signIn, doSignOut } from './reader-userdata/firebase.js'
import { initAnswers } from './reader-userdata/answers.js'
import { initAnnotations } from './reader-userdata/annotations.js'
import { openLibrary } from './reader-userdata/library.js'
import { el, ICONS, warn } from './reader-userdata/util.js'

function sbtn(icon, title, onClick) {
  const b = el('button', 'nc-sbtn')
  b.type = 'button'
  b.title = title
  b.innerHTML = icon
  b.onclick = (e) => onClick(e, b)
  return b
}

let isSession = false // true only on a reading page (has a session context + .session-content)
let acctMenu = null
const ncUser = () => (typeof window !== 'undefined' ? window.__NC_USER : null) // server-resolved (unified only)
const acctOutside = (e) => { if (acctMenu && !acctMenu.contains(e.target) && !e.target.closest('.nc-hbtn') && !e.target.closest('.nc-sbtn')) closeAcct() }
function closeAcct() { acctMenu?.remove(); acctMenu = null; document.removeEventListener('mousedown', acctOutside) }

function placeMenu(anchor, w) {
  const r = anchor.getBoundingClientRect()
  acctMenu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px'
  acctMenu.style.top = (r.bottom + 8) + 'px'
  setTimeout(() => document.addEventListener('mousedown', acctOutside), 0)
}

// Signed OUT: a short intro popover (Coram-Deo-style) before the OAuth popup, rather than firing
// the Google popup immediately.
function showSignInIntro(anchor) {
  if (acctMenu) { closeAcct(); return }
  acctMenu = el('div', 'nc-menu nc-acct nc-signin')
  acctMenu.setAttribute('data-nc-skip', '')
  acctMenu.appendChild(el('div', 'nc-acct__name', 'Sign in'))
  acctMenu.appendChild(el('div', 'nc-signin__body', 'Sign in to save your bookmarks, highlights, and notes across devices.'))
  const go = el('button', 'nc-btn nc-btn--primary', 'Continue with Google')
  go.onclick = () => { closeAcct(); signIn() }
  acctMenu.appendChild(go)
  document.body.appendChild(acctMenu)
  placeMenu(anchor, 240)
}

// Signed IN: identity + role-aware links (Notifications for editors, then Sign out).
function toggleAccountMenu(anchor) {
  if (acctMenu) { closeAcct(); return }
  const u = getUser()
  const su = ncUser()
  acctMenu = el('div', 'nc-menu nc-acct')
  acctMenu.setAttribute('data-nc-skip', '')
  acctMenu.appendChild(el('div', 'nc-acct__name', u?.displayName || su?.displayName || 'Signed in'))
  const email = u?.email || su?.email
  if (email) acctMenu.appendChild(el('div', 'nc-acct__email', email))
  if (su && su.isEditor) {
    const notif = el('button', 'nc-acct__link', 'Notifications')
    notif.innerHTML = `<span class="nc-acct__ico">${ICONS.bell}</span>Notifications`
    notif.onclick = () => { location.href = '/notifications' }
    acctMenu.appendChild(notif)
  }
  const out = el('button', 'nc-btn', 'Sign out')
  out.onclick = () => { doSignOut(); closeAcct() }
  acctMenu.appendChild(out)
  document.body.appendChild(acctMenu)
  placeMenu(anchor, 214)
}

function buildSidebarControls() {
  const host = document.querySelector('.sidebar')
  if (!host || host.querySelector('.nc-side')) return // idempotent — never inject twice
  const wrap = el('div', 'nc-side')
  wrap.setAttribute('data-nc-skip', '')
  const userBtn = sbtn(ICONS.user, 'Sign in', (e, b) => { if (getUser() || ncUser()) toggleAccountMenu(b); else showSignInIntro(b) })
  if (ncUser()) userBtn.classList.add('nc-sbtn--in') // server already knows we're signed in (unified)
  const setBtn = sbtn(ICONS.gear, 'Reading settings', (e, b) => toggleSettingsMenu(b))
  setBtn.setAttribute('data-nc-settings-btn', '')
  wrap.append(userBtn, setBtn)
  // Admin shield — only when the server says this account is an admin (unified identity). Sits next
  // to Settings; links to the console.
  const su = ncUser()
  if (su && su.isAdmin) {
    const adminBtn = sbtn(ICONS.shield, 'Admin Console', () => { location.href = '/admin' })
    adminBtn.setAttribute('data-nc-admin-btn', '')
    wrap.append(adminBtn)
  }
  const nbBtn = sbtn(ICONS.notebook, 'My Notebook', () => openLibrary())
  nbBtn.style.display = 'none' // shown only on session pages (needs a reading context) once signed in
  wrap.append(nbBtn)
  host.insertBefore(wrap, host.firstChild) // top of the sidebar; pushes the nav down

  // The site's mobile TOC clones `.sidebar` innerHTML into `.mobile-toc-sidebar-dropdown` on
  // DOMContentLoaded (after us), which copies our controls as dead (handler-less) buttons. Strip any
  // such clone now and whenever the dropdown is (re)built.
  const stripClones = () => document.querySelectorAll('.mobile-toc-sidebar-dropdown .nc-side').forEach((n) => n.remove())
  stripClones()
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('mobile-toc-sidebar-dropdown')) {
        n.querySelectorAll('.nc-side').forEach((x) => x.remove())
      }
    }
  }).observe(document.body, { childList: true })

  onUser((u) => {
    nbBtn.style.display = (isSession && u) ? '' : 'none'
    userBtn.classList.toggle('nc-sbtn--in', !!u)
    userBtn.title = u ? 'Account' : (isSession ? 'Sign in to save your highlights, notes & answers' : 'Sign in')
  })
}

function boot() {
  if (window.__ncBooted) return // guard against the bundle evaluating/booting more than once
  window.__ncBooted = true
  const ctx = window.__READER_CTX
  const root = ctx && ctx.bookPath && ctx.sessionFile ? document.querySelector('.session-content') : null
  isSession = !!root
  injectStyles()
  initFirebase()
  initSettings()
  // Under unified identity the reader owns the site's sign-in, so back the legacy globals the mobile
  // header drawer (header.ejs) still calls onto the 463519 flow.
  if (window.__NC_UNIFIED) {
    window.loginWithGoogle = () => signIn()
    window.logout = () => doSignOut()
  }
  buildSidebarControls() // account + settings on every page; notebook + reading features only on sessions
  if (isSession) {
    ctx.root = root
    initAnswers(ctx)
    initAnnotations(ctx)
  }
}

try {
  applyCachedSettings() // instant theme/text-size (site-wide, before sign-in)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { boot() } catch (e) { warn(e) } })
  else boot()
} catch (e) { warn('bootstrap', e) }
