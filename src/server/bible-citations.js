// Citation-anchored quotation audit.
//
// The site turns parenthetical verse references in book content into clickable
// links (see renderMarkdown in src/renderer/parser.js). This module reuses the
// SAME citation grammar to walk those references, and — for any citation that
// points at a verse whose text changed upstream — pulls the quoted passage
// beside the citation and diffs it against the verse. This finds stale
// quotations in a targeted way (we know which verse is quoted) rather than by
// blind full-text search.
//
// The BIBLE_BOOKS list and the ref patterns below are COPIED from
// src/renderer/parser.js and must be kept in sync with it (same convention as
// usfm-audio.js ↔ the audiobook converter). If parser.js changes its citation
// grammar, mirror it here.

const { normalizeVerse, computeChangeAnchor } = require('./bible-validation');

// --- COPIED FROM parser.js (keep in sync) ---
const BIBLE_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
  'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalm', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
  'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
  'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
  '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
  '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
  'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
];
const bookNamePat = BIBLE_BOOKS.slice().sort((a, b) => b.length - a.length)
  .map(b => b.replace(/\s/g, '\\s')).join('|');
const verseSpecPat = '\\d+:\\d+(?:[–\\-]\\d+:\\d+|[–\\-]\\d+)?(?:,\\s?\\d+(?:[–\\-]\\d+)?)*';
// A fresh RegExp per call (global → stateful lastIndex).
function fullRefRe() { return new RegExp(`(${bookNamePat})\\s(${verseSpecPat})`, 'g'); }
// --- END COPIED ---

// All full "Book Ch:V" citations in the text: [{ book, spec, refString, index }].
function detectFullCitations(text) {
  const out = [];
  const re = fullRefRe();
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ book: m[1], spec: m[2], refString: `${m[1]} ${m[2]}`, index: m.index });
  }
  return out;
}

// Does a citation ("Book C:spec") cover a single target ref ("Book C:V")?
// Handles single verses, comma lists, same-chapter ranges, and cross-chapter
// ranges (start chapter..end chapter). Shorthand/complex specs default to false.
function citationCoversRef(refString, targetRef) {
  const cm = refString.match(/^(.+?)\s+(\d+):(.+)$/);
  const tm = targetRef.match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!cm || !tm) return false;
  if (cm[1] !== tm[1]) return false; // different book
  const ch = parseInt(cm[2], 10);
  const tCh = parseInt(tm[2], 10);
  const tV = parseInt(tm[3], 10);
  for (const seg of cm[3].split(/,\s?/)) {
    let mm;
    if ((mm = seg.match(/^(\d+)[–-](\d+):(\d+)$/))) { // cross-chapter range
      const sv = +mm[1], eCh = +mm[2], eV = +mm[3];
      if (tCh === ch && tV >= sv) return true;
      if (tCh > ch && tCh < eCh) return true;
      if (tCh === eCh && tV <= eV) return true;
    } else if ((mm = seg.match(/^(\d+)[–-](\d+)$/))) { // same-chapter range
      if (tCh === ch && tV >= +mm[1] && tV <= +mm[2]) return true;
    } else if ((mm = seg.match(/^(\d+)$/))) {         // single verse
      if (tCh === ch && tV === +mm[1]) return true;
    }
  }
  return false;
}

// Extract the quoted passage associated with a citation at `index`.
// Two conventions (both put the quote BEFORE the citation):
//   inline:       "quoted text" (Book C:V)
//   attribution:  > quoted text\n\n<< Book C:V
// Returns { kind, quote } or null when no adjacent quotation is found.
function quoteForCitation(text, index) {
  // inline: skip back over "(" and spaces, expect a closing quote mark
  let i = index - 1;
  while (i >= 0 && (text[i] === '(' || text[i] === ' ')) i--;
  if (i >= 0 && (text[i] === '"' || text[i] === '”' || text[i] === '\'')) {
    const closeCh = text[i];
    const openCh = closeCh === '”' ? '“' : closeCh;
    const openPos = text.lastIndexOf(openCh, i - 1);
    if (openPos !== -1 && i - openPos > 1) {
      const quote = text.slice(openPos + 1, i);
      // Surrounding paragraph = the block (between blank lines) holding the quote.
      const bStart0 = text.lastIndexOf('\n\n', openPos);
      const bStart = bStart0 === -1 ? 0 : bStart0 + 2;
      let bEnd = text.indexOf('\n\n', index);
      if (bEnd === -1) bEnd = text.length;
      return { kind: 'inline', quote, raw: quote, context: text.slice(bStart, bEnd).trim() };
    }
  }
  // attribution: citation sits on a line beginning with "<<", quote is the
  // preceding blockquote (lines starting with ">").
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  if (text.slice(lineStart, index).trimStart().startsWith('<<')) {
    const before = text.slice(0, lineStart).split('\n');
    const quoteLines = [];
    let startLine = -1, endLine = -1;
    for (let l = before.length - 1; l >= 0; l--) {
      const t = before[l].trim();
      if (t === '') { if (quoteLines.length) break; else continue; }
      if (t.startsWith('>')) { quoteLines.unshift(t.replace(/^>\s?/, '')); if (endLine === -1) endLine = l; startLine = l; }
      else break;
    }
    if (quoteLines.length) {
      return {
        kind: 'attribution',
        quote: quoteLines.join(' '),
        raw: before.slice(startLine, endLine + 1).join('\n'), // exact source block for a Fix
        context: quoteLines.join('\n'),
      };
    }
  }
  return null;
}

