// Validates the Bible book-name → OSIS-code map used to store Bible annotations under the shared
// user-data SDK's bibleLocator. A wrong/missing code would silently disable highlighting for a book
// or (worse) mis-key a verse across products, so we assert every canon book resolves and that the
// codes round-trip through the SDK's bibleLocator.
const { test } = require('node:test');
const assert = require('node:assert');
const { osisCodeForBook, OSIS_CANON, OSIS_CODES } = require('../../src/server/osis');
// osis.js hardcodes the codes (it must not require the SDK at server runtime — zod isn't a prod
// dep). Here in the test env the SDK IS present, so we cross-check the hardcoded table against it.
const { bibleLocator, OSIS_BOOKS } = require('@noble-collective/userdata/core');

test('hardcoded OSIS codes match the SDK OSIS_BOOKS canonical order (no drift)', () => {
  assert.strictEqual(OSIS_CANON.length, 66, 'expected 66 canon book names');
  assert.strictEqual(OSIS_CODES.length, 66, 'expected 66 OSIS codes');
  for (let i = 0; i < 66; i++) {
    assert.strictEqual(OSIS_CODES[i], OSIS_BOOKS[i + 1], `code drift at #${i + 1} (${OSIS_CANON[i]})`);
  }
});

test('all 66 canon books resolve to an OSIS code accepted by bibleLocator', () => {
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
