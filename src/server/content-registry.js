// Content identity registry (analytics P1.5).
//
// Assigns a stable, forever `contentId` (UUID) to each book/session so analytics
// survives renames. The id lives ONLY here (Firestore `contentRegistry`), never
// in the content repo.
//
// Phase A: mint-on-first-sight keyed by the item's current repoPath, cached in
// memory. Phase B: LAZY, fully-automatic rename reconciliation — when a
// never-seen path shows up, inherit an existing id instead of minting, by
// matching it structurally against "orphans" (registered paths that have
// disappeared from the current content tree). Renames therefore keep their id
// with zero admin action and zero GitHub calls. Initial population is free:
// nothing is orphaned yet, so every new path just mints.
//
// Coverage (structural signals, no content in the repo):
//  - session file renamed, book unchanged   -> parentBook path + session number
//  - book directory renamed (cascade)        -> book's parent (series/subseries)
//    dir; its sessions re-link by (old book -> new book) + session number
// Ambiguous matches (e.g. two books renamed in one series at once, or a session
// whose NUMBER also changed) are left to mint a fresh id rather than guess — a
// rare "split" surfaced passively in the dashboard later. Best-effort: any
// failure returns null and never blocks a render.

const crypto = require('crypto');
const firestore = require('./firestore');

// encodedRepoPath -> { contentId, type, repoPath, series, subseries, book, sessionNumber, ... }
const index = new Map();
// subset of `index`: entries whose repoPath is no longer in the current tree
const orphans = new Map();
let currentPaths = new Set();
let lastTree = null;
let loaded = false;

function encodePath(repoPath) {
  return firestore.encodeBookPath(repoPath); // '/' -> '|'
}
function parentDir(p) {
  const i = String(p).lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
// series/.../Book/sessions/File.md -> series/.../Book
function sessionParentBook(sessionPath) {
  const m = /^(.*)\/sessions\/[^/]+$/.exec(String(sessionPath));
  return m ? m[1] : parentDir(parentDir(sessionPath));
}

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

// A tree whose path count collapses to below this fraction of the last good view is
// treated as degraded — we skip the orphan recompute rather than orphan live content.
const ORPHAN_SYNC_MIN_FRACTION = Number(process.env.REGISTRY_ORPHAN_SYNC_MIN_FRACTION) || 0.5;

// Recompute the current-path set + orphan list from the (cached) content tree.
// Memoized on the tree object reference, so it only runs when the tree rebuilds.
function syncTree(tree) {
  if (!tree || tree === lastTree) return;
  const paths = new Set();
  for (const s of (tree.series || [])) {
    for (const child of (s.children || [])) {
      if (child.type === 'book') {
        paths.add(child.repoPath);
        for (const ses of (child.sessions || [])) paths.add(ses.path);
      } else if (child.type === 'subseries') {
        for (const b of (child.books || [])) {
          paths.add(b.repoPath);
          for (const ses of (b.sessions || [])) paths.add(ses.path);
        }
      }
    }
  }
  // Data-safety guard (coupled to content.isTreeSane): if the path set collapses sharply
  // vs. the last good sync, this is almost certainly a degraded/partial tree. Recomputing
  // orphans off it would mark live content as "disappeared" → a new path could inherit()
  // its id and DELETE the real registry doc. Skip until a healthy tree returns.
  if (currentPaths.size > 0 && paths.size < currentPaths.size * ORPHAN_SYNC_MIN_FRACTION) {
    console.error(`[REGISTRY] skipping orphan sync — path count ${currentPaths.size} → ${paths.size} looks degraded; keeping previous view`);
    return; // leave lastTree/currentPaths/orphans untouched
  }
  lastTree = tree;
  currentPaths = paths;
  orphans.clear();
  for (const [key, entry] of index) {
    if (!currentPaths.has(entry.repoPath)) orphans.set(key, entry);
  }
}

// Return the single orphan matching a predicate, or null if none / ambiguous.
function uniqueOrphan(pred) {
  let found = null;
  for (const entry of orphans.values()) {
    if (!pred(entry)) continue;
    if (found) return null; // ambiguous — don't guess
    found = entry;
  }
  return found;
}

// Find the orphaned predecessor of a new path, or null.
function findPredecessor(type, repoPath, meta) {
  if (orphans.size === 0) return null;
  if (type === 'book') {
    const parent = parentDir(repoPath);
    return uniqueOrphan((e) => e.type === 'book' && parentDir(e.repoPath) === parent);
  }
  if (type === 'session') {
    const num = meta.sessionNumber != null ? String(meta.sessionNumber) : null;
    if (num == null) return null;
    const newParentBook = sessionParentBook(repoPath);
    // (1) session-only rename: same book path, same number
    const direct = uniqueOrphan((e) =>
      e.type === 'session' && sessionParentBook(e.repoPath) === newParentBook && String(e.sessionNumber) === num);
    if (direct) return direct;
    // (2) book-rename cascade: the new book is itself a rename of an orphaned book
    const oldBook = uniqueOrphan((e) => e.type === 'book' && parentDir(e.repoPath) === parentDir(newParentBook));
    if (oldBook) {
      return uniqueOrphan((e) =>
        e.type === 'session' && sessionParentBook(e.repoPath) === oldBook.repoPath && String(e.sessionNumber) === num);
    }
  }
  return null;
}

// Move an orphan's contentId onto a new path (rename): create the new doc with
// the SAME contentId, delete the old doc. Keeps analytics continuity.
async function inherit(orphan, type, repoPath, meta) {
  const oldKey = encodePath(orphan.repoPath);
  const newKey = encodePath(repoPath);
  const entry = {
    contentId: orphan.contentId,
    type,
    repoPath,
    title: meta.title || null,
    series: meta.series || null,
    subseries: meta.subseries || null,
    book: meta.book || null,
    sessionNumber: meta.sessionNumber != null ? String(meta.sessionNumber) : null,
    status: 'active',
    firstSeen: orphan.firstSeen || firestore.serverTimestamp(),
    lastSeen: firestore.serverTimestamp(),
    previousPaths: [...(orphan.previousPaths || []), orphan.repoPath],
  };
  const col = firestore.contentRegistryCollection();
  await col.doc(newKey).set(entry);
  // Soft-delete the old doc (tombstone) instead of hard-deleting, so a mistaken rename
  // re-link stays recoverable (the id already lives on the new doc).
  if (oldKey !== newKey) {
    await col.doc(oldKey).set({ status: 'renamed', renamedTo: repoPath }, { merge: true }).catch(() => {});
  }
  index.delete(oldKey);
  orphans.delete(oldKey);
  index.set(newKey, entry);
  console.log(`[REGISTRY] rename re-linked ${orphan.contentId.slice(0, 8)}: ${orphan.repoPath} -> ${repoPath}`);
  return orphan.contentId;
}

// Return the stable contentId for a content item. `tree` is the current content
// tree (for orphan detection). `type` is 'book' | 'session'.
async function contentIdFor(type, repoPath, meta = {}, tree = null) {
  if (!repoPath) return null;
  syncTree(tree);
  const key = encodePath(repoPath);
  const cached = index.get(key);
  if (cached) return cached.contentId;
  try {
    // Phase B: inherit an orphan's id if this looks like a rename.
    const predecessor = findPredecessor(type, repoPath, meta);
    if (predecessor) return await inherit(predecessor, type, repoPath, meta);

    // Otherwise mint a fresh id (transaction guards concurrent first views).
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

module.exports = {
  init, contentIdFor,
  // exposed for tests
  _index: index, _orphans: orphans, syncTree, findPredecessor, sessionParentBook,
};
