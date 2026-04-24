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
    // Update display info on each login
    await ref.update({
      displayName: displayName || doc.data().displayName,
      photoURL: photoURL || doc.data().photoURL,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
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

module.exports = {
  getUser,
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
};
