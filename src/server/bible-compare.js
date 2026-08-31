// Streaming "Compare to current BSB" — the consolidated check that replaces the
// old Run-Validation + Scan buttons. It fetches the publisher's live text ONCE,
// walks every book of the Bible comparing our stored copy against the source,
// and emits progress events so the admin UI can render a live checklist proving
// a deterministic (non-AI) program is systematically verifying each book. At the
// end it assembles the actionable Accept/Reject changes.

const crypto = require('crypto');
const github = require('./github');
const v = require('./bible-validation');
const sync = require('./bible-sync');

const BSB_TXT_URL = 'https://bereanbible.com/bsb.txt';
const BSB_USFM_ZIP_URL = 'https://bereanbible.com/bsb_usfm.zip';

// Group a ref→text Map into Map<bookName, [{ref,text}]> preserving file order.
function groupByBook(map) {
  const books = new Map();
  for (const [ref, text] of map) {
    const m = ref.match(/^(.+?)\s+\d+:\d+$/);
    if (!m) continue;
    const book = m[1];
    if (!books.has(book)) books.set(book, []);
    books.get(book).push({ ref, text });
  }
  return books;
}

// USFM 3-letter book code → full display name (so the UI never shows raw "1PE").
const USFM_BOOK_NAMES = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah',
  LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea', JOL: 'Joel', AMO: 'Amos',
  OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah', NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah',
  HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi', MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke',
  JHN: 'John', ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
  GAL: 'Galatians', EPH: 'Ephesians', PHP: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy', '2TI': '2 Timothy',
  TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews', JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter',
  '1JN': '1 John', '2JN': '2 John', '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// opts.emit(event) is called for each progress event. opts.bookDelayMs paces the
