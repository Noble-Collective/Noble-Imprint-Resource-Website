// The Home search box's pure helpers (src/public/js/library-search.js; library-search plan P4).
// The matching itself is the shared matcher's (library-search.test.js); this is what a row shows.
const test = require('node:test');
const assert = require('node:assert');
const { isSearchable, headText, rowModel, PREVIEW_ROWS } = require('../../src/public/js/library-search.js');

test('a query needs 2+ letters or digits before it searches', () => {
  for (const q of ['', ' ', 'c', '  c ', "'", '...', '-a-']) assert.strictEqual(isSearchable(q), false, q);
  for (const q of ['ca', 'kjv', 'acts 2', 'é è', '23']) assert.strictEqual(isSearchable(q), true, q);
});

test('the count line', () => {
  assert.strictEqual(headText(12, 'catechism'), '12 books match “catechism”');
  assert.strictEqual(headText(1, 'advent'), '1 book matches “advent”');
  assert.strictEqual(headText(0, 'zzqq'), 'No books match “zzqq”');
});

test('a topic match carries its reason, a title match does not', () => {
  const base = { url: '/x', title: 'T', cover: '/cover/x.svg', seriesPath: ['Narrative Journey Series', 'Foundations'] };
  const topic = rowModel({ ...base, banner: 'Pre-Release', matched: { text: 'catéchisme', field: 'terms' } });
  assert.deepStrictEqual(topic, {
    href: '/x', title: 'T', cover: '/cover/x.svg', banner: 'Pre-Release',
    path: 'Narrative Journey Series · Foundations', chip: 'Matches catéchisme',
  });
  assert.strictEqual(rowModel({ ...base, matched: { text: 'the call', field: 'title' } }).chip, null);
  assert.strictEqual(rowModel({ ...base, matched: { text: 'catechism', field: 'series', via: 'Narrative Journey Series' } }).chip, 'Matches catechism');
  assert.strictEqual(rowModel({ ...base, banner: 'Something else' }).banner, null);
  assert.strictEqual(rowModel({ url: '/bible/kjv', title: 'King James Bible', seriesPath: ['Bibles'], matched: { text: 'kjv', field: 'primary' } }).path, 'Bibles');
  assert.strictEqual(PREVIEW_ROWS, 5);
});
