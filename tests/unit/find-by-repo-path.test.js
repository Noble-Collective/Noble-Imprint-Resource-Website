// Guards content.findByRepoPath — the reverse lookup (stored locator -> route nodes) behind
// GET /api/reader/resolve-locator, which lets the Notebook / My Notes navigate to a bookmark whose
// denormalized `href` is absent (e.g. one created in the mobile app). A wrong match would send the
// reader to the wrong session or nowhere.
const { test } = require('node:test');
const assert = require('node:assert');
const content = require('../../src/server/content');

const tree = {
  series: [{
    slug: 'narrative-journey', children: [
      {
        type: 'book', slug: 'the-call-of-christ', repoPath: 'series/Narrative Journey/The Call of Christ',
        sessions: [
          { filename: '01-Intro.md', slug: 'introduction', displayName: 'Introduction', title: 'The Introduction' },
          { filename: '03-The-Cost.md', slug: 'the-cost', displayName: 'The Cost', title: 'The Cost of Following' },
        ],
      },
      {
        type: 'subseries', slug: 'foundations', books: [
          {
            type: 'book', slug: 'first-steps', repoPath: 'series/Narrative Journey/Foundations/First Steps',
            sessions: [{ filename: '02-Begin.md', slug: 'begin-here', displayName: 'Begin', title: 'Begin Here' }],
          },
        ],
      },
    ],
  }],
};

test('findByRepoPath resolves a session under a direct book', () => {
  const hit = content.findByRepoPath(tree, 'series/Narrative Journey/The Call of Christ', '03-The-Cost.md');
  assert.ok(hit && hit.session, 'expected a hit with a session');
  assert.strictEqual(hit.subseries, null);
  assert.strictEqual(content.sessionUrl(hit.series, hit.subseries, hit.book, hit.session), '/narrative-journey/the-call-of-christ/the-cost');
  assert.strictEqual(hit.session.title, 'The Cost of Following');
});

test('findByRepoPath resolves a session under a subseries book (correct 4-segment URL)', () => {
  const hit = content.findByRepoPath(tree, 'series/Narrative Journey/Foundations/First Steps', '02-Begin.md');
  assert.ok(hit && hit.session);
  assert.strictEqual(hit.subseries.slug, 'foundations');
  assert.strictEqual(content.sessionUrl(hit.series, hit.subseries, hit.book, hit.session), '/narrative-journey/foundations/first-steps/begin-here');
});

test('findByRepoPath returns null session for an unknown sessionFile (book still matched)', () => {
  const hit = content.findByRepoPath(tree, 'series/Narrative Journey/The Call of Christ', '99-Nope.md');
  assert.ok(hit, 'book should still match');
  assert.strictEqual(hit.session, null, 'unknown session file yields null session');
});

test('findByRepoPath returns null for an unknown bookPath', () => {
  assert.strictEqual(content.findByRepoPath(tree, 'series/Does Not/Exist', '01-Intro.md'), null);
});
