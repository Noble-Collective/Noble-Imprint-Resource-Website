// Library-wide quotation-integrity audit (admin feature).
//
// Walks every parenthetical / << citation in the library, pulls the quoted
// passage beside it, and diffs it against our CURRENT stored Bible text. Streams
// progress book-by-book and groups the results by book (with cover art). Read-
// only — proposes nothing, writes nothing.
//
// Pure classification lives in bible-citations.js; this adds the I/O.

const github = require('./github');
const bible = require('./bible');
const content = require('./content');
const citations = require('./bible-citations');
const v = require('./bible-validation');
const { listLibraryMarkdown } = require('./bible-sync');

// The BSB wording for the span a quote covers: the raw verse text from the first
// to the last quoted word (so a "Fix" replaces the quote with scripture, changing
// only what differs). Returns null when it can't be aligned confidently.
function correctQuote(quote, verseText) {
  const qWords = v.normalizeVerse(quote).split(' ').filter(Boolean);
  if (qWords.length < 3) return null;
  const tokens = String(verseText).split(/(\s+)/); // words + whitespace, preserved
  const words = [];
  tokens.forEach((tok, i) => { if (tok.trim()) words.push({ norm: v.normalizeVerse(tok).toLowerCase(), idx: i }); });
  const firstN = v.normalizeVerse(qWords[0]).toLowerCase();
  const lastN = v.normalizeVerse(qWords[qWords.length - 1]).toLowerCase();
  let start = -1;
  for (const w of words) { if (w.norm === firstN) { start = w.idx; break; } }
  if (start < 0) return null;
  let end = -1;
  for (const w of words) { if (w.idx >= start && w.norm === lastN) end = w.idx; }
  if (end < start) return null;
  const span = tokens.slice(start, end + 1).join('');
  const spanWords = span.split(/\s+/).filter(Boolean).length;
  if (spanWords < qWords.length * 0.6 || spanWords > qWords.length * 1.6) return null; // sanity
  return span;
}

// Can this deviation be auto-fixed by snapping the quote to scripture? Only for
// inline quotes (verbatim in the file) with small/mechanical word differences —
// not whole different-translation passages or paraphrases.
function computeFix(kind, res, quote, verseText) {
  if (kind !== 'inline' || res.status !== 'deviation') return { ok: false };
  if (res.reason === 'heavy-difference') return { ok: false };
  const corrected = correctQuote(quote, verseText);
  if (!corrected || v.normalizeVerse(corrected) === v.normalizeVerse(quote)) return { ok: false };
  return { ok: true, newText: corrected };
}

// Audit every citation+quote in one file's text against the Bible.
// Returns findings with the info the UI needs (nice title, session link, fix).
function scanText(text, path, hasRef, getText, sessionTitle, sessionUrl) {
  const out = [];
  for (const cite of citations.detectFullCitations(text)) {
    const q = citations.quoteForCitation(text, cite.index);
    if (!q) continue;
    const vr = citations.expandCitationRefs(cite.refString, hasRef);
    if (!vr.length) continue;
    const verseText = vr.map(getText).join(' ');
    const res = citations.auditQuoteAgainstText(q.quote, verseText);
    if (res.status === 'skip-short') continue;
    out.push({
      status: res.status, reason: res.reason, tier: res.tier,
      coverage: res.coverage != null ? Math.round(res.coverage * 100) : undefined,
      onlyInQuote: res.onlyInQuote || [], ref: cite.refString, file: path,
      kind: q.kind, quote: q.quote, verse: verseText,
      sessionTitle: sessionTitle, sessionUrl: sessionUrl,
      fix: computeFix(q.kind, res, q.quote, verseText),
    });
  }
  return out;
}

