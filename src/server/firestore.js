const admin = require('firebase-admin');
const { isSuperAdmin } = require('./auth');

function getDb() {
  return admin.firestore();
}

function usersCollection() {
  return getDb().collection('users');
}

function docId(email) {
  return email.toLowerCase();
}

async function getUser(email) {
  const doc = await usersCollection().doc(docId(email)).get();
  return doc.exists ? doc.data() : null;
}

async function createOrUpdateUser(email, displayName, photoURL) {
  const ref = usersCollection().doc(docId(email));
  const doc = await ref.get();

  if (doc.exists) {
    // Update photo on each login (may change), but keep existing displayName
    // if already set (allows manual override via admin console / Firestore)
    const existing = doc.data();
    const updates = {
      photoURL: photoURL || existing.photoURL,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Only set displayName if the user doesn't have one yet
    if (!existing.displayName || existing.displayName === existing.email) {
      updates.displayName = displayName || existing.displayName;
    }
    await ref.update(updates);
  } else {
    await ref.set({
      email: email.toLowerCase(),
      displayName: displayName || email,
      photoURL: photoURL || null,
      globalRole: null,
      bookRoles: {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return (await ref.get()).data();
}

// Create a user stub (from admin console, before they've logged in)
async function createUser(email) {
  const ref = usersCollection().doc(docId(email));
  const doc = await ref.get();
  if (doc.exists) return doc.data();

  await ref.set({
    email: email.toLowerCase(),
    displayName: email,
    photoURL: null,
    globalRole: null,
    bookRoles: {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return (await ref.get()).data();
}

async function setGlobalRole(email, role) {
  if (isSuperAdmin(email)) {
    throw new Error('Cannot modify super admin role');
  }
  const validRoles = ['admin', null];
  if (!validRoles.includes(role)) {
    throw new Error(`Invalid global role: ${role}`);
  }
  await usersCollection().doc(docId(email)).update({
    globalRole: role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function setBookRole(email, bookPath, role) {
  const validRoles = ['manuscript-owner', 'comment-suggest', 'viewer'];
  if (!validRoles.includes(role)) {
    throw new Error(`Invalid book role: ${role}`);
  }
  await usersCollection().doc(docId(email)).update({
    [`bookRoles.${bookPath.replace(/\//g, '|')}`]: role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function removeBookRole(email, bookPath) {
  await usersCollection().doc(docId(email)).update({
    [`bookRoles.${bookPath.replace(/\//g, '|')}`]: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function removeUser(email) {
  if (isSuperAdmin(email)) {
    throw new Error('Cannot remove super admin');
  }
  await usersCollection().doc(docId(email)).delete();
}

async function getAllUsers() {
  const snapshot = await usersCollection().orderBy('email').get();
  return snapshot.docs.map(doc => doc.data());
}

async function isAdmin(email) {
  if (isSuperAdmin(email)) return true;
  const user = await getUser(email);
  return user && user.globalRole === 'admin';
}

// Check if a user has any role on a specific book
async function getUserBookRole(email, bookRepoPath) {
  if (isSuperAdmin(email)) return 'admin';
  const user = await getUser(email);
  if (!user) return null;
  if (user.globalRole === 'admin') return 'admin';
  const key = bookRepoPath.replace(/\//g, '|');
  return user.bookRoles ? user.bookRoles[key] || null : null;
}

// Encode/decode book paths for Firestore field names (/ is not allowed in field paths)
function encodeBookPath(repoPath) {
  return repoPath.replace(/\//g, '|');
}

function decodeBookPath(encoded) {
  return encoded.replace(/\|/g, '/');
}

// --- Notification preferences ---

async function getNotificationPrefs(email) {
  const user = await getUser(email);
  if (!user || !user.notificationPrefs) {
    return { globalOptIn: true, bookOverrides: {} };
  }
  return {
    globalOptIn: user.notificationPrefs.globalOptIn !== false,
    bookOverrides: user.notificationPrefs.bookOverrides || {},
  };
}

async function updateNotificationPrefs(email, prefs) {
  await usersCollection().doc(docId(email)).update({
    notificationPrefs: prefs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// Check if a user should receive a notification for a given book
async function shouldNotify(email, bookPath) {
  const prefs = await getNotificationPrefs(email);
  if (!prefs.globalOptIn) return false;
  const key = bookPath.replace(/\//g, '|');
  if (key in prefs.bookOverrides) return prefs.bookOverrides[key];
  // Test Book defaults to OFF
  if (bookPath.includes('Foundations/Test Book')) return false;
  return true;
}

// --- BSB text-validation run history ---

function validationRunsCollection() {
  return getDb().collection('bibleValidationRuns');
}

// Persist a completed validation run. Returns { id }.
async function saveValidationRun(run) {
  const ref = await validationRunsCollection().add({
    ...run,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
}

// Most-recent runs first. Firestore Timestamps are converted to ISO strings so
// the client can render them directly.
async function getValidationRuns(limit = 25) {
  const snap = await validationRunsCollection().orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      ...d,
      createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null,
    };
  });
}

// Delete every validation run (history reset). Returns the count removed.
async function deleteAllValidationRuns() {
  const snap = await validationRunsCollection().get();
  let deleted = 0;
  // Firestore batches cap at 500 ops.
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = getDb().batch();
    for (const doc of snap.docs.slice(i, i + 450)) batch.delete(doc.ref);
    await batch.commit();
    deleted += Math.min(450, snap.docs.length - i);
  }
  return deleted;
}

// --- Dismissed (hidden) compare diffs ---
// Each doc = one diff the admin chose to hide (by a stable key), so it stays hidden across
// compare runs and is excluded from the "up to date" verdict.
function dismissedDiffsCollection() { return getDb().collection('bibleDismissedDiffs'); }

async function getDismissedDiffs() {
  const snap = await dismissedDiffsCollection().get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addDismissedDiff(entry) {
  const existing = await dismissedDiffsCollection().where('key', '==', entry.key).limit(1).get();
  if (!existing.empty) return { id: existing.docs[0].id, deduped: true };
  const ref = await dismissedDiffsCollection().add({ ...entry, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return { id: ref.id };
}

async function removeDismissedDiff(key) {
  const snap = await dismissedDiffsCollection().where('key', '==', key).get();
  if (snap.empty) return 0;
  const batch = getDb().batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

// --- Quotation-audit run history ---

async function saveQuoteAuditRun(run) {
  const ref = await getDb().collection('quoteAuditRuns').add({
    ...run,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
}

async function getQuoteAuditRuns(limit = 25) {
  const snap = await getDb().collection('quoteAuditRuns').orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map(doc => {
    const d = doc.data();
    return { id: doc.id, ...d, createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null };
  });
}

module.exports = {
  getUser,
  saveValidationRun,
  getValidationRuns,
  deleteAllValidationRuns,
  getDismissedDiffs,
  addDismissedDiff,
  removeDismissedDiff,
  saveQuoteAuditRun,
  getQuoteAuditRuns,
  createOrUpdateUser,
  createUser,
  setGlobalRole,
  setBookRole,
  removeBookRole,
  removeUser,
  getAllUsers,
  isAdmin,
  getUserBookRole,
  encodeBookPath,
  decodeBookPath,
  getNotificationPrefs,
  updateNotificationPrefs,
  shouldNotify,
  getDb,
  contentRegistryCollection,
  serverTimestamp,
};

function contentRegistryCollection() {
  return getDb().collection('contentRegistry');
}

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}
