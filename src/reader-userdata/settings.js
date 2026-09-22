// Settings: load/apply/persist the shared user settings, and the gear menu. Applies from a local
// cache instantly (no-flash), then syncs from the shared store on sign-in. Mirrors Coram Deo:
// theme -> .nc-dark class, fontSize -> --nc-font-scale, fontFamily -> font class.
import { DEFAULT_SETTINGS } from '@noble-collective/userdata/core'
import { onUser, getClient } from './firebase.js'
import { el, warn } from './util.js'

// fontSize token -> numeric scale. Per-product presentation: the shared store carries the ABSTRACT
// token (sm/base/lg/xl), and each product maps it to its own scale — so bumping lg/xl here is a pure
// presentation change with no effect on the shared contract or cross-device sync. Owned locally (not
// imported from the SDK) so this site can render "Large"/"Extra Large" bigger, closer to the mobile
// app's feel (mobile: lg 1.2, xl 2.0), without coupling presentation to the contract package.
const FONT_SCALE = { sm: 0.9, base: 1, lg: 1.2, xl: 1.75 }

const CACHE_KEY = 'nc:reader-settings'
let current = load()
let systemWatched = false

function load() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } }
  catch { return { ...DEFAULT_SETTINGS } }
}
function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(current)) } catch { /* ignore */ } }

function resolveDark(theme) {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

const SANS_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const SERIF_STACK = "'Lora', Georgia, 'Times New Roman', serif"

export function apply() {
  const root = document.documentElement
  root.style.setProperty('--nc-font-scale', String(FONT_SCALE[current.fontSize] ?? 1))
  // Override the site's own reading-font variable so the toggle actually changes the body text
  // (paragraphs set font-family: var(--font-reading) directly).
  root.style.setProperty('--font-reading', current.fontFamily === 'serif' ? SERIF_STACK : SANS_STACK)
  root.classList.toggle('nc-dark', resolveDark(current.theme))
  // Verse layout on the Bible reader: 'line' puts each verse on its own line (CSS-driven).
  root.classList.toggle('nc-verse-line', current.verseLayout === 'line')
}

/** Apply cached settings immediately (before sign-in) to avoid a flash. */
export function applyCachedSettings() {
  apply()
  if (!systemWatched && window.matchMedia) {
    systemWatched = true
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (current.theme === 'system') apply()
    })
  }
}

/**
 * Live-sync from the shared store once signed in (server wins), re-applying on every change.
 * onSettingsRaw fires immediately with the current stored settings and again whenever they change -
 * including a change made on another device or on Coram Deo - so a signed-in setting change reaches
 * this reader within a second, no reload. No-clobber: apply only the keys the server actually stores;
 * seed the user's local choices up once if the store is empty.
 */
let unsubSettings = null
export function initSettings() {
  onUser((u, client) => {
    // Rebind on user change (sign-in/out/switch).
    if (unsubSettings) { try { unsubSettings() } catch { /* ignore */ } unsubSettings = null }
    if (!client) return
    let seeded = false
    unsubSettings = client.onSettingsRaw((raw) => {
      const { updatedAt, ...vals } = raw || {}
      if (Object.keys(vals).length) {
        // Server has settings -> apply only the keys it actually stores (don't clobber local with defaults).
        current = { ...current, ...vals }
        saveCache()
        apply()
        refreshOpenMenu() // if the gear menu is open, track the change in its toggles too
      } else if (!seeded) {
        // No server settings yet -> migrate the user's local choices up, once.
        seeded = true
        client.setSettings(current).catch((e) => warn('seed settings', e))
      }
    }, (e) => warn('load settings', e))
  })
}

function set(key, value) {
  current = { ...current, [key]: value }
  apply()
  saveCache()
  const c = getClient()
  if (c) c.setSetting(key, value).catch((e) => warn('save setting', e))
}

// ---- gear menu ----
let menuEl = null
let menuRefreshers = [] // per-row fns that re-sync toggle states from `current` (for live updates)
const onEsc = (e) => { if (e.key === 'Escape') closeMenu() }
const onOutside = (e) => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-nc-settings-btn]')) closeMenu() }

// Re-sync the OPEN menu's toggles to `current` — called when a live settings snapshot arrives (a
// change on another device / Coram Deo) so the popup's pressed states track the reader, which apply()
// already updated. No-op when the menu is closed.
function refreshOpenMenu() {
  if (!menuEl) return
  menuRefreshers.forEach((fn) => { try { fn() } catch { /* ignore */ } })
}

function closeMenu() {
  menuEl?.remove(); menuEl = null
  menuRefreshers = []
  document.removeEventListener('mousedown', onOutside)
  document.removeEventListener('keydown', onEsc)
}

function sectionTitle(text, divider) {
  return el('div', 'nc-menu__section' + (divider ? ' nc-menu__section--divider' : ''), text)
}

function segRow(label, options, key) {
  const row = el('div', 'nc-menu__row')
  row.appendChild(el('span', 'nc-menu__label', label))
  const seg = el('div', 'nc-seg')
  const refresh = () => seg.querySelectorAll('.nc-seg__btn').forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === current[key])))
  for (const [val, txt] of options) {
    const b = el('button', 'nc-seg__btn', txt)
    b.type = 'button'
    b.onclick = () => { set(key, val); refresh() }
    seg.appendChild(b)
  }
  refresh()
  menuRefreshers.push(refresh) // let live settings updates re-sync this row's pressed state
  row.appendChild(seg)
  return row
}

export function toggleSettingsMenu(anchor) {
  if (menuEl) { closeMenu(); return }
  menuRefreshers = []
  menuEl = el('div', 'nc-menu')
  // Section 1 — applies everywhere on the site.
  menuEl.appendChild(sectionTitle('All resources'))
  menuEl.appendChild(segRow('Appearance', [['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']], 'theme'))
  menuEl.appendChild(segRow('Text Size', [['sm', 'S'], ['base', 'M'], ['lg', 'L'], ['xl', 'XL']], 'fontSize'))
  menuEl.appendChild(segRow('Font', [['sans', 'Sans'], ['serif', 'Serif']], 'fontFamily'))
  // Section 2 — Bible reader only (divider + heading).
  menuEl.appendChild(sectionTitle('Bible only', true))
  const trans = (typeof window !== 'undefined' && window.__NC_TRANSLATIONS) || []
  if (trans.length > 1) {
    // value = SDK vocabulary (e.g. 'BSB'/'KJV'); verse popups + reference links honor it.
    menuEl.appendChild(segRow('Bible Translation', trans.map((t) => [String(t.id).toUpperCase(), String(t.id).toUpperCase()]), 'translation'))
  }
  // Verse layout (mirrors Coram Deo; 'line' is shown as "Verse").
  menuEl.appendChild(segRow('Verse Layout', [['paragraph', 'Paragraph'], ['line', 'Verse']], 'verseLayout'))
  document.body.appendChild(menuEl)
  const r = anchor.getBoundingClientRect()
  const w = 290
  menuEl.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px'
  menuEl.style.top = (r.bottom + 8) + 'px'
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0)
  document.addEventListener('keydown', onEsc)
}
