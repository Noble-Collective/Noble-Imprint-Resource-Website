// Validates the Bible book-name → OSIS-code map used to store Bible annotations under the shared
// user-data SDK's bibleLocator. A wrong/missing code would silently disable highlighting for a book
// or (worse) mis-key a verse across products, so we assert every canon book resolves and that the
// codes round-trip through the SDK's bibleLocator.
const { test } = require('node:test');
const assert = require('node:assert');
const { osisCodeForBook, OSIS_CANON } = require('../../src/server/osis');
const { bibleLocator } = require('@noble-collective/userdata/core');

test('all 66 canon books resolve to an OSIS code accepted by bibleLocator', () => {
  assert.strictEqual(OSIS_CANON.length, 66, 'expected 66 canon book names');
  for (const name of OSIS_CANON) {
    const code = osisCodeForBook(name);
    assert.ok(code, `no OSIS code for ${name}`);
    // must build a valid bible locator (throws on an invalid osisRef)
    const loc = bibleLocator({ osisRef: `${code}.1.1` }, { translation: 'BSB' });
    assert.strictEqual(loc.corpus, 'bible');
    assert.ok(typeof loc.verseId === 'number' && loc.verseId > 0, `bad verseId for ${name}`);
  }
});

test('spot-check specific books (names must match bible.getBookList exactly)', () => {
  assert.strictEqual(osisCodeForBook('Genesis'), 'Gen');
  assert.strictEqual(osisCodeForBook('Psalm'), 'Ps');        // singular, as the reader lists it
  assert.strictEqual(osisCodeForBook('Song of Solomon'), 'Song');
  assert.strictEqual(osisCodeForBook('2 Timothy'), '2Tim');
  assert.strictEqual(osisCodeForBook('Revelation'), 'Rev');
});

test('unknown book returns null (highlighting stays disabled rather than mis-keyed)', () => {
  assert.strictEqual(osisCodeForBook('Nonexistent'), null);
  assert.strictEqual(osisCodeForBook(''), null);
});