// per-book stream so the checklist is visibly systematic (default 18ms).
async function runStreamingCompare(opts = {}) {
  const emit = opts.emit || (() => {});
  const translationId = opts.translationId || 'bsb';
  const bookDelayMs = opts.bookDelayMs != null ? opts.bookDelayMs : 0; // client paces the reveal
  const t0 = Date.now();

  // 1 & 2. Download official verse text + structure concurrently.
  emit({ type: 'step', key: 'download-verses', label: 'Downloading official verse text from bereanbible.com', status: 'running' });
  emit({ type: 'step', key: 'download-usfm', label: 'Downloading official structure (headings + footnotes) from bereanbible.com', status: 'running' });
  const [txtRes, zipRes] = await Promise.all([fetch(BSB_TXT_URL), fetch(BSB_USFM_ZIP_URL)]);
  if (!txtRes.ok) throw new Error(`bsb.txt fetch failed: ${txtRes.status}`);
  if (!zipRes.ok) throw new Error(`bsb_usfm.zip fetch failed: ${zipRes.status}`);
  const txt = await txtRes.text();
  const lastModified = txtRes.headers.get('last-modified');
  const sha256 = crypto.createHash('sha256').update(txt).digest('hex');
  const officialVerses = v.parseBsbTxt(txt);
  emit({ type: 'step', key: 'download-verses', status: 'done', detail: `${officialVerses.size.toLocaleString()} verses · source updated ${lastModified || 'unknown'}` });
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  const officialUsfm = v.parseZip(zipBuf);
  emit({ type: 'step', key: 'download-usfm', status: 'done', detail: `${officialUsfm.size} books` });

  // 3. Our stored copy — read the 66 USFM files in parallel with live progress
  //    (sequential reads were the ~17s cold-start stall before books appeared).
  emit({ type: 'step', key: 'load-ours', label: 'Loading our stored copy from the content repository', status: 'running' });
  // references.json is ~4.6MB — larger than the GitHub contents API's 1MB inline
  // limit — so it must be read via getFileRaw (raw media type), not getFileContent.
  const raw = await github.getFileRaw(`bibles/${translationId}/references.json`);
  const oursStr = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8');
  const oursVerses = v.parseReferences(oursStr);
  const listing = await github.getDirectoryContents(`bibles/${translationId}/content`);
  const usfmNames = listing.filter(f => /\.(sfm|usfm)$/i.test(f.name)).map(f => f.name);
  let lastPct = -1;
  const contents = await v.mapLimit(usfmNames, 16,
    n => github.getFileContent(`bibles/${translationId}/content/${n}`).then(r => r.content),
    (d, t) => { const pct = Math.floor(d / t * 100); if (pct - lastPct >= 20 || d === t) { lastPct = pct; emit({ type: 'step', key: 'load-ours', status: 'running', detail: `loaded ${d}/${t} books` }); } });
  const oursUsfm = new Map();
  usfmNames.forEach((n, i) => { if (contents[i] != null) oursUsfm.set(n, contents[i]); });
  emit({ type: 'step', key: 'load-ours', status: 'done', detail: `${oursVerses.size.toLocaleString()} verses · ${oursUsfm.size} books` });

  // 4. Book-by-book verse comparison (streamed)
  emit({ type: 'step', key: 'compare', label: 'Comparing every book, verse by verse, against the source', status: 'running' });
  const officialByBook = groupByBook(officialVerses);
  const drifted = [];       // real (non-cosmetic) verse changes
  let matched = 0, cosmetic = 0, missing = 0, extra = 0;

  for (const [book, verses] of officialByBook) {
    let bChanged = 0, bCosmetic = 0, bMissing = 0;
    for (const { ref, text } of verses) {
      if (!oursVerses.has(ref)) { bMissing++; missing++; continue; }
      const ours = oursVerses.get(ref);
      if (ours === text) { matched++; }
      else if (v.normalizeVerse(ours) === v.normalizeVerse(text)) { bCosmetic++; cosmetic++; }
      else { bChanged++; drifted.push({ ref, ours, official: text }); }
    }
    emit({ type: 'book', name: book, verses: verses.length, changed: bChanged, cosmetic: bCosmetic, missing: bMissing });
    if (bookDelayMs) await sleep(bookDelayMs);
  }
  for (const ref of oursVerses.keys()) if (!officialVerses.has(ref)) extra++;
  emit({ type: 'step', key: 'compare', status: 'done', detail: `${matched.toLocaleString()} verses identical · ${drifted.length} changed · ${missing} missing · ${extra} extra` });

  // 5. Structure (headings + footnotes)
  emit({ type: 'step', key: 'structure', label: 'Checking section headings, footnotes, and cross-references', status: 'running' });
  const structure = v.diffStructure(oursUsfm, officialUsfm, { footnotes: true, crossRefs: true });
  emit({ type: 'step', key: 'structure', status: 'done', detail: `${structure.totals.booksMatched}/${structure.totals.booksChecked} books identical · ${structure.totals.booksWithHeadingDiffs} heading, ${structure.totals.booksWithFootnoteDiffs} footnote, ${structure.totals.booksWithCrossRefDiffs} cross-reference differences` });

  // 6. Library scan for quotations of changed verses (parallel + live progress)
  emit({ type: 'step', key: 'library', label: 'Scanning the library for quotations of changed verses', status: 'running' });
  let libPct = -1;
  const changes = await sync.buildChangesFromDrift(drifted, translationId, {
    onProgress: (d, t) => { const pct = Math.floor(d / t * 100); if (pct - libPct >= 20 || d === t) { libPct = pct; emit({ type: 'step', key: 'library', status: 'running', detail: `scanned ${d}/${t} files` }); } },
  });
  emit({ type: 'step', key: 'library', status: 'done', detail: `${changes.scannedFiles} files scanned · ${changes.libraryChanges.length} quotation(s) affected` });

  const result = {
    translationId,
    durationMs: Date.now() - t0,
    upstream: { lastModified, sha256, contentLength: txt.length, checkedAt: new Date().toISOString() },
    verse: { total: officialVerses.size, matched, cosmetic, changed: drifted.length, missing, extra },
    structure: {
      totals: structure.totals,
      books: structure.books.slice(0, 66).map(b => {
        const code = v.bookCode(b.book);
        return { ...b, code, bookName: USFM_BOOK_NAMES[code] || code };
      }),
    },
    changes,
  };
  emit({ type: 'result', result });
  emit({ type: 'done' });
  return result;
}

module.exports = { runStreamingCompare, groupByBook };
