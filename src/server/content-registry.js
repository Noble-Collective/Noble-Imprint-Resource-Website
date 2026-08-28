// Content identity registry (analytics P1.5).
//
// Assigns a stable, forever `contentId` (UUID) to each book/session so analytics
// survives renames. The id lives ONLY here (Firestore `contentRegistry`), never
// in the content repo. Phase A: mint-on-first-sight keyed by the item's current
// repoPath, cached in memory. Rename reconciliation (inheriting an existing id
// when a path changes) is layered on in a later phase — see
// plans/2026-08-28-content-identity-registry.md.
//
// Best-effort: every failure returns null so a Firestore hiccup never breaks a
// page render (analytics simply falls back to title-keyed rows).

const crypto = require('crypto');
const firestore = require('./firestore');

// encodedRepoPath -> { contentId, type, repoPath, ... }
const index = new Map();
let loaded = false;

function encodePath(repoPath) {
  return firestore.encodeBookPath(repoPath); // '/' -> '|' (Firestore doc-id safe)
}

// Load the whole registry into memory once at boot. Small (dozens of books,
// hundreds of sessions), so a single read keeps the render path Firestore-free.
async function init() {
  try {
    const snap = await firestore.contentRegistryCollection().get();
    index.clear();
    snap.forEach((doc) => {
      const d = doc.data();
      if (d && d.repoPath && d.contentId) index.set(encodePath(d.repoPath), d);
    });
    loaded = true;
    console.log(`[REGISTRY] loaded ${index.size} content id(s)`);
  } catch (err) {
    console.error('[REGISTRY] init failed:', err && err.message);
  }
}

// Return the stable contentId for a content item, minting one on first sight.
// `type` is 'book' | 'session'. `meta` carries denormalized labels for the
// dashboard + future structural rename matching.
async function contentIdFor(type, repoPath, meta = {}) {
  if (!repoPath) return null;
  const key = encodePath(repoPath);
  const cached = index.get(key);
  if (cached) return cached.contentId;
  try {
    const ref = firestore.contentRegistryCollection().doc(key);
    const contentId = await firestore.getDb().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (doc.exists && doc.data().contentId) return doc.data().contentId;
      const id = crypto.randomUUID();
      tx.set(ref, {
        contentId: id,
        type,
        repoPath,
        title: meta.title || null,
        series: meta.series || null,
        subseries: meta.subseries || null,
        book: meta.book || null,
        sessionNumber: meta.sessionNumber != null ? String(meta.sessionNumber) : null,
        status: 'active',
        firstSeen: firestore.serverTimestamp(),
        lastSeen: firestore.serverTimestamp(),
      });
      return id;
    });
    index.set(key, { contentId, type, repoPath, ...meta });
    return contentId;
  } catch (err) {
    console.error('[REGISTRY] contentIdFor failed for', repoPath, '-', err && err.message);
    return null;
  }
}

module.exports = { init, contentIdFor, _index: index };
