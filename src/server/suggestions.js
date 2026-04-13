const admin = require('firebase-admin');
const github = require('./github');
const cache = require('./cache');

function getDb() {
  return admin.firestore();
}

function suggestionsCollection() {
  return getDb().collection('suggestions');
}

function commentsCollection() {
  return getDb().collection('comments');
}

// --- Suggestion Hunk CRUD ---

async function createHunk({ filePath, bookPath, baseCommitSha, type, originalFrom, originalTo, originalText, newText, contextBefore, contextAfter, authorEmail, authorName }) {
  const ref = await suggestionsCollection().add({
    filePath,
    bookPath,
    baseCommitSha,
    type,
    originalFrom,
    originalTo,
    originalText: originalText || '',
    newText: newText || '',
    contextBefore: contextBefore || '',
    contextAfter: contextAfter || '',
    authorEmail,
    authorName: authorName || authorEmail,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
  });
  return ref.id;
}

async function updateHunk(id, { originalFrom, originalTo, originalText, newText, contextBefore, contextAfter, type }) {
  await suggestionsCollection().doc(id).update({
    originalFrom,
    originalTo,
    originalText: originalText || '',
    newText: newText || '',
    contextBefore: contextBefore || '',
    contextAfter: contextAfter || '',
    type,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function deleteHunk(id) {
  await suggestionsCollection().doc(id).delete();
}

async function getHunk(id) {
  const doc = await suggestionsCollection().doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function getSuggestionsForFile(filePath) {
  const snapshot = await suggestionsCollection()
    .where('filePath', '==', filePath)
    .where('status', '==', 'pending')
    .orderBy('originalFrom', 'asc')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function listSuggestions({ bookPath, status, limit } = {}) {
  let query = suggestionsCollection().orderBy('createdAt', 'desc');
  if (bookPath) query = query.where('bookPath', '==', bookPath);
  if (status) query = query.where('status', '==', status);
  query = query.limit(limit || 50);

  const snapshot = await query.get();
  return snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      filePath: d.filePath,
      bookPath: d.bookPath,
      type: d.type,
      originalText: d.originalText,
      newText: d.newText,
      authorEmail: d.authorEmail,
      authorName: d.authorName,
      status: d.status,
      comment: d.comment,
      createdAt: d.createdAt,
      resolvedAt: d.resolvedAt,
      resolvedBy: d.resolvedBy,
    };
  });
}

async function acceptHunk(id, resolverEmail) {
  const hunk = await getHunk(id);
  if (!hunk) throw new Error('Suggestion not found');
  if (hunk.status !== 'pending') throw new Error('Suggestion is not pending');

  // Fetch current file
  const { content: currentContent, sha: currentSha } = await github.getFileContent(hunk.filePath);

  // Simple find-and-replace: find the originalText in the current file
  let newContent;

  if (hunk.type === 'insertion') {
    // For insertions, find the insertion point using context
    const ctx = hunk.contextBefore + hunk.contextAfter;
    const pos = currentContent.indexOf(ctx);
    if (pos === -1) {
      await suggestionsCollection().doc(id).update({
        status: 'stale',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: resolverEmail,
      });
      return { stale: true };
    }
    const insertAt = pos + hunk.contextBefore.length;
    newContent = currentContent.slice(0, insertAt) + hunk.newText + currentContent.slice(insertAt);
  } else {
    // For deletions and replacements, find the original text
    const pos = currentContent.indexOf(hunk.originalText);
    if (pos === -1) {
      // Text no longer exists — mark stale
      await suggestionsCollection().doc(id).update({
        status: 'stale',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: resolverEmail,
      });
      return { stale: true };
    }

    if (hunk.type === 'deletion') {
      newContent = currentContent.slice(0, pos) + currentContent.slice(pos + hunk.originalText.length);
    } else {
      // replacement
      newContent = currentContent.slice(0, pos) + hunk.newText + currentContent.slice(pos + hunk.originalText.length);
    }
  }

  // Commit
  const message = `Accept suggestion by ${hunk.authorEmail}`;
  await github.updateFileContent(hunk.filePath, newContent, currentSha, message);

  // Mark accepted
  await suggestionsCollection().doc(id).update({
    status: 'accepted',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: resolverEmail,
  });

  // Other pending suggestions stay pending — they'll still work as long as
  // their originalText can be found in the file. No blanket stale.

  cache.invalidateAll();
  return { stale: false };
}

async function rejectHunk(id, resolverEmail, reason) {
  await suggestionsCollection().doc(id).update({
    status: 'rejected',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: resolverEmail,
    rejectionReason: reason || null,
  });
}

// --- Comment CRUD ---

async function createComment({ filePath, bookPath, baseCommitSha, from, to, selectedText, commentText, authorEmail, authorName }) {
  const ref = await commentsCollection().add({
    filePath,
    bookPath,
    baseCommitSha,
    from,
    to,
    selectedText,
    commentText,
    authorEmail,
    authorName: authorName || authorEmail,
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
  });
  return ref.id;
}

async function getCommentsForFile(filePath) {
  const snapshot = await commentsCollection()
    .where('filePath', '==', filePath)
    .where('status', '==', 'open')
    .orderBy('from', 'asc')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function resolveComment(id, resolverEmail) {
  await commentsCollection().doc(id).update({
    status: 'resolved',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: resolverEmail,
  });
}

module.exports = {
  createHunk,
  updateHunk,
  deleteHunk,
  getHunk,
  getSuggestionsForFile,
  listSuggestions,
  acceptHunk,
  rejectHunk,
  createComment,
  getCommentsForFile,
  resolveComment,
};
