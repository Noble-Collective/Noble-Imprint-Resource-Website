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
const bible = require('./bible');

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
function replaceHeadingInUsfm(content, oldText, newText, ref) {
  // ADD (BSB has a heading ours lacks) → insert "\s1 <text>" before the ref verse.
  if (!oldText) return insertLineBeforeVerse(content, ref, '\\s1 ' + newText);
  const want = v.normalizeVerse(v.stripInlineMarkers(oldText));
  const lines = String(content).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*\\s[1-4]?\s+)(.+?)(\r?)$/);
    if (m && v.normalizeVerse(v.stripInlineMarkers(m[2])) === want) {
      if (!newText) lines.splice(i, 1);            // DELETE (ours has a heading BSB lacks)
      else lines[i] = m[1] + newText + m[3];       // REPLACE
      return { content: lines.join('\n'), changed: true };
    }
  }
  return { content, changed: false };
}

// Insert a whole line (e.g. "\s1 …" or "\r …") immediately before the \v of `ref`.
function insertLineBeforeVerse(content, ref, newLine) {
  if (!ref) return { content, changed: false };
  const [ch, vs] = String(ref).split(':');
  const lines = String(content).split('\n');
  let curCh = 0;
  for (let i = 0; i < lines.length; i++) {
    const cm = lines[i].match(/^\s*\\c\s+(\d+)/); if (cm) { curCh = cm[1]; continue; }
    const vm = lines[i].match(/^\s*\\v\s+(\d+)/);
    if (vm && String(curCh) === String(ch) && vm[1] === String(vs)) {
      lines.splice(i, 0, newLine);
      return { content: lines.join('\n'), changed: true };
    }
  }
  return { content, changed: false };
}

// Replace a footnote's text in raw USFM, matching by verse ref + normalized
// prose. Our footnotes are all the simple form "\f <caller> \fr <ref> \ft <prose>\f*"
// (verified: no \fq/\fk/multi-part), so we rebuild that canonical form with the
// new prose, preserving the caller and \fr. Matching uses the SAME normalization
// as the compare (v.footnoteText) so encoding differences don't defeat it.
function replaceFootnoteInUsfm(content, ref, oldText, newText, anchor) {
  const s = String(content);
  // ADD (BSB has a footnote ours lacks) → insert it at the same in-verse position the
  // BSB puts it (right after the `anchor` words that precede the caller in the source),
  // falling back to end-of-verse only if the anchor text can't be located.
  if (!oldText) return appendFootnoteToVerse(s, ref, newText, anchor);
  const re = /\\c\s+(\d+)|\\v\s+(\d+)|\\f\s[\s\S]*?\\f\*/g;
  let ch = 0, vs = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) { ch = parseInt(m[1], 10); continue; }
    if (m[2] !== undefined) { vs = parseInt(m[2], 10); continue; }
    if (ref && ch + ':' + vs !== ref) continue;
    const span = m[0];
    if (v.footnoteText(span) !== oldText) continue;
    if (!newText) {  // DELETE (ours has a footnote BSB lacks) → drop the whole span
      return { content: s.slice(0, m.index) + s.slice(m.index + span.length), changed: true };
    }
    const caller = (span.match(/\\f\s*([+\-?])/) || [null, '+'])[1];
    const fr = (span.match(/\\fr\s+(\S+)/) || [null, ''])[1];
    const rebuilt = '\\f ' + caller + (fr ? ' \\fr ' + fr : '') + ' \\ft ' + newText + '\\f*';
    return { content: s.slice(0, m.index) + rebuilt + s.slice(m.index + span.length), changed: true };
  }
  return { content, changed: false };
}

// Insert a canonical footnote span into the verse `ref`. If `anchor` (the words the BSB
// places just before the caller) is given and found in the verse, the span is inserted
// right after it — matching the publisher's exact position. Otherwise it lands at the end
// of the verse's first line. Collects all lines of the verse so mid-verse (poetry) anchors
// work too.
function appendFootnoteToVerse(content, ref, newText, anchor) {
  const [ch, vs] = String(ref).split(':');
  const lines = String(content).split('\n');
  const span = '\\f + \\fr ' + ref + ' \\ft ' + newText + '\\f*';
  let curCh = 0, inVerse = false;
  const verseIdxs = [];
  for (let i = 0; i < lines.length; i++) {
    const cm = lines[i].match(/^\s*\\c\s+(\d+)/); if (cm) { if (inVerse) break; curCh = cm[1]; continue; }
    const vm = lines[i].match(/^\s*\\v\s+(\d+)/);
    if (vm) {
      if (inVerse) break;
      if (String(curCh) === String(ch) && vm[1] === String(vs)) { inVerse = true; verseIdxs.push(i); }
      continue;
    }
    if (inVerse) verseIdxs.push(i);
  }
  if (!verseIdxs.length) return { content, changed: false };

  if (anchor) {
    for (const idx of verseIdxs) {
      const pos = findAnchorEnd(lines[idx], anchor);
      if (pos >= 0) { lines[idx] = lines[idx].slice(0, pos) + span + lines[idx].slice(pos); return { content: lines.join('\n'), changed: true }; }
    }
  }
  // Fallback: end of the verse's first line, preserving any trailing CR.
  const fm = lines[verseIdxs[0]].match(/^(.*?)(\r?)$/);
  lines[verseIdxs[0]] = fm[1] + span + fm[2];
  return { content: lines.join('\n'), changed: true };
}

