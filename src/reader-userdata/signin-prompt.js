// Home, signed out (web sign-in plan P3, res-flow-1 / res-flow-phone-home): wires the server-rendered
// prompt (views/partials/signin-prompt.ejs). Sign in is a plain link to /sign-in?returnTo=/; Get the
// app picks the store for this device; × is remembered per browser; a signed-in reader never sees it.
import { onUser } from './firebase.js'
import { appLink } from './signin-model.js'

const CLOSED_KEY = 'nc:signin-prompt-closed'

export function mountSignInPrompt() {
  const box = document.querySelector('[data-nc-signin-prompt]')
  if (!box) return
  const app = box.querySelector('[data-nc-prompt-app]')
  if (app) app.href = appLink(navigator.userAgent)
  const close = box.querySelector('[data-nc-prompt-close]')
  if (close) close.addEventListener('click', () => {
    try { localStorage.setItem(CLOSED_KEY, '1') } catch { /* storage blocked: closes for this visit only */ }
    box.remove()
  })
  // The server saw no session, but this browser may still be signed in (a lapsed cookie): then the
  // Continue reading strip takes the slot instead.
  onUser((u) => { if (u) box.remove() })
}
