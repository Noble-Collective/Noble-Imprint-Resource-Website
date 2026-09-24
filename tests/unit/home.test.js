// Guards the pure logic behind GET /api/home (Resource of the day + Partner with us): the pick is
// deterministic per date (not random), skips front matter via the site's numbered-session rule, honours
// per-book exclusions and the book list, and shows only public books with their own meta subtitle.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const home = require('../../src/server/home');

const book = (repoPath, title, sessions, extra = {}) => ({
  type: 'book', slug: title.toLowerCase().replace(/\W+/g, '-'), repoPath, title,
  subtitle: `${title} subtitle`, status: 'public', audiobook: { enabled: true }, sessions, ...extra,
});
const s = (filename, title) => ({ filename, slug: filename.replace('.md', ''), displayName: title, title });

const tree = {
  series: [{
    slug: 'nj', title: 'NJ', children: [
      book('series/NJ/A', 'Book A', [s('01-FrontMatter.md', 'Front Matter'), s('02-S1.md', 'Session 1: One'), s('03-S2.md', 'Session 2: Two')]),
      book('series/NJ/B', 'Book B', [s('01-FM.md', 'Front Matter'), s('02-C1.md', 'Chapter One')], { audiobook: null }),
      book('series/NJ/Hidden', 'Hidden', [s('01.md', 'Session 1')], { status: 'hidden' }),
    ],
  }],
};
const cfg = home.normalizeConfig({ resourceOfTheDay: { books: ['series/NJ/A', 'series/NJ/B', 'series/NJ/Hidden', 'series/NJ/Missing'] } });

test('eligible sessions: books interleaved, front matter skipped, hidden/missing books skipped', () => {
  const e = home.eligibleSessions(tree, cfg).map((x) => `${x.book.title}/${x.session.filename}`);
  assert.deepStrictEqual(e, ['Book A/02-S1.md', 'Book B/02-C1.md', 'Book A/03-S2.md']);
});

test('per-book exclusions are honoured', () => {
  const c = home.normalizeConfig({ resourceOfTheDay: { books: ['series/NJ/A'], excludeSessions: { 'series/NJ/A': ['02-S1.md'] } } });
  assert.deepStrictEqual(home.eligibleSessions(tree, c).map((x) => x.session.filename), ['03-S2.md']);
});

test('same date ⇒ same pick; consecutive dates walk the list', () => {
  const e = home.eligibleSessions(tree, cfg);
  const a = home.pickForDate(e, '2026-09-24');
  assert.strictEqual(home.pickForDate(e, '2026-09-24'), a);
  const seq = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'].map((d) => home.pickForDate(e, d).session.filename);
  assert.strictEqual(new Set(seq.slice(0, 3)).size, 3);
  assert.strictEqual(seq[3], seq[0]);
});

test('card: subtitle from meta, audio flag, web URL', () => {
  const out = home.buildHome(tree, cfg, '2026-09-24');
  assert.ok(out.resourceOfTheDay);
  assert.match(out.resourceOfTheDay.subtitle, / subtitle$/);
  assert.strictEqual(typeof out.resourceOfTheDay.hasAudio, 'boolean');
  assert.match(out.resourceOfTheDay.webUrl, /^https:\/\/.+\/nj\//);
  assert.deepStrictEqual(out.partner, home.DEFAULT_CONFIG.partner);
});

test('invalid date ⇒ no pick; empty list ⇒ no pick', () => {
  assert.strictEqual(home.pickForDate(home.eligibleSessions(tree, cfg), 'not-a-date'), null);
  assert.strictEqual(home.buildHome(tree, home.normalizeConfig({ resourceOfTheDay: { books: [] } }), '2026-09-24').resourceOfTheDay, null);
});

test('config normalization: defaults, trimming, https-only donate URL', () => {
  const d = home.normalizeConfig(null);
  assert.deepStrictEqual(d.resourceOfTheDay.books, home.DEFAULT_CONFIG.resourceOfTheDay.books);
  const c = home.normalizeConfig({ partner: { title: '  Give  ', url: 'javascript:alert(1)' } });
  assert.strictEqual(c.partner.title, 'Give');
  assert.strictEqual(c.partner.url, home.DEFAULT_CONFIG.partner.url);
});

test('real content snapshot: every default book resolves and has sessions to rotate', () => {
  const snapPath = path.join(__dirname, '../../src/.content-tree-cache.json');
  const raw = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const real = raw.tree || raw;
  const d = home.normalizeConfig(null);
  const eligible = home.eligibleSessions(real, d);
  const booksSeen = new Set(eligible.map((x) => x.book.repoPath));
  for (const bp of d.resourceOfTheDay.books) assert.ok(booksSeen.has(bp), `default book missing from rotation: ${bp}`);
  for (const x of eligible) assert.doesNotMatch(x.session.title || x.session.displayName, /front matter|orientation/i);
  const preview = home.previewPicks(real, d, '2026-09-24', 14);
  assert.strictEqual(preview.picks.length, 14);
  assert.ok(preview.picks.every((p) => p.sessionTitle && p.bookTitle));
});