// Char index just after `anchor` in `line`. Tries the full anchor, then shorter word
// tails, so minor punctuation/edition differences in the leading words don't defeat it.
function findAnchorEnd(line, anchor) {
  let i = line.indexOf(anchor);
  if (i >= 0) return i + anchor.length;
  const words = anchor.split(' ');
  for (const n of [4, 3, 2]) {
    if (words.length >= n) {
      const tail = words.slice(-n).join(' ');
      i = line.indexOf(tail);
      if (i >= 0) return i + tail.length;
    }
  }
  return -1;
}

// Replace a \r parallel-passage cross-reference line, matching by normalized
// display text (our copy stores these as plain text, no \ref markup). We write the
// official RAW display form (real dashes/parens preserved), keeping our plain-text
// style. Matches the first \r line whose reduced+normalized text equals oldText.
function replaceCrossRefInUsfm(content, ref, oldText, newText) {
  // ADD (BSB has a \r ours lacks) → insert "\r <text>" before the ref verse.
  if (!oldText) return insertLineBeforeVerse(content, ref, '\\r ' + newText);
  const lines = String(content).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*\\r\s+)(.+?)(\r?)$/);
    if (m && v.normalizeVerse(v.crossRefRaw(m[2])) === oldText) {
      if (!newText) lines.splice(i, 1);           // DELETE (ours has a \r BSB lacks)
      else lines[i] = m[1] + newText + m[3];      // REPLACE
      return { content: lines.join('\n'), changed: true };
    }
  }
  return { content, changed: false };
}

// Read a file too large for the contents API's 1MB inline limit (references.json
// is ~4.6MB): content via getFileRaw (raw media type), sha via the git tree.
async function readBigFile(file) {
  const raw = await github.getFileRaw(file);
  const content = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8');
  let sha;
  const tree = await github.getTreeRecursive();
  const entry = tree.find(t => t.path === file);
  if (entry) sha = entry.sha;
  return { content, sha };
}

// Resolve our on-disk USFM path for a book code (e.g. "1CH" → bibles/bsb/content/131CHBSB.SFM).
async function resolveOurUsfmPath(translationId, code) {
  const listing = await github.getDirectoryContents(`bibles/${translationId}/content`);
  const hit = listing.find(f => /\.(sfm|usfm)$/i.test(f.name) && v.bookCode(f.name) === code);
  return hit ? `bibles/${translationId}/content/${hit.name}` : null;
}

// ── Apply a single accepted change (GitHub write) ──────────────────────────────

// Keep the rendered Bible reader in sync after a Bible-copy commit: rebuild the
// in-memory + on-disk .bible-cache from the just-committed repo content. Fire-and-forget
// so it never blocks the accept response; the warm instance serves fresh on its next
// request. (Cold containers get a fresh committed cache via the refresh-cache workflow.)
function refreshReader() {
  Promise.resolve().then(() => bible.reload()).catch(err => console.warn('bible reader refresh failed:', err.message));
}

