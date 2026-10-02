// The vendored shared scripture parser (src/vendor/scripture.cjs) against its specification,
// tests/unit/fixtures/scripture.cases.json (Collective-Shared ARCHITECTURE §9c). Both files come
// from scripts/vendor-scripture.sh; the SDK and the mobile app's Dart copy run the same cases.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../../src/vendor/scripture.cjs');
const cases = require('./fixtures/scripture.cases.json');

const lengths = S.chapterLengthsFromTable(cases.chapterLengths);

test('the BSB table has the 66 books with the chapter counts the module knows', () => {
  assert.deepStrictEqual(Object.keys(cases.chapterLengths), S.BOOKS);
  for (const b of S.BOOKS) assert.strictEqual(cases.chapterLengths[b].length, S.CHAPTER_COUNTS[b], b);
});

for (const [input, want] of cases.canonicalBook) {
  test(`canonicalBook ${JSON.stringify(input)} → ${want}`, () => {
    assert.strictEqual(S.canonicalBook(input), want);
  });
}

for (const c of cases.find) {
  test(`findReferences: ${c.name}`, () => {
    const options = c.context
      ? { context: S.bookContext(c.context), contextOffset: c.context.indexOf(c.text) }
      : {};
    if (c.context) assert.ok(options.contextOffset >= 0, 'text sits inside context');
    const got = S.findReferences(c.text, options).map((r) => {
      assert.strictEqual(c.text.slice(r.start, r.end), r.text);
      return {
        text: r.text,
        book: r.book,
        spec: r.spec,
        ...(r.implied ? { implied: true } : {}),
        ...(r.continuation ? { continuation: true } : {}),
      };
    });
    assert.deepStrictEqual(got, c.refs);
  });
}

for (const c of cases.resolve) {
  test(`resolvePassage ${c.book} ${c.spec}${c.maxChapters ? ` (max ${c.maxChapters} chapters)` : ''}`, () => {
    const p = S.resolvePassage(c.book, c.spec, lengths, c.maxChapters ? { maxChapters: c.maxChapters } : {});
    assert.strictEqual(S.formatPassage(p.book, p.verses, lengths), c.passage);
    assert.strictEqual(p.verses.length, c.count);
    assert.deepStrictEqual(p.problems, c.problems || []);
    const cont = p.continuesThrough ? `${p.continuesThrough.chapter}:${p.continuesThrough.verse}` : undefined;
    assert.strictEqual(cont, c.continuesThrough);
  });
}
