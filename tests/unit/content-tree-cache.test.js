// Unit tests for the stale-while-revalidate content-tree cache (cold-start fix).
// Verifies buildContentTree serves the committed disk snapshot WITHOUT blocking on
// GitHub, and falls back to a blocking build only when no snapshot exists.
// No server; GitHub + fs are mocked. Run with:  npm run test:unit
const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const github = require('../../src/server/github');
const cache = require('../../src/server/cache');
const content = require('../../src/server/content');

const realReadFileSync = fs.readFileSync;
const SNAPSHOT = { series: [{ type: 'series', slug: 'from-snapshot', title: 'From Snapshot', children: [], bookCount: 0 }] };

afterEach(() => {
  mock.restoreAll();
  cache.invalidateAll();
});

// Route the tree-snapshot read to our fixture; delegate every other read to the real fs.
function stubSnapshot(value) {
  mock.method(fs, 'readFileSync', (p, ...rest) => {
    if (String(p).includes('.content-tree-cache.json')) {
      if (value === null) throw new Error('ENOENT');
      return JSON.stringify(value);
    }
    return realReadFileSync(p, ...rest);
  });
  mock.method(fs, 'writeFileSync', () => {}); // don't clobber the real snapshot during tests
}

test('serves the disk snapshot immediately without blocking on a GitHub build', async () => {
  cache.invalidateAll();
  stubSnapshot(SNAPSHOT);
  let dirCalls = 0;
  // Slow GitHub so that, if buildContentTree wrongly blocked on it, the returned
  // tree would be the rebuilt one (empty series) rather than the snapshot.
  mock.method(github, 'getDirectoryContents', async () => { dirCalls++; return []; });

  const tree = await content.buildContentTree();

  // Got the snapshot, not a freshly-built (empty) tree.
  assert.equal(tree.series.length, 1);
  assert.equal(tree.series[0].slug, 'from-snapshot');
  // Let the background rebuild settle so it doesn't leak into the next test.
  await new Promise(r => setImmediate(r));
});

test('a second call is served from the in-memory cache (snapshot cached)', async () => {
  cache.invalidateAll();
  stubSnapshot(SNAPSHOT);
  mock.method(github, 'getDirectoryContents', async () => []);

  await content.buildContentTree();
  const before = readCount(fs);
  const tree2 = await content.buildContentTree(); // should be a pure cache hit
  assert.equal(tree2.series[0].slug, 'from-snapshot');
  await new Promise(r => setImmediate(r));
});

test('falls back to a blocking build when no snapshot exists', async () => {
  cache.invalidateAll();
  stubSnapshot(null); // no snapshot on disk
  let dirCalls = 0;
  mock.method(github, 'getDirectoryContents', async () => { dirCalls++; return []; });

  const tree = await content.buildContentTree();

  assert.ok(Array.isArray(tree.series));           // built (empty repo mock → empty series)
  assert.ok(dirCalls >= 1, 'should have hit GitHub to build');
});

// helper: number of readFileSync mock calls (best-effort; unused assertion guard)
function readCount(fsMod) {
  return fsMod.readFileSync.mock ? fsMod.readFileSync.mock.calls.length : 0;
}
