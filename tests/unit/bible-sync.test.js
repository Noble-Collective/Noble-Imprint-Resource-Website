// Unit tests for the pure helpers of the "Apply Latest BSB Text" sync feature.
// No network — GitHub I/O (detect/apply) is exercised on deploy.
const test = require('node:test');
const assert = require('node:assert');
const s = require('../../src/server/bible-sync');

// ── findOccurrences ────────────────────────────────────────────────────────────
test('findOccurrences returns each verbatim hit with context', () => {
  const quote = 'they became even more silent';
  const doc = 'As Paul said, "they became even more silent" — and again they became even more silent later.';
  const hits = s.findOccurrences(doc, quote);
  assert.strictEqual(hits.length, 2);
  assert.ok(hits[0].context.includes(quote));
  assert.ok(hits[0].index < hits[1].index);
});

test('findOccurrences ignores needles that are too short to match safely', () => {
  assert.deepStrictEqual(s.findOccurrences('the the the', 'the'), []);
});

// ── replaceNthOccurrence ───────────────────────────────────────────────────────
test('replaceNthOccurrence replaces the targeted occurrence only', () => {
  const doc = 'quiet here and quiet there';
  assert.strictEqual(s.replaceNthOccurrence(doc, 'quiet', 'silent', 1), 'quiet here and silent there');
  assert.strictEqual(s.replaceNthOccurrence(doc, 'quiet', 'silent', 0), 'silent here and quiet there');
});

test('replaceNthOccurrence throws when the occurrence is gone (file changed)', () => {
  assert.throws(() => s.replaceNthOccurrence('nothing here', 'missing', 'x', 0), /not found/);
});

// ── updateReferenceValue ───────────────────────────────────────────────────────
test('updateReferenceValue rewrites one verse value, leaving the file otherwise identical', () => {
  const raw = '{\n  "Genesis 1:1": "In the beginning...",\n  "Acts 22:2": "they became even more silent. Then Paul declared,",\n  "John 3:16": "For God so loved..."\n}';
  const r = s.updateReferenceValue(raw, 'Acts 22:2',
    'they became even more silent. Then Paul declared,',
    'they became even more quiet. Then Paul declared,');
  assert.strictEqual(r.changed, true);
  assert.ok(r.json.includes('"they became even more quiet. Then Paul declared,"'));
  assert.ok(r.json.includes('"Genesis 1:1": "In the beginning..."')); // untouched
  assert.ok(!r.json.includes('even more silent'));
});

test('updateReferenceValue handles verse text containing quotes/escapes', () => {
  const oldText = 'Jesus said, "Let there be light,"';
  const newText = 'Jesus said, "Let there be light."';
  const raw = `{${JSON.stringify('Mark 1:1')}: ${JSON.stringify(oldText)}}`;
  const r = s.updateReferenceValue(raw, 'Mark 1:1', oldText, newText);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.json, `{${JSON.stringify('Mark 1:1')}: ${JSON.stringify(newText)}}`);
});

test('updateReferenceValue reports changed=false when old text no longer matches', () => {
  const raw = '{"Acts 22:2": "already updated text"}';
  const r = s.updateReferenceValue(raw, 'Acts 22:2', 'stale old text', 'new text');
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.json, raw);
});

// ── computeChangeAnchor (partial-quote detection) ──────────────────────────────
test('computeChangeAnchor yields verbatim anchors differing only by the change', () => {
  const oldT = 'When they heard him speak to them in Hebrew, they became even more silent. Then Paul declared,';
  const newT = 'When they heard him speak to them in Hebrew, they became even more quiet. Then Paul declared,';
  const a = s.computeChangeAnchor(oldT, newT);
  assert.ok(a.changed);
  assert.ok(oldT.includes(a.oldAnchor), 'oldAnchor must be a verbatim substring of the old verse');
  assert.ok(newT.includes(a.newAnchor), 'newAnchor must be a verbatim substring of the new verse');
  assert.ok(a.oldAnchor.includes('silent'));
  assert.ok(a.newAnchor.includes('quiet'));
  assert.ok(a.oldAnchor.length < oldT.length, 'anchor is a window, not the whole verse');
});

test('computeChangeAnchor catches a PARTIAL quote and snaps only the change', () => {
  const oldT = 'When they heard him speak to them in Hebrew, they became even more silent. Then Paul declared,';
  const newT = 'When they heard him speak to them in Hebrew, they became even more quiet. Then Paul declared,';
  const a = s.computeChangeAnchor(oldT, newT);
  // A book quotes only a clause of the verse, not the whole thing:
  const doc = 'As the crowd listened, they became even more silent. Then Paul declared his defense.';
  const hits = s.findOccurrences(doc, a.oldAnchor);
  assert.strictEqual(hits.length, 1, 'partial quote containing the change is found');
  const updated = s.replaceNthOccurrence(doc, a.oldAnchor, a.newAnchor, 0);
  assert.ok(updated.includes('even more quiet. Then Paul'));
  assert.ok(!updated.includes('even more silent'));
});

test('computeChangeAnchor handles a punctuation-only change (comma insertion)', () => {
  const oldT = "This is the most important: 'Hear O Israel, the Lord our God, the Lord is One.";
  const newT = "This is the most important: 'Hear, O Israel, the Lord our God, the Lord is One.";
  const a = s.computeChangeAnchor(oldT, newT);
  assert.ok(a.changed);
  assert.ok(oldT.includes(a.oldAnchor));
  assert.ok(newT.includes(a.newAnchor));
  assert.ok(a.oldAnchor.includes('Hear O Israel'));
  assert.ok(a.newAnchor.includes('Hear, O Israel'));
});

// ── changeId ───────────────────────────────────────────────────────────────────
test('changeId is stable and distinct per change', () => {
  assert.strictEqual(s.changeId({ type: 'verse-store', ref: 'Acts 22:2' }), 'verse:Acts 22:2');
  assert.strictEqual(
    s.changeId({ type: 'library-quote', file: 'series/S/Book/s1.md', occurrenceIndex: 2, ref: 'Acts 22:2' }),
    'lib:series/S/Book/s1.md:2:Acts 22:2');
});

// ── replaceHeadingInUsfm (Accept for structure heading diffs) ──────────────────
test('replaceHeadingInUsfm swaps heading prose, matching normalized (curly vs straight)', () => {
  const usfm = '\\c 16\n\\s1 David’s Psalms of Thanksgiving\n\\v 7 On that day David first appointed...';
  const r = s.replaceHeadingInUsfm(usfm, "David's Psalms of Thanksgiving", "David's Psalm of Thanksgiving");
  assert.strictEqual(r.changed, true);
  assert.ok(r.content.includes("\\s1 David's Psalm of Thanksgiving"));
  assert.ok(r.content.includes('\\v 7 On that day')); // rest untouched
});

test('replaceHeadingInUsfm returns changed=false when the heading is not present', () => {
  const r = s.replaceHeadingInUsfm('\\s1 The Creation\n\\v 1 x', 'Not a heading here', 'x');
  assert.strictEqual(r.changed, false);
});
