// Reader per-user data layer (convergence) — entry point. Bundled by esbuild into
// src/public/js/reader-userdata-bundle.js and loaded on session pages only when FEATURE_USER_DATA
// is on. Injects a control cluster (Notebook · Settings · Account) into the site's sticky top nav
// (Coram-Deo-style), then wires settings + answers + highlights/notes/bookmarks + notebook.
// Entirely additive and self-contained; any failure is swallowed so reading is never affected.
import { injectStyles } from './reader-userdata/styles.js'
import { applyCachedSettings, initSettings, toggleSettingsMenu } from './reader-userdata/settings.js'
import { initFirebase, onUser, getUser, signIn, doSignOut, deleteAllData, deleteAccount } from './reader-userdata/firebase.js'
import { initAnswers, attachAnswers } from './reader-userdata/answers.js'
import { initAnnotations, attachAnnotations } from './reader-userdata/annotations.js'
import { openLibrary } from './reader-userdata/library.js'
import { maybeOnboard } from './reader-userdata/onboarding.js'
import { recordReading, mountContinueReading } from './reader-userdata/progress.js'
import { mountMyNotes } from './reader-userdata/mynotes.js'
import { textDirectiveToRange, parseTextDirective, paintRange, unpaint } from './reader-userdata/anchor-dom.js'
import { el, ICONS, warn } from './reader-userdata/util.js'

// Robustly honor a shared `#:~:text=` link: find the quoted text ourselves, scroll to it, and
// flash it. Native scroll-to-text-fragment is unreliable on some browsers (notably mobile Safari),
// so we don't depend on it — same normalized-anchor machinery the highlights use.
function jumpToTextFragment(root) {
  const dir = parseTextDirective(location.search + location.hash)
  if (!dir) return
  const id = 'nc-shared-passage'
  const tryJump = () => {
    try {
      const range = textDirectiveToRange(root, dir.startText, dir.endText)
      if (!range) return false
      unpaint(id)
      if (!paintRange(range, 'nc-share-hl', id)) return false
      const mark = document.querySelector('mark[data-annot-id="nc-shared-passage"]')
      if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => unpaint(id), 3200) // remove the temporary emphasis; the reading text is untouched
      return true
    } catch (e) { warn('shared-passage jump', e); return true /* don't retry on error */ }
  }
  // Retry until the text is found (content is server-rendered so usually first try), then re-center
  // a couple more times so late web-font/image reflow (which shifts the target) and any browser
  // scroll-restoration can't leave us stranded at the top.
  let tries = 0
  let recenters = 0
  const tick = () => {
    if (tryJump()) { if (recenters++ < 2) setTimeout(tick, 500) }
    else if (tries++ < 8) setTimeout(tick, 250)
  }
  setTimeout(tick, 200)
}

function sbtn(icon, title, onClick) {
  const b = el('button', 'nc-sbtn')
  b.type = 'button'
  b.setAttribute('data-tip', title) // fast CSS tooltip (native title is too slow)
  b.setAttribute('aria-label', title)
  b.innerHTML = icon
  b.onclick = (e) => onClick(e, b)
  return b
}