// Compare a quoted passage against a changed verse (raw old/new text).
// Returns:
//   { status: 'current' }                         quote matches the new verse — fine
//   { status: 'stale', apply?: {oldText,newText} } quote matches old wording;
//                                                  apply present when a clean
//                                                  verbatim edit is computable
//   { status: 'divergent' }                        differs from both (paraphrase
//                                                  or other change) — needs review
//   null                                           quote unrelated to this verse
function classifyQuote(quote, oldRaw, newRaw) {
  const nq = normalizeVerse(quote);
  if (!nq || nq.length < 12) return null;
  const no = normalizeVerse(oldRaw);
  const nn = normalizeVerse(newRaw);
  if (nn.includes(nq)) return { status: 'current' };
  if (no.includes(nq)) {
    const a = computeChangeAnchor(oldRaw, newRaw);
    // Offer a one-click apply only if the anchor appears verbatim in the raw
    // quote (encoding matches); otherwise leave it for manual review.
    if (a.changed && quote.includes(a.oldAnchor)) {
      return { status: 'stale', apply: { oldText: a.oldAnchor, newText: a.newAnchor } };
    }
    return { status: 'stale' };
  }
  return { status: 'divergent' };
}

// Expand a citation ("Book C:spec") into the individual verse refs it covers,
// using hasRef(ref) to probe verse existence for ranges/cross-chapter spans.
// Returns [] for shorthand/unparseable specs.
function expandCitationRefs(refString, hasRef) {
  const m = refString.match(/^(.+?)\s+(\d+):(.+)$/);
  if (!m) return [];
  const book = m[1], ch = parseInt(m[2], 10);
  const refs = [];
  for (const seg of m[3].split(/,\s?/)) {
    let mm;
    if ((mm = seg.match(/^(\d+)[–-](\d+):(\d+)$/))) {           // cross-chapter
      const sv = +mm[1], eCh = +mm[2], eV = +mm[3];
      for (let v = sv; ; v++) { const r = `${book} ${ch}:${v}`; if (hasRef(r)) refs.push(r); else break; }
      for (let c = ch + 1; c < eCh; c++) for (let v = 1; ; v++) { const r = `${book} ${c}:${v}`; if (hasRef(r)) refs.push(r); else break; }
      for (let v = 1; v <= eV; v++) { const r = `${book} ${eCh}:${v}`; if (hasRef(r)) refs.push(r); }
    } else if ((mm = seg.match(/^(\d+)[–-](\d+)$/))) {          // same-chapter range
      for (let v = +mm[1]; v <= +mm[2]; v++) { const r = `${book} ${ch}:${v}`; if (hasRef(r)) refs.push(r); }
    } else if ((mm = seg.match(/^(\d+)$/))) {                   // single verse
      const r = `${book} ${ch}:${mm[1]}`; if (hasRef(r)) refs.push(r);
    }
  }
  return refs;
}

// Length of the longest common subsequence of two word arrays.
function wordLcs(a, b) {
  const dp = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Word-level diff via LCS backtrack. Returns the words present only in `a`
// (the quote) and only in `b` (the verse).
function diffWords(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const onlyA = [], onlyB = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { onlyA.unshift(a[--i]); }
    else { onlyB.unshift(b[--j]); }
  }
  while (i > 0) onlyA.unshift(a[--i]);
  while (j > 0) onlyB.unshift(b[--j]);
  return { onlyA, onlyB };
}

