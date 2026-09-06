// Per-question answers: a textarea under each <div class="question-block" data-question-id>, with
// debounced autosave to users/{uid}/answers/{deterministic id}. Loads existing answers on sign-in.
import { seriesLocator } from '@noble-collective/userdata/core'
import { getClient, onUser } from './firebase.js'
import { el, warn, debounce } from './util.js'

const SAVE_MS = 800
let CTX = null
let wired = false
let ansUnsub = null       // active onAnswers subscription teardown (per signed-in session)
let ansSnapshot = []      // last live snapshot of ALL answers (across sessions)
const fields = new Map()
const listeners = []
export const onAnswers = (cb) => listeners.push(cb)
const answersState = new Map() // questionId -> text (for the notebook)
export const getAnswers = () => answersState

// One-time wiring (auth subscription) + first attach. Safe to call once per page load.
export function initAnswers(ctx) {
  if (!wired) {
    wired = true
    onUser((u, client) => { applyAuthState(client); manageAnswerSub(client) })
  }
  attachAnswers(ctx)
}

// Per-session (re)attach — rebuilds the textareas for the CURRENT .session-content. Called on first
// boot and again after an AJAX session swap (window.__ncReattach), so the reader survives nav.
export function attachAnswers(ctx) {
  CTX = ctx
  fields.clear()
  answersState.clear()
  buildFields()
  applyAuthState(getClient())
  applyAnswersToFields() // fill from the cached live snapshot (subscription persists across nav)
}

// LIVE cross-surface sync (Phase 2.6): subscribe to the answers collection so a same-account answer
// saved elsewhere shows here without a reload. One subscription per signed-in session; teardown on
// sign-out. NOTE: cross-surface answers are rare today (Coram Deo has no answers) but cross-DEVICE
// sync is real. We never clobber a field the user is actively editing (see applyAnswersToFields).
function manageAnswerSub(client) {
  if (ansUnsub) { ansUnsub(); ansUnsub = null }
  if (!client) { ansSnapshot = []; return }
  ansUnsub = client.onAnswers((rows) => { ansSnapshot = rows || []; applyAnswersToFields() },
    (e) => warn('answers subscription', e))
}

// Apply the current session's answers from the cached snapshot into the textareas — but SKIP any
// field the user is focused on or has unsaved edits in, so live updates never eat in-progress typing.
function applyAnswersToFields() {
  if (!CTX || !getClient()) return
  const mine = new Map()
  for (const a of ansSnapshot) {
    const l = a.locator || {}
    if (l.bookPath === CTX.bookPath && l.sessionFile === CTX.sessionFile && l.questionId) mine.set(l.questionId, a.answer)
  }
  for (const [id, f] of fields) {
    const { ta, status } = f
    if (ta === document.activeElement || f.dirty) continue // don't clobber active/unsaved edits
    const v = mine.has(id) ? mine.get(id) : ''
    if (ta.value !== v) { ta.value = v; status.textContent = v ? 'Saved' : '' }
    answersState.set(id, v)
  }
  listeners.forEach((cb) => cb(answersState))
}

const pageSessionTitle = () => (document.title || '').split(' — ')[0].trim()

function buildFields() {
  document.querySelectorAll('.question-block[data-question-id]').forEach((block) => {
    const id = block.getAttribute('data-question-id')
    if (!id || fields.has(id) || block.querySelector('.nc-answer')) return
    const questionText = (block.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) // before we inject the textarea
    const wrap = el('div', 'nc-answer')
    wrap.setAttribute('data-nc-skip', '')
    const ta = el('textarea', 'nc-answer__ta nc-answer__ta--locked')
    ta.rows = 2
    ta.placeholder = 'Sign in to write your answer'
    ta.readOnly = true // readOnly (not disabled) so it still receives clicks → prompt sign-in
    // Clicking the locked prompt opens the sign-in flow.
    ta.addEventListener('click', () => { if (ta.readOnly) { ta.blur(); document.dispatchEvent(new CustomEvent('nc:need-signin')) } })
    const status = el('span', 'nc-answer__status', '')
    wrap.append(ta, status)
    block.appendChild(wrap)
    const rec = { ta, status, dirty: false } // `dirty` shields in-progress typing from live updates
    const save = debounce(async () => {
      const client = getClient()
      if (!client) return
      status.textContent = 'Saving…'
      const v = ta.value.trim()
      answersState.set(id, v)
      try {
        const loc = seriesLocator(CTX.bookPath, CTX.sessionFile, { questionId: id, contentVersion: CTX.contentVersion || undefined })
        if (v) await client.putAnswer(loc, v, { href: location.pathname, sessionTitle: pageSessionTitle(), questionText })
        else await client.deleteAnswer(loc)
        status.textContent = 'Saved'
        if (ta.value.trim() === v) rec.dirty = false // no new typing during the save → safe to unshield
      } catch (e) { warn('save answer', e); status.textContent = 'Save failed' }
      listeners.forEach((cb) => cb(answersState))
    }, SAVE_MS)
    ta.addEventListener('input', () => { status.textContent = 'Editing…'; rec.dirty = true; save() })
    fields.set(id, rec)
  })
}

function applyAuthState(client) {
  if (!client) {
    answersState.clear()
    for (const { ta, status } of fields.values()) {
      ta.readOnly = true; ta.classList.add('nc-answer__ta--locked')
      ta.value = ''; ta.placeholder = 'Sign in to write your answer'; status.textContent = ''
    }
    listeners.forEach((cb) => cb(answersState))
    return
  }
  for (const { ta } of fields.values()) {
    ta.readOnly = false; ta.classList.remove('nc-answer__ta--locked'); ta.placeholder = 'Write your answer…'
  }
  applyAnswersToFields() // data comes from the live snapshot (manageAnswerSub), not a one-shot read
}

/** Scroll to and flash a question by id (for the library panel). */
export function scrollToQuestion(id) {
  const block = document.querySelector(`.question-block[data-question-id="${window.CSS && CSS.escape ? CSS.escape(id) : id}"]`)
  if (block) { block.scrollIntoView({ behavior: 'smooth', block: 'center' }); block.classList.remove('nc-jumpflash'); void block.offsetWidth; block.classList.add('nc-jumpflash'); setTimeout(() => block.classList.remove('nc-jumpflash'), 2600) }
}
