// BSB text-integrity validation — PURE functions only.
//
// This module compares our stored copy of a Bible translation against the
// official public-domain master published at bereanbible.com:
//   - Verse text:  our references.json  vs  the official bsb.txt
//   - Structure:   our content/*.SFM    vs  the official bsb_usfm.zip
//
// Everything here is dependency-free (Node built-ins only: `zlib`) so it is
// unit-testable without installing node_modules. Network fetching, GitHub
// reads, and Firestore persistence live in the caller (admin-routes.js), which
// feeds raw strings/buffers into these functions.

const zlib = require('zlib');

// A verse key looks like "Genesis 1:1", "1 Samuel 3:10", "Song of Solomon 2:1".
// Same filter bible.js uses to drop the copyright/"Verse" header rows.
const VERSE_KEY_RE = /^[A-Z1-3].*\s\d+:\d+$/;

function isVerseKey(key) {
  return VERSE_KEY_RE.test(key);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// Parse bereanbible.com's bsb.txt: tab-delimited "Reference<TAB>text", preceded
// by 2 attribution lines and a "Verse<TAB>Berean Standard Bible" header row.
// Returns a Map of ref → text (verses with empty text are kept as "").
function parseBsbTxt(text) {
  const map = new Map();
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const ref = line.slice(0, tab).trim();
    const verse = line.slice(tab + 1);
    if (!isVerseKey(ref)) continue; // skips the attribution + "Verse" header rows
    map.set(ref, verse);
  }
  return map;
}

// Parse our references.json (raw JSON string or already-parsed object) into the
// same ref → text Map, dropping the non-verse metadata keys.
function parseReferences(jsonOrString) {
  const obj = typeof jsonOrString === 'string' ? JSON.parse(jsonOrString) : jsonOrString;
  const map = new Map();
  for (const [key, value] of Object.entries(obj)) {
    if (!isVerseKey(key)) continue;
    map.set(key, typeof value === 'string' ? value : String(value));
  }
  return map;
}

// ── Normalization ────────────────────────────────────────────────────────────

// Fold cosmetic-only differences so we can tell "the words differ" apart from
// "the encoding differs" (curly vs straight quotes, dash variants, NBSP, NFC).
// Used for the second comparison pass only — the exact pass compares verbatim.
function normalizeVerse(s) {
  return String(s)
    .normalize('NFC')
    // curly / prime quotes → straight
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    // dash variants (hyphen, non-breaking hyphen, figure/en/em/horizontal) → hyphen-minus
    .replace(/[‐‑‒–—―]/g, '-')
    // ellipsis → three dots
    .replace(/…/g, '...')
    // zero-width characters (ZWSP, ZWNJ, ZWJ, BOM) → removed entirely
    .replace(/[​‌‍﻿]/g, '')
    // markdown emphasis markers (never appear in scripture text) → removed
    .replace(/[_*]/g, '')
    // collapse all whitespace — JS \s already covers NBSP, thin/narrow spaces,
    // ideographic space, tabs, newlines — into a single normal space
    .replace(/\s+/g, ' ')
    .trim();
}