// Strip to bare lowercase words (drop all punctuation) for a format-only check.
function bareWords(s) {
  return normalizeVerse(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Audit a quotation against the current verse text it cites.
//   exact       — normalized quote is a substring of the verse(s): faithful
//   deviation   — high word overlap but NOT exact: a near-verbatim quote that
//                 drifted from our current Bible (the thing worth reviewing)
//   paraphrase  — low overlap: not a verbatim quote, ignore
//   skip-short  — too short to judge
// minCoverage is the fraction of quote words that must appear (in order) in the
// verse for it to count as an intended verbatim quote.
function auditQuoteAgainstText(quote, verseText, opts = {}) {
  const minCoverage = opts.minCoverage != null ? opts.minCoverage : 0.6;
  const nqO = normalizeVerse(quote);
  const nvO = normalizeVerse(verseText);
  if (!nqO || nqO.length < 12) return { status: 'skip-short' };
  if (!nvO) return { status: 'paraphrase', coverage: 0 };
  const nq = nqO.toLowerCase();
  const nv = nvO.toLowerCase();
  if (nv.includes(nq)) {
    // Matches word-for-word case-insensitively. Distinguish a truly exact quote
    // from one that differs only in casing (e.g. "the Lord" vs the BSB "LORD").
    return { status: nvO.includes(nqO) ? 'exact' : 'case-only', tier: nvO.includes(nqO) ? 'faithful' : 'cosmetic', quote: nqO, verse: nvO };
  }
  // Punctuation/whitespace/dash/quote differences only (words all match).
  if (bareWords(nv).includes(bareWords(nq))) {
    return { status: 'format-only', tier: 'cosmetic', quote: nqO, verse: nvO };
  }

  // Editorial brackets ([...] insertions/substitutions) are the author's marks, not the
  // Bible's — the quote is still faithful if it matches once they're set aside. Try the
  // de-bracketed quote before calling it a deviation, and use it for the word-diff so the
  // bracketed words don't corrupt the alignment of the real ones.
  const hasBrackets = /[[\]]/.test(nqO);
  let compareText = nq;
  if (hasBrackets) {
    const deBr = normalizeVerse(quote.replace(/\[[^\]]*\]/g, ' '));
    const deBrL = deBr.toLowerCase();
    if (deBr.length >= 8 && (nvO.toLowerCase().includes(deBrL) || bareWords(nv).includes(bareWords(deBr)))) {
      return { status: 'bracketed-match', tier: 'faithful', reason: 'editorial-bracket', quote: nqO, verse: nvO };
    }
    compareText = deBrL;
  }

  const vw = nv.split(' ');
  const qw = compareText.split(' ').filter(Boolean);
  const { onlyA } = diffWords(qw, vw);
  if (hasBrackets) {
    // A bracketed substitution ([our] for "your", [Jesus] for "He") shifts the word
    // alignment, so the LCS can flag a couple of real words as "different". If every
    // offending word actually appears somewhere in the verse (compared bare, ignoring the
    // attached punctuation), the quote introduced no foreign wording — faithful, just
    // bracketed. A genuinely different word (e.g. "abundantly" for "fullness") is not in
    // the verse and keeps it a deviation.
    const vbare = new Set(bareWords(nv).split(' '));
    if (onlyA.every(w => vbare.has(w.replace(/[^a-z0-9]/g, '')))) {
      return { status: 'bracketed-match', tier: 'faithful', reason: 'editorial-bracket', quote: nqO, verse: nvO };
    }
  }
  const coverage = (qw.length - onlyA.length) / qw.length;
  if (coverage < minCoverage) return { status: 'paraphrase', tier: 'ignore', coverage };

  // Word-level deviation — sub-classify by what the offending (non-bracket) words look like.
  let reason, tier;
  if (onlyA.length && onlyA.every(w => /^[a-z0-9]$/.test(w))) { reason = 'footnote-artifact'; tier = 'minor'; }
  else if (/\.\.\.|…/.test(nqO)) { reason = 'ellipsis-omission'; tier = 'minor'; }
  else if (onlyA.length <= 4) { reason = 'word-difference'; tier = 'review'; }   // a few words off → likely misquote/older wording
  else { reason = 'heavy-difference'; tier = 'different-translation'; }           // many words off → probably a different translation
  return { status: 'deviation', reason, tier, coverage, onlyInQuote: onlyA, quote: nqO, verse: nvO };
}

module.exports = {
  BIBLE_BOOKS,
  detectFullCitations,
  citationCoversRef,
  quoteForCitation,
  classifyQuote,
  expandCitationRefs,
  wordLcs,
  diffWords,
  auditQuoteAgainstText,
};
