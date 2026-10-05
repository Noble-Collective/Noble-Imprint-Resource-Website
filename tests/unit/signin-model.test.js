// Pure pieces of the resources-site sign-in (web sign-in plan P3): the per-site copy (§2a), the
// "Get the app" store link, the held action (Highlight/Note/Bookmark/Answer while signed out is kept
// and completed after sign-in; cancel/failure discards it), and the home "Continue reading" cards
// (source label + progress only when real data backs them).
const { test } = require('node:test');
const assert = require('node:assert');

const load = () => import('../../src/reader-userdata/signin-model.js');

test('copy: the page benefit line is the approved resources line (§2a)', async () => {
  const { PAGE_COPY } = await load();
  assert.strictEqual(PAGE_COPY.benefit, 'Sign in to pick up any book where you left off on any device, with your highlights, notes, bookmarks and answers.');
  assert.strictEqual(PAGE_COPY.eyebrow, 'Noble Imprint Resources');
  assert.strictEqual(PAGE_COPY.title, 'Sign in');
  assert.strictEqual(PAGE_COPY.fine, 'Use the same sign-in as the Noble Imprint app and everything lines up.');
});

test('copy: the sheet names the held action (res-flow-phone-sheet)', async () => {
  const { sheetCopy } = await load();
  assert.deepStrictEqual(sheetCopy('highlight'), {
    eyebrow: '', // the sheet has no eyebrow (the /sign-in page does)
    title: 'Sign in to save this highlight',
    benefit: 'Sign in to save this highlight and pick up this book where you left off, here or in the Noble Imprint app.',
    fine: 'Your highlight is kept and saved as soon as you sign in.',
  })
  for (const k of ['note', 'bookmark']) {
    const c = sheetCopy(k)
    assert.strictEqual(c.title, `Sign in to save this ${k}`)
    assert.match(c.benefit, new RegExp(`^Sign in to save this ${k} and pick up this book`))
    assert.strictEqual(c.fine, `Your ${k} is kept and saved as soon as you sign in.`)
  }
  assert.strictEqual(sheetCopy('answer').title, 'Sign in to save this answer')
  assert.strictEqual(sheetCopy('answer').fine, 'Your answer box opens as soon as you sign in.')
});

test('copy: no action → the plain sheet (page benefit, title "Sign in")', async () => {
  const { sheetCopy, PAGE_COPY } = await load();
  for (const k of [undefined, null, 'unknown']) {
    assert.deepStrictEqual(sheetCopy(k), { eyebrow: '', title: 'Sign in', benefit: PAGE_COPY.benefit, fine: PAGE_COPY.fine })
  }
});