// Report where two strings first diverge, with a little surrounding context.
// Purely for human-readable diagnostics in the report.
function firstDivergence(a, b) {
  const max = Math.max(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  const from = Math.max(0, i - 20);
  return {
    index: i,
    oursContext: a.slice(from, i + 20),
    officialContext: b.slice(from, i + 20),
  };
}

// ── Change-anchor (shared by the sync + citation-audit features) ─────────────

// Last `n` whole words of a prefix / first `n` whole words of a suffix. Word-
// based (not char-based) so context ends cleanly ON a word and never drags in
// trailing punctuation. Returned pieces are exact substrings.
function tailWords(prefix, n) {
  const m = [...prefix.matchAll(/\S+/g)];
  if (m.length <= n) return prefix;
  return prefix.slice(m[m.length - n].index);
}
function headWords(suffix, n) {
  const m = [...suffix.matchAll(/\S+/g)];
  if (m.length <= n) return suffix;
  const w = m[n - 1];
  return suffix.slice(0, w.index + w[0].length);
}

// Minimal-but-anchored window around the part of a verse that changed, with
// `contextWords` of surrounding unchanged words on each side. oldAnchor is a
// verbatim substring of oldText, newAnchor of newText, differing only by the
// change — so searching prose for oldAnchor catches partial quotations that
// include the change, and replacing with newAnchor snaps exactly that span.
function computeChangeAnchor(oldText, newText, contextWords = 2) {
  const maxP = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < maxP && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < maxP - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;

  const prefix = oldText.slice(0, p);
  const suffix = oldText.slice(oldText.length - s);
  const oldMiddle = oldText.slice(p, oldText.length - s);
  const newMiddle = newText.slice(p, newText.length - s);

  const before = tailWords(prefix, contextWords);
  const after = headWords(suffix, contextWords);
  const oldAnchor = before + oldMiddle + after;
  const newAnchor = before + newMiddle + after;
  return { oldAnchor, newAnchor, oldMiddle, newMiddle, changed: oldAnchor !== newAnchor };
}

// ── Verse-text comparison (Check A) ──────────────────────────────────────────

// Compare our verse map against the official verse map.
// Returns totals plus arrays of discrepancies. `oursMap`/`officialMap` are Maps.
function diffVerses(oursMap, officialMap) {
  const missingInOurs = []; // ref present in official, absent from ours
  const extraInOurs = [];   // ref present in ours, absent from official
  const textMismatch = [];  // present in both, real (non-cosmetic) text difference
  const cosmeticOnly = [];  // present in both, differ only after normalization fold

  for (const [ref, official] of officialMap) {
    if (!oursMap.has(ref)) {
      missingInOurs.push({ ref, official });
      continue;
    }
    const ours = oursMap.get(ref);
    if (ours === official) continue; // exact match
    if (normalizeVerse(ours) === normalizeVerse(official)) {
      cosmeticOnly.push({ ref, ours, official });
    } else {
      textMismatch.push({ ref, ours, official, divergence: firstDivergence(ours, official) });
    }
  }

  for (const ref of oursMap.keys()) {
    if (!officialMap.has(ref)) extraInOurs.push({ ref, ours: oursMap.get(ref) });
  }

  const matched = officialMap.size - missingInOurs.length - textMismatch.length - cosmeticOnly.length;
  return {
    totals: {
      official: officialMap.size,
      ours: oursMap.size,
      matched,
      textMismatch: textMismatch.length,
      cosmeticOnly: cosmeticOnly.length,
      missingInOurs: missingInOurs.length,
      extraInOurs: extraInOurs.length,
    },
    missingInOurs,
    extraInOurs,
    textMismatch,
    cosmeticOnly,
  };
}

// ── ZIP reading (dependency-free) ────────────────────────────────────────────

// Minimal ZIP reader using only zlib. Reads the central directory, then inflates
// each stored/deflated entry. Returns a Map of entryName → utf-8 content.
// Sufficient for bereanbible.com's bsb_usfm.zip (standard deflate, no encryption).
function parseZip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const EOCD_SIG = 0x06054b50;
  const CDH_SIG = 0x02014b50;

  // Locate End Of Central Directory record (scan backwards; comment is usually empty).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a valid ZIP: EOCD not found');

  const total = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // central directory offset

  const out = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(ptr) !== CDH_SIG) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf-8', ptr + 46, ptr + 46 + nameLen);

    // Jump to the local header to find where the actual data begins.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);

    if (!name.endsWith('/')) { // skip directory entries
      let content;
      if (method === 0) content = compData;                          // stored
      else if (method === 8) content = zlib.inflateRawSync(compData); // deflate
      else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
      out.set(name, content.toString('utf-8'));
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ── Structure comparison (Check B) ───────────────────────────────────────────

// Reduce a USFM filename to its canonical book code so our files match the
// official zip's regardless of naming convention:
//   ours     "01GENBSB.SFM"     → strip ".SFM", 2-digit order prefix, "BSB" tag → "GEN"
//   ours     "091SABSB.SFM"     → strip "09" and "BSB"                          → "1SA"
//   official "bsb_usfm/GEN.usfm"→ basename, strip ".usfm"                       → "GEN"
//   official "bsb_usfm/1CH.usfm"→ (1 is a single digit, not a 2-digit prefix)   → "1CH"
// Book codes never begin with two digits, so the ^\d{2} strip only removes our
// order index, never a book number like the "1" in 1 Samuel.
function bookCode(name) {
  return name
    .split(/[\\/]/).pop()
    .replace(/\.(sfm|usfm)$/i, '')
    .toUpperCase()
    .replace(/^\d{2}/, '')
    .replace(/BSB$/, '');
}

// Raw line-diffing USFM is meaningless here: our USFM and the official
// bsb_usfm.zip are two different USFM *encodings* of the same text (theirs is
// autogenerated by bereanbible.com's bsb2usfm tool), so a byte/line comparison
// is ~90k lines of markup-convention noise. Instead we extract the SEMANTIC
// apparatus the sites actually consume — section headings (this reader) and
// footnotes (the Coram Deo study app) — and compare those per book.

// Section headings (\s, \s1..\s4) as { text, ref } where ref is the "chapter:verse"
// the heading introduces (the verse that follows it) — so the UI can show where
// each heading difference lives instead of a bare, context-free string.
function extractHeadings(usfm) {
  const out = [];
  let ch = 0, pending = [];
  for (const line of String(usfm).split(/\r?\n/)) {
    const cm = line.match(/^\s*\\c\s+(\d+)/);
    if (cm) { ch = parseInt(cm[1], 10); continue; }
    const hm = line.match(/^\s*\\s[1-4]?\s+(.+)$/);
    if (hm) { pending.push(normalizeVerse(stripInlineMarkers(hm[1]))); continue; }
    const vm = line.match(/^\s*\\v\s+(\d+)/);
    if (vm && pending.length) {
      const ref = ch + ':' + vm[1];
      for (const t of pending) out.push({ text: t, ref });
      pending = [];
    }
  }
  for (const t of pending) out.push({ text: t, ref: ch ? ch + ':?' : '?' });
  return out;
}

// Footnotes as { text, ref } where ref is the "chapter:verse" the footnote sits
// in. Each footnote is the span from "\f " to "\f*"; we strip the caller, the
// \fr origin reference, and all footnote sub-markers, keeping the prose. The
// official USFM wraps scripture references in \ref display|target\ref* markup
// where ours stores plain text, so we reduce \ref to its display text and drop
// the space-before-punctuation that \ref* stripping leaves — encoding artifacts.
// A single ordered scan tracks \c/\v so each footnote gets its location.
function extractFootnotes(usfm) {
  const out = [];
  const re = /\\c\s+(\d+)|\\v\s+(\d+)|\\f\s[\s\S]*?\\f\*/g;
  const s = String(usfm);
  let ch = 0, vs = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) { ch = parseInt(m[1], 10); continue; }
    if (m[2] !== undefined) { vs = parseInt(m[2], 10); continue; }
    const n = footnoteText(m[0]);
    if (n) out.push({ text: n, ref: ch + ':' + vs });
  }
  return out;
}

