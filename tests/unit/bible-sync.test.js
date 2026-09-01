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

// ── replaceFootnoteInUsfm (Accept for structure footnote diffs) ────────────────
test('replaceFootnoteInUsfm rebuilds the footnote prose, keeping caller + \\fr', () => {
  const usfm = '\\c 94\n\\v 11 The LORD knows\\f + \\fr 94:11 \\ft Psalms 94:11\\f* the thoughts of man.';
  const r = s.replaceFootnoteInUsfm(usfm, '94:11', 'Psalms 94:11', 'Psalm 94:11');
  assert.strictEqual(r.changed, true);
  assert.ok(r.content.includes('\\f + \\fr 94:11 \\ft Psalm 94:11\\f*'));
  assert.ok(r.content.includes('the thoughts of man.')); // surrounding verse text intact
});

test('replaceFootnoteInUsfm matches on normalized prose (curly vs straight) at the right verse', () => {
  const usfm = '\\c 1\n\\v 5 ...day.\\f + \\fr 1:5 \\ft Literally day one\\f*\n\\v 6 ...\\f + \\fr 1:6 \\ft Or a canopy\\f*';
  const r = s.replaceFootnoteInUsfm(usfm, '1:6', 'Or a canopy', 'Or a firmament');
  assert.strictEqual(r.changed, true);
  assert.ok(r.content.includes('\\fr 1:6 \\ft Or a firmament\\f*'));
  assert.ok(r.content.includes('\\ft Literally day one\\f*')); // the 1:5 footnote untouched
});

test('replaceFootnoteInUsfm returns changed=false when no footnote matches', () => {
  const r = s.replaceFootnoteInUsfm('\\c 1\n\\v 1 x\\f + \\fr 1:1 \\ft Note\\f*', '1:1', 'Different note', 'x');
  assert.strictEqual(r.changed, false);
});

// ── replaceCrossRefInUsfm (Accept for \r cross-reference diffs) ─────────────────
test('replaceCrossRefInUsfm swaps a \\r parallel-passage ref, matching normalized text', () => {
  const usfm = '\\c 3\n\\s1 H\n\\r (Psalms 38:1–22)\n\\v 1 x';
  const r = s.replaceCrossRefInUsfm(usfm, '3:1', '(Psalms 38:1-22)', '(Psalm 38:1–22)');
  assert.strictEqual(r.changed, true);
  assert.ok(r.content.includes('\\r (Psalm 38:1–22)'));
  assert.ok(r.content.includes('\\v 1 x')); // surrounding lines intact
});

test('replaceCrossRefInUsfm returns changed=false when no \\r line matches', () => {
  const r = s.replaceCrossRefInUsfm('\\c 1\n\\r (Acts 2:1-4)\n\\v 1 x', '1:1', '(Nope 1:1)', 'x');
  assert.strictEqual(r.changed, false);
});

// ── replaceVerseInUsfm (mirror a verse-store edit into the USFM \v) ────────────
test('replaceVerseInUsfm swaps the changed span in the \\v line, keeping footnotes intact', () => {
  const usfm = '\\c 1\n\\v 11 they have rushed headlong into the error of Balaam;\\f + \\fr 1:11 \\ft note\\f* they perished.';
  const r = s.replaceVerseInUsfm(usfm, 'Jude 1:11',
    'they have rushed headlong into the error of Balaam; they perished.',
    'they have rushed for profit into the error of Balaam; they perished.');
  assert.strictEqual(r.changed, true);
  assert.ok(r.content.includes('rushed for profit into'));
  assert.ok(r.content.includes('\\f + \\fr 1:11')); // footnote preserved
});

test('replaceVerseInUsfm falls back to the changed word when it is unique in the verse', () => {
  const usfm = '\\c 22\n\\v 2 they became even more silent. Then Paul declared,';
  const r = s.replaceVerseInUsfm(usfm, 'Acts 22:2',
    'they became even more silent. Then Paul declared,',
    'they became even more quiet. Then Paul declared,');
  assert.strictEqual(r.changed, true);
  assert.ok(r.content.includes('even more quiet.'));
});

// ── Add / delete (one-sided) structure changes ────────────────────────────────
test('replaceHeadingInUsfm deletes our heading when newText is empty (BSB has none)', () => {
  const usfm = '\\c 11\n\\s1 (Joshua-Malachi)\n\\v 30 By faith...';
  const r = s.replaceHeadingInUsfm(usfm, '(Joshua-Malachi)', '', '11:30');
  assert.strictEqual(r.changed, true);
  assert.ok(!r.content.includes('\\s1 (Joshua-Malachi)'));
  assert.ok(r.content.includes('\\v 30 By faith...'));
});

test('replaceHeadingInUsfm adds a heading before the verse when oldText is empty (BSB-only)', () => {
  const usfm = '\\c 3\n\\v 1 In those days...';
  const r = s.replaceHeadingInUsfm(usfm, '', 'The Ministry of John', '3:1');
  assert.strictEqual(r.changed, true);
  assert.ok(/\\s1 The Ministry of John\n\\v 1 In those days/.test(r.content));
});

