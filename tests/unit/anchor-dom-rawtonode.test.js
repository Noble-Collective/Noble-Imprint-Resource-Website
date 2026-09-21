// Regression guard for the "app bookmark renders above the H1" bug (2026-09-21).
//
// A mobile-app-created bookmark stores a textAnchor whose `quote` begins at the very START of a
// block (empty prefix, no start offset). When the website resolves that anchor to a DOM Range, the
// raw start offset lands exactly on the boundary between the inter-block whitespace text node that
// markdown-it emits between blocks (a direct child of `.session-content`) and the paragraph's own
// text node. `rawToNode` scans the node map in document order with an INCLUSIVE upper bound, so a
// boundary offset was attributed to the END of the preceding (whitespace) node instead of the START
// of the following (content) node. `placeBookmarkMarker` then walked up from that whitespace node
// straight to ROOT and inserted the marker at ROOT.firstChild — above the H1.
//
// The fix: `rawToNode(idx, nodeMap, preferForward)` — when resolving a range START (preferForward),
// a boundary offset attaches to the FOLLOWING content node; a range END keeps the trailing-edge
// (backward) attribution so the range doesn't spill into the next node.
const { test } = require('node:test');
const assert = require('node:assert');

// A node map mirroring markdown-it output "<h1>..</h1>\n<p>A few days..</p>":
//   [ h1 text ][ "\n" whitespace ][ paragraph text ]
// The bug reproduces at the whitespace↔paragraph boundary (raw offset 12).
function fixture() {
  const h1 = { tag: 'h1-text', length: 9 };
  const ws = { tag: 'whitespace', length: 3 }; // the "\n" + indentation between blocks
  const p = { tag: 'paragraph', length: 80 };
  const nodeMap = [
    { node: h1, start: 0, end: 9 },
    { node: ws, start: 9, end: 12 },
    { node: p, start: 12, end: 92 },
  ];
  return { nodeMap, h1, ws, p };
}

test('rawToNode: a range START on a node boundary attaches to the FOLLOWING content node', async () => {
  const { rawToNode } = await import('../../src/reader-userdata/anchor-dom.js');
  const { nodeMap, p } = fixture();
  // raw offset 12 = end of the whitespace node == start of the paragraph node.
  const start = rawToNode(12, nodeMap, true);
  assert.strictEqual(start.node, p, 'boundary start must resolve to the paragraph text node, not the preceding whitespace node');
  assert.strictEqual(start.offset, 0, 'and at offset 0 (the beginning of that node)');
});

test('rawToNode: a range END on a node boundary keeps the trailing-edge (preceding) node', async () => {
  const { rawToNode } = await import('../../src/reader-userdata/anchor-dom.js');
  const { nodeMap, ws } = fixture();
  // Default (preferForward=false) is the range-END behavior: offset 12 stays at the end of `ws`
  // so a range ending there does not spill into the paragraph.
  const end = rawToNode(12, nodeMap, false);
  assert.strictEqual(end.node, ws, 'boundary end stays on the preceding node');
  assert.strictEqual(end.offset, 3, 'at that node’s trailing edge');
});

test('rawToNode: an interior offset resolves to its containing node (both directions)', async () => {
  const { rawToNode } = await import('../../src/reader-userdata/anchor-dom.js');
  const { nodeMap, p } = fixture();
  for (const pf of [true, false]) {
    const r = rawToNode(20, nodeMap, pf);
    assert.strictEqual(r.node, p, `interior offset resolves inside the paragraph (preferForward=${pf})`);
    assert.strictEqual(r.offset, 8);
  }
});

test('rawToNode: end-of-text offset falls back to the last node (preferForward too)', async () => {
  const { rawToNode } = await import('../../src/reader-userdata/anchor-dom.js');
  const { nodeMap, p } = fixture();
  const r = rawToNode(92, nodeMap, true);
  assert.strictEqual(r.node, p, 'the very end of the text maps to the last content node');
  assert.strictEqual(r.offset, 80);
});
