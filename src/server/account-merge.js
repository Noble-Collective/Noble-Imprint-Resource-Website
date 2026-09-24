// Combine accounts — POST /api/account/merge (plan: Collective-Shared/plans/2026-09-24-account-merge.md).
//
// When a person tries to connect a sign-in method (Google/Apple) that already belongs to ANOTHER
// account, the client signs in to that other account on a secondary Firebase app and sends both ID
// tokens here. We verify both, pick the survivor, copy the loser's shared-store data into it, delete the
// loser, then move the loser's sign-in methods onto the survivor. Returns a custom token when the
// survivor isn't the account the client is signed in to.
//
// The pure rules (pickSurvivor / mergeUserData / dataCountOf) are a CommonJS port of
// @noble-collective/userdata core/merge.ts — the server can't require the SDK (devDependency; its core
// pulls in zod) — kept identical by tests/unit/account-merge.test.js against the shared merge.golden.json.

const RELAY_RE = /@privaterelay\.appleid\.com$/i;
const COLLECTIONS = ['answers', 'annotations', 'settings', 'activity', 'planProgress', 'readingPositions'];
const FRESH_MS = 5 * 60 * 1000;

// --- pure (port of core/merge.ts) ------------------------------------------------------------

const isRelayEmail = (email) => !!email && RELAY_RE.test(String(email).trim());
const hasTrustedRealEmail = (a) => a.emailVerified === true && !!a.email && !isRelayEmail(a.email);

function pickSurvivor(a, b) {
  const score = (x) => [hasTrustedRealEmail(x) ? 1 : 0, x.dataCount || 0, -(x.createdAt ?? Number.MAX_SAFE_INTEGER)];
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i] ? { survivor: a, loser: b } : { survivor: b, loser: a };
  }
  return a.uid <= b.uid ? { survivor: a, loser: b } : { survivor: b, loser: a };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const stamp = (d) => Math.max(num(d.updatedAt), num(d.viewedAt), num(d.completedAt), num(d.createdAt));

function unionDays(a, b) {
  if (!Array.isArray(a) && !Array.isArray(b)) return a ?? b;
  const all = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  return [...new Set(all.map((x) => JSON.stringify(x)))].map((s) => JSON.parse(s)).sort((x, y) =>
    typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
}

function mergeUserData(survivor, loser) {
  const out = [];
  for (const collection of Object.keys(loser).sort()) {
    const lDocs = loser[collection] || {};
    const sDocs = survivor[collection] || {};
    for (const docId of Object.keys(lDocs).sort()) {
      const l = lDocs[docId];
      const s = sDocs[docId];
      if (!s) { out.push({ collection, docId, data: l }); continue; }
      if (collection === 'settings' && docId === 'prefs') {
        const fill = Object.fromEntries(Object.entries(l).filter(([k]) => !(k in s)));
        if (Object.keys(fill).length) out.push({ collection, docId, data: { ...s, ...fill } });
        continue;
      }
      if (collection === 'planProgress') {
        const newer = stamp(l) > stamp(s) ? l : s;
        const merged = { ...newer, completedDays: unionDays(s.completedDays, l.completedDays) };
        if (JSON.stringify(merged) !== JSON.stringify(s)) out.push({ collection, docId, data: merged });
        continue;
      }
      if (stamp(l) > stamp(s)) out.push({ collection, docId, data: l });
    }
  }
  return out;
}

const dataCountOf = (docs) => Object.keys(docs.annotations || {}).length + Object.keys(docs.answers || {}).length;

// --- I/O ---------------------------------------------------------------------------------------

class MergeError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

/** Firestore Timestamp → epoch ms (so the pure rules compare numbers); leave everything else. */
function toPlain(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    out[k] = v && typeof v.toMillis === 'function' ? v.toMillis() : v;
  }
  return out;
}

/** Epoch-ms timestamp fields back to Firestore Timestamps on write. */
function toStored(data, Timestamp) {
  const out = { ...data };
  for (const k of ['createdAt', 'updatedAt', 'viewedAt', 'completedAt']) {
    if (typeof out[k] === 'number' && Timestamp) out[k] = Timestamp.fromMillis(out[k]);
  }
  return out;
}

async function readUserDocs(db, uid) {
  const docs = {};
  for (const c of COLLECTIONS) {
    const snap = await db.collection('users').doc(uid).collection(c).get();
    if (snap.empty) continue;
    docs[c] = {};
    snap.forEach((d) => { docs[c][d.id] = toPlain(d.data()); });
  }
  return docs;
}

/**
 * Combine two accounts. `deps`:
 *   auth      — firebase-admin Auth for noble-imprint-463519 (verifyIdToken/getUser/deleteUser/updateUser/createCustomToken)
 *   db        — Firestore `collective-user-data` (the shared store)
 *   legacyDb  — Firestore (default) on 463519 (pre-cutover app data) — optional
 *   hasOtherProductData(uid) → Promise<string|null> — e.g. 'institute' when the uid has data we can't move yet
 *   Timestamp — firebase-admin Timestamp class (optional; for writing ms back as Timestamps)
 *   now       — () => ms
 *   log       — (obj) => void (one audit line per merge)
 */
