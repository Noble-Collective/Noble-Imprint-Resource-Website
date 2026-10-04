// The ecosystem permalink /s/<bookKey>/<sessionKey>[/<chapterKey>] (server/permalink.js) — the link
// both this site and the mobile app share, and the frozen table that keeps old app links
// (/s/<deeplinkId>/<sessionId>/<chapterId>) working. Noble-Imprint-App
// plans/2026-10-03-live-content-sync.md §5.3.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const p = require('../../src/server/permalink');

const callOfChrist = {
  type: 'book', slug: 'the-call-of-christ', key: 'the-call-of-christ',
  repoPath: 'series/Narrative Journey Series/Foundations/The Call of Christ', title: 'The Call of Christ',
  sessions: [
    { filename: '1-FrontMatter.md', slug: 'front-matter' },
    { filename: '3-Intro-The Opening.md', slug: 'the-opening' },
    { filename: '4-Session1-TheGospel.md', slug: 'the-gospel' },
  ],
};
// A snapshot from before the tree carried `key`: matched by slug (the ids were slugify(title)).
const hearMySon = {
  type: 'book', slug: 'hear-my-son', repoPath: 'series/Vade Mecum/Proverbs and Faith Formation', title: 'Hear, My Son',
  sessions: [{ filename: '03-Wisdom-Calls-Out.md', slug: 'wisdom-calls-out' }],
};
const tree = {
  series: [
    { slug: 'narrative-journey-series', children: [{ type: 'subseries', slug: 'foundations', books: [callOfChrist] }] },
    { slug: 'vade-mecum', children: [hearMySon] },
  ],
};

test('the frozen table is the app\'s, entry for entry', () => {
  // Next to the app repo (a dev machine); CI has only this repo. Parsed, so CRLF checkouts agree.
  const app = path.join(__dirname, '../../../Noble-Imprint-App/tool/legacy_links/legacy_links.json');
  if (!fs.existsSync(app)) return;
  assert.deepStrictEqual(p.LEGACY, JSON.parse(fs.readFileSync(app, 'utf8')));
});

test('the frozen table: 24 books, 3576 chapters, the 1.3.86 ids', () => {
  const books = p.LEGACY.books;
  assert.strictEqual(Object.keys(books).length, 24);
  assert.strictEqual(Object.values(books).reduce((n, b) => n + Object.keys(b.chapters).length, 0), 3576);
  assert.deepStrictEqual(books.tcoc.chapters['1'], ['1-FrontMatter', 'front-matter']);
  assert.strictEqual(books.hms.bookKey, 'hear-my-son');
  assert.strictEqual(books.bsb.bookKey, 'bible-bsb');
});

test('a permanent link reads as keys; book found by key, or by slug on an old snapshot', () => {
  assert.deepStrictEqual(p.parsePermalink(tree, ['the-call-of-christ', '4-Session1-TheGospel', 'the-gospel']),
    { bookKey: 'the-call-of-christ', sessionKey: '4-Session1-TheGospel', chapterKey: 'the-gospel' });
  assert.deepStrictEqual(p.parsePermalink(tree, ['hear-my-son', '03-Wisdom-Calls-Out']),
    { bookKey: 'hear-my-son', sessionKey: '03-Wisdom-Calls-Out', chapterKey: null });
  assert.strictEqual(p.findBookByKey(tree, 'hear-my-son').book, hearMySon);
  assert.strictEqual(p.findBookByKey(tree, 'the-call-of-christ').subseries.slug, 'foundations');
  assert.deepStrictEqual(p.parsePermalink(tree, ['bible-bsb', 'JHN', '3']),
    { bookKey: 'bible-bsb', sessionKey: 'JHN', chapterKey: '3' });
});

test('an old link resolves through the frozen table: chapter, else session, else book', () => {
  assert.deepStrictEqual(p.parsePermalink(tree, ['tcoc', '1', '1']),
    { bookKey: 'the-call-of-christ', sessionKey: '1-FrontMatter', chapterKey: 'front-matter' });
  assert.deepStrictEqual(p.parsePermalink(tree, ['tcoc', '4', '999999']),
    { bookKey: 'the-call-of-christ', sessionKey: '4-Session1-TheGospel', chapterKey: null });
  assert.deepStrictEqual(p.parsePermalink(tree, ['tcoc', 'x', 'y']),
    { bookKey: 'the-call-of-christ', sessionKey: null, chapterKey: null });
  assert.strictEqual(p.parsePermalink(tree, ['bsb', '1', '1']).bookKey, 'bible-bsb');
  assert.strictEqual(p.parsePermalink(tree, ['not-a-book', '1', '1']), null);
});

