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
  const drifted = result.verseCheck.textMismatch.items; // [{ ref, ours, official, ... }]

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

  const libraryChanges = [];
  const files = await listLibraryMarkdown();
  // 4. Citation-anchored audit: for every parenthetical/`<<` citation of a
  //    changed verse, diff the quoted passage beside it against the verse.
  //    Complements the span search — catches quotes whose encoding differs from
  //    the anchor (missed by verbatim search) and flags divergent paraphrases.
  const citationReview = [];

  for (const path of files) {
    let content;
    try { ({ content } = await github.getFileContent(path)); }
    catch { continue; }

    // Span search → actionable snaps (works for cited and uncited quotes alike).
    for (const a of anchors) {
      const hits = findOccurrences(content, a.oldAnchor);
      hits.forEach((hit, i) => {
        libraryChanges.push({
          type: 'library-quote',
          ref: a.ref,
          file: path,
          occurrenceIndex: i,
          oldText: a.oldAnchor,
          newText: a.newAnchor,
          context: hit.context,
        });
      });
    }

    // Citation audit → targeted diff of quotations of the changed verses.
    const cites = citations.detectFullCitations(content);
    for (const c of cites) {
      for (const d of drifted) {
        if (!citations.citationCoversRef(c.refString, d.ref)) continue;
        const q = citations.quoteForCitation(content, c.index);
        if (!q) continue;
        const cls = citations.classifyQuote(q.quote, d.ours, d.official);
        if (!cls || cls.status === 'current') continue;
        citationReview.push({
          ref: d.ref,
          file: path,
          citation: c.refString,
          kind: q.kind,
          status: cls.status,          // 'stale' | 'divergent'
          autoFixable: !!cls.apply,    // a matching span change exists to Accept
          quote: q.quote,
          oldText: d.ours,
          newText: d.official,
        });
      }
    }
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

// ── Apply a single accepted change (GitHub write) ──────────────────────────────

async function applyChange(change) {
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
  listLibraryMarkdown,
  detectSyncChanges,
  applyChange,
};
