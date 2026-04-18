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

async function createHunk({ filePath, bookPath, baseCommitSha, type, originalFrom, originalTo, originalText, newText, contextBefore, contextAfter, authorEmail, authorName, fileContent, linkedGroup, linkedLabel }) {
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

    // Strategy 4: Last resort — bare indexOf (only safe for long/unique text)
    if (pos === -1) {
      pos = currentContent.indexOf(hunk.originalText);
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

  // Mark accepted
  await suggestionsCollection().doc(id).update({
    status: 'accepted',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: resolverEmail,
  });

  await deleteRepliesForParent(id);

  // Re-anchor all remaining annotations against the new file content
  await reanchorAnnotations(hunk.filePath, newContent);

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
  await deleteRepliesForParent(id);
}

// --- Comment CRUD ---

async function createComment({ filePath, bookPath, baseCommitSha, from, to, selectedText, commentText, authorEmail, authorName, fileContent }) {
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
  await deleteRepliesForParent(id);
}

// --- Reply CRUD ---

async function createReply({ parentId, parentType, filePath, text, authorEmail, authorName }) {
  const ref = await repliesCollection().add({
    parentId,
    parentType,
    filePath,
    text,
    authorEmail,
    authorName: authorName || authorEmail,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
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
  createReply,
  getRepliesForFile,
  deleteRepliesForParent,
  resolveAnchor,
  reanchorAnnotations,
  contentHash,
  buildAnchorData,
};
