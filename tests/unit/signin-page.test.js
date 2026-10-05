// The /sign-in?returnTo= page and the home "Continue reading" shelf (web sign-in plan P3,
// Collective-Shared plans/2026-10-05-common-web-sign-in.md). Pure helpers in src/server/signin-page.js:
// returnTo must only ever be a same-site path (it's navigated to after sign-in — an open redirect
// otherwise), the chip names where you'll land, and the shelf gives the client the cover + the
// session's place in the book for each Continue card.
const { test } = require('node:test');
const assert = require('node:assert');
const content = require('../../src/server/content');
const { safeReturnTo, returnLabel, shelfFromTree } = require('../../src/server/signin-page');

test('safeReturnTo: keeps same-site paths (with their query)', () => {
  assert.strictEqual(safeReturnTo('/'), '/');
  assert.strictEqual(safeReturnTo('/narrative-journey-series/foundations/the-call-of-christ/session-3'), '/narrative-journey-series/foundations/the-call-of-christ/session-3');
  assert.strictEqual(safeReturnTo('/notes?tab=highlights'), '/notes?tab=highlights');
});

test('safeReturnTo: anything else falls back to the library home', () => {
  for (const bad of [undefined, null, '', 42, ['/a'], 'https://evil.example/', '//evil.example/x', '/\\evil.example',
    'javascript:alert(1)', ' /x', '/x\n', '/a\u0000b', 'notes', '/sign-in', '/sign-in?returnTo=/', '/' + 'a'.repeat(1001)]) {
    assert.strictEqual(safeReturnTo(bad), '/', `rejects ${JSON.stringify(bad)}`);
  }
});

// A tiny tree in the content.js shape (resolveRoute / sessionNumber read these fields).
const book = {
  type: 'book', slug: 'the-call-of-christ', key: 'call-of-christ', title: 'The Call of Christ',
  coverPath: 'series/NJS/Foundations/The Call of Christ/cover.png', repoPath: 'series/NJS/Foundations/The Call of Christ',
  sessions: [
    { filename: '00-Front-Matter.md', slug: 'front-matter', displayName: 'Front Matter' },
    { filename: '01-Session1.md', slug: 'session-1', displayName: 'Session 1: The Call' },
    { filename: '02-Session2.md', slug: 'session-2', displayName: 'Session 2: The Cost' },
    { filename: '03-Session3.md', slug: 'session-3', displayName: 'Session 3: The Way' },
    { filename: '04-Further.md', slug: 'further', displayName: 'Further Resources' },
  ],
};
const plain = { type: 'book', slug: 'plain', key: null, title: 'Plain Book', coverPath: null, repoPath: 'series/NJS/Plain', sessions: [] };
const tree = {
  series: [{
    slug: 'narrative-journey-series', title: 'Narrative Journey Series',
    children: [{ type: 'subseries', slug: 'foundations', title: 'Foundations', books: [book] }, plain],
  }],
};

test('returnLabel: home, a book, a session (its own name), other pages', () => {
  assert.strictEqual(returnLabel('/', tree, content), 'Resource Library');
  assert.strictEqual(returnLabel('/narrative-journey-series/foundations/the-call-of-christ', tree, content), 'The Call of Christ');
  // The session's own (H1) name — not a number guessed from it ("Chapter One" isn't "Session 1").
  assert.strictEqual(returnLabel('/narrative-journey-series/foundations/the-call-of-christ/session-3', tree, content), 'The Call of Christ · Session 3: The Way');
  assert.strictEqual(returnLabel('/narrative-journey-series/foundations/the-call-of-christ/front-matter?x=1', tree, content), 'The Call of Christ · Front Matter');
  assert.strictEqual(returnLabel('/notes', tree, content), 'My Notebooks');
  assert.strictEqual(returnLabel('/bible/bsb/JHN/3', tree, content), 'the Bible');
  assert.strictEqual(returnLabel('/no/such/page', tree, content), 'the page you were on');
});

test('shelfFromTree: one entry per book with cover + numbered-session order', () => {
  const shelf = shelfFromTree(tree, content);
  assert.deepStrictEqual(shelf, [
    {
      key: 'call-of-christ', path: 'series/NJS/Foundations/The Call of Christ', title: 'The Call of Christ',
      cover: '/cover/series/NJS/Foundations/The Call of Christ/cover.png',
      total: 3, order: { '01-Session1.md': 1, '02-Session2.md': 2, '03-Session3.md': 3 },
    },
    { key: null, path: 'series/NJS/Plain', title: 'Plain Book', cover: null, total: 0, order: {} },
  ]);
});

test('shelfFromTree: survives an empty / missing tree', () => {
  assert.deepStrictEqual(shelfFromTree(null, content), []);
  assert.deepStrictEqual(shelfFromTree({ series: [] }, content), []);
});
