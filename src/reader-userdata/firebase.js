// Firebase/auth/store core for the reader per-user data layer. Owns the named 'readerApp' on the
// shared convergence project + the collective-user-data database, auth state, and the SDK client.
import { initializeApp } from 'firebase/app'
import {
  getAuth, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, connectAuthEmulator, deleteUser,
} from 'firebase/auth'
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { createUserDataClient } from '@noble-collective/userdata/client'
import { warn, postSession } from './util.js'

const CONFIG = {
  apiKey: 'AIzaSyC3dwU9dR59QncPWsSgHG2CQxg4_jVqbrc',
  authDomain: 'account.noblecollective.org', // custom auth domain -> popup reads "noblecollective.org"
  projectId: 'noble-imprint-463519',
  appId: '1:160156401404:web:39385683295e00348de179',
  messagingSenderId: '160156401404',
  storageBucket: 'noble-imprint-463519.firebasestorage.app',
}

let _auth = null
let _db = null
let _client = null
let _user = null
let _emu = false
const cbs = []

export function initFirebase() {
  if (_auth) return
  const app = initializeApp(CONFIG, 'readerApp')
  _auth = getAuth(app)
  _db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, 'collective-user-data')
  if (location.hostname === 'localhost' && /[?&]ncEmu=1/.test(location.search)) {
    try {
      connectFirestoreEmulator(_db, '127.0.0.1', 8080)
      connectAuthEmulator(_auth, 'http://127.0.0.1:9099')
      _emu = true // signin.js adds the __ncTestSignIn / __ncTestLink seams over the sign-in kit
    } catch (e) { warn('emu', e) }
  }
  setPersistence(_auth, browserLocalPersistence).catch(() => {})
  let restored = false
  onAuthStateChanged(_auth, (u) => {
    // The first callback is the sign-in RESTORED from storage (later ones are live sign-in/out).
    if (!restored) { restored = true; healServerSession(u) }
    _user = u
    _client = u ? createUserDataClient(_db, u.uid) : null
    for (const cb of cbs) { try { cb(u, _client) } catch (e) { warn('user cb', e) } }
  })
}

/** Subscribe to auth changes; fires immediately with the current state if already known. */
export function onUser(cb) {
  cbs.push(cb)
  if (_auth) cb(_user, _client)
}
export const getClient = () => _client
export const getUser = () => _user
export const getAuthInstance = () => _auth
export const isEmulated = () => _emu

/** Resolves with the data client once someone is signed in (immediately if they already are). */
export function whenClient() {
  return new Promise((resolve) => {
    let done = false
    onUser((u, client) => { if (!done && client) { done = true; resolve(client) } })
  })
}

// Convergence Phase 1b: when identity is unified (window.__NC_UNIFIED), the reader sign-in is ALSO
// the site's sign-in — the sign-in kit (signin.js) calls this after every sign-in to exchange the
// 463519 ID token for the server __session cookie (editor/admin access + role-aware UI). The kit has
// already backfilled the auth record's name/photo from the provider (Apple gives no photo, and its
// name only once — the kit asks for one). → undefined, or { error: 'email-not-verified' } (the P2
// 403: the kit signs back out and says why). Any other failure is not fatal: the reader works
// client-side and healServerSession retries on the next load.
export async function bridgeSession(user, profile) {
  if (!window.__NC_UNIFIED || !user) return undefined
  const idToken = await user.getIdToken(true) // force-refresh so the new name/picture ride the token
  const r = await postSession(idToken, { displayName: (profile && profile.displayName) || null, photoURL: (profile && profile.photoURL) || null })
  if (r === 'email-not-verified') return { error: r }
  if (r !== 'ok') warn('session', r)
  return undefined
}

// The server __session cookie lives 5 days (auth.SESSION_EXPIRES_IN); the Firebase client sign-in
// lives on in storage. Once the cookie lapses the page renders signed-out server-side (no Edit/Admin,
// window.__NC_USER null) while the reader still shows the avatar — and nothing re-minted the cookie
// short of signing out and in again. When the restored client user has no server session, quietly
// exchange a fresh ID token for one (no reload: the next page has the editor/admin UI back).
// Same lapse as the Institute's 2026-10 spinner. Once per tab, so a rejecting server can't loop.
async function healServerSession(u) {
  try {
    if (!u || !window.__NC_UNIFIED || window.__NC_USER) return
    if (sessionStorage.getItem('nc:session-heal')) return
    sessionStorage.setItem('nc:session-heal', '1')
    const idToken = await u.getIdToken()
    // A 403 email-not-verified is final for this tab (the flag above), so it can't loop.
    const r = await postSession(idToken, { displayName: u.displayName || null, photoURL: u.photoURL || null })
    if (r !== 'ok') warn('session heal', r)
  } catch (e) { warn('session heal', e) }
}

export const doSignOut = async () => {
  try {
    if (window.__NC_UNIFIED) await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    await signOut(_auth)
    if (window.__NC_UNIFIED) location.reload()
  } catch { /* ignore */ }
}

// Erase all of the signed-in user's converged data (highlights/notes/bookmarks/answers/activity/
// settings). Irreversible. Keeps the account.
export async function deleteAllData() {
  if (_client) await _client.eraseAll()
  try { localStorage.removeItem('nc:reader-settings') } catch { /* ignore */ }
}

// Erase all data, then delete the Firebase account itself, and clear the server session.
// Irreversible. `reauth` = the kit's reauthForDelete (whichever provider the account has — never
// assume Google). → 'deleted' | 'cancelled'.
export async function deleteAccount(reauth) {
  const user = _auth && _auth.currentUser
  if (!user) { await deleteAllData(); return 'deleted' }
  // Reauthenticate UP FRONT: if the user cancels, we abort with NOTHING deleted (avoids the
  // half-completed state where data is erased but a reauth prompt then fails). The kit returns
  // 'cancelled' rather than throwing, so check it explicitly. Firestore erase must run while still
  // authed, so it happens after reauth but before the account is removed.
  if ((await reauth()) !== 'ok') return 'cancelled'
  await deleteAllData()
  await deleteUser(user)
  if (window.__NC_UNIFIED) { try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ } }
  return 'deleted'
}
