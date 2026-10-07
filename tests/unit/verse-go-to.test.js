// The verse pop-up's one footer link, the same words as the app (Noble-Imprint-App
// plans/2026-10-07-settings-redesign-and-multi-tab.md, P5c, Q8/Q9): always "Go to <Book> <chapter> ›"
// — a whole passage opens its first chapter AT the first verse quoted; a passage cut short opens the
// first chapter not shown ("Genesis 1–50" → "Go to Genesis 4 ›"). The cases are the app's
// (test/unit-tests/go_to_link_test.dart), run through the real /api/verses answer (bible.getPassage).
const test = require('node:test');
const assert = require('node:assert');
const bible = require('../../src/server/bible');
const { verseGoTo } = require('../../src/public/js/verse-go-to');

const goTo = (ref, translation = 'bsb') => verseGoTo(bible.getPassage(translation, ref, { maxChapters: 3 }), translation);

test.before(() => bible.loadBibles()); // the committed .bible-cache snapshot

for (const [ref, label, href] of [
  ['Hebrews 11:4', 'Go to Hebrews 11 ›', '/bible/bsb/Hebrews?chapter=11#v4'], // one verse: its chapter, at it
  ['Genesis 1-50', 'Go to Genesis 4 ›', '/bible/bsb/Genesis?chapter=4#v1'], // cut short: the first chapter not shown
  ['Hebrews 11', 'Go to Hebrews 11 ›', '/bible/bsb/Hebrews?chapter=11#v1'], // chapter only
  ['John 3:16-18,20', 'Go to John 3 ›', '/bible/bsb/John?chapter=3#v16'], // a list: the first verse quoted
  ['Matthew 5-7, 13', 'Go to Matthew 13 ›', '/bible/bsb/Matthew?chapter=13#v1'], // cut list: the next chapter it names
  ['Exodus 11:1-13:16', 'Go to Exodus 11 ›', '/bible/bsb/Exodus?chapter=11#v1'], // 3 chapters, whole
  ['Psalm 23', 'Go to Psalm 23 ›', '/bible/bsb/Psalm?chapter=23#v1'], // one psalm, not "Psalms"
  ['Jude 3', 'Go to Jude 1 ›', '/bible/bsb/Jude?chapter=1#v3'], // a one-chapter book, at verse 3
]) {
  test(`${ref} → "${label}"`, () => {
    assert.deepStrictEqual(goTo(ref), { label, href });
  });
}

test('one psalm says "Psalm" whatever the translation calls the book', () => {
  assert.strictEqual(goTo('Psalm 23', 'kjv').label, 'Go to Psalm 23 ›');
  const cut = verseGoTo({ verses: [{ ref: 'Psalms 1:1', verse: 1 }], continuesAt: { book: 'Psalms', chapter: 4, verse: 1, ref: 'Psalms 4:1' } }, 'kjv');
  assert.deepStrictEqual(cut, { label: 'Go to Psalm 4 ›', href: '/bible/kjv/Psalms?chapter=4#v1' });
});

test('gaps are skipped; nothing to link without verses', () => {
  assert.deepStrictEqual(verseGoTo({ verses: [{ gap: true }, { ref: 'Acts 2:37', verse: 37 }] }, 'bsb'), {
    label: 'Go to Acts 2 ›',
    href: '/bible/bsb/Acts?chapter=2#v37',
  });
  assert.strictEqual(verseGoTo({ verses: [] }, 'bsb'), null);
  assert.strictEqual(verseGoTo({ verses: [{ gap: true }] }, 'bsb'), null);
  assert.strictEqual(verseGoTo(null, 'bsb'), null);
});

test('a book name with spaces is encoded in the href', () => {
  assert.strictEqual(goTo('Song of Solomon 2:1').href, '/bible/bsb/Song%20of%20Solomon?chapter=2#v1');
  assert.strictEqual(goTo('Song of Solomon 2:1').label, 'Go to Song of Solomon 2 ›');
});
