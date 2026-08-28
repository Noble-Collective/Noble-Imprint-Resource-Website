// Orchestration for a BSB validation run: fetch the official master from
// bereanbible.com, read our stored copy through the github.js cached path, run
// the pure diff functions, and produce a bounded result summary suitable for
// storing in Firestore and rendering in the admin console.
//
// The pure comparison logic lives in bible-validation.js (dependency-free). This
// module adds the I/O (network + GitHub) that pure functions can't have.

const github = require('./github');
const v = require('./bible-validation');

const BSB_TXT_URL = 'https://bereanbible.com/bsb.txt';
const BSB_USFM_ZIP_URL = 'https://bereanbible.com/bsb_usfm.zip';

// Cap an array of examples for storage; keep exact totals separately.
function cap(arr, n) {
  return { total: arr.length, truncated: arr.length > n, items: arr.slice(0, n) };
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`);
  return {
    text: await res.text(),
    version: { lastModified: res.headers.get('last-modified'), etag: res.headers.get('etag') },
  };
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    version: { lastModified: res.headers.get('last-modified'), etag: res.headers.get('etag') },
  };
}

// Read our USFM files for a translation via the github.js cache (Map name→content).
async function readOurUsfm(translationId) {
  const listing = await github.getDirectoryContents(`bibles/${translationId}/content`);
  const files = new Map();
  for (const f of listing) {
    if (/\.(sfm|usfm)$/i.test(f.name)) {
      const { content } = await github.getFileContent(`bibles/${translationId}/content/${f.name}`);
      files.set(f.name, content);
    }
  }
  return files;
}

// Run the full validation. Returns a bounded, JSON-serializable summary.
// opts.footnotes (default true) toggles footnote comparison in Check B.
async function runValidation(opts = {}) {
  const translationId = opts.translationId || 'bsb';
  const footnotes = opts.footnotes !== false;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // ── Check A: verse text ──
  const oursRefsRaw = await github.getFileRaw(`bibles/${translationId}/references.json`);
  const oursRefsStr = typeof oursRefsRaw === 'string' ? oursRefsRaw : Buffer.from(oursRefsRaw).toString('utf-8');
  const oursVerses = v.parseReferences(oursRefsStr);

  const bsbTxt = await fetchText(BSB_TXT_URL);
  const officialVerses = v.parseBsbTxt(bsbTxt.text);
  const vr = v.diffVerses(oursVerses, officialVerses);

  // ── Check B: semantic structure (headings + footnotes) ──
  const oursFiles = await readOurUsfm(translationId);
  const usfmZip = await fetchBuffer(BSB_USFM_ZIP_URL);
  const officialFiles = v.parseZip(usfmZip.buffer);
  const sr = v.diffStructure(oursFiles, officialFiles, { footnotes });

  const status = v.overallStatus(vr, sr);
  const durationMs = Date.now() - t0;

  // Cap example arrays for Firestore's 1 MB doc limit; totals stay exact.
  const cappedStructureBooks = sr.books.slice(0, 25).map(b => ({
    book: b.book,
    headings: { onlyInOurs: b.headings.onlyInOurs.slice(0, 20), onlyInOfficial: b.headings.onlyInOfficial.slice(0, 20) },
    footnotes: { onlyInOurs: b.footnotes.onlyInOurs.slice(0, 20), onlyInOfficial: b.footnotes.onlyInOfficial.slice(0, 20) },
  }));

  return {
    translationId,
    startedAt,
    durationMs,
    status,
    footnotesChecked: footnotes,
    upstream: { bsbTxt: bsbTxt.version, usfmZip: usfmZip.version },
    verseCheck: {
      totals: vr.totals,
      textMismatch: cap(vr.textMismatch, 25),
      missingInOurs: cap(vr.missingInOurs, 25),
      extraInOurs: cap(vr.extraInOurs, 25),
      cosmeticOnly: cap(vr.cosmeticOnly, 25),
    },
    structureCheck: {
      totals: sr.totals,
      missingBooks: sr.missingBooks,
      extraBooks: sr.extraBooks,
      books: cappedStructureBooks,
      booksTruncated: sr.books.length > 25,
    },
  };
}

module.exports = { runValidation };
