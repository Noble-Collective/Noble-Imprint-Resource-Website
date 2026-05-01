const admin = require('firebase-admin');
const crypto = require('crypto');
const github = require('./github');
const cache = require('./cache');

// --- Content hash for fast-path position validation ---
function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// --- Multi-selector anchor: resolve an annotation's position in current content ---
// Returns { from, to, confidence, stale } or { stale: true } if unfindable
function resolveAnchor(annotation, currentContent) {
  // FAST PATH: content hash matches — positions are still valid
  if (annotation.position && annotation.position.contentHash &&
      annotation.position.contentHash === contentHash(currentContent)) {
    return { from: annotation.position.from, to: annotation.position.to, confidence: 1.0 };
  }

  // Determine the exact text to search for
  const exact = annotation.anchor ? annotation.anchor.exact
    : (annotation.originalText || annotation.selectedText || '');
  const prefix = annotation.anchor ? (annotation.anchor.prefix || '')
    : (annotation.contextBefore || '');
  const suffix = annotation.anchor ? (annotation.anchor.suffix || '')
    : (annotation.contextAfter || '');

  if (!exact && !prefix && !suffix) {
    return { stale: true, confidence: 0 };
  }

  // Step 1: Try prefix + exact + suffix (highest confidence)
  if (prefix && suffix) {
    const fullCtx = prefix + exact + suffix;
    const pos = currentContent.indexOf(fullCtx);
    if (pos >= 0) {
      const from = pos + prefix.length;
      return { from, to: from + exact.length, confidence: 1.0 };
    }
  }

  // Step 2: Try prefix + exact only
  if (prefix) {
    const partial = prefix + exact;
    const pos = currentContent.indexOf(partial);
    if (pos >= 0) {
      const from = pos + prefix.length;
      return { from, to: from + exact.length, confidence: 0.95 };
    }
  }

  // Step 3: Try exact + suffix only
  if (suffix) {
    const partial = exact + suffix;
    const pos = currentContent.indexOf(partial);
    if (pos >= 0) {
      return { from: pos, to: pos + exact.length, confidence: 0.95 };
    }
  }

  // Step 4: Bare exact text search (only safe for long strings)
  if (exact.length >= 20) {
    const pos = currentContent.indexOf(exact);
    if (pos >= 0) {
      return { from: pos, to: pos + exact.length, confidence: 0.8 };
    }
  }

  // Step 5: Short exact text — find all occurrences, pick closest to structural hint
  if (exact.length > 0 && exact.length < 20) {
    const candidates = [];
    let searchFrom = 0;
    while (true) {
      const pos = currentContent.indexOf(exact, searchFrom);
      if (pos === -1) break;
      candidates.push(pos);
      searchFrom = pos + 1;
    }

    if (candidates.length === 1) {
      return { from: candidates[0], to: candidates[0] + exact.length, confidence: 0.8 };
    }

    if (candidates.length > 1 && annotation.structure && annotation.structure.percentOffset != null) {
      const expectedPos = Math.round(annotation.structure.percentOffset * currentContent.length);
      let best = candidates[0];
      let bestDist = Math.abs(best - expectedPos);
      for (const c of candidates) {
        const dist = Math.abs(c - expectedPos);
        if (dist < bestDist) { best = c; bestDist = dist; }
      }
      return { from: best, to: best + exact.length, confidence: 0.6 };
    }
  }

  // FAILED — mark stale
  return { stale: true, confidence: 0 };
}

// --- Build multi-selector anchor data for a new annotation ---
function buildAnchorData(content, from, to, exactText) {
  const prefix = content.substring(Math.max(0, from - 80), from);
  const suffix = content.substring(to, Math.min(content.length, to + 80));
  const line = content.substring(0, from).split('\n').length;

  return {
    anchor: { exact: exactText, prefix, suffix },
    position: { from, to, contentHash: contentHash(content) },
    structure: { lineNumber: line, percentOffset: from / content.length },
  };
}

