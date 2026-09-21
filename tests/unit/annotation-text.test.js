// Regression guard for the "blank bookmark text in the notebook" bug (2026-09-21).
//
// List views (Notebook, /notes), Markdown export, and search rendered an annotation's text from the
// denormalized `ref` snippet. The website populates `ref`, but a peer product (the mobile app) writes
// bookmarks with only the anchor — the text lives in `locator.textAnchor.quote`, no `ref` — so those
// rows showed blank. `annotationText` treats the anchor quote as the source of truth and falls back
// to it when `ref` is absent, so any writer's annotation renders instead of a blank row.
const { test } = require('node:test');
const assert = require('node:assert');

test('annotationText: website-shaped annotation uses its ref snippet', async () => {
  const { annotationText } = await import('../../src/reader-userdata/util.js');
  const a = { kind: 'bookmark', ref: 'A selected phrase', locator: { textAnchor: { quote: 'A selected phrase from the paragraph' } } };
  assert.strictEqual(annotationText(a), 'A selected phrase');
});

test('annotationText: app-shaped bookmark (no ref) falls back to the anchor quote', async () => {
  const { annotationText } = await import('../../src/reader-userdata/util.js');
  const a = { kind: 'bookmark', locator: { textAnchor: { quote: 'A few days, and our work will be done.', prefix: '', suffix: '' } } };
  assert.strictEqual(annotationText(a), 'A few days, and our work will be done.');
});

test('annotationText: trims surrounding whitespace from either source', async () => {
  const { annotationText } = await import('../../src/reader-userdata/util.js');
  assert.strictEqual(annotationText({ ref: '  padded ref  ' }), 'padded ref');
  assert.strictEqual(annotationText({ locator: { textAnchor: { quote: '  padded quote ' } } }), 'padded quote');
});

test('annotationText: Bible whole-verse annotation (ref, no textAnchor) resolves via ref', async () => {
  const { annotationText } = await import('../../src/reader-userdata/util.js');
  const a = { kind: 'bookmark', ref: 'In the beginning God created…', locator: { corpus: 'bible', osisRef: 'Gen.1.1' } };
  assert.strictEqual(annotationText(a), 'In the beginning God created…');
});

test('annotationText: nothing usable → empty string (never undefined, never throws)', async () => {
  const { annotationText } = await import('../../src/reader-userdata/util.js');
  assert.strictEqual(annotationText({ kind: 'bookmark', locator: {} }), '');
  assert.strictEqual(annotationText({}), '');
  assert.strictEqual(annotationText(null), '');
  assert.strictEqual(annotationText(undefined), '');
});
