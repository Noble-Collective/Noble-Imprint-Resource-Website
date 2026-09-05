// Firebase/auth/store core for the reader per-user data layer. Owns the named 'readerApp' on the
// shared convergence project + the collective-user-data database, auth state, and the SDK client.
import { initializeApp } from 'firebase/app'
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence, connectAuthEmulator,
  deleteUser, reauthenticateWithPopup,
} from 'firebase/auth'
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { createUserDataClient } from '@noble-collective/userdata/client'
import { warn } from './util.js'

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
      window.__ncTestSignIn = (email = 'tester@example.com', sub = 'testuser-1', name = 'Test Reader') =>
        signInWithCredential(_auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name })))
    } catch (e) { warn('emu', e) }
  }
  setPersistence(_auth, browserLocalPersistence).catch(() => {})
  onAuthStateChanged(_auth, (u) => {
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

// Convergence Phase 1b: when identity is unified (window.__NC_UNIFIED), the reader sign-in is ALSO
// the site's sign-in — after the popup we exchange the 463519 ID token for the server __session
// cookie (so editor/admin access + role-aware UI light up), then reload to reflect server state.
async function bridgeSession(cred) {
  if (!window.__NC_UNIFIED || !cred || !cred.user) return
  const idToken = await cred.user.getIdToken()
  await fetch('/api/auth/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  })
  location.reload()
}

export const signIn = () =>
  signInWithPopup(_auth, new GoogleAuthProvider()).then(bridgeSession).catch((e) => warn('sign-in', e))

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

// Erase all data, then delete the Firebase account itself (re-auth if the session is too old), and
// clear the server session. Irreversible.
export async function deleteAccount() {
  await deleteAllData()
  const user = _auth && _auth.currentUser
  if (user) {
    try {
      await deleteUser(user)
    } catch (e) {
      if (e && e.code === 'auth/requires-recent-login') {
        await reauthenticateWithPopup(user, new GoogleAuthProvider())
        await deleteUser(user)
      } else { throw e }
    }
  }
  if (window.__NC_UNIFIED) { try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ } }
}