const confirmTwice = (msg1, msg2) => window.confirm(msg1) && window.confirm(msg2) // destructive-action guard
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
  const name = u?.displayName || su?.displayName || 'Signed in'
  const email = u?.email || su?.email
  const photo = u?.photoURL || (su && su.photoURL)
  const head = el('div', 'nc-acct__head')
  const initialsAvatar = () => el('span', 'nc-acct__avatar nc-acct__avatar--initials', (name[0] || '?').toUpperCase())
  if (photo) {
    const img = el('img', 'nc-acct__avatar')
    img.alt = ''; img.referrerPolicy = 'no-referrer' // Google photo URLs 403 without this
    img.onerror = () => img.replaceWith(initialsAvatar()) // fall back to initials if it fails to load
    img.src = photo
    head.appendChild(img)
  } else {
    head.appendChild(initialsAvatar())
  }
  const info = el('div', 'nc-acct__info')
  info.appendChild(el('div', 'nc-acct__name', name))
  if (email) info.appendChild(el('div', 'nc-acct__email', email))
  head.appendChild(info)
  acctMenu.appendChild(head)
  // My Notes — everything saved across all books (any signed-in user).
  const notes = el('button', 'nc-acct__link')
  notes.innerHTML = `<span class="nc-acct__ico">${ICONS.notebook}</span>My Notebooks`
  notes.onclick = () => { location.href = '/notes' }
  acctMenu.appendChild(notes)
  if (su && su.isEditor) {
    const notif = el('button', 'nc-acct__link', 'Notifications')
    notif.innerHTML = `<span class="nc-acct__ico">${ICONS.bell}</span>Notifications`
    notif.onclick = () => { location.href = '/notifications' }
    acctMenu.appendChild(notif)
  }
  const out = el('button', 'nc-btn', 'Sign out')
  out.onclick = () => { doSignOut(); closeAcct() }
  acctMenu.appendChild(out)

  // Data & privacy (parity with the app: Privacy Policy · Delete my data · Delete account)
  const data = el('details', 'nc-acct__data')
  const sum = el('summary', 'nc-acct__data-sum', 'Manage your data')
  data.appendChild(sum)
  const priv = el('a', 'nc-acct__link')
  priv.href = 'https://noblecollective.org/policies/privacy-policy'; priv.target = '_blank'; priv.rel = 'noopener'
  priv.innerHTML = `<span class="nc-acct__ico">${ICONS.shield}</span>Privacy Policy`
  data.appendChild(priv)
  const delData = el('button', 'nc-acct__link nc-acct__link--danger', 'Delete my data')
  delData.onclick = async () => {
    if (!confirmTwice(
      'Delete ALL your highlights, notes, bookmarks, answers and settings?\n\nThis permanently erases your saved data (only your own account) and cannot be undone.',
      'Are you absolutely sure? This cannot be undone.',
    )) return
    try { await deleteAllData(); location.reload() } catch (e) { warn('delete data', e); window.alert('Could not delete your data. Please try again.') }
  }
  data.appendChild(delData)
  const delAcct = el('button', 'nc-acct__link nc-acct__link--danger', 'Delete account')
  delAcct.onclick = async () => {
    if (!confirmTwice(
      'Permanently delete your ACCOUNT and all your data?\n\nThis erases your saved data and removes your Noble Collective sign-in. It cannot be undone.',
      'Last chance — are you absolutely sure you want to delete your account?',
    )) return
    try { await deleteAccount(); location.href = '/' } catch (e) { warn('delete account', e); window.alert('Could not delete your account. Please sign in again and retry.') }
  }
  data.appendChild(delAcct)
  acctMenu.appendChild(data)

  document.body.appendChild(acctMenu)
  placeMenu(anchor, 214)
}

const clusters = [] // every rendered control cluster (desktop sidebar + mobile header), for onUser

// Build one Account · Settings · [Admin] · Notebook cluster into `host`.
function buildCluster(host, { atTop, extraClass } = {}) {
  if (!host || host.querySelector('.nc-side')) return null // idempotent per host
  const wrap = el('div', 'nc-side' + (extraClass ? ' ' + extraClass : ''))
  wrap.setAttribute('data-nc-skip', '')
  const homeBtn = sbtn(ICONS.bookOpen, 'Resource Library — home', () => { location.href = '/' })
  wrap.append(homeBtn)
  const userBtn = sbtn(ICONS.user, 'Sign in', (e, b) => { if (getUser() || ncUser()) toggleAccountMenu(b); else showSignInIntro(b) })
  userBtn.setAttribute('data-nc-account-btn', '')
  if (ncUser()) userBtn.classList.add('nc-sbtn--in') // server already knows we're signed in (unified)
  const setBtn = sbtn(ICONS.gear, 'Reading settings', (e, b) => toggleSettingsMenu(b))
  setBtn.setAttribute('data-nc-settings-btn', '')
  wrap.append(userBtn, setBtn)
  const su = ncUser()
  if (su && su.isAdmin) {
    const adminBtn = sbtn(ICONS.shield, 'Admin Console', () => { location.href = '/admin' })
    adminBtn.setAttribute('data-nc-admin-btn', '')
    wrap.append(adminBtn)
  }
  const nbBtn = sbtn(ICONS.notebook, 'Notebook', () => openLibrary())
  nbBtn.style.display = 'none' // shown only on session pages (needs a reading context) once signed in
  wrap.append(nbBtn)
  if (atTop) host.insertBefore(wrap, host.firstChild)
  else host.appendChild(wrap)
  clusters.push({ wrap, userBtn, nbBtn })
  return wrap
}