// Normalized prose of a single "\f … \f*" footnote span — the caller, \fr origin
// reference, and all sub-markers stripped, \ref reduced to display text. Shared
// by the compare (extractFootnotes) and the sync apply so they agree exactly.
function footnoteText(span) {
  const text = String(span)
    .replace(/\\f\s*[+\-?]?\s*/, ' ')                    // opening marker + caller symbol
    .replace(/\\fr\s+\S+/g, ' ')                         // origin reference, e.g. "1:3"
    .replace(/\\ref\s+([^|\\]*)\|[^\\]*\\ref\*/g, '$1')  // \ref Genesis 5:32|GEN 5:32\ref* → "Genesis 5:32"
    .replace(/\\f\*/g, ' ')                              // closing marker
    .replace(/\\f[a-z]+\*?/g, ' ');                      // \ft \fq \fqa \fk … and their closers
  return normalizeVerse(text).replace(/\s+([.,;:!?])/g, '$1');
}

// Strip inline character markers (\add \wj \nd \it …, opening and closing) from
// a heading/text fragment, leaving the plain words.
function stripInlineMarkers(s) {
  return s.replace(/\\\+?[a-z]+\d*\*?/g, ' ');
}

// Order-insensitive multiset difference of two string arrays.
function multisetDiff(a, b) {
  const counts = new Map();
  for (const x of a) { const e = counts.get(x) || { a: 0, b: 0 }; e.a++; counts.set(x, e); }
  for (const x of b) { const e = counts.get(x) || { a: 0, b: 0 }; e.b++; counts.set(x, e); }
  const onlyA = [], onlyB = [];
  for (const [k, e] of counts) {
    if (e.a > e.b) for (let i = 0; i < e.a - e.b; i++) onlyA.push(k);
    else if (e.b > e.a) for (let i = 0; i < e.b - e.a; i++) onlyB.push(k);
  }
  return { onlyA, onlyB };
}

// Multiset difference of two object arrays, matched by keyFn (e.g. normalized
// text). Returns the extra OBJECTS on each side (preserving their .ref, etc.).
function multisetDiffBy(a, b, keyFn) {
  const counts = new Map();
  for (const x of a) { const k = keyFn(x); const e = counts.get(k) || { a: [], b: [] }; e.a.push(x); counts.set(k, e); }
  for (const x of b) { const k = keyFn(x); const e = counts.get(k) || { a: [], b: [] }; e.b.push(x); counts.set(k, e); }
  const onlyA = [], onlyB = [];
  for (const [, e] of counts) {
    if (e.a.length > e.b.length) for (const x of e.a.slice(e.b.length)) onlyA.push(x);
    else if (e.b.length > e.a.length) for (const x of e.b.slice(e.a.length)) onlyB.push(x);
  }
  return { onlyA, onlyB };
}

