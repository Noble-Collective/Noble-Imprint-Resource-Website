const { test } = require('node:test');
const assert = require('node:assert');

const reg = require('../../src/server/content-registry');

function bookNode(repoPath) { return { type: 'book', repoPath, sessions: [] }; }
function treeOf(paths) { return { series: [{ type: 'series', children: paths.map(bookNode) }] }; }
function seed(paths) {
  reg._index.clear();
  reg._orphans.clear();
  for (const p of paths) reg._index.set('k:' + p, { type: 'book', repoPath: p, contentId: 'id-' + p });
}
const FIVE = ['series/A/B1', 'series/A/B2', 'series/A/B3', 'series/A/B4', 'series/A/B5'];

test('syncTree: a sharp path-count collapse is treated as degraded and does NOT orphan live content', () => {
  seed(FIVE);
  reg.syncTree(treeOf(FIVE));            // healthy baseline (currentPaths = 5)
  assert.strictEqual(reg._orphans.size, 0);
  reg.syncTree(treeOf(['series/A/B1'])); // 1 of 5 → below the 50% floor → guard skips
  assert.strictEqual(reg._orphans.size, 0, 'degraded tree must not orphan the 4 missing books');
});

test('syncTree: a legitimate removal above the floor is orphaned normally', () => {
  seed(FIVE);
  reg.syncTree(treeOf(FIVE)); // baseline 5
  reg.syncTree(treeOf(['series/A/B1', 'series/A/B2', 'series/A/B3', 'series/A/B4'])); // 4 of 5 ≥ floor
  assert.strictEqual(reg._orphans.size, 1, 'the one genuinely-removed book should be orphaned');
});