// Apply the current sign-in state to every live cluster (notebook visibility + account icon).
function updateClusters() {
  const u = getUser()
  for (const c of clusters) {
    c.nbBtn.style.display = (isSession && u) ? '' : 'none'
    c.userBtn.classList.toggle('nc-sbtn--in', !!u)
    const tip = u ? 'Account' : 'Sign in'
    c.userBtn.setAttribute('data-tip', tip)
    c.userBtn.setAttribute('aria-label', tip)
  }
}

function buildSidebarControls() {
  // Desktop: top of the left sidebar (hidden on mobile, where .sidebar is display:none).
  buildCluster(document.querySelector('.sidebar'), { atTop: true })
  // Mobile: the top header's right slot (`.header-icons` is empty on phones — GIVE hides ≤1024px).
  // CSS shows this cluster only ≤989px, so desktop keeps a single sidebar cluster.
  buildCluster(document.querySelector('.site-header .header-icons') || document.querySelector('.header-inner'),
    { atTop: false, extraClass: 'nc-side--mobile' })

  // The site's mobile TOC clones `.sidebar` innerHTML into `.mobile-toc-sidebar-dropdown` on
  // DOMContentLoaded (after us), copying the sidebar cluster as dead (handler-less) buttons. Strip
  // any such clone now and whenever the dropdown is (re)built. (The header cluster is never cloned.)
  const stripClones = () => document.querySelectorAll('.mobile-toc-sidebar-dropdown .nc-side').forEach((n) => n.remove())
  stripClones()
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('mobile-toc-sidebar-dropdown')) {
        n.querySelectorAll('.nc-side').forEach((x) => x.remove())
      }
    }
  }).observe(document.body, { childList: true })

  onUser(() => updateClusters())
}

// Re-attach the reader to freshly-swapped session content (AJAX nav within a book). ajax-nav.js
// replaces #reading-content (new .session-content) and wipes the sidebar, so we update the context,
// re-inject the sidebar cluster, and re-bind answers + annotations to the new DOM.
function reattach(newCtx) {
  try {
    if (!newCtx) return
    const root = document.querySelector('.session-content')
    if (!root) return
    newCtx.root = root
    window.__READER_CTX = newCtx
    isSession = true
    // The sidebar cluster was destroyed by the swap; drop any detached clusters, then re-inject it.
    for (let i = clusters.length - 1; i >= 0; i--) if (!clusters[i].wrap.isConnected) clusters.splice(i, 1)
    buildCluster(document.querySelector('.sidebar'), { atTop: true })
    attachAnswers(newCtx)
    attachAnnotations(newCtx)
    recordReading(newCtx) // keep "Continue reading" current through in-book AJAX navigation
    updateClusters()
  } catch (e) { warn('reattach', e) }
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
  // A signed-out action that needs an account (highlight/note/bookmark/answer) dispatches this →
  // show the sign-in intro popover anchored to the account icon.
  document.addEventListener('nc:need-signin', () => {
    if (getUser()) return
    const b = [...document.querySelectorAll('.nc-side [data-nc-account-btn]')].find((x) => x.offsetParent !== null)
    if (!b) return
    if (acctMenu) closeAcct()
    showSignInIntro(b)
  })
  window.__ncReattach = reattach // let ajax-nav re-bind the reader after an in-page session swap
  if (isSession) {
    ctx.root = root
    initAnswers(ctx)
    initAnnotations(ctx)
    recordReading(ctx) // remember this session for "Continue reading"
    jumpToTextFragment(root) // shared #:~:text= link → scroll to + flash the quoted passage
    maybeOnboard() // one-time coach-mark introducing the reader features
  } else if (location.pathname === '/') {
    mountContinueReading() // resume strip at the top of the home page
  } else if (location.pathname === '/notes') {
    mountMyNotes() // the cross-book "My Notes" page
  }
}

try {
  applyCachedSettings() // instant theme/text-size (site-wide, before sign-in)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { boot() } catch (e) { warn(e) } })
  else boot()
} catch (e) { warn('bootstrap', e) }
