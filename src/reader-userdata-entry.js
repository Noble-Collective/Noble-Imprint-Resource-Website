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

let acctMenu = null
const acctOutside = (e) => { if (acctMenu && !acctMenu.contains(e.target) && !e.target.closest('.nc-hbtn')) closeAcct() }
function closeAcct() { acctMenu?.remove(); acctMenu = null; document.removeEventListener('mousedown', acctOutside) }
function toggleAccountMenu(anchor) {
  if (acctMenu) { closeAcct(); return }
  const u = getUser()
  acctMenu = el('div', 'nc-menu nc-acct')
  acctMenu.setAttribute('data-nc-skip', '')
  acctMenu.appendChild(el('div', 'nc-acct__name', u?.displayName || 'Signed in'))
  if (u?.email) acctMenu.appendChild(el('div', 'nc-acct__email', u.email))
  const out = el('button', 'nc-btn', 'Sign out')
  out.onclick = () => { doSignOut(); closeAcct() }
  acctMenu.appendChild(out)
  document.body.appendChild(acctMenu)
  const r = anchor.getBoundingClientRect()
  const w = 214
  acctMenu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px'
  acctMenu.style.top = (r.bottom + 8) + 'px'
  setTimeout(() => document.addEventListener('mousedown', acctOutside), 0)
}

function buildSidebarControls() {
  const host = document.querySelector('.sidebar')
  if (!host || host.querySelector('.nc-side')) return // idempotent — never inject twice
  const wrap = el('div', 'nc-side')
  wrap.setAttribute('data-nc-skip', '')
  const userBtn = sbtn(ICONS.user, 'Sign in', (e, b) => { if (getUser()) toggleAccountMenu(b); else signIn() })
  const setBtn = sbtn(ICONS.gear, 'Reading settings', (e, b) => toggleSettingsMenu(b))
  setBtn.setAttribute('data-nc-settings-btn', '')
  const nbBtn = sbtn(ICONS.notebook, 'My Notebook', () => openLibrary())
  nbBtn.style.display = 'none'
  wrap.append(userBtn, setBtn, nbBtn)
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
    nbBtn.style.display = u ? '' : 'none'
    userBtn.classList.toggle('nc-sbtn--in', !!u)
    userBtn.title = u ? 'Account' : 'Sign in to save your highlights, notes & answers'
  })
}

function boot() {
  if (window.__ncBooted) return // guard against the bundle evaluating/booting more than once
  window.__ncBooted = true
  const root = document.querySelector('.session-content')
  if (!root) return
  const ctx = window.__READER_CTX
  ctx.root = root
  injectStyles()
  initFirebase()
  initSettings()
  buildSidebarControls()
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
