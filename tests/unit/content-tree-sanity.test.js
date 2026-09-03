const { test } = require('node:test');
const assert = require('node:assert');

const content = require('../../src/server/content');

// Build a minimal tree: series -> (books | subseries -> books). Each book carries a
// `sessions` array whose length is all the sanity check cares about.
function book(repoPath, sessionCount) {
  return { type: 'book', repoPath, sessions: Array.from({ length: sessionCount }, (_, i) => ({ path: `${repoPath}/s${i}` })) };
}
function tree(...books) {
  return { series: [{ type: 'series', repoPath: 'series/A', children: books }] };
}

// --- countBooks ---------------------------------------------------------------

test('countBooks counts direct books and subseries books', () => {
  const t = {
    series: [{
      children: [
        book('series/A/One', 3),
        { type: 'subseries', books: [book('series/A/Sub/Two', 2), book('series/A/Sub/Three', 1)] },
      ],
    }],
  };
  assert.strictEqual(content.countBooks(t), 3);
});

// --- isTreeSane ---------------------------------------------------------------

test('isTreeSane: rejects an empty { series: [] }', () => {
  assert.strictEqual(content.isTreeSane({ series: [] }, tree(book('series/A/One', 3))).ok, false);
});

test('isTreeSane: rejects a tree with zero books', () => {
  const empty = { series: [{ type: 'series', repoPath: 'series/A', children: [] }] };
  assert.strictEqual(content.isTreeSane(empty, tree(book('series/A/One', 3))).ok, false);
});

test('isTreeSane: rejects null / malformed input', () => {
  assert.strictEqual(content.isTreeSane(null, null).ok, false);
  assert.strictEqual(content.isTreeSane({}, null).ok, false);
});

test('isTreeSane: a healthy tree with no prior snapshot is sane', () => {
  assert.strictEqual(content.isTreeSane(tree(book('series/A/One', 3)), null).ok, true);
});

test('isTreeSane: book count holding steady vs prev is sane', () => {
  const prev = tree(book('series/A/One', 3), book('series/A/Two', 2));
  const next = tree(book('series/A/One', 3), book('series/A/Two', 2));
  assert.strictEqual(content.isTreeSane(next, prev).ok, true);
});

test('isTreeSane: growth (more books than prev) is sane', () => {
  const prev = tree(book('series/A/One', 3));
  const next = tree(book('series/A/One', 3), book('series/A/Two', 2));
  assert.strictEqual(content.isTreeSane(next, prev).ok, true);
});

test('isTreeSane: a sharp book-count drop vs prev is rejected', () => {
  const prev = tree(book('series/A/1', 2), book('series/A/2', 2), book('series/A/3', 2),
                    book('series/A/4', 2), book('series/A/5', 2));
  const next = tree(book('series/A/1', 2), book('series/A/2', 2)); // 2 of 5 = 40% < 90%
  assert.strictEqual(content.isTreeSane(next, prev).ok, false);
});

test('isTreeSane: a book that previously had sessions dropping to 0 is rejected', () => {
  const prev = tree(book('series/A/One', 3), book('series/A/Two', 2));
  const next = tree(book('series/A/One', 3), book('series/A/Two', 0)); // Two lost all sessions
  assert.strictEqual(content.isTreeSane(next, prev).ok, false);
});

test('isTreeSane: a book that had 0 sessions before and still has 0 is fine', () => {
  const prev = tree(book('series/A/One', 3), book('series/A/Two', 0));
  const next = tree(book('series/A/One', 3), book('series/A/Two', 0));
  assert.strictEqual(content.isTreeSane(next, prev).ok, true);
});