async function mergeAccounts({ currentIdToken, otherIdToken, dryRun = false }, deps) {
  const { auth, db, legacyDb, hasOtherProductData, Timestamp, now = Date.now, log = () => {} } = deps;
  if (!currentIdToken || !otherIdToken) throw new MergeError(400, 'missing-token');

  let cur;
  let oth;
  try {
    [cur, oth] = await Promise.all([auth.verifyIdToken(currentIdToken, true), auth.verifyIdToken(otherIdToken, true)]);
  } catch (e) {
    throw new MergeError(401, 'invalid-token', e.message);
  }
  if (cur.uid === oth.uid) throw new MergeError(400, 'same-account');
  // The OTHER account was signed in to moments ago on this device — proof the person holds it.
  if (!oth.auth_time || now() - oth.auth_time * 1000 > FRESH_MS) throw new MergeError(401, 'stale-sign-in');

  const [curUser, othUser, curDocs, othDocs] = await Promise.all([
    auth.getUser(cur.uid), auth.getUser(oth.uid), readUserDocs(db, cur.uid), readUserDocs(db, oth.uid),
  ]);
  const info = (u, docs) => ({
    uid: u.uid,
    email: u.email || null,
    emailVerified: u.emailVerified === true,
    createdAt: u.metadata && u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : undefined,
    dataCount: dataCountOf(docs),
  });
  const { survivor, loser } = pickSurvivor(info(curUser, curDocs), info(othUser, othDocs));
  const survivorUser = survivor.uid === cur.uid ? curUser : othUser;
  const loserUser = survivor.uid === cur.uid ? othUser : curUser;
  const survivorDocs = survivor.uid === cur.uid ? curDocs : othDocs;
  const loserDocs = survivor.uid === cur.uid ? othDocs : curDocs;

  // The loser is DELETED. If that's the current (possibly long-lived) session and it holds data, require
  // a recent sign-in, like any account deletion — so a stolen session can't fold someone's data away.
  // An empty loser (the common Hide-My-Email stray) needs no extra step.
  const loserHasData = Object.keys(loserDocs).length > 0;
  if (loser.uid === cur.uid && loserHasData && (!cur.auth_time || now() - cur.auth_time * 1000 > FRESH_MS)) {
    throw new MergeError(401, 'reauth-required');
  }

  // Refuse rather than orphan data we can't move yet.
  if (legacyDb) {
    const legacy = await legacyDb.collection('users').doc(loser.uid).listCollections();
    if (legacy.length) throw new MergeError(409, 'legacy-data');
  }
  if (hasOtherProductData) {
    const product = await hasOtherProductData(loser.uid);
    if (product) throw new MergeError(409, `${product}-data`);
  }

  // Sign-in methods to move. One identity per provider per account: if the survivor already has that
  // provider (a different Google account, say), that loser identity can't move — report it.
  const survivorProviders = new Set((survivorUser.providerData || []).map((p) => p.providerId));
  const toMove = (loserUser.providerData || []).filter((p) => p.providerId === 'google.com' || p.providerId === 'apple.com');
  const movable = toMove.filter((p) => !survivorProviders.has(p.providerId));
  const skipped = toMove.filter((p) => survivorProviders.has(p.providerId)).map((p) => p.providerId);

  const writes = mergeUserData(survivorDocs, loserDocs);
  const summary = {
    survivorUid: survivor.uid,
    loserUid: loser.uid,
    survivorIsCurrent: survivor.uid === cur.uid,
    writes: writes.length,
    moved: movable.map((p) => p.providerId),
    skipped,
  };
  if (dryRun) return { ...summary, dryRun: true };

  // 1) Data first: batched writes into the survivor (≤ 450 per batch).
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) {
      batch.set(db.collection('users').doc(survivor.uid).collection(w.collection).doc(w.docId), toStored(w.data, Timestamp));
    }
    await batch.commit();
  }
  // 2) Remove the loser's shared data, then the loser account (frees its sign-in identities).
  if (typeof db.recursiveDelete === 'function') await db.recursiveDelete(db.collection('users').doc(loser.uid));
  await auth.deleteUser(loser.uid);
  // 3) Move the identities onto the survivor.
  const linkErrors = [];
  for (const p of movable) {
    try {
      await auth.updateUser(survivor.uid, {
        providerToLink: { providerId: p.providerId, uid: p.uid, email: p.email || undefined, displayName: p.displayName || undefined },
      });
    } catch (e) {
      linkErrors.push({ providerId: p.providerId, error: e.code || e.message });
    }
  }
  if (!survivorUser.displayName && loserUser.displayName) {
    try { await auth.updateUser(survivor.uid, { displayName: loserUser.displayName }); } catch (_) { /* cosmetic */ }
  }

  const customToken = survivor.uid === cur.uid ? null : await auth.createCustomToken(survivor.uid);
  log({ event: 'account-merge', ...summary, linkErrors });
  return { ...summary, linkErrors, customToken };
}

module.exports = {
  // pure
  isRelayEmail, hasTrustedRealEmail, pickSurvivor, mergeUserData, dataCountOf,
  // I/O
  mergeAccounts, MergeError, readUserDocs, FRESH_MS,
};
