// Playwright global setup — runs once before the whole suite.
//
// 1. Purge leftover Test Book suggestion/comment/reply data so count-based tests
//    start from a clean slate (interrupted prior runs can leave orphans that make
//    tests like "undoing all edits removes suggestion from Firestore" see stale rows).
// 2. Warm the content tree with ONE full refresh so the per-test scoped refreshes
//    (?scope=files) can keep reusing it instead of each rebuilding all 22 books.
const BASE = process.env.BASE_URL || 'http://localhost:8080';

module.exports = async () => {
  try {
    const c = await fetch(BASE + '/api/cleanup-test-data', { method: 'POST' });
    const j = await c.json().catch(() => ({}));
    console.log(`[global-setup] cleanup-test-data: deleted ${j.deleted ?? '?'}`);
  } catch (e) {
    console.warn('[global-setup] cleanup skipped (server not reachable?):', e.message);
  }
  // NOTE: deliberately do NOT call a full /api/refresh here — that clears the
  // disk-cache fallback (github.clearDiskCache) and forces a full tree rebuild.
  // The server already builds the tree at boot, and per-test refreshes are scoped
  // (?scope=files), so the tree stays warm without wiping the rate-limit safety net.
};
