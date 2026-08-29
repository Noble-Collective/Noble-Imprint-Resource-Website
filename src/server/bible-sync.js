// "Apply Latest BSB Text" — detect and apply, one change at a time, the edits
// needed to bring our stored copy (and any library text that quotes it) up to
// the current official BSB.
//
// Two kinds of proposed change:
//   1. verse-store  — update a verse's text in bibles/<id>/references.json
//   2. library-quote — a book file quotes the OLD verse text verbatim; snap it
//                      to the new text (one proposal per occurrence)
//
// Nothing here writes on its own during detection. Each change is applied only
// when an admin accepts it (applyChange), producing a single scoped commit.
//
// The pure helpers (findOccurrences, replaceNthOccurrence, updateReferenceValue)
// take strings and are unit-tested without network. The scan/apply functions add
// GitHub I/O.

const github = require('./github');
const v = require('./bible-validation');
const { computeChangeAnchor } = require('./bible-validation');
const citations = require('./bible-citations');
const { runValidation } = require('./bible-validation-runner');

const CONTEXT = 45; // chars of surrounding context to show for a library match

// ── Pure helpers ──────────────────────────────────────────────────────────────

// All non-overlapping verbatim occurrences of `needle` in `haystack`, each with
// a little surrounding context for the reviewer.
function findOccurrences(haystack, needle) {
  const out = [];
  if (!needle || needle.length < 12) return out; // too short → unsafe to auto-match
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push({
      index: idx,
      context: haystack.slice(Math.max(0, idx - CONTEXT), idx + needle.length + CONTEXT),
    });
    from = idx + needle.length;
  }
  return out;
}

// Replace the nth (0-based) verbatim occurrence of `needle` with `replacement`.
// Throws if that occurrence is not found (guards against a file changing under us
// between scan and apply).
function replaceNthOccurrence(haystack, needle, replacement, n) {
  let from = 0, count = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    if (count === n) return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
    from = idx + needle.length;
    count++;
  }
  throw new Error(`Occurrence ${n} of the quoted text was not found (file changed since scan?)`);
}

// Update one verse value inside raw references.json WITHOUT reserializing the
// whole file — a targeted string replace of `"ref": "oldText"` → `"ref": "newText"`
// keeps the other ~31k lines byte-identical (clean diffs, stable key order).
// Uses JSON.stringify to build the exact quoted tokens. Returns { json, changed }.
function updateReferenceValue(rawJson, ref, oldText, newText) {
  const needle = `${JSON.stringify(ref)}: ${JSON.stringify(oldText)}`;
  const replacement = `${JSON.stringify(ref)}: ${JSON.stringify(newText)}`;
  if (rawJson.indexOf(needle) === -1) {
    // Fall back to no-space form ("ref":"text") in case formatting differs.
    const compact = `${JSON.stringify(ref)}:${JSON.stringify(oldText)}`;
    if (rawJson.indexOf(compact) === -1) return { json: rawJson, changed: false };
    return { json: rawJson.replace(compact, `${JSON.stringify(ref)}:${JSON.stringify(newText)}`), changed: true };
  }
  return { json: rawJson.replace(needle, replacement), changed: true };
}

// A stable id for a proposed change so the client can accept/reject individually.
function changeId(c) {
  if (c.type === 'verse-store') return `verse:${c.ref}`;
  return `lib:${c.file}:${c.occurrenceIndex}:${c.ref}`;
}

// ── Detection (GitHub I/O) ──────────────────────────────────────────────────────

// List every markdown file path in the content repo (single git-tree call),
// excluding the bibles/ directory (that's the source, not library prose).
async function listLibraryMarkdown() {
  const tree = await github.getTreeRecursive();
  return tree
    .filter(t => t.type === 'blob' && /\.md$/i.test(t.path) && !t.path.startsWith('bibles/'))
    .map(t => t.path);
}

// Detect all proposed changes to bring us up to current upstream.
// Returns { verseChanges, libraryChanges, drifted, scannedFiles }.
async function detectSyncChanges(opts = {}) {
  const translationId = opts.translationId || 'bsb';
  // 1. Which verses drifted (real text differences present in both copies).
  const result = await runValidation({ translationId, footnotes: false });
  return buildChangesFromDrift(result.verseCheck.textMismatch.items, translationId);
}

