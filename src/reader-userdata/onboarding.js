// One-time coach-mark introducing the reader features (highlight / settings / sign-in-to-sync).
// Shows once per browser on a session page, anchored to the visible control cluster.
import { el } from './util.js'

const KEY = 'nc_onboarded_v1'

export function maybeOnboard() {
  let seen = true
  try { seen = !!localStorage.getItem(KEY) } catch { return }
  if (seen) return
  // Show after a beat so layout has settled; anchor to whichever settings button is visible
  // (desktop sidebar or mobile header cluster).
  setTimeout(() => {
    const anchor = [...document.querySelectorAll('.nc-side [data-nc-settings-btn]')].find((b) => b.offsetParent !== null)
    if (!anchor) return
    if (document.querySelector('.nc-coach')) return

    const pop = el('div', 'nc-coach')
    pop.setAttribute('data-nc-skip', '')
    pop.appendChild(el('div', 'nc-coach__title', 'Make it yours'))
    const body = el('div', 'nc-coach__body')
    body.innerHTML = 'Highlight any text to save it. Use <b>Settings</b> (the gear) for dark mode &amp; text size, and <b>sign in</b> to sync your highlights, notes &amp; answers across devices.'
    pop.appendChild(body)
    const ok = el('button', 'nc-btn nc-btn--primary', 'Got it')
    pop.appendChild(ok)
    document.body.appendChild(pop)

    const place = () => {
      const r = anchor.getBoundingClientRect()
      const w = 280
      pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px'
      pop.style.top = (r.bottom + 10) + 'px'
    }
    place()
    const done = () => {
      try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
      pop.remove()
      document.removeEventListener('click', outside, true)
      window.removeEventListener('resize', place)
    }
    const outside = (e) => { if (!pop.contains(e.target)) done() }
    ok.onclick = done
    window.addEventListener('resize', place)
    setTimeout(() => document.addEventListener('click', outside, true), 500)
  }, 700)
}
