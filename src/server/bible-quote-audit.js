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

// Word-level LCS alignment: the matched (quote-word, verse-word) index pairs, in
// increasing order. Lets us locate where a quote maps into a verse even when the
// boundary words are substitutions (e.g. "came"/"come", "abundantly"/"fullness").
function alignWords(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const pairs = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { pairs.unshift({ qi: i - 1, vi: j - 1 }); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  return pairs;
}

// The BSB wording for the span a quote actually covers — so a "Fix" replaces the
// quote with just that scripture fragment, not the whole verse. We align the quote
// to the verse by word-LCS (tolerating boundary word differences), narrowed to the
// most COMPACT window of the verse that still explains the whole quote (so a word the
// quote repeats — "a pit" vs the verse's two "pit"s — doesn't spread the span), then
// take the verse text from the first to the last aligned word, extended to cover the
// words the quote substituted at each edge:
//   • if the aligned span reaches near a verse end, run to that end (quotes stop at
//     natural breaks) — this captures "abundantly" → "in all its fullness";
//   • otherwise extend by the count of substituted boundary quote words, stopping
//     at the first clause punctuation — this trims a trailing clause the quote
//     never covered (e.g. John 1:9 "…everyone" not "…into the world").
// Finally the span's trailing punctuation is matched to the quote's, so a quote that
// stopped mid-sentence ("…forgot him") doesn't gain a period it never had.
// Returns null when the quote can't be aligned confidently (a real paraphrase).
function lcsLen(a, b) {
  const m = b.length, dp = new Array(m + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= m; j++) { const t = dp[j]; dp[j] = a[i] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = t; }
  }
  return dp[m];
}
function correctQuote(quote, verseText) {
  const tokens = String(verseText).split(/(\s+)/); // words + whitespace, preserved
  const vw = []; // { l: normalized-lowercase, tok: token index, raw: original token }
  tokens.forEach((tok, i) => { if (tok.trim()) vw.push({ l: v.normalizeVerse(tok).toLowerCase(), tok: i, raw: tok }); });
  if (vw.length < 3) return null;
  // De-bracket the quote (editorial [..] marks aren't the Bible's wording) and drop
  // inline markdown emphasis markers so "_word_"/"**word**" align to the plain verse.
  // Compare on BARE words (punctuation stripped) so "pit" matches "pit." — otherwise a
  // repeated word could anchor to the wrong (differently-punctuated) occurrence.
  const bare = w => w.replace(/[^a-z0-9]/g, '');
  const qw = v.normalizeVerse(String(quote).replace(/\[[^\]]*\]/g, ' ').replace(/[_*`]+/g, '')).toLowerCase().split(/\s+/).map(bare).filter(Boolean);
  if (qw.length < 3) return null;

  // Narrow to the most compact verse window that still yields the full LCS: the earliest
  // end and the latest start that each preserve it. This anchors a repeated quote word to
  // the occurrence nearest the rest of the match, not a far one.
  const vl = vw.map(w => bare(w.l));
  const full = lcsLen(qw, vl);
  if (full < 2) return null;
  let winEnd = vl.length;
  for (let k = 1; k <= vl.length; k++) { if (lcsLen(qw, vl.slice(0, k)) === full) { winEnd = k; break; } }
  let winStart = 0;
  for (let k = 0; k < vl.length; k++) { if (lcsLen(qw, vl.slice(k)) === full) winStart = k; else break; }
  const matches = alignWords(qw, vl.slice(winStart, winEnd)).map(p => ({ qi: p.qi, vi: p.vi + winStart }));
  if (matches.length < 2) return null;
  const qi0 = matches[0].qi, qi1 = matches[matches.length - 1].qi;
  const vi0 = matches[0].vi, vi1 = matches[matches.length - 1].vi;
  const NEAR = 4; // words-from-a-verse-edge that we treat as "reaches the edge"

  // Leading boundary.
  let startVi;
  if (vi0 <= NEAR) startVi = 0;
  else startVi = Math.max(0, vi0 - qi0);

  // Trailing boundary.
  let endVi;
  if ((vw.length - 1) - vi1 <= NEAR) endVi = vw.length - 1;
  else {
    endVi = vi1;
    let steps = (qw.length - 1) - qi1; // substituted quote words after the last match
    while (steps > 0 && endVi < vw.length - 1) {
      endVi++; steps--;
      if (/[.,;:!?”"']$/.test(vw[endVi].raw)) break; // stop at a clause boundary
    }
  }

  let span = tokens.slice(vw[startVi].tok, vw[endVi].tok + 1).join('').trim();
  const spanWords = span.split(/\s+/).filter(Boolean).length;
  if (spanWords > qw.length * 2.5 + 4) return null; // alignment ballooned — bail
  // If the quote stopped mid-sentence (no terminal . ! ? before any closing quote), drop
  // the terminal/clause punctuation the span picked up from the verse — so an embedded
  // quote doesn't gain a period it never had (Genesis 40:23 "…forgot him"). Closing quote
  // marks are kept. When the quote DOES end a sentence, the span is left exactly as-is.
  const qEndsSentence = /[.!?][”"'’)\]]*\s*$/.test(String(quote));
  if (!qEndsSentence) span = span.replace(/[.,;:!?]+([”"'’)\]]*)\s*$/, '$1');
  return span || null;
}

// Peel the wrapper markup off the edges of a raw quote block so a Fix can preserve
// it: leading blockquote markers / opening quotes / emphasis, and the matching
// trailing markers — leaving the scripture "core" (sentence punctuation stays in the
// core). E.g. "> _Christ … him._ " → open "> _", core "Christ … him.", close "_ ".
// `peelQuotes` controls whether quotation marks count as wrapper: true for INLINE quotes
// (the "…" delimits the quote) but false for blockquote/attribution, where a trailing
// quote mark is part of the scripture (Jesus's speech) and must NOT be peeled/duplicated.
const EDGE_WITH_QUOTES = /[>\s_*`"'“”‘’]/;
const EDGE_NO_QUOTES = /[>\s_*`]/;
function peelRaw(raw, peelQuotes) {
  const re = peelQuotes ? EDGE_WITH_QUOTES : EDGE_NO_QUOTES;
  const s = String(raw);
  let i = 0, j = s.length;
  while (i < j && re.test(s[i])) i++;
  while (j > i && re.test(s[j - 1])) j--;
  return { open: s.slice(0, i), core: s.slice(i, j), close: s.slice(j) };
}

// Build a "Fix" for a deviation. `span` is the aligned scripture (used to highlight
// the covered words in the verse). `replacement` is the EXPLICIT source text the
// reviewer edits and that will be written verbatim — the scripture re-wrapped in the
// quote's original markdown (blockquote/italics/bold), so applying a Fix preserves
// that formatting instead of flattening it. Falls back to the full cited verse when
// the quote can't be aligned (e.g. a different-translation passage).
function computeFix(q, res, verseText) {
  if (res.status !== 'deviation') return { ok: false };
  const corrected = correctQuote(q.quote, verseText) || String(verseText).trim();
  if (!corrected || v.normalizeVerse(corrected) === v.normalizeVerse(q.quote)) return { ok: false };
  // Inline quotes wrap the scripture in "…"; blockquotes don't (a trailing quote there is
  // scripture), so only peel quote marks for inline.
  const { open, close } = peelRaw(q.raw, q.kind !== 'attribution');
  const replacement = (open + corrected + close).replace(/\s+$/, '');
  return { ok: true, oldRaw: q.raw, span: corrected, replacement, preview: replacement };
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
      pos: cite.index, // char offset in the file — for ordering findings by book position
      kind: q.kind, quote: q.quote, verse: verseText, context: q.context || q.quote,
      sessionTitle: sessionTitle, sessionUrl: sessionUrl,
      fix: computeFix(q, res, verseText),
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

  // Map each session file → its live site URL (for the "Show session" link) and its
  // reading order (tree order → so findings sort by where they appear in the book).
  const urlByPath = new Map();
  const orderByPath = new Map();
  let seq = 0;
  for (const series of tree.series) {
    for (const child of series.children) {
      if (child.type === 'book') for (const se of child.sessions) { urlByPath.set(se.path, content.sessionUrl(series, null, child, se)); orderByPath.set(se.path, seq++); }
      else if (child.type === 'subseries') for (const bk of child.books) for (const se of bk.sessions) { urlByPath.set(se.path, content.sessionUrl(series, child, bk, se)); orderByPath.set(se.path, seq++); }
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
    const minor = (bcount['footnote-artifact'] || 0) + (bcount['ellipsis-omission'] || 0);
    const diffTransl = bcount['heavy-difference'] || 0;
    const rec = {
      title: g.meta.title, series: g.meta.series, coverPath: g.meta.coverPath,
      files: g.files.length, quotes: bChecked,
      exact: bcount['exact'] || 0, caseOnly: bcount['case-only'] || 0, formatOnly: bcount['format-only'] || 0,
      bracketed: bcount['bracketed-match'] || 0,
      review, minor, diffTransl, paraphrase: bcount['paraphrase'] || 0,
      // Order findings by where they appear in the book: session reading order, then
      // character offset within the session.
      findings: findings.sort((a, b) =>
        ((orderByPath.get(a.file) ?? 1e9) - (orderByPath.get(b.file) ?? 1e9)) || ((a.pos || 0) - (b.pos || 0))
      ).slice(0, 60),
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

module.exports = { runStreamingQuoteAudit, scanText, auditLibraryQuotations, correctQuote, computeFix, peelRaw };

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
