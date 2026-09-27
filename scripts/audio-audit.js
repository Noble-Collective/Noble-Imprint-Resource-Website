// Audio-highlight audit: for every narrated sentence of the audiobooks (and a Bible sample), how much
// of the listening time the page lights the RIGHT text. Drives the real player on real pages
// (headless Chromium against a running site) and reads window.__audioPlayer.debugAlignment().
//
//   node scripts/audio-audit.js [--base http://localhost:8080] [--bible-only|--books-only] [--json out.json]
//
// A local server needs real audio: set AUDIO_DEV_SOURCE=https://resources.noblecollective.org
// (src/server/audio.js) unless its service account can read the audio bucket. Read-only.
//
// Scoring (by duration): "exact" = the lit text folds (letters+digits) to the sentence's text (after
// turning spoken references back into written ones); "partial" = lit but different (the narration's
// spoken form differs from the page — e.g. a removed parenthetical); "unlit" = not placed.
// "multiVerse" (Bible) = a highlight covering more than one verse number.
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const BASE = opt('--base', 'http://localhost:8080')
const JSON_OUT = opt('--json', null)

const BOOKS = [
  '/a-library-of-classics/a-pastoral-shelf/oration-ii',
  '/a-library-of-classics/a-philosophical-shelf/on-the-shortness-of-life',
  '/narrative-journey-series/foundations/lappel-du-christ',
  '/narrative-journey-series/foundations/the-call-of-christ',
  '/passage/homestead',
  '/vade-mecum/hear-my-son',
]
const BIBLE = [['Genesis', [1, 28, 50]], ['Exodus', [20]], ['Psalm', [1, 23, 119, 136]], ['Proverbs', [1, 31]],
  ['Song of Solomon', [1]], ['Isaiah', [40, 53]], ['Matthew', [5]], ['Luke', [1, 2]], ['John', [1, 3]],
  ['Romans', [8]], ['Ephesians', [1]], ['2 Timothy', [1]], ['Hebrews', [11]], ['Revelation', [21]]]

const fold = (s) => s.toLowerCase().replace(/[^a-z0-9À-￿]/g, '').replace(/[ -⯿-]/g, '')

async function sessionsOf(page, bookUrl) {
  await page.goto(BASE + bookUrl)
  const hrefs = await page.$$eval(`a[href^="${bookUrl}/"]`, (as) => [...new Set(as.map((a) => a.getAttribute('href')))])
  return hrefs.filter((h) => h.split('/').length === bookUrl.split('/').length + 1)
}

async function auditPage(page, url, isBible) {
  await page.goto(BASE + url)
  if (!(await page.$('#audio-fab'))) return null
  await page.waitForFunction(() => window.__audioPlayer && window.__audioPlayer.debugAlignment(), null, { timeout: 60000 })
  const rows = await page.evaluate(() => window.__audioPlayer.debugAlignment())
  const r = { url, n: rows.length, time: 0, exact: 0, partial: 0, unlit: 0, multiVerse: 0, worst: [] }
  const written = await page.evaluate((texts) => texts.map((t) => window.NCNarration.writtenReferences(t)), rows.map((x) => x.text))
  rows.forEach((row, i) => {
    const d = Math.max(0, row.end - row.start)
    r.time += d
    if (!row.lit) { r.unlit += d; r.worst.push(['UNLIT', row.text.slice(0, 90)]); return }
    if (fold(row.lit) === fold(written[i])) r.exact += d
    else { r.partial += d; r.worst.push(['PARTIAL', row.text.slice(0, 60), '→', row.lit.slice(0, 60)]) }
    if (isBible && row.sups > 0) { r.multiVerse++; r.worst.push(['MULTI-VERSE', row.text.slice(0, 80)]) }
  })
  return r
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const results = []
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '100.0')
  const report = (label, rs) => {
    const t = rs.reduce((a, r) => a + r.time, 0)
    const e = rs.reduce((a, r) => a + r.exact, 0)
    const p = rs.reduce((a, r) => a + r.partial, 0)
    const u = rs.reduce((a, r) => a + r.unlit, 0)
    console.log(`${label.padEnd(34)} ${String(rs.reduce((a, r) => a + r.n, 0)).padStart(6)} segs  lit ${pct(e + p, t).padStart(5)}%  exact ${pct(e, t).padStart(5)}%  partial ${pct(p, t).padStart(4)}%  unlit ${pct(u, t).padStart(4)}%` + (label.startsWith('Bible') ? `  multi-verse ${rs.reduce((a, r) => a + r.multiVerse, 0)}` : ''))
  }
  if (!args.includes('--bible-only')) {
    for (const book of BOOKS) {
      const rs = []
      for (const s of await sessionsOf(page, book)) {
        const r = await auditPage(page, s, false)
        if (r) rs.push(r)
      }
      results.push(...rs)
      report(book.split('/').pop(), rs)
    }
  }
  if (!args.includes('--books-only')) {
    const rs = []
    for (const [book, chs] of BIBLE) {
      for (const ch of chs) {
        const r = await auditPage(page, `/bible/bsb/${encodeURIComponent(book)}?chapter=${ch}`, true)
        if (r) rs.push(r)
      }
    }
    results.push(...rs)
    report(`Bible (${rs.length} chapters)`, rs)
  }
  await browser.close()
  if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify(results, null, 1))
})()