// First H1 title in a markdown file (the nice session name), else null.
function h1Of(text) {
  const m = String(text).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

const tierOf = f => f.tier === 'review' ? 'review' : f.tier === 'different-translation' ? 'differentTranslation' : 'minor';

// Streaming audit: emits per-book progress + a book-grouped result.
async function runStreamingQuoteAudit(opts = {}) {
  const emit = opts.emit || (() => {});
  const translationId = opts.translationId || 'bsb';
  const t0 = Date.now();

  emit({ type: 'step', key: 'load', label: 'Loading the Bible and indexing the library', status: 'running' });
  await bible.loadBibles();
  const hasRef = r => bible.getVerse(translationId, r) != null;
  const getText = r => bible.getVerse(translationId, r) || '';
  const tree = await content.buildContentTree();
  const books = content.getAllBooks(tree)
    .map(b => ({ repoPath: b.repoPath, title: b.title, coverPath: b.coverPath || null, series: b.seriesTitle || '', sub: b.subseriesTitle || '' }))
    .sort((a, b) => b.repoPath.length - a.repoPath.length); // longest-prefix match first

  // Map each session file → its live site URL (for the "Show session" link).
  const urlByPath = new Map();
  for (const series of tree.series) {
    for (const child of series.children) {
      if (child.type === 'book') for (const se of child.sessions) urlByPath.set(se.path, content.sessionUrl(series, null, child, se));
      else if (child.type === 'subseries') for (const bk of child.books) for (const se of bk.sessions) urlByPath.set(se.path, content.sessionUrl(series, child, bk, se));
    }
  }

  const TEST_BOOK = 'series/Narrative Journey Series/Foundations/Test Book/';
  const files = (await listLibraryMarkdown()).filter(f => !f.startsWith(TEST_BOOK));
  emit({ type: 'step', key: 'load', status: 'done', detail: `${books.length} books · ${files.length} files` });

  // Group library files under their book (by repoPath prefix).
  const groups = new Map();
  const other = [];
  for (const f of files) {
    const bk = books.find(b => f === b.repoPath || f.startsWith(b.repoPath + '/'));
    if (bk) {
      if (!groups.has(bk.repoPath)) groups.set(bk.repoPath, { meta: bk, files: [] });
      groups.get(bk.repoPath).files.push(f);
    } else { other.push(f); }
  }
  if (other.length) groups.set('__other__', { meta: { repoPath: '__other__', title: 'Other files', coverPath: null, series: 'ZZ' }, files: other });
  const ordered = [...groups.values()].sort((a, b) =>
    (a.meta.series + '|' + a.meta.title).localeCompare(b.meta.series + '|' + b.meta.title));

  emit({ type: 'step', key: 'scan', label: 'Auditing quotations, book by book', status: 'running' });
  const perBook = [];
  const counts = {};
  let checked = 0;

  for (const g of ordered) {
    const contents = await v.mapLimit(g.files, 12, async p => {
      try { return (await github.getFileContent(p)).content; } catch { return null; }
    });
    const bcount = {};
    const findings = [];
    let bChecked = 0;
    contents.forEach((cnt, idx) => {
      if (cnt == null) return;
      const title = h1Of(cnt);
      for (const f of scanText(cnt, g.files[idx], hasRef, getText, title, urlByPath.get(g.files[idx]) || null)) {
        checked++; bChecked++;
        const key = f.status === 'deviation' ? f.reason : f.status;
        counts[key] = (counts[key] || 0) + 1;
        bcount[key] = (bcount[key] || 0) + 1;
        if (f.status === 'deviation') findings.push(f);
      }
    });
    const review = bcount['word-difference'] || 0;
    const minor = (bcount['footnote-artifact'] || 0) + (bcount['ellipsis-omission'] || 0) + (bcount['editorial-bracket'] || 0);
    const diffTransl = bcount['heavy-difference'] || 0;
    const rec = {
      title: g.meta.title, series: g.meta.series, coverPath: g.meta.coverPath,
      files: g.files.length, quotes: bChecked,
      exact: bcount['exact'] || 0, caseOnly: bcount['case-only'] || 0, formatOnly: bcount['format-only'] || 0,
      review, minor, diffTransl, paraphrase: bcount['paraphrase'] || 0,
      findings: findings.slice(0, 60).sort((a, b) => (a.coverage || 0) - (b.coverage || 0)),
    };
    perBook.push(rec);
    emit({ type: 'book', title: rec.title, series: rec.series, coverPath: rec.coverPath, quotes: rec.quotes, exact: rec.exact, review: rec.review, diffs: review + minor + diffTransl });
  }
  emit({ type: 'step', key: 'scan', status: 'done', detail: `${checked} quotations checked across ${ordered.length} books` });

  const result = {
    translationId, durationMs: Date.now() - t0, checked, counts,
    comparedAgainst: 'current stored BSB', books: perBook,
  };
  emit({ type: 'result', result });
  emit({ type: 'done' });
  return result;
}

module.exports = { runStreamingQuoteAudit, scanText, auditLibraryQuotations };

// ── Legacy non-streaming audit (kept for compatibility) ────────────────────────
async function auditLibraryQuotations(opts = {}) {
  const translationId = opts.translationId || 'bsb';
  await bible.loadBibles();
  const hasRef = r => bible.getVerse(translationId, r) != null;
  const getText = r => bible.getVerse(translationId, r) || '';
  const files = await listLibraryMarkdown();
  const counts = {}; const tiers = { review: [], minor: [], differentTranslation: [] };
  let checked = 0;
  for (const path of files) {
    let text; try { ({ content: text } = await github.getFileContent(path)); } catch { continue; }
    for (const f of scanText(text, path, hasRef, getText)) {
      checked++;
      const key = f.status === 'deviation' ? f.reason : f.status;
      counts[key] = (counts[key] || 0) + 1;
      if (f.status === 'deviation' && tiers[tierOf(f)].length < 300) tiers[tierOf(f)].push(f);
    }
  }
  return { translationId, scannedFiles: files.length, checked, counts, tiers, comparedAgainst: 'current stored BSB' };
}
