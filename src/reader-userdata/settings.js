// Settings: load/apply/persist the shared user settings, and the gear menu. Applies from a local
// cache instantly (no-flash), then syncs from the shared store on sign-in. Mirrors Coram Deo:
// theme -> .nc-dark class, fontSize -> --nc-font-scale, fontFamily -> font class.
import { FONT_SCALE, DEFAULT_SETTINGS } from '@noble-collective/userdata/core'
import { onUser, getClient } from './firebase.js'
import { el, warn } from './util.js'

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

/** Sync from the shared store once signed in (server wins), then re-apply. */
export function initSettings() {
  onUser(async (u, client) => {
    if (!client) return
    try {
      const raw = await client.getSettingsRaw()
      const { updatedAt, ...vals } = raw || {}
      if (Object.keys(vals).length) {
        // Server has settings -> apply only the keys it actually stores (don't clobber local with defaults).
        current = { ...current, ...vals }
        saveCache()
        apply()
      } else {
        // No server settings yet -> migrate the user's local choices up.
        await client.setSettings(current)
      }
    } catch (e) { warn('load settings', e) }
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
const onEsc = (e) => { if (e.key === 'Escape') closeMenu() }
const onOutside = (e) => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-nc-settings-btn]')) closeMenu() }

function closeMenu() {
  menuEl?.remove(); menuEl = null
  document.removeEventListener('mousedown', onOutside)
  document.removeEventListener('keydown', onEsc)
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
  row.appendChild(seg)
  return row
}

export function toggleSettingsMenu(anchor) {
  if (menuEl) { closeMenu(); return }
  menuEl = el('div', 'nc-menu')
  menuEl.appendChild(segRow('Appearance', [['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']], 'theme'))
  menuEl.appendChild(segRow('Text Size', [['sm', 'S'], ['base', 'M'], ['lg', 'L'], ['xl', 'XL']], 'fontSize'))
  menuEl.appendChild(segRow('Font', [['sans', 'Sans'], ['serif', 'Serif']], 'fontFamily'))
  // Default Bible translation — only when the site offers more than one (value = SDK vocabulary,
  // e.g. 'BSB'/'KJV'; verse popups + reference links honor it). Shared with the app + Coram Deo.
  const trans = (typeof window !== 'undefined' && window.__NC_TRANSLATIONS) || []
  if (trans.length > 1) {
    menuEl.appendChild(segRow('Bible Translation', trans.map((t) => [String(t.id).toUpperCase(), String(t.id).toUpperCase()]), 'translation'))
  }
  document.body.appendChild(menuEl)
  const r = anchor.getBoundingClientRect()
  const w = 290
  menuEl.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px'
  menuEl.style.top = (r.bottom + 8) + 'px'
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0)
  document.addEventListener('keydown', onEsc)
}