async function applyChange(change) {
  if (change.type === 'usfm-heading' || change.type === 'usfm-footnote' || change.type === 'usfm-crossref') {
    const kind = change.type === 'usfm-heading' ? 'heading' : change.type === 'usfm-footnote' ? 'footnote' : 'cross-reference';
    const translationId = change.translationId || 'bsb';
    const file = await resolveOurUsfmPath(translationId, change.bookCode);
    if (!file) throw new Error(`No USFM file found for ${change.bookCode}`);
    const { content, sha } = await github.getFileContent(file);
    const { content: updated, changed } = change.type === 'usfm-heading'
      ? replaceHeadingInUsfm(content, change.oldText, change.newText, change.ref)
      : change.type === 'usfm-footnote'
        ? replaceFootnoteInUsfm(content, change.ref, change.oldText, change.newText, change.anchor)
        : replaceCrossRefInUsfm(content, change.ref, change.oldText, change.newText);
    if (!changed) throw new Error(`${kind} "${change.oldText || change.newText}" not found in ${file} (already updated?)`);
    const verb = !change.oldText ? 'Add' : !change.newText ? 'Remove' : 'Update';
    const res = await github.updateFileContent(file, updated, sha,
      `${verb} ${change.bookCode} ${kind} at ${change.ref} to match latest BSB`);
    refreshReader(); // keep the rendered reader in sync with the repo
    return { file, ref: change.ref, sha: res.sha };
  }


  if (change.type === 'verse-store') {
    const { content, sha } = await readBigFile(change.file); // references.json > 1MB
    const { json, changed } = updateReferenceValue(content, change.ref, change.oldText, change.newText);
    if (!changed) throw new Error(`Verse ${change.ref} not found with the expected old text (already updated?)`);
    const res = await github.updateFileContent(change.file, json, sha,
      `Sync ${change.ref} to latest BSB\n\nUpdate verse text to match bereanbible.com master.`);
    refreshReader(); // verse text changed → keep the rendered reader in sync
    return { file: change.file, ref: change.ref, sha: res.sha };
  }

  if (change.type === 'library-quote') {
    const { content, sha } = await github.getFileContent(change.file);
    const updated = replaceNthOccurrence(content, change.oldText, change.newText, change.occurrenceIndex);
    const res = await github.updateFileContent(change.file, updated, sha,
      `Snap ${change.ref} quotation to latest BSB in ${change.file}`);
    return { file: change.file, ref: change.ref, sha: res.sha };
  }

  if (change.type === 'library-fix') {
    // Fix a quotation from the audit: replace the verbatim quoted text with the
    // corrected scripture wording (first occurrence). oldText is the exact quote.
    const { content, sha } = await github.getFileContent(change.file);
    const updated = replaceNthOccurrence(content, change.oldText, change.newText, 0);
    const res = await github.updateFileContent(change.file, updated, sha,
      `Fix ${change.ref} quotation to match BSB in ${change.file}`);
    return { file: change.file, ref: change.ref, sha: res.sha };
  }

  throw new Error(`Unknown change type: ${change.type}`);
}

// Apply many Bible-copy changes (verse-store + usfm-heading + usfm-footnote) in
// as FEW commits as possible: all references.json verse edits in one commit, and
// all heading/footnote edits per USFM file in one commit each. (Library-quote
// changes are ignored here — they edit book content, not the Bible copy.)
async function applyBatch(changes) {
  let applied = 0, commits = 0, failed = 0;

  // 1. Verse text → references.json (single commit).
  const verse = changes.filter(c => c.type === 'verse-store');
  if (verse.length) {
    const file = verse[0].file || `bibles/${verse[0].translationId || 'bsb'}/references.json`;
    try {
      const { content, sha } = await readBigFile(file); // references.json > 1MB
      let json = content, n = 0;
      for (const c of verse) { const r = updateReferenceValue(json, c.ref, c.oldText, c.newText); if (r.changed) { json = r.json; n++; } else failed++; }
      if (n) { await github.updateFileContent(file, json, sha, `Refresh ${n} verse(s) from BSB`); applied += n; commits++; }
    } catch (e) { failed += verse.length; }
  }

  // 2. Headings + footnotes + cross-references → one commit per USFM book.
  const byBook = {};
  for (const c of changes) if (c.type === 'usfm-heading' || c.type === 'usfm-footnote' || c.type === 'usfm-crossref') (byBook[c.bookCode] = byBook[c.bookCode] || []).push(c);
  for (const code of Object.keys(byBook)) {
    const list = byBook[code];
    try {
      const file = await resolveOurUsfmPath(list[0].translationId || 'bsb', code);
      if (!file) { failed += list.length; continue; }
      const { content, sha } = await github.getFileContent(file);
      let text = content, n = 0;
      for (const c of list) {
        const r = c.type === 'usfm-heading'
          ? replaceHeadingInUsfm(text, c.oldText, c.newText, c.ref)
          : c.type === 'usfm-footnote'
            ? replaceFootnoteInUsfm(text, c.ref, c.oldText, c.newText, c.anchor)
            : replaceCrossRefInUsfm(text, c.ref, c.oldText, c.newText);
        if (r.changed) { text = r.content; n++; } else failed++;
      }
      if (n) { await github.updateFileContent(file, text, sha, `Refresh ${n} heading/footnote/cross-reference(s) in ${code} from BSB`); applied += n; commits++; }
    } catch (e) { failed += list.length; }
  }

  if (applied) refreshReader(); // the Bible copy changed → rebuild the rendered reader
  return { applied, commits, failed };
}

// ── Sync log (derived from the content-repo commit history) ─────────────────────
// Every accept/refresh is a real commit under bibles/<id>/, so reading that history gives
// a complete per-change log (all past accepts included, no separate bookkeeping) where each
// entry links to its actual commit. Restore re-applies the reverse of a commit's changes.

const SYNC_PATH_RE = /^bibles\/[a-z0-9]+\/(content\/|references\.json)/i;

