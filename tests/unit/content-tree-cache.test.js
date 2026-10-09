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

// ---- search-terms.json rides in the snapshot (library search plan P3) ----

// A one-series, one-book repo; `terms` is what GitHub returns for search-terms.json (an Error = the fetch fails).
function stubRepo(terms) {
  mock.method(github, 'getDirectoryContents', async (p) => ({
    series: [{ type: 'dir', name: 'S' }],
    'series/S': [{ type: 'dir', name: 'B' }],
    'series/S/B': [{ type: 'dir', name: 'sessions' }],
    'series/S/B/sessions': [{ type: 'file', name: '1-One.md' }],
  }[p] || []));
  mock.method(github, 'getFileContent', async (p) => {
    if (p === 'search-terms.json') {
      if (terms instanceof Error) throw terms;
      return { content: typeof terms === 'string' ? terms : JSON.stringify(terms) };
    }
    if (p === 'series/S/B/meta.json') return { content: '{"title":"B","id":"b"}' };
    if (p.endsWith('.md')) return { content: '# 1 One\n' };
    throw new Error('404');
  });
}
const TERMS = { version: 1, nodes: { 'series/S/B': { title: 'B', primary: ['bee'], terms: [] } } };

test('rebuildContentTree loads search-terms.json into the tree and the snapshot it writes', async () => {
  cache.invalidateAll();
  stubSnapshot(null);
  const written = [];
  mock.method(fs, 'writeFileSync', (p, data) => { if (String(p).includes('.content-tree-cache.json')) written.push(JSON.parse(data)); });
  stubRepo(TERMS);
  const tree = await content.rebuildContentTree();
  assert.deepStrictEqual(tree.searchTerms, TERMS);
  assert.strictEqual(written.length, 1);
  assert.deepStrictEqual(written[0].searchTerms, TERMS);
});

test('search terms that fail to load or parse keep the previous snapshot\'s terms (never fatal)', async () => {
  const prev = { ...SNAPSHOT, searchTerms: TERMS };
  for (const bad of [new Error('rate limited'), '{not json', JSON.stringify({ nodes: 'x' }), 'null']) {
    cache.invalidateAll();
    mock.restoreAll();
    stubSnapshot(prev);
    stubRepo(bad);
    const errs = [];
    mock.method(console, 'error', (...a) => errs.push(a.join(' ')));
    assert.deepStrictEqual(await content.loadSearchTerms(prev), TERMS, String(bad));
    assert.ok(errs.some((e) => e.includes('search-terms.json')), errs.join('\n'));
  }
});

test('no search-terms.json anywhere → null terms (books still search by title)', async () => {
  cache.invalidateAll();
  stubSnapshot(null);
  stubRepo(new Error('404'));
  mock.method(console, 'error', () => {});
  assert.strictEqual(await content.loadSearchTerms(null), null);
});
