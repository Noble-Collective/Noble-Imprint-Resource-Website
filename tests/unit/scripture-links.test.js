// The reader's scripture links (parser.js, through the shared parser) and the verses /api/verses
// opens for them (bible.getPassage). Plan: Collective-Shared plans/2026-10-02-shared-scripture-parser.md P4.
const test = require('node:test');
const assert = require('node:assert');
const { renderMarkdown } = require('../../src/renderer/parser');
const bible = require('../../src/server/bible');

const LINK = /<a class="bible-ref" href="#" data-ref="([^"]*)" title="([^"]*)">([^<]*)<\/a>/g;
const links = (md) => [...renderMarkdown(md).matchAll(LINK)].map((m) => ({ ref: m[1], title: m[2], text: m[3] }));

test('chapter-only references link (Steve, 2026-10-02)', () => {
  assert.deepStrictEqual(links('Read Genesis 1–50 and Job 1–42, then Psalm 23.'), [
    { ref: 'Genesis 1-50', title: 'Genesis 1–50', text: 'Genesis 1–50' },
    { ref: 'Job 1-42', title: 'Job 1–42', text: 'Job 1–42' },
    { ref: 'Psalm 23', title: 'Psalm 23', text: 'Psalm 23' },
  ]);
});

test('a bare cross-chapter range keeps its whole span (the site cut "(17:1–18:30)" to 17:1-18)', () => {
  const got = links('Genesis 16:1 begins it.\n\nThen Abraham (17:1–18:30) and more.');
  assert.deepStrictEqual(got[1], { ref: 'Genesis 17:1-18:30', title: 'Genesis 17:1–18:30', text: '17:1–18:30' });
});

test('chapter-only "Biblical Narrative" declarations set the book (Sacred Script s1 opened Revelation)', () => {
  const md = 'Revelation 21:1 is the end.\n\n## Job\n\nBiblical Narrative (Job 1-42)\n\nSatan answers (1:9; 2:4).';
  const bare = links(md).filter((l) => /^\d/.test(l.text));
  assert.deepStrictEqual(bare.map((l) => l.ref), ['Job 1:9', 'Job 2:4']);
});

test('a ";"-continuation keeps its named book; "cf." groups and brackets link', () => {
  assert.deepStrictEqual(links('Exodus 20:5; 23:25 and (cf. 24:1) and [7:24].').map((l) => l.ref), [
    'Exodus 20:5', 'Exodus 23:25', 'Exodus 24:1', 'Exodus 7:24',
  ]);
});

test('never: clock times, printed verse numbers, image alt text, inside an existing link', () => {
  const html = renderMarkdown('John 3:16.\n\nAt 3:00 pm.\n\n> 17:1 Now this\n\n![Art for John 3:16](a.png)\n\nSee [John 3:16](https://x.org).');
  assert.strictEqual([...html.matchAll(LINK)].length, 2); // the paragraph and the figure caption
  assert.match(html, /alt="Art for John 3:16"/);
  assert.match(html, /<a href="https:\/\/x\.org"[^>]*>John 3:16<\/a>/);
  assert.doesNotMatch(html, /[\uE000-\uE01F]/);
});

test('emphasis and smart quotes around a reference render as before; heading slugs are unchanged', () => {
  const html = renderMarkdown('## Read Genesis 1:1–3\n\n_Genesis 11:27–50:26_ and "John 3:16" and **Psalm 23**.', { maxNavHeadingLevel: 2 });
  assert.match(html, /<h2 id="read-genesis-1-1-3">/);
  assert.match(html, /<em><a class="bible-ref"[^>]*>Genesis 11:27–50:26<\/a><\/em>/);
  assert.match(html, /“<a class="bible-ref"[^>]*>John 3:16<\/a>”/);
  assert.match(html, /<strong><a class="bible-ref"[^>]*>Psalm 23<\/a><\/strong>/);
});

test('a <Callout> reference links in the paragraph and its pull-quote', () => {
  const html = renderMarkdown('<Callout>Romans 8:28 holds</Callout> more.');
  assert.strictEqual([...html.matchAll(LINK)].length, 2);
});

test('getPassage: whole chapters, cross-chapter ranges, and the 3-chapter cap', async () => {
  await bible.loadBibles(); // the committed .bible-cache snapshot
  const g = bible.getPassage('bsb', 'Genesis 1-50', { maxChapters: 3 });
  assert.strictEqual(g.verses[0].ref, 'Genesis 1:1');
  assert.strictEqual(g.verses[g.verses.length - 1].ref, 'Genesis 3:24');
  assert.deepStrictEqual(g.continuesThrough, { book: 'Genesis', chapter: 50, verse: 26 });

  const ex = bible.getPassage('bsb', 'Exodus 11:1-13:16').verses.map((v) => v.ref);
  assert.ok(ex.includes('Exodus 12:1'), 'includes the chapter between');
  assert.strictEqual(ex[ex.length - 1], 'Exodus 13:16');
  assert.strictEqual(bible.getPassage('bsb', 'Exodus 11:1-13:16', { maxChapters: 3 }).continuesThrough, null);

  assert.strictEqual(bible.getPassage('bsb', 'Psalm 23').verses.length, 6);
  assert.strictEqual(bible.getPassage('bsb', 'Psalms 127').verses.length, 5);
  assert.strictEqual(bible.getPassage('bsb', 'Jude 1:3').verses[0].ref, 'Jude 1:3');
  assert.strictEqual(bible.getPassage('bsb', 'Jude 3').verses[0].ref, 'Jude 1:3');
});

// P7 (Steve, 2026-10-02, option A): a cut passage's footer ("Go to Genesis 4 ›" since the app's P5c) and
// opens the first verse the pop-up didn't show; a chapter list continues at the next chapter it
// names ("Matthew 5-7, 13" → 13:1, not 8).
test('getPassage: continuesAt = the first verse a cut passage did not show', async () => {
  await bible.loadBibles();
  const g = bible.getPassage('bsb', 'Genesis 1-50', { maxChapters: 3 });
  assert.deepStrictEqual(g.continuesAt, { book: 'Genesis', chapter: 4, verse: 1, ref: 'Genesis 4:1' });
  assert.deepStrictEqual(bible.getPassage('bsb', 'Genesis 11:27-50:26', { maxChapters: 3 }).continuesAt.ref, 'Genesis 14:1');
  assert.deepStrictEqual(bible.getPassage('bsb', 'Matthew 5-7, 13', { maxChapters: 3 }).continuesAt.ref, 'Matthew 13:1');
  assert.deepStrictEqual(bible.getPassage('bsb', 'Psalm 119-121', { maxChapters: 3 }).continuesAt, null);
  assert.deepStrictEqual(bible.getPassage('bsb', 'Romans 8:28').continuesAt, null);
  assert.deepStrictEqual(bible.getPassage('bsb', 'Genesis 1-50').continuesAt, null, 'no cap, no cut');
});

test('getPassage: lists keep their gap; a ";" part without a book keeps the previous one', async () => {
  await bible.loadBibles();
  const refs = bible.getPassage('bsb', 'Acts 2:23,25-27').verses.map((v) => v.gap ? 'gap' : v.ref);
  assert.deepStrictEqual(refs, ['Acts 2:23', 'gap', 'Acts 2:25', 'Acts 2:26', 'Acts 2:27']);
  const two = bible.getPassage('bsb', '2 Samuel 7:12-13; Isaiah 11:1; 11:3').verses.map((v) => v.gap ? 'gap' : v.ref);
  assert.deepStrictEqual(two, ['2 Samuel 7:12', '2 Samuel 7:13', 'Isaiah 11:1', 'gap', 'Isaiah 11:3']);
  // The old form the Institute still sends.
  assert.strictEqual(bible.getPassage('bsb', 'Genesis 37:5, 8').verses.filter((v) => !v.gap).length, 2);
});