// Compare the semantic apparatus of all our USFM files against the official set.
// oursFiles / officialFiles are Maps of filename → content.
// opts.footnotes (default true) toggles the footnote comparison.
function diffStructure(oursFiles, officialFiles, opts = {}) {
  const compareFootnotes = opts.footnotes !== false;
  const ours = new Map();
  for (const [name, c] of oursFiles) ours.set(bookCode(name), { name, content: c });
  const official = new Map();
  for (const [name, c] of officialFiles) official.set(bookCode(name), { name, content: c });

  const books = [];
  const missingBooks = [];
  const extraBooks = [];
  let booksWithHeadingDiffs = 0, booksWithFootnoteDiffs = 0;
  let headingOnlyOurs = 0, headingOnlyOfficial = 0;
  let footnoteOnlyOurs = 0, footnoteOnlyOfficial = 0;
  let headingsOurs = 0, headingsOfficial = 0, footnotesOurs = 0, footnotesOfficial = 0;

  for (const [key, off] of official) {
    if (!ours.has(key)) { missingBooks.push(off.name); continue; }
    const oc = ours.get(key).content;

    const ohs = extractHeadings(oc), fhs = extractHeadings(off.content);
    headingsOurs += ohs.length; headingsOfficial += fhs.length;
    const hd = multisetDiffBy(ohs, fhs, x => x.text);

    let fd = { onlyA: [], onlyB: [] };
    if (compareFootnotes) {
      const ofn = extractFootnotes(oc), ffn = extractFootnotes(off.content);
      footnotesOurs += ofn.length; footnotesOfficial += ffn.length;
      fd = multisetDiffBy(ofn, ffn, x => x.text);
    }

    const hasHeadingDiff = hd.onlyA.length || hd.onlyB.length;
    const hasFootnoteDiff = fd.onlyA.length || fd.onlyB.length;
    if (hasHeadingDiff) { booksWithHeadingDiffs++; headingOnlyOurs += hd.onlyA.length; headingOnlyOfficial += hd.onlyB.length; }
    if (hasFootnoteDiff) { booksWithFootnoteDiffs++; footnoteOnlyOurs += fd.onlyA.length; footnoteOnlyOfficial += fd.onlyB.length; }
    if (hasHeadingDiff || hasFootnoteDiff) {
      books.push({
        book: off.name,
        headings: { onlyInOurs: hd.onlyA, onlyInOfficial: hd.onlyB },
        footnotes: { onlyInOurs: fd.onlyA, onlyInOfficial: fd.onlyB },
      });
    }
  }
  for (const [key, o] of ours) {
    if (!official.has(key)) extraBooks.push(o.name);
  }

  return {
    totals: {
      booksChecked: official.size,
      booksMatched: official.size - books.length - missingBooks.length,
      booksWithHeadingDiffs,
      booksWithFootnoteDiffs,
      headings: { ours: headingsOurs, official: headingsOfficial, onlyOurs: headingOnlyOurs, onlyOfficial: headingOnlyOfficial },
      footnotes: { ours: footnotesOurs, official: footnotesOfficial, onlyOurs: footnoteOnlyOurs, onlyOfficial: footnoteOnlyOfficial },
      missingBooks: missingBooks.length,
      extraBooks: extraBooks.length,
    },
    books,
    missingBooks,
    extraBooks,
  };
}

// ── Overall status ───────────────────────────────────────────────────────────

// A run passes when there are no real (non-cosmetic) verse differences and no
// structural (heading/footnote/book) differences. Cosmetic-only verse diffs are
// surfaced but don't fail.
function overallStatus(verse, structure) {
  const verseClean = verse.totals.textMismatch === 0 &&
    verse.totals.missingInOurs === 0 && verse.totals.extraInOurs === 0;
  const structureClean = !structure || (
    structure.totals.booksWithHeadingDiffs === 0 &&
    structure.totals.booksWithFootnoteDiffs === 0 &&
    structure.totals.missingBooks === 0 && structure.totals.extraBooks === 0);
  return (verseClean && structureClean) ? 'pass' : 'fail';
}

// Run async `fn` over `items` with at most `limit` in flight. Results keep input
// order; a failing item becomes null. onProgress(done, total) fires per completion.
async function mapLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let idx = 0, done = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); } catch { results[i] = null; }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

module.exports = {
  mapLimit,
  isVerseKey,
  parseBsbTxt,
  parseReferences,
  normalizeVerse,
  firstDivergence,
  computeChangeAnchor,
  diffVerses,
  parseZip,
  bookCode,
  extractHeadings,
  extractFootnotes,
  footnoteText,
  stripInlineMarkers,
  multisetDiff,
  multisetDiffBy,
  diffStructure,
  overallStatus,
};
