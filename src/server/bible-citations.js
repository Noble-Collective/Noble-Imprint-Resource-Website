// Citation-anchored quotation audit.
//
// The site turns verse references in book content into clickable links (see
// renderMarkdown in src/renderer/parser.js). Both find them with the shared
// scripture parser (src/vendor/scripture.cjs; Collective-Shared ARCHITECTURE §9c),
// so this module walks exactly the references the reader links, and — for any
// citation that points at a verse whose text changed upstream — pulls the quoted
// passage beside the citation and diffs it against the verse. This finds stale
// quotations in a targeted way (we know which verse is quoted) rather than by
// blind full-text search.

const { normalizeVerse, computeChangeAnchor } = require('./bible-validation');
const scripture = require('../vendor/scripture.cjs');

// The book names the shared parser links (exported for callers that list them).
const BIBLE_BOOKS = scripture.BOOKS;

// Chapter lengths that admit every verse a chapter could have (Psalm 119 has 176): coverage and
// expansion only need a reference's shape — whether a verse exists is the caller's hasRef.
const anyLengthsCache = new Map();
function anyLengths(book) {
  const n = scripture.CHAPTER_COUNTS[book];
  if (!n) return null;
  if (!anyLengthsCache.has(book)) anyLengthsCache.set(book, new Map(Array.from({ length: n }, (_, i) => [i + 1, 176])));
  return anyLengthsCache.get(book);
}

// "Book spec" → the verses it names, [{ book, chapter, verse }] (book as the BSB spells it).
function citationVerses(refString) {
  const m = String(refString).replace(/\u00a0/g, ' ').match(/^(.+?)\s+(\d.*)$/);
  const book = m && scripture.canonicalBook(m[1]);
  if (!book) return [];
  const p = scripture.resolvePassage(book, m[2], anyLengths);
  return p.verses.map(v => ({ book: p.book, chapter: v.chapter, verse: v.verse }));
}

// All named citations with a verse ("Book C:V", "Jude 3") in the text:
// [{ book, spec, refString, index }]. refString is the reference as written; chapter-only
// references ("Psalm 23") aren't quotations of a verse, so they're left out.
function detectFullCitations(text) {
  const out = [];
  for (const r of scripture.findReferences(text)) {
    if (r.implied || r.continuation) continue;
    if (!r.spec.includes(':') && !scripture.ONE_CHAPTER_BOOKS.has(r.book)) continue;
    out.push({ book: r.book, spec: r.spec, refString: r.text.replace(/\u00a0/g, ' '), index: r.start });
  }
  return out;
}

// Does a citation ("Book C:spec") cover a single target ref ("Book C:V")?
function citationCoversRef(refString, targetRef) {
  const t = citationVerses(targetRef);
  if (t.length !== 1) return false;
  return citationVerses(refString).some(v => v.book === t[0].book && v.chapter === t[0].chapter && v.verse === t[0].verse);
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
      // raw includes BOTH quotation marks (the exact source unit a Fix replaces), so
      // the fix keeps the quote characters; `quote` stays the inner text for matching.
      return { kind: 'inline', quote, raw: text.slice(openPos, i + 1), context: text.slice(bStart, bEnd).trim() };
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

// Expand a citation ("Book C:spec") into the individual verse refs it covers
// ("Book C:V", the BSB's spelling), keeping those hasRef(ref) says exist.
function expandCitationRefs(refString, hasRef) {
  return citationVerses(refString).map(v => `${v.book} ${v.chapter}:${v.verse}`).filter(hasRef);
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
