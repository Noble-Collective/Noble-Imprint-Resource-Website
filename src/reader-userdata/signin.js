// The resources site's sign-in (web sign-in plan P3, Collective-Shared
// plans/2026-10-05-common-web-sign-in.md): one shared-kit controller (@noble-collective/userdata/signin)
// over the reader's 463519 Auth. Ways in: the account icon (desktop → /sign-in?returnTo=, phone →
// the sheet in place), the home prompt (→ /sign-in), nc:need-signin (Highlight/Note/Bookmark/Answer
// while signed out → the sheet, with the action HELD and completed after sign-in), and the mobile
// drawer (→ the sheet). Google + Apple; Apple only when window.__NC_FLAGS.appleSignin.
import { createSignIn, injectStyles as injectKitStyles } from '@noble-collective/userdata/signin'
import {
  GoogleAuthProvider, OAuthProvider, signInWithCredential, linkWithCredential, reauthenticateWithCredential,
} from 'firebase/auth'
import { getAuthInstance, bridgeSession, whenClient, isEmulated, getUser } from './firebase.js'
import { PAGE_COPY, sheetCopy, createHeld, signedInToast } from './signin-model.js'
import { el, warn } from './util.js'

const MERGE_URL = '/api/account/merge' // this site's Combine accounts endpoint (account-merge.js)
const TOAST_KEY = 'nc:signed-in-toast'
const PHONE = '(max-width: 989px)' // same breakpoint that swaps the sidebar cluster for the header one

let ctrl = null
const held = createHeld()
let sheet = null // { host, panel, kind }

const appleOn = () => !!(window.__NC_FLAGS && window.__NC_FLAGS.appleSignin)

function ssGet(k) { try { return sessionStorage.getItem(k) } catch { return null } }
function ssSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v) } catch { /* blocked */ } }

/** Create the one controller (at boot on every page, so a popup-blocked → redirect sign-in resumes). */
export function initSignIn() {
  if (ctrl) return ctrl
  const auth = getAuthInstance()
  if (!auth) return null
  // The kit injects its stylesheet when a panel mounts; a dialog can open with none mounted (the
  // name / link prompt after a popup-blocked → redirect sign-in), so inject it up front.
  injectKitStyles(document)
  ctrl = createSignIn({
    auth,
    providers: appleOn() ? ['google', 'apple'] : ['google'],
    bridgeSession,
    mergeUrl: MERGE_URL,
    copy: PAGE_COPY,
    onSignedIn: (user) => {
      // Before the kit navigates (returnTo on /sign-in): the next page shows the toast once.
      ssSet(TOAST_KEY, user.displayName || '')
      // After the name prompt the user has a name but no auth-state change fired: repaint the avatar.
      document.dispatchEvent(new CustomEvent('nc:signed-in'))
      if (sheet) void afterSheetSignIn()
      // A redirect sign-in (popup blocked) that lands back on a reading page: no navigation follows.
      else if (location.pathname !== '/sign-in') setTimeout(showSignedInToast, 0)
    },
    onError: (code, cause) => {
      warn('sign-in', code, cause || '')
      held.discard() // a failure drops the held action (the sheet shows the error inline)
    },
    adapters: isEmulated() ? testAdapters() : undefined,
  })
  if (isEmulated()) installTestSeams()
  return ctrl
}

// In-place sign-in (the sheet): no reload, so the reader keeps their spot. The held action runs as
// soon as the data client is ready, then the toast. The server session cookie is already set, so
// editor/admin UI appears from the next page load.
async function afterSheetSignIn() {
  closeSheet({ keepHeld: true })
  await whenClient()
  await held.complete()
  showSignedInToast()
}

// --- the sheet (res-flow-phone-sheet; a centred card on wide screens) --------------------------

export function openSheet(kind, resume) {
  const c = initSignIn()
  if (!c) return
  if (kind && typeof resume === 'function') held.hold(kind, resume)
  else held.discard()
  closeSheet({ keepHeld: true })
  const host = el('div', 'nc-si-sheet')
  host.setAttribute('data-nc-skip', '')
  host.setAttribute('data-nc-signin-sheet', '')
  const scrim = el('div', 'nc-si-sheet__scrim')
  scrim.addEventListener('click', () => closeSheet())
  const panel = el('div', 'nc-si-sheet__panel')
  const x = el('button', 'nc-si-sheet__x', '×')
  x.type = 'button'; x.setAttribute('aria-label', 'Close')
  x.addEventListener('click', () => closeSheet())
  panel.appendChild(x)
  host.append(scrim, panel)
  document.body.appendChild(host)
  c.mountPanel(panel, { variant: 'sheet', copy: sheetCopy(kind) })
  sheet = { host, panel, kind: kind || null }
  document.addEventListener('keydown', sheetKey)
  const first = panel.querySelector('.ncsi-btn')
  if (first) first.focus()
}

function sheetKey(e) {
  // Esc closes the sheet — unless a kit dialog (link / name / combine) is open on top of it.
  // (The dialog closes itself first, so test where the key came from, not whether it's still open.)
  if (e.key !== 'Escape' || !sheet) return
  if (document.querySelector('.ncsi-overlay') || (e.target && e.target.closest && e.target.closest('.ncsi-dlg'))) return
  closeSheet()
}