test('permalinkFor: the shared URL, keys percent-encoded; none without a key', () => {
  assert.strictEqual(p.permalinkFor(callOfChrist, callOfChrist.sessions[1]),
    'https://resources.noblecollective.org/s/the-call-of-christ/3-Intro-The%20Opening');
  assert.strictEqual(p.permalinkFor(callOfChrist, callOfChrist.sessions[0], 'front-matter'),
    'https://resources.noblecollective.org/s/the-call-of-christ/1-FrontMatter/front-matter');
  assert.strictEqual(p.permalinkFor(hearMySon, hearMySon.sessions[0]), null);
});

test('chapterAnchor maps the app\'s chapter key to this page\'s heading id', () => {
  const src = [
    '# Session One', '', '## It\'s Here', 'text', '', '## Reflection', 'a', '',
    '### Detail', '', '## Reflection', 'b', '', '<!-- ## Hidden -->', '## Psalms *3*', '',
  ].join('\n');
  // App keys drop apostrophes (its-here) and number repeats ~2; the page keeps the apostrophe as a
  // separator (it-s-here) and numbers repeats -2.
  assert.strictEqual(p.chapterAnchor(src, src, 'its-here'), 'it-s-here');
  assert.strictEqual(p.chapterAnchor(src, src, 'reflection'), 'reflection');
  assert.strictEqual(p.chapterAnchor(src, src, 'reflection~2'), 'reflection-2');
  assert.strictEqual(p.chapterAnchor(src, src, 'psalms-3'), 'psalms-3');
  assert.strictEqual(p.chapterAnchor(src, src, 'hidden'), null);
  assert.strictEqual(p.chapterAnchor(src, src, null), null);
  // With level-3 headings in the nav they share the page's slug counter.
  const deep = '## Detail\n\n### Detail\n\n## Detail\n';
  assert.strictEqual(p.chapterAnchor(deep, deep, 'detail~2', 3), 'detail-3');
  // An include that adds headings before it shifts the page's numbering, not the app's.
  const withInclude = '## A\n<!-- @include: X -->\n## A\n';
  const resolved = '## A\n### From include\n## A\n';
  assert.strictEqual(p.chapterAnchor(withInclude, resolved, 'a~2'), 'a-2');
});

test('the app\'s chapter keys come from the same slug rule as its processor', () => {
  assert.strictEqual(p.chapterSlug('It’s the Lord’s'), 'its-the-lords');
  assert.strictEqual(p.chapterSlug('***'), 'section');
});

test('bibleUrl: USFM code → this site\'s chapter page', () => {
  const names = ['Genesis', 'John', '1 John', 'Song of Solomon'];
  assert.strictEqual(p.bibleUrl('bsb', 'JHN', '3', names), '/bible/bsb/John?chapter=3');
  assert.strictEqual(p.bibleUrl('bsb', '1JN', null, names), '/bible/bsb/1%20John');
  assert.strictEqual(p.bibleUrl('kjv', 'TOB', '1', names), '/bible/kjv');
});

// Stored series locators (shared contract §4, SDK 0.5.0): by bookKey first, else bookPath.
test('findForLocator: a keyed locator finds its book even after a folder move', () => {
  const hit = p.findForLocator(tree, { bookKey: 'the-call-of-christ', bookPath: 'series/Old Place/The Call of Christ', sessionFile: '4-Session1-TheGospel.md' });
  assert.strictEqual(hit.book, callOfChrist);
  assert.strictEqual(hit.session.slug, 'the-gospel');
  assert.strictEqual(hit.subseries.slug, 'foundations');
});
test('findForLocator: a pre-key locator matches by bookPath; unknown → null', () => {
  const hit = p.findForLocator(tree, { bookPath: 'series/Vade Mecum/Proverbs and Faith Formation', sessionFile: '03-Wisdom-Calls-Out.md' });
  assert.strictEqual(hit.book, hearMySon);
  assert.strictEqual(hit.subseries, null);
  assert.strictEqual(hit.session.filename, '03-Wisdom-Calls-Out.md');
  assert.strictEqual(p.findForLocator(tree, { bookKey: 'nope', sessionFile: 'x.md' }), null);
  assert.strictEqual(p.findForLocator(tree, { bookPath: 'series/Vade Mecum/Proverbs and Faith Formation', sessionFile: 'gone.md' }).session, null);
});
