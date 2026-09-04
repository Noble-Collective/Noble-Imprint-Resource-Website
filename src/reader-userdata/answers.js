// Per-question answers: a textarea under each <div class="question-block" data-question-id>, with
// debounced autosave to users/{uid}/answers/{deterministic id}. Loads existing answers on sign-in.
import { seriesLocator } from '@noble-collective/userdata/core'
import { getClient, onUser } from './firebase.js'
import { el, warn, debounce } from './util.js'

const SAVE_MS = 800
let CTX = null
const fields = new Map()
const listeners = []
export const onAnswers = (cb) => listeners.push(cb)
const answersState = new Map() // questionId -> text (for the library panel)
export const getAnswers = () => answersState

export function initAnswers(ctx) {
  CTX = ctx
  document.querySelectorAll('.question-block[data-question-id]').forEach((block) => {
    const id = block.getAttribute('data-question-id')
    if (!id || fields.has(id)) return
    const wrap = el('div', 'nc-answer')
    wrap.setAttribute('data-nc-skip', '')
    const ta = el('textarea', 'nc-answer__ta')
    ta.rows = 2
    ta.placeholder = 'Sign in to write your answer…'
    ta.disabled = true
    const status = el('span', 'nc-answer__status', '')
    wrap.append(ta, status)
    block.appendChild(wrap)
    const save = debounce(async () => {
      const client = getClient()
      if (!client) return
      status.textContent = 'Saving…'
      const v = ta.value.trim()
      answersState.set(id, v)
      try {
        const loc = seriesLocator(CTX.bookPath, CTX.sessionFile, { questionId: id, contentVersion: CTX.contentVersion || undefined })
        if (v) await client.putAnswer(loc, v)
        else await client.deleteAnswer(loc)
        status.textContent = 'Saved'
      } catch (e) { warn('save answer', e); status.textContent = 'Save failed' }
      listeners.forEach((cb) => cb(answersState))
    }, SAVE_MS)
    ta.addEventListener('input', () => { status.textContent = 'Editing…'; save() })
    fields.set(id, { ta, status })
  })

  onUser(async (u, client) => {
    if (!client) {
      answersState.clear()
      for (const { ta, status } of fields.values()) { ta.disabled = true; ta.value = ''; ta.placeholder = 'Sign in to write your answer…'; status.textContent = '' }
      listeners.forEach((cb) => cb(answersState))
      return
    }
    for (const { ta } of fields.values()) { ta.disabled = false; ta.placeholder = 'Write your answer…' }
    try {
      const all = await client.listAnswers()
      const mine = new Map()
      for (const a of all) {
        const l = a.locator || {}
        if (l.bookPath === CTX.bookPath && l.sessionFile === CTX.sessionFile && l.questionId) mine.set(l.questionId, a.answer)
      }
      for (const [id, { ta, status }] of fields) {
        if (mine.has(id)) { ta.value = mine.get(id); status.textContent = 'Saved'; answersState.set(id, mine.get(id)) }
      }
      listeners.forEach((cb) => cb(answersState))
    } catch (e) { warn('load answers', e) }
  })
}

/** Scroll to and flash a question by id (for the library panel). */
export function scrollToQuestion(id) {
  const block = document.querySelector(`.question-block[data-question-id="${window.CSS && CSS.escape ? CSS.escape(id) : id}"]`)
  if (block) { block.scrollIntoView({ behavior: 'smooth', block: 'center' }); block.classList.remove('nc-jumpflash'); void block.offsetWidth; block.classList.add('nc-jumpflash'); setTimeout(() => block.classList.remove('nc-jumpflash'), 2600) }
}