// Given the drifted verses ([{ ref, ours, official }]) already computed by a
// comparison, scan the library and assemble the actionable Accept/Reject changes.
// Separated from detectSyncChanges so the streaming compare can reuse it without
// fetching/validating upstream a second time.
async function buildChangesFromDrift(drifted, translationId = 'bsb', opts = {}) {
  const onProgress = opts.onProgress;
  // 2. Verse-store changes: one per drifted verse.
  const verseChanges = drifted.map(d => ({
    type: 'verse-store',
    ref: d.ref,
    file: `bibles/${translationId}/references.json`,
    oldText: d.ours,
    newText: d.official,
  }));

  // 3. Library-quote changes: scan every book file for quotations that include
  //    the changed span (anchored with surrounding context), so partial quotes
  //    are caught, not just full-verse copies.
  const anchors = drifted
    .map(d => ({ ref: d.ref, ...computeChangeAnchor(d.ours, d.official) }))
    .filter(a => a.changed);

  const files = await listLibraryMarkdown();

  // Scan one file: span search (→ library-quote changes) + citation audit
  // (→ citationReview). Runs per-file so files can be scanned in parallel.
  function scanFile(path, content) {
    const libraryChanges = [], citationReview = [];
    for (const a of anchors) {
      findOccurrences(content, a.oldAnchor).forEach((hit, i) => {
        libraryChanges.push({ type: 'library-quote', ref: a.ref, file: path, occurrenceIndex: i, oldText: a.oldAnchor, newText: a.newAnchor, context: hit.context });
      });
    }
    for (const c of citations.detectFullCitations(content)) {
      for (const d of drifted) {
        if (!citations.citationCoversRef(c.refString, d.ref)) continue;
        const q = citations.quoteForCitation(content, c.index);
        if (!q) continue;
        const cls = citations.classifyQuote(q.quote, d.ours, d.official);
        if (!cls || cls.status === 'current') continue;
        citationReview.push({ ref: d.ref, file: path, citation: c.refString, kind: q.kind, status: cls.status, autoFixable: !!cls.apply, quote: q.quote, oldText: d.ours, newText: d.official });
      }
    }
    return { libraryChanges, citationReview };
  }

  // Read + scan files in parallel (was sequential — a major cold-start stall).
  const perFile = await v.mapLimit(files, 20, async (path) => {
    let content;
    try { ({ content } = await github.getFileContent(path)); } catch { return null; }
    return scanFile(path, content);
  }, onProgress);

  const libraryChanges = [], citationReview = [];
  for (const r of perFile) {
    if (!r) continue;
    for (const c of r.libraryChanges) libraryChanges.push(c);
    for (const c of r.citationReview) citationReview.push(c);
  }

  const tag = c => ({ ...c, id: changeId(c) });
  return {
    translationId,
    drifted: drifted.map(d => ({ ref: d.ref, oldText: d.ours, newText: d.official })),
    verseChanges: verseChanges.map(tag),
    libraryChanges: libraryChanges.map(tag),
    citationReview,
    scannedFiles: files.length,
  };
}

// Replace a section-heading's text in raw USFM, matching on NORMALIZED prose
// (so curly/straight-quote and marker-encoding differences don't defeat it).
// Preserves the leading marker + indentation and any trailing CR. Pure/testable.
function replaceHeadingInUsfm(content, oldText, newText) {
  const want = v.normalizeVerse(v.stripInlineMarkers(oldText));
  const lines = String(content).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*\\s[1-4]?\s+)(.+?)(\r?)$/);
    if (m && v.normalizeVerse(v.stripInlineMarkers(m[2])) === want) {
      lines[i] = m[1] + newText + m[3];
      return { content: lines.join('\n'), changed: true };
    }
  }
  return { content, changed: false };
}

// Resolve our on-disk USFM path for a book code (e.g. "1CH" → bibles/bsb/content/131CHBSB.SFM).
async function resolveOurUsfmPath(translationId, code) {
  const listing = await github.getDirectoryContents(`bibles/${translationId}/content`);
  const hit = listing.find(f => /\.(sfm|usfm)$/i.test(f.name) && v.bookCode(f.name) === code);
  return hit ? `bibles/${translationId}/content/${hit.name}` : null;
}

// ── Apply a single accepted change (GitHub write) ──────────────────────────────

async function applyChange(change) {
  if (change.type === 'usfm-heading') {
    const translationId = change.translationId || 'bsb';
    const file = await resolveOurUsfmPath(translationId, change.bookCode);
    if (!file) throw new Error(`No USFM file found for ${change.bookCode}`);
    const { content, sha } = await github.getFileContent(file);
    const { content: updated, changed } = replaceHeadingInUsfm(content, change.oldText, change.newText);
    if (!changed) throw new Error(`Heading "${change.oldText}" not found in ${file} (already updated?)`);
    const res = await github.updateFileContent(file, updated, sha,
      `Update ${change.bookCode} heading at ${change.ref} to match latest BSB`);
    return { file, ref: change.ref, sha: res.sha };
  }


  if (change.type === 'verse-store') {
    const { content, sha } = await github.getFileContent(change.file);
    const { json, changed } = updateReferenceValue(content, change.ref, change.oldText, change.newText);
    if (!changed) throw new Error(`Verse ${change.ref} not found with the expected old text (already updated?)`);
    const res = await github.updateFileContent(change.file, json, sha,
      `Sync ${change.ref} to latest BSB\n\nUpdate verse text to match bereanbible.com master.`);
    return { file: change.file, ref: change.ref, sha: res.sha };
  }

  if (change.type === 'library-quote') {
    const { content, sha } = await github.getFileContent(change.file);
    const updated = replaceNthOccurrence(content, change.oldText, change.newText, change.occurrenceIndex);
    const res = await github.updateFileContent(change.file, updated, sha,
      `Snap ${change.ref} quotation to latest BSB in ${change.file}`);
    return { file: change.file, ref: change.ref, sha: res.sha };
  }

  throw new Error(`Unknown change type: ${change.type}`);
}

module.exports = {
  findOccurrences,
  replaceNthOccurrence,
  computeChangeAnchor,
  updateReferenceValue,
  changeId,
  replaceHeadingInUsfm,
  listLibraryMarkdown,
  detectSyncChanges,
  buildChangesFromDrift,
  applyChange,
};