test('appLink: App Store on iPhone/iPad, Google Play on Android, App Store otherwise', async () => {
  const { appLink, APP_STORE_URL, PLAY_URL } = await load();
  assert.strictEqual(APP_STORE_URL, 'https://apps.apple.com/app/id6745697286');
  assert.strictEqual(PLAY_URL, 'https://play.google.com/store/apps/details?id=com.noblecollective.noble_imprint');
  assert.strictEqual(appLink('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), APP_STORE_URL);
  assert.strictEqual(appLink('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), APP_STORE_URL);
  assert.strictEqual(appLink('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), PLAY_URL);
  assert.strictEqual(appLink('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), APP_STORE_URL);
  assert.strictEqual(appLink(undefined), APP_STORE_URL);
});

test('held action: completes once after sign-in; cancel or failure discards it', async () => {
  const { createHeld } = await load();
  const held = createHeld();
  let ran = 0;
  held.hold('highlight', async () => { ran++ });
  assert.strictEqual(held.kind(), 'highlight');
  await held.complete();
  await held.complete(); // only once
  assert.strictEqual(ran, 1);
  assert.strictEqual(held.kind(), null);

  held.hold('note', async () => { ran++ });
  held.discard(); // cancel / failure
  await held.complete();
  assert.strictEqual(ran, 1);

  // A newer hold replaces an older one.
  held.hold('bookmark', async () => { ran += 10 });
  held.hold('note', async () => { ran += 100 });
  await held.complete();
  assert.strictEqual(ran, 101);

  // A throwing action never escapes complete().
  held.hold('note', async () => { throw new Error('boom') });
  await held.complete();
});

const H = 3600e3;
const NOW = Date.UTC(2026, 9, 5, 15, 0); // Mon 2026-10-05 15:00 UTC
const shelf = [
  { key: 'call-of-christ', path: 'series/NJS/Foundations/The Call of Christ', title: 'The Call of Christ', cover: '/cover/a.png', total: 3, order: { '01-S1.md': 1, '03-S3.md': 3 } },
  { key: null, path: 'series/NJS/Formation/Best Life', title: 'The Best Possible Life', cover: null, total: 12, order: { '07-S7.md': 7 } },
];
const ser = (bookPath, sessionFile, bookKey) => ({ corpus: 'series', bookPath, sessionFile, ...(bookKey ? { bookKey } : {}) });

test('continueCards: one per book, newest first; app reads without an href get a permalink', async () => {
  const { continueCards } = await load();
  const acts = [
    // The app: no href, keyed book → /s/<bookKey>/<sessionKey>
    { locator: ser('series/NJS/Foundations/The Call of Christ', '03-S3.md', 'call-of-christ'), title: 'Session 3: The Way', bookTitle: 'The Call of Christ', source: 'app', viewedAt: NOW - 2 * H },
    // An older read of the same book on the web → folded into that book's card
    { locator: ser('series/NJS/Foundations/The Call of Christ', '01-S1.md'), title: 'Session 1', href: '/x/s1', source: 'resources-web', viewedAt: NOW - 30 * H },
    // The website, yesterday
    { locator: ser('series/NJS/Formation/Best Life', '07-S7.md'), title: 'Session 7', bookTitle: 'The Best Possible Life', href: '/best/s7', source: 'resources-web', viewedAt: NOW - 20 * H },
  ];
  const cards = continueCards(acts, shelf, NOW, 0);
  assert.deepStrictEqual(cards, [
    { href: '/s/call-of-christ/03-S3', title: 'Session 3: The Way', bookTitle: 'The Call of Christ', cover: '/cover/a.png', where: 'On your phone', device: 'phone', when: '2 h ago', progress: { n: 3, total: 3 } },
    { href: '/best/s7', title: 'Session 7', bookTitle: 'The Best Possible Life', cover: null, where: 'Here', device: 'laptop', when: 'Yesterday', progress: { n: 7, total: 12 } },
  ]);
});

test('continueCards: no fake data — unknown source, no progress, unreachable items', async () => {
  const { continueCards } = await load();
  const acts = [
    // Coram Deo source, Bible chapter with an href → kept, no cover/progress
    { locator: { corpus: 'bible', osisRef: 'John.3.1' }, title: 'John 3', href: '/bible/bsb/JHN/3', source: 'coram-deo', viewedAt: NOW - 3 * H },
    // App Bible read: no href → can't be linked here → dropped
    { locator: { corpus: 'bible', osisRef: 'Gen.1.1' }, title: 'Genesis 1', source: 'app', viewedAt: NOW - 1 * H },
    // Series book this visitor's shelf doesn't have (hidden book), no href → dropped
    { locator: ser('series/X/Hidden', '01.md'), title: 'Hidden 1', source: 'app', viewedAt: NOW - 1 * H },
    // An unnumbered session (front matter) → no progress bar
    { locator: ser('series/NJS/Foundations/The Call of Christ', '00-Front.md', 'call-of-christ'), title: 'Front Matter', href: '/x/front', source: 'resources-web', viewedAt: NOW - 4 * H },
  ];
  const cards = continueCards(acts, shelf, NOW, 0);
  assert.deepStrictEqual(cards.map((c) => [c.title, c.where, c.progress, c.cover]), [
    ['John 3', 'On Coram Deo', null, null],
    ['Front Matter', 'Here', null, '/cover/a.png'],
  ]);
});

test('continueCards: at most 6, and empty input → []', async () => {
  const { continueCards } = await load();
  assert.deepStrictEqual(continueCards([], shelf, NOW, 0), []);
  const many = Array.from({ length: 9 }, (_, i) => ({ locator: ser(`series/B${i}`, '01.md'), title: `B${i}`, href: `/b${i}`, source: 'resources-web', viewedAt: NOW - i * H }));
  assert.strictEqual(continueCards(many, shelf, NOW, 0).length, 6);
});

test("continueCards: the shelf's book title wins over a recorded one (older web docs carry the tab-title suffix)", async () => {
  const { continueCards } = await load();
  const acts = [{ locator: ser('series/NJS/Foundations/The Call of Christ', '01-S1.md'), title: 'Session 1', bookTitle: 'The Call of Christ | Noble Collective Resources', href: '/x', source: 'resources-web', viewedAt: NOW - H }];
  assert.strictEqual(continueCards(acts, shelf, NOW, 0)[0].bookTitle, 'The Call of Christ');
});

test('activityTitles: session + book from the tab title, without the site suffix', async () => {
  const { activityTitles } = await load();
  assert.deepStrictEqual(activityTitles('Chapter One — Oration II | Noble Collective Resources'), { title: 'Chapter One', bookTitle: 'Oration II' });
  assert.deepStrictEqual(activityTitles('Session 3: The Way — The Call of Christ | Noble Collective Resources'), { title: 'Session 3: The Way', bookTitle: 'The Call of Christ' });
  assert.deepStrictEqual(activityTitles(''), { title: 'Session', bookTitle: undefined });
});

test('signedInToast: the one-time toast copy', async () => {
  const { signedInToast } = await load();
  assert.strictEqual(signedInToast('Jane Whitaker'), 'Signed in as Jane Whitaker. Your library is in sync.');
  assert.strictEqual(signedInToast(''), 'Signed in. Your library is in sync.');
  assert.strictEqual(signedInToast(null), 'Signed in. Your library is in sync.');
});

test('initialsOf: two letters from a name, one from an email, "?" for nothing', async () => {
  const { initialsOf } = await load();
  assert.strictEqual(initialsOf('Jane Whitaker'), 'JW');
  assert.strictEqual(initialsOf('  jane   q.  whitaker '), 'JW');
  assert.strictEqual(initialsOf('Madonna'), 'M');
  assert.strictEqual(initialsOf('lundys@gmail.com'), 'L');
  assert.strictEqual(initialsOf(''), '?');
  assert.strictEqual(initialsOf(null), '?');
});

test('displayEmail: an Apple relay address reads "Hidden by Apple"', async () => {
  const { displayEmail } = await load();
  assert.strictEqual(displayEmail('x7k2m9qz@privaterelay.appleid.com'), 'Hidden by Apple');
  assert.strictEqual(displayEmail('jane@example.com'), 'jane@example.com');
  assert.strictEqual(displayEmail(''), '');
});
