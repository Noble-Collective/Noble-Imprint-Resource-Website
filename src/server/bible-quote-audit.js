// Library-wide quotation-integrity audit (admin feature).
//
// Walks every parenthetical / << citation in the library, pulls the quoted
// passage beside it, and diffs it against our CURRENT stored Bible text. Groups
// results into tiers by how much judgment they need. Read-only — proposes
// nothing, writes nothing.
//
// Pure classification lives in bible-citations.js; this adds the I/O (list files
// via github, look up verse text via the in-memory bible module).

const github = require('./github');
const bible = require('./bible');
const citations = require('./bible-citations');
const { listLibraryMarkdown } = require('./bible-sync');

const PER_TIER_CAP = 300; // bound findings per tier for payload/Firestore size

function finding(cite, path, res, quote, verseText) {
  return {
    ref: cite.refString,
    file: path,
    reason: res.reason,
    coverage: Math.round((res.coverage || 0) * 100),
    onlyInQuote: res.onlyInQuote || [],
    quote,
    verse: verseText,
  };
}

async function auditLibraryQuotations(opts = {}) {
  const translationId = opts.translationId || 'bsb';
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  await bible.loadBibles();
  const hasRef = r => bible.getVerse(translationId, r) != null;
  const getText = r => bible.getVerse(translationId, r) || '';

  const files = await listLibraryMarkdown();
  const counts = {};
  const tiers = { review: [], minor: [], differentTranslation: [] };
  const truncated = { review: false, minor: false, differentTranslation: false };
  let checked = 0;

  const push = (bucketKey, item) => {
    const b = tiers[bucketKey];
    if (b.length < PER_TIER_CAP) b.push(item);
    else truncated[bucketKey] = true;
  };

  for (const path of files) {
    let content;
    try { ({ content } = await github.getFileContent(path)); }
    catch { continue; }
    for (const cite of citations.detectFullCitations(content)) {
      const q = citations.quoteForCitation(content, cite.index);
      if (!q) continue;
      const vr = citations.expandCitationRefs(cite.refString, hasRef);
      if (!vr.length) continue;
      const verseText = vr.map(getText).join(' ');
      const res = citations.auditQuoteAgainstText(q.quote, verseText);
      if (res.status === 'skip-short') continue;
      checked++;
      const key = res.status === 'deviation' ? res.reason : res.status;
      counts[key] = (counts[key] || 0) + 1;
      if (res.status === 'deviation') {
        const bucketKey = res.tier === 'review' ? 'review'
          : res.tier === 'different-translation' ? 'differentTranslation' : 'minor';
        push(bucketKey, finding(cite, path, res, q.quote, verseText));
      }
    }
  }

  // Sort each tier lowest-coverage-first (most different at the top).
  for (const k of Object.keys(tiers)) tiers[k].sort((a, b) => a.coverage - b.coverage);

  return {
    translationId,
    startedAt,
    durationMs: Date.now() - t0,
    scannedFiles: files.length,
    checked,
    counts,
    cosmetic: { caseOnly: counts['case-only'] || 0, formatOnly: counts['format-only'] || 0 },
    tiers,
    truncated,
    comparedAgainst: 'current stored BSB (references.json)',
  };
}

module.exports = { auditLibraryQuotations };