test('replaceFootnoteInUsfm deletes our footnote when newText is empty', () => {
  const usfm = '\\c 1\n\\v 1 x\\f + \\fr 1:1 \\ft A note\\f* y';
  const r = s.replaceFootnoteInUsfm(usfm, '1:1', 'A note', '');
  assert.strictEqual(r.changed, true);
  assert.ok(!r.content.includes('\\f'));
  assert.ok(r.content.includes('\\v 1 x y'));
});

test('replaceFootnoteInUsfm adds a BSB-only footnote at the anchor position', () => {
  const usfm = '\\c 18\n\\v 2 Now Judas knew the place, because Jesus had often met there.';
  const r = s.replaceFootnoteInUsfm(usfm, '18:2', '', 'HF and PT Jesus also', 'because Jesus');
  assert.strictEqual(r.changed, true);
  // lands right after "because Jesus", exactly where the BSB puts it
  assert.ok(r.content.includes('because Jesus\\f + \\fr 18:2 \\ft HF and PT Jesus also\\f* had often met'));
});

test('replaceFootnoteInUsfm falls back to end-of-verse when the anchor is not found', () => {
  const usfm = '\\c 18\n\\v 2 Some verse text here.';
  const r = s.replaceFootnoteInUsfm(usfm, '18:2', '', 'A note', 'no such anchor words');
  assert.strictEqual(r.changed, true);
  assert.ok(r.content.includes('here.\\f + \\fr 18:2 \\ft A note\\f*'));
});

test('replaceCrossRefInUsfm deletes / adds a \\r line for one-sided diffs', () => {
  const del = s.replaceCrossRefInUsfm('\\c 3\n\\r (Psalms 1:1-6)\n\\v 1 x', '3:1', '(Psalms 1:1-6)', '');
  assert.strictEqual(del.changed, true);
  assert.ok(!del.content.includes('\\r '));
  const add = s.replaceCrossRefInUsfm('\\c 3\n\\v 1 x', '3:1', '', '(Psalm 1:1–6)');
  assert.strictEqual(add.changed, true);
  assert.ok(/\\r \(Psalm 1:1–6\)\n\\v 1 x/.test(add.content));
});

// ── idempotent footnote ADD (guards against duplicate-accept, e.g. John 18:2) ────
test('replaceFootnoteInUsfm ADD is a no-op when the footnote already exists at the verse', () => {
  const usfm = '\\c 18\n\\v 2 Now Judas His betrayer also knew the place, because Jesus\\f + \\fr 18:2 \\ft HF and PT Jesus also\\f* had often met there.';
  const r = s.replaceFootnoteInUsfm(usfm, '18:2', '', 'HF and PT Jesus also', 'because Jesus');
  assert.strictEqual(r.changed, false);
  // exactly one footnote span survives — no duplicate is appended
  assert.strictEqual((r.content.match(/HF and PT Jesus also/g) || []).length, 1);
});

test('replaceFootnoteInUsfm ADD ignores marker/spacing differences when detecting an existing footnote', () => {
  // existing uses \fqa; the add text is the reduced plain form — still recognized as present
  const usfm = '\\c 18\n\\v 2 because Jesus\\f + \\fr 18:2 \\ft HF and PT \\fqa Jesus also\\f* had often met there.';
  const r = s.replaceFootnoteInUsfm(usfm, '18:2', '', 'HF and PT Jesus also', 'because Jesus');
  assert.strictEqual(r.changed, false);
});

test('replaceFootnoteInUsfm ADD still inserts when the verse has no such footnote', () => {
  const usfm = '\\c 18\n\\v 2 because Jesus had often met there.';
  const r = s.replaceFootnoteInUsfm(usfm, '18:2', '', 'HF and PT Jesus also', 'because Jesus');
  assert.strictEqual(r.changed, true);
  assert.strictEqual((r.content.match(/HF and PT Jesus also/g) || []).length, 1);
});

test('replaceHeadingInUsfm ADD is a no-op when the heading already introduces the verse', () => {
  const usfm = '\\c 3\n\\s1 The Betrayal\n\\v 1 x';
  const r = s.replaceHeadingInUsfm(usfm, '', 'The Betrayal', '3:1');
  assert.strictEqual(r.changed, false);
  assert.strictEqual((r.content.match(/The Betrayal/g) || []).length, 1);
});

test('replaceCrossRefInUsfm ADD is a no-op when the cross-reference already introduces the verse', () => {
  const usfm = '\\c 3\n\\r (Psalm 1:1–6)\n\\v 1 x';
  const r = s.replaceCrossRefInUsfm(usfm, '3:1', '', '(Psalm 1:1–6)');
  assert.strictEqual(r.changed, false);
  assert.strictEqual((r.content.match(/Psalm 1:1/g) || []).length, 1);
});