/** Close the sheet; a close without a sign-in (cancel) discards the held action. */
export function closeSheet({ keepHeld = false } = {}) {
  if (!sheet) return
  if (!keepHeld) held.discard()
  ctrl?.unmount(sheet.panel)
  sheet.host.remove()
  sheet = null
  document.removeEventListener('keydown', sheetKey)
}

export const isSheetOpen = () => !!sheet

/** Signed-out account icon: /sign-in on desktop, the sheet in place on a phone. */
export function startSignIn() {
  if (window.matchMedia && window.matchMedia(PHONE).matches) return openSheet()
  location.href = signInHref()
}

export function signInHref(path = location.pathname + location.search) {
  return '/sign-in?returnTo=' + encodeURIComponent(path)
}

// --- the /sign-in page (res-flow-2) -------------------------------------------------------------

export function mountSignInPage(slot) {
  const c = initSignIn()
  if (!c || !slot) return
  const href = slot.getAttribute('data-return-to') || '/'
  const label = slot.getAttribute('data-return-label') || 'Resource Library'
  c.setOptions({ returnTo: { href, label } })
  slot.replaceChildren()
  c.mountPanel(slot, { variant: 'page', copy: PAGE_COPY })
  // Signed in on this browser but the server had no session (e.g. the cookie lapsed): go back.
  if (getUser()) location.replace(href)
}

// --- account menu: Connected accounts + delete ---------------------------------------------------

export function mountConnectedAccounts(slot) {
  const c = initSignIn()
  if (c && slot) c.mountConnectedAccounts(slot)
}
export function unmountConnectedAccounts(slot) { if (ctrl && slot) ctrl.unmount(slot) }

export const reauthForDelete = () => (initSignIn() ? ctrl.reauthForDelete() : Promise.resolve('cancelled'))

// --- the one-time toast (res-flow-3) -------------------------------------------------------------

export function showSignedInToast() {
  const name = ssGet(TOAST_KEY)
  if (name === null) return
  ssSet(TOAST_KEY, null)
  const u = getUser()
  const t = el('div', 'nc-signed-toast')
  t.setAttribute('role', 'status')
  t.setAttribute('data-nc-skip', '')
  t.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
  t.appendChild(el('span', '', signedInToast(name || (u && u.displayName) || '')))
  document.body.appendChild(t)
  requestAnimationFrame(() => t.classList.add('nc-signed-toast--show'))
  setTimeout(() => { t.classList.remove('nc-signed-toast--show'); setTimeout(() => t.remove(), 300) }, 4200)
}

// --- emulator seams (localhost + ?ncEmu=1 only; test-harness/) -----------------------------------

let nextCred = null // the credential the next authenticate/link/reauth uses
let reauthMode = 'ok'

function testCred(kind, { email, sub, name, verified }) {
  const claims = { sub, email, email_verified: verified }
  if (kind === 'apple') return new OAuthProvider('apple.com').credential({ idToken: JSON.stringify(claims) })
  return GoogleAuthProvider.credential(JSON.stringify({ ...claims, ...(name ? { name } : {}) }))
}

function takeCred() {
  const c = nextCred
  nextCred = null
  if (!c) throw Object.assign(new Error('no test credential'), { code: 'auth/popup-closed-by-user' })
  return c
}

function testAdapters() {
  return {
    authenticate: (a) => signInWithCredential(a, takeCred()),
    link: (u) => linkWithCredential(u, takeCred()),
    reauthenticate: (u) => {
      if (reauthMode === 'cancel') return Promise.reject(Object.assign(new Error('cancelled'), { code: 'auth/popup-closed-by-user' }))
      const kind = u.providerData.some((p) => p.providerId === 'google.com') ? 'google' : 'apple'
      const info = u.providerData.find((p) => p.providerId === (kind === 'google' ? 'google.com' : 'apple.com')) || {}
      return reauthenticateWithCredential(u, testCred(kind, { email: info.email || u.email, sub: info.uid, verified: true }))
    },
  }
}

function installTestSeams() {
  // Signs in through the kit (bridgeSession, name prompt, link dialog all run). Zero-arg = the old
  // Google seam. Resolves when the kit settles (a dialog may be waiting).
  window.__ncTestSignIn = (email = 'tester@example.com', sub = 'testuser-1', name = 'Test Reader', kind = 'google', verified = true) => {
    nextCred = testCred(kind, { email, sub, name, verified })
    return ctrl.signIn(kind)
  }
  // Queue the credential the next kit popup (link dialog / Connect / Combine) uses.
  window.__ncTestNextCredential = (kind, email, sub, name, verified = true) => { nextCred = testCred(kind, { email, sub, name, verified }) }
  window.__ncTestReauth = (mode) => { reauthMode = mode === 'cancel' ? 'cancel' : 'ok' }
  window.__ncTestUid = () => { const u = getUser(); return u ? u.uid : null }
}