// --- Location context for history cards ---
// Captures line number and nearest heading at the time of resolution.
function getLocationContext(content, pos) {
  try {
    if (!content || pos == null || pos < 0) return {};
    const textBefore = content.substring(0, pos);
    const lineNumber = (textBefore.match(/\n/g) || []).length + 1;
    const headingMatches = textBefore.match(/^#{1,6}\s+(.+)$/gm);
    const nearestHeading = headingMatches
      ? headingMatches[headingMatches.length - 1].replace(/^#+\s+/, '')
      : null;
    return { resolvedLineNumber: lineNumber, resolvedHeading: nearestHeading };
  } catch { return {}; }
}

// --- Re-anchor all remaining annotations for a file after it changes ---
async function reanchorAnnotations(filePath, newContent) {
  const newHash = contentHash(newContent);

  const [suggestions, comments] = await Promise.all([
    getSuggestionsForFile(filePath),
    getCommentsForFile(filePath),
  ]);

  const batch = getDb().batch();
  let batchCount = 0;

  for (const s of suggestions) {
    const resolved = resolveAnchor(s, newContent);
    if (resolved.stale) {
      batch.update(suggestionsCollection().doc(s.id), {
        status: 'stale',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Update positions AND context strings — stale context causes accepts to fail.
      // Also sync originalFrom/originalTo so client-side savedHunks keys match the
      // diff engine's positions (which are relative to the current file, not the
      // file that existed when the suggestion was first created).
      const freshCtxBefore = newContent.substring(Math.max(0, resolved.from - 80), resolved.from);
      const ctxEnd = s.type === 'insertion' ? resolved.from : resolved.from + (s.originalText || '').length;
      const freshCtxAfter = newContent.substring(ctxEnd, Math.min(newContent.length, ctxEnd + 80));
      const resolvedTo = s.type === 'insertion' ? resolved.from : resolved.from + (s.originalText || '').length;
      batch.update(suggestionsCollection().doc(s.id), {
        originalFrom: resolved.from,
        originalTo: resolvedTo,
        'position.from': resolved.from,
        'position.to': resolved.to,
        'position.contentHash': newHash,
        contextBefore: freshCtxBefore,
        contextAfter: freshCtxAfter,
        'anchor.prefix': freshCtxBefore,
        'anchor.suffix': freshCtxAfter,
      });
    }
    batchCount++;
  }

  for (const c of comments) {
    const resolved = resolveAnchor(c, newContent);
    if (resolved.stale) {
      batch.update(commentsCollection().doc(c.id), {
        status: 'resolved',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: 'system:stale',
      });
    } else {
      // Update positions AND context
      const freshCtxBefore = newContent.substring(Math.max(0, resolved.from - 80), resolved.from);
      const freshCtxAfter = newContent.substring(resolved.to, Math.min(newContent.length, resolved.to + 80));
      batch.update(commentsCollection().doc(c.id), {
        from: resolved.from,
        to: resolved.to,
        'position.from': resolved.from,
        'position.to': resolved.to,
        'position.contentHash': newHash,
        contextBefore: freshCtxBefore,
        contextAfter: freshCtxAfter,
      });
    }
    batchCount++;
  }

  if (batchCount > 0) await batch.commit();
}

function getDb() {
  return admin.firestore();
}

function suggestionsCollection() {
  return getDb().collection('suggestions');
}

function commentsCollection() {
  return getDb().collection('comments');
}

function repliesCollection() {
  return getDb().collection('replies');
}

// --- Suggestion Hunk CRUD ---

async function createHunk({ filePath, bookPath, baseCommitSha, type, originalFrom, originalTo, originalText, newText, contextBefore, contextAfter, authorEmail, authorName, authorPhotoURL, fileContent, linkedGroup, linkedLabel }) {
  // Deduplication: check for an existing pending suggestion with the same text
  // at an overlapping position (±5 chars). Prevents duplicates from rapid auto-save
  // cycles or two users making the exact same edit.
  const existingSnap = await suggestionsCollection()
    .where('filePath', '==', filePath)
    .where('status', '==', 'pending')
    .where('originalText', '==', originalText || '')
    .where('newText', '==', newText || '')
    .get();
  for (const doc of existingSnap.docs) {
    const d = doc.data();
    if (Math.abs((d.originalFrom || 0) - (originalFrom || 0)) <= 5) {
      console.log('[DEDUP] Found existing suggestion', doc.id, 'at', d.originalFrom, '— skipping create');
      return doc.id;
    }
  }

  // Build enhanced anchor data if file content is available
  const anchorData = fileContent
    ? buildAnchorData(fileContent, originalFrom, originalTo, originalText || '')
    : {
        anchor: { exact: originalText || '', prefix: contextBefore || '', suffix: contextAfter || '' },
        position: { from: originalFrom, to: originalTo, contentHash: '' },
        structure: { lineNumber: 0, percentOffset: 0 },
      };

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
    anchor: anchorData.anchor,
    position: anchorData.position,
    structure: anchorData.structure,
    authorEmail,
    authorName: authorName || authorEmail,
    authorPhotoURL: authorPhotoURL || null,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
    ...(linkedGroup ? { linkedGroup, linkedLabel: linkedLabel || '' } : {}),
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
    // Keep anchor data in sync — stale anchor.exact causes reanchorAnnotations
    // to fail, which leads to misplaced accepts for short/common words
    'anchor.exact': originalText || '',
    'anchor.prefix': contextBefore || '',
    'anchor.suffix': contextAfter || '',
    'position.from': originalFrom,
    'position.to': originalTo,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function deleteHunk(id) {
  await deleteRepliesForParent(id);
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

async function getSuggestionCountsByBook(bookPath) {
  const [sugSnap, comSnap] = await Promise.all([
    suggestionsCollection()
      .where('bookPath', '==', bookPath)
      .where('status', '==', 'pending')
      .get(),
    commentsCollection()
      .where('bookPath', '==', bookPath)
      .where('status', '==', 'open')
      .get(),
  ]);
  const counts = {};
  for (const doc of sugSnap.docs) {
    const fp = doc.data().filePath;
    counts[fp] = (counts[fp] || 0) + 1;
  }
  for (const doc of comSnap.docs) {
    const fp = doc.data().filePath;
    counts[fp] = (counts[fp] || 0) + 1;
  }
  return counts;
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
    const ctx = (hunk.contextBefore || '') + (hunk.contextAfter || '');
    if (!ctx) {
      await suggestionsCollection().doc(id).update({
        status: 'stale',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: resolverEmail,
      });
      return { stale: true };
    }
    const pos = currentContent.indexOf(ctx);
    if (pos === -1) {
      await suggestionsCollection().doc(id).update({
        status: 'stale',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: resolverEmail,
      });
      return { stale: true };
    }
    const insertAt = pos + (hunk.contextBefore || '').length;
    newContent = currentContent.slice(0, insertAt) + hunk.newText + currentContent.slice(insertAt);
  } else {
    // For deletions and replacements, use context to find the EXACT location.
    // A bare indexOf(originalText) is catastrophic for short/common strings
    // like "." or "the" — it finds the first occurrence, not the right one.
    let pos = -1;

    // Strategy 1: Find using full context (contextBefore + originalText + contextAfter)
    if (hunk.contextBefore || hunk.contextAfter) {
      const fullCtx = (hunk.contextBefore || '') + hunk.originalText + (hunk.contextAfter || '');
      const ctxPos = currentContent.indexOf(fullCtx);
      if (ctxPos >= 0) {
        pos = ctxPos + (hunk.contextBefore || '').length;
      }
    }

    // Strategy 2: Try contextBefore + originalText (contextAfter may have changed)
    if (pos === -1 && hunk.contextBefore) {
      const partialCtx = hunk.contextBefore + hunk.originalText;
      const ctxPos = currentContent.indexOf(partialCtx);
      if (ctxPos >= 0) {
        pos = ctxPos + hunk.contextBefore.length;
      }
    }

    // Strategy 3: Try originalText + contextAfter (contextBefore may have changed)
    if (pos === -1 && hunk.contextAfter) {
      const partialCtx = hunk.originalText + hunk.contextAfter;
      const ctxPos = currentContent.indexOf(partialCtx);
      if (ctxPos >= 0) {
        pos = ctxPos;
      }
    }

    // Strategy 4: Last resort — only for long/unique text (>= 20 chars).
    // For short common words like "that", "the", "to", bare indexOf finds
    // the FIRST occurrence which is almost certainly wrong. Mark stale instead.
    if (pos === -1 && hunk.originalText.length >= 20) {
      pos = currentContent.indexOf(hunk.originalText);
    }

    // Strategy 5: Short text with structural hint — find closest match to
    // the expected position (percentOffset), but ONLY if there's exactly one
    // plausible candidate near the expected position.
    if (pos === -1 && hunk.originalText.length > 0 && hunk.originalText.length < 20) {
      const expectedPos = hunk.originalFrom || 0;
      const candidates = [];
      let searchFrom = 0;
      while (true) {
        const found = currentContent.indexOf(hunk.originalText, searchFrom);
        if (found === -1) break;
        candidates.push(found);
        searchFrom = found + 1;
      }
      // Only use if exactly 1 candidate is within 500 chars of expected position
      const nearby = candidates.filter(c => Math.abs(c - expectedPos) < 500);
      if (nearby.length === 1) {
        pos = nearby[0];
      }
    }

    if (pos === -1) {
      // Text no longer exists — mark stale
      await suggestionsCollection().doc(id).update({
        status: 'stale',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: resolverEmail,
      });
      return { stale: true };
    }

    // Verify the text at the found position actually matches
    if (currentContent.substring(pos, pos + hunk.originalText.length) !== hunk.originalText) {
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

  // Mark accepted with location context for history
  const acceptLocation = getLocationContext(currentContent, hunk.originalFrom || 0);
  await suggestionsCollection().doc(id).update({
    status: 'accepted',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: resolverEmail,
    ...acceptLocation,
  });

  // Replies are preserved for history — not deleted on accept

  // Re-anchor all remaining annotations against the new file content
  await reanchorAnnotations(hunk.filePath, newContent);

  cache.invalidateAll();
  return { stale: false };
}

async function rejectHunk(id, resolverEmail, reason) {
  // Capture location context for history before rejecting
  let rejectLocation = {};
  try {
    const hunk = await getHunk(id);
    if (hunk && hunk.filePath) {
      const { content } = await github.getFileContent(hunk.filePath);
      rejectLocation = getLocationContext(content, hunk.originalFrom || 0);
    }
  } catch { /* location context is optional */ }

  await suggestionsCollection().doc(id).update({
    status: 'rejected',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: resolverEmail,
    rejectionReason: reason || null,
    ...rejectLocation,
  });
  // Replies are preserved for history — not deleted on reject
}

// --- Comment CRUD ---

async function createComment({ filePath, bookPath, baseCommitSha, from, to, selectedText, commentText, mentionedUsers, authorEmail, authorName, authorPhotoURL, fileContent }) {
  // Build enhanced anchor data if file content is available
  const anchorData = fileContent
    ? buildAnchorData(fileContent, from, to, selectedText || '')
    : {
        anchor: { exact: selectedText || '', prefix: '', suffix: '' },
        position: { from, to, contentHash: '' },
        structure: { lineNumber: 0, percentOffset: 0 },
      };

  const ref = await commentsCollection().add({
    filePath,
    bookPath,
    baseCommitSha,
    from,
    to,
    selectedText,
    commentText,
    anchor: anchorData.anchor,
    position: anchorData.position,
    structure: anchorData.structure,
    authorEmail,
    authorName: authorName || authorEmail,
    authorPhotoURL: authorPhotoURL || null,
    mentionedUsers: mentionedUsers || [],
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
  });
  return ref.id;
}

async function getComment(id) {
  const doc = await commentsCollection().doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function updateComment(id, { commentText, mentionedUsers }) {
  const updates = { editedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (commentText !== undefined) updates.commentText = commentText;
  if (mentionedUsers !== undefined) updates.mentionedUsers = mentionedUsers;
  await commentsCollection().doc(id).update(updates);
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
  // Capture location context for history
  let commentLocation = {};
  try {
    const doc = await commentsCollection().doc(id).get();
    if (doc.exists) {
      const c = doc.data();
      if (c.filePath) {
        const { content } = await github.getFileContent(c.filePath);
        commentLocation = getLocationContext(content, c.from || 0);
      }
    }
  } catch { /* location context is optional */ }

  await commentsCollection().doc(id).update({
    status: 'resolved',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: resolverEmail,
    ...commentLocation,
  });
  // Replies are preserved for history — not deleted on resolve
}

// --- Reply CRUD ---

async function createReply({ parentId, parentType, filePath, text, mentionedUsers, authorEmail, authorName, authorPhotoURL }) {
  const ref = await repliesCollection().add({
    parentId,
    parentType,
    filePath,
    text,
    mentionedUsers: mentionedUsers || [],
    authorEmail,
    authorName: authorName || authorEmail,
    authorPhotoURL: authorPhotoURL || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function getReply(id) {
  const doc = await repliesCollection().doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function updateReply(id, { text, mentionedUsers }) {
  const updates = { editedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (text !== undefined) updates.text = text;
  if (mentionedUsers !== undefined) updates.mentionedUsers = mentionedUsers;
  await repliesCollection().doc(id).update(updates);
}

async function getRepliesForFile(filePath) {
  const snapshot = await repliesCollection()
    .where('filePath', '==', filePath)
    .orderBy('createdAt', 'asc')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function deleteRepliesForParent(parentId) {
  const snapshot = await repliesCollection()
    .where('parentId', '==', parentId)
    .get();

  if (snapshot.empty) return;

  const batch = getDb().batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

// --- Editing session presence ---

function editingSessionsCollection() {
  return getDb().collection('editingSessions');
}

function presenceDocId(filePath, email) {
  // Firestore doc IDs cannot contain '/' — encode it
  return filePath.replace(/\//g, '__') + '::' + email;
}

async function enterEditingSession({ filePath, email, displayName, photoURL, mode }) {
  const docId = presenceDocId(filePath, email);
  await editingSessionsCollection().doc(docId).set({
    filePath, email, displayName,
    photoURL: photoURL || null,
    mode: mode || null,
    heartbeat: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function exitEditingSession({ filePath, email }) {
  const docId = presenceDocId(filePath, email);
  try {
    await editingSessionsCollection().doc(docId).delete();
  } catch (err) {
    console.warn('[PRESENCE] exit delete failed:', err.message);
  }
}

async function getActiveEditors(filePath) {
  const snap = await editingSessionsCollection()
    .where('filePath', '==', filePath)
    .get();
  const now = Date.now();
  const editors = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    // Filter out stale sessions (>90 seconds without heartbeat)
    const ts = d.heartbeat && d.heartbeat.toMillis ? d.heartbeat.toMillis() : 0;
    if (now - ts > 90000) continue;
    editors.push({ email: d.email, displayName: d.displayName, photoURL: d.photoURL || null, mode: d.mode || null });
  }
  return editors;
}

// --- History queries ---

async function getResolvedSuggestions({ filePath, bookPath, limit } = {}) {
  // Query each resolved status separately to avoid needing composite indexes for `in` queries
  const statuses = ['accepted', 'rejected', 'stale'];
  const lim = limit || 50;
  const allDocs = [];
  for (const status of statuses) {
    let query = suggestionsCollection().where('status', '==', status);
    if (filePath) query = query.where('filePath', '==', filePath);
    if (bookPath) query = query.where('bookPath', '==', bookPath);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) allDocs.push({ id: doc.id, ...doc.data() });
  }
  // Sort by resolvedAt descending, limit
  allDocs.sort((a, b) => {
    const ta = a.resolvedAt?.toMillis ? a.resolvedAt.toMillis() : 0;
    const tb = b.resolvedAt?.toMillis ? b.resolvedAt.toMillis() : 0;
    return tb - ta;
  });
  return allDocs.slice(0, lim).map(d => ({
    id: d.id, filePath: d.filePath, bookPath: d.bookPath,
    type: d.type, originalText: d.originalText, newText: d.newText,
    authorEmail: d.authorEmail, authorName: d.authorName,
    status: d.status, createdAt: d.createdAt,
    resolvedAt: d.resolvedAt, resolvedBy: d.resolvedBy,
    rejectionReason: d.rejectionReason || null,
    resolvedLineNumber: d.resolvedLineNumber || null,
    resolvedHeading: d.resolvedHeading || null,
  }));
}

async function getResolvedComments({ filePath, bookPath, limit } = {}) {
  let query = commentsCollection().where('status', '==', 'resolved');
  if (filePath) query = query.where('filePath', '==', filePath);
  if (bookPath) query = query.where('bookPath', '==', bookPath);
  const snapshot = await query.get();
  const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  allDocs.sort((a, b) => {
    const ta = a.resolvedAt?.toMillis ? a.resolvedAt.toMillis() : 0;
    const tb = b.resolvedAt?.toMillis ? b.resolvedAt.toMillis() : 0;
    return tb - ta;
  });
  const lim = limit || 50;
  return allDocs.slice(0, lim).map(d => ({
    id: d.id, filePath: d.filePath, bookPath: d.bookPath,
    selectedText: d.selectedText, commentText: d.commentText,
    authorEmail: d.authorEmail, authorName: d.authorName,
    status: d.status, createdAt: d.createdAt,
    resolvedAt: d.resolvedAt, resolvedBy: d.resolvedBy,
    resolvedLineNumber: d.resolvedLineNumber || null,
    resolvedHeading: d.resolvedHeading || null,
  }));
}

module.exports = {
  createHunk,
  updateHunk,
  deleteHunk,
  getHunk,
  getSuggestionsForFile,
  getSuggestionCountsByBook,
  listSuggestions,
  acceptHunk,
  rejectHunk,
  createComment,
  getComment,
  updateComment,
  getCommentsForFile,
  resolveComment,
  createReply,
  getReply,
  updateReply,
  getRepliesForFile,
  deleteRepliesForParent,
  getResolvedSuggestions,
  getResolvedComments,
  resolveAnchor,
  reanchorAnnotations,
  contentHash,
  buildAnchorData,
  enterEditingSession,
  exitEditingSession,
  getActiveEditors,
};