// A short type/location badge parsed from the commit message (display only, best-effort).
function classifySyncCommit(message) {
  const first = String(message || '').split('\n')[0];
  let m;
  if ((m = first.match(/^(Update|Add|Remove) (\S+) (heading|footnote|cross-reference) at (\S+)/)))
    return { kind: m[3], action: m[1], where: m[2] + ' ' + m[4] };
  if ((m = first.match(/^Sync (.+?) to latest BSB/))) return { kind: 'verse', action: 'Update', where: m[1] };
  if ((m = first.match(/^Refresh (\d+) verse/))) return { kind: 'verse', action: 'Refresh', where: m[1] + ' verses' };
  if ((m = first.match(/^Refresh (\d+) .*?in (\S+)/))) return { kind: 'structure', action: 'Refresh', where: m[1] + ' in ' + m[2] };
  if ((m = first.match(/quotation to .*? in (.+)/))) return { kind: 'quote', action: 'Fix', where: (m[1] || '').split('/').pop() };
  if (/^Restore /.test(first)) return { kind: 'restore', action: 'Restore', where: '' };
  return { kind: 'other', action: '', where: '' };
}

// Parse a unified-diff patch into changed { old, new } line pairs (context/headers dropped).
function parsePatchChanges(patch) {
  if (!patch) return [];
  const removed = [], added = [];
  for (const l of String(patch).split('\n')) {
    if (l.startsWith('---') || l.startsWith('+++') || l.startsWith('@@')) continue;
    if (l[0] === '-') removed.push(l.slice(1));
    else if (l[0] === '+') added.push(l.slice(1));
  }
  const pairs = [];
  for (let i = 0; i < Math.max(removed.length, added.length); i++) pairs.push({ old: removed[i] || '', new: added[i] || '' });
  return pairs.filter(p => p.old !== p.new);
}

// List sync commits (newest first) with a parsed badge — no patches (one cheap API call).
async function getSyncLog({ limit = 50 } = {}) {
  const commits = await github.listCommits('bibles', { perPage: Math.min(limit, 100) });
  return commits
    .filter(c => !/^Resources added/.test(c.commit.message)) // skip the one-time bulk import
    .map(c => ({
      sha: c.sha, shortSha: c.sha.slice(0, 7),
      date: c.commit.author && c.commit.author.date,
      by: (c.commit.author && (c.commit.author.name || c.commit.author.email)) || '',
      message: c.commit.message.split('\n')[0],
      ...classifySyncCommit(c.commit.message),
    }));
}

// The individual line changes of one sync commit (for the on-demand diff view + restore).
async function getSyncCommitChanges(sha) {
  const detail = await github.getCommit(sha);
  return (detail.files || [])
    .filter(f => SYNC_PATH_RE.test(f.filename))
    .map(f => ({ file: f.filename, name: f.filename.split('/').pop(), changes: parsePatchChanges(f.patch) }));
}

// Restore (revert) one sync commit: put the OLD text of each changed line back into the
// CURRENT file (line-level, so it works even if other lines changed since). Best-effort for
// whole-line adds/deletes. Commits the reverted content + refreshes the reader.
async function restoreCommit(sha) {
  const detail = await github.getCommit(sha);
  let reverted = 0; const files = [];
  for (const f of (detail.files || [])) {
    if (!SYNC_PATH_RE.test(f.filename)) continue;
    const pairs = parsePatchChanges(f.patch);
    if (!pairs.length) continue;
    const big = /references\.json$/.test(f.filename);
    const { content, sha: fileSha } = big ? await readBigFile(f.filename) : await github.getFileContent(f.filename);
    let text = content, n = 0;
    for (const p of pairs) {
      if (p.old !== '' && p.new !== '') { if (text.includes(p.new)) { text = text.replace(p.new, p.old); n++; } }
      else if (p.old === '' && p.new !== '') { const before = text; text = text.split('\n').filter(l => l !== p.new).join('\n'); if (text !== before) n++; }
      // pure delete (new === '') — re-adding at the exact position isn't supported here.
    }
    if (n) {
      await github.updateFileContent(f.filename, text, fileSha, `Restore ${f.filename.split('/').pop()} (revert ${sha.slice(0, 7)})`);
      reverted += n; files.push(f.filename.split('/').pop());
    }
  }
  if (reverted) refreshReader();
  return { reverted, files };
}

module.exports = {
  getSyncLog,
  getSyncCommitChanges,
  restoreCommit,
  findOccurrences,
  replaceNthOccurrence,
  computeChangeAnchor,
  applyBatch,
  updateReferenceValue,
  changeId,
  replaceHeadingInUsfm,
  replaceFootnoteInUsfm,
  replaceCrossRefInUsfm,
  listLibraryMarkdown,
  detectSyncChanges,
  buildChangesFromDrift,
  applyChange,
};
