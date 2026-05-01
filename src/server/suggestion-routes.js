const express = require('express');
const suggestions = require('./suggestions');
const firestore = require('./firestore');
const github = require('./github');
const cache = require('./cache');
const notifications = require('./notifications');

const router = express.Router();

// All routes require authentication
router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
});

// --- Taggable users for @-mention autocomplete ---
router.get('/taggable-users', async (req, res) => {
  try {
    const { bookPath } = req.query;
    if (!bookPath) return res.status(400).json({ error: 'bookPath required' });

    // Check cache first (60s TTL)
    const cacheKey = `taggable-users:${bookPath}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const allUsers = await firestore.getAllUsers();
    const encodedBook = bookPath.replace(/\//g, '|');
    const users = allUsers.filter(u => {
      // Include global admins
      if (u.globalRole === 'admin') return true;
      // Include super admin
      if (require('./auth').isSuperAdmin(u.email)) return true;
      // Include users with any role on this book
      return u.bookRoles && u.bookRoles[encodedBook];
    }).map(u => ({
      email: u.email,
      displayName: u.displayName || u.email,
      photoURL: u.photoURL || null,
    }));

    const result = { users };
    cache.set(cacheKey, result, 60 * 1000);
    res.json(result);
  } catch (err) {
    console.error('Taggable users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Lightweight version check (for stale detection — includes GitHub SHA) ---
router.get('/file-version', async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });

    const { sha } = await github.getFileContent(filePath);
    const pendingSuggestions = await suggestions.getSuggestionsForFile(filePath);
    const pendingComments = await suggestions.getCommentsForFile(filePath);
    res.json({
      sha,
      pendingSuggestionCount: pendingSuggestions.length,
      pendingCommentCount: pendingComments.length,
    });
  } catch (err) {
    console.error('File version check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Activity count (Firestore only, no GitHub API) ---
router.get('/suggestion-count', async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    const pendingSuggestions = await suggestions.getSuggestionsForFile(filePath);
    const replies = await suggestions.getRepliesForFile(filePath);
    const comments = await suggestions.getCommentsForFile(filePath);
    res.json({
      count: pendingSuggestions.length,
      replyCount: replies.length,
      commentCount: comments.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Editing session presence ---
router.post('/presence', async (req, res) => {
  try {
    const { filePath, mode } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    await suggestions.enterEditingSession({
      filePath, email: req.user.email, displayName: req.user.displayName || req.user.email,
      photoURL: req.user.photoURL || null,
      mode: mode || null,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Presence enter error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/presence', async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    await suggestions.exitEditingSession({ filePath, email: req.user.email });
    res.json({ ok: true });
  } catch (err) {
    console.error('Presence exit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// sendBeacon can only POST, so provide an exit route via POST
router.post('/presence/exit', async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    await suggestions.exitEditingSession({ filePath, email: req.user.email });
    res.json({ ok: true });
  } catch (err) {
    console.error('Presence beacon exit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/presence', async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    const editors = await suggestions.getActiveEditors(filePath);
    res.json({ editors });
  } catch (err) {
    console.error('Presence list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Content read endpoint (for bots/automation) ---
router.get('/content', async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'filePath query param required' });

    // Derive bookPath from filePath (everything before /sessions/)
    const sessionsIdx = filePath.indexOf('/sessions/');
    const bookPath = sessionsIdx >= 0 ? filePath.substring(0, sessionsIdx) : filePath;

    // Check permission
    const role = await firestore.getUserBookRole(req.user.email, bookPath);
    if (!role) return res.status(403).json({ error: 'No access to this book' });

    const { content, sha } = await github.getFileContent(filePath);

    // Get pending suggestions and comments, resolve their positions against current content
    const pendingSuggestions = await suggestions.getSuggestionsForFile(filePath);
    const pendingComments = await suggestions.getCommentsForFile(filePath);
    const pendingReplies = await suggestions.getRepliesForFile(filePath);

    // Resolve positions for each annotation against the current file content
    for (const s of pendingSuggestions) {
      const resolved = suggestions.resolveAnchor(s, content);
      if (!resolved.stale) {
        s.resolvedFrom = resolved.from;
        s.resolvedTo = resolved.to;
        s.resolvedConfidence = resolved.confidence;
      } else {
        s.resolvedStale = true;
      }
    }
    for (const c of pendingComments) {
      const resolved = suggestions.resolveAnchor(c, content);
      if (!resolved.stale) {
        c.resolvedFrom = resolved.from;
        c.resolvedTo = resolved.to;
        c.resolvedConfidence = resolved.confidence;
      } else {
        c.resolvedStale = true;
      }
    }

    res.json({ content, sha, filePath, bookPath, pendingSuggestions, pendingComments, pendingReplies });
  } catch (err) {
    console.error('Content read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function canEdit(email, bookPath) {
  const role = await firestore.getUserBookRole(email, bookPath);
  return role === 'admin' || role === 'manuscript-owner' || role === 'comment-suggest';
}

async function canReview(email, bookPath) {
  const role = await firestore.getUserBookRole(email, bookPath);
  return role === 'admin' || role === 'manuscript-owner';
}

// --- Hunk CRUD ---

// Create a suggestion hunk (auto-save from editor)
router.post('/hunk', async (req, res) => {
  try {
    const { filePath, bookPath, baseCommitSha, type, originalFrom, originalTo, originalText, newText, contextBefore, contextAfter, lineNumber, linkedGroup, linkedLabel, reason } = req.body;
    if (!filePath || !bookPath || !type || lineNumber == null) {
      return res.status(400).json({ error: 'filePath, bookPath, type, and lineNumber required' });
    }
    if (!(await canEdit(req.user.email, bookPath))) {
      return res.status(403).json({ error: 'No edit permission on this book' });
    }

    // Fetch file content for line-number position resolution and anchor data
    let fileContent = null;
    try { fileContent = (await github.getFileContent(filePath)).content; } catch { /* fallback */ }

    const result = await suggestions.createHunk({
      filePath, bookPath, baseCommitSha,
      type, originalFrom, originalTo, originalText, newText,
      contextBefore, contextAfter, lineNumber,
      authorEmail: req.user.email,
      authorName: req.user.displayName,
      authorPhotoURL: req.user.photoURL || null,
      fileContent,
      ...(linkedGroup ? { linkedGroup, linkedLabel } : {}),
    });
    const id = result.id;

    // If a reason is provided, create a reply — but skip if the suggestion was
    // deduped and an identical reply already exists (prevents duplicate replies
    // when the bot re-submits the same suggestion for repeated template text).
    let replyId = null;
    if (reason && !result.deduped) {
      replyId = await suggestions.createReply({
        parentId: id, parentType: 'suggestion', filePath, text: reason,
        authorEmail: req.user.email,
        authorName: req.user.displayName,
        authorPhotoURL: req.user.photoURL || null,
      });
    } else if (reason && result.deduped) {
      // Check if this exact reason text already exists as a reply
      const existingReplies = await suggestions.getRepliesForParent(id);
      const alreadyExists = existingReplies.some(r => r.text === reason && r.authorEmail === req.user.email);
      if (!alreadyExists) {
        replyId = await suggestions.createReply({
          parentId: id, parentType: 'suggestion', filePath, text: reason,
          authorEmail: req.user.email,
          authorName: req.user.displayName,
          authorPhotoURL: req.user.photoURL || null,
        });
      } else {
        console.log('[DEDUP] Skipping duplicate reason reply on', id);
      }
    }

    res.json({ id, status: 'ok', ...(replyId ? { replyId } : {}), ...(result.deduped ? { deduped: true } : {}) });

    // Fire-and-forget: notify manuscript owners/admins about new suggestion
    try {
      notifications.processImmediateNotifications({
        bookPath, filePath,
        actorEmail: req.user.email,
        actorName: req.user.displayName || req.user.email,
        action: 'suggestion',
        text: newText || originalText || '',
        selectedText: originalText || null,
        mentionedUsers: [],
      }).catch(err => console.error('[NOTIFY] hunk notification error:', err.message));
    } catch (err) { console.error('[NOTIFY] hunk notification error:', err.message); }
  } catch (err) {
    console.error('Create hunk error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update a suggestion hunk
router.put('/hunk/:id', async (req, res) => {
  try {
    const hunk = await suggestions.getHunk(req.params.id);
    if (!hunk) return res.status(404).json({ error: 'Not found' });
    if (hunk.authorEmail !== req.user.email && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not your suggestion' });
    }

    await suggestions.updateHunk(req.params.id, req.body);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Update hunk error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete a suggestion hunk
router.delete('/hunk/:id', async (req, res) => {
  try {
    const hunk = await suggestions.getHunk(req.params.id);
    if (!hunk) return res.status(404).json({ error: 'Not found' });
    if (hunk.authorEmail !== req.user.email && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not your suggestion' });
    }

    await suggestions.deleteHunk(req.params.id);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Delete hunk error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get all pending suggestions + comments for a file
router.get('/file', async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });

    const sug = await suggestions.getSuggestionsForFile(filePath);
    const comments = await suggestions.getCommentsForFile(filePath);
    const replies = await suggestions.getRepliesForFile(filePath);
    res.json({ suggestions: sug, comments, replies });
  } catch (err) {
    console.error('Get file suggestions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// List suggestions (for admin review queue)
router.get('/', async (req, res) => {
  try {
    const { bookPath, status } = req.query;
    const items = await suggestions.listSuggestions({
      bookPath: bookPath || undefined,
      status: status || 'pending',
    });
    res.json(items);
  } catch (err) {
    console.error('List suggestions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Accept a hunk
router.put('/hunk/:id/accept', async (req, res) => {
  try {
    const hunk = await suggestions.getHunk(req.params.id);
    if (!hunk) return res.status(404).json({ error: 'Not found' });
    if (!(await canReview(req.user.email, hunk.bookPath))) {
      return res.status(403).json({ error: 'No review permission' });
    }

    // Block accepts while someone is in direct edit mode on this file
    const activeEditors = await suggestions.getActiveEditors(hunk.filePath);
    const directEditor = activeEditors.find(e => e.mode === 'direct');
    if (directEditor) {
      const name = directEditor.displayName || directEditor.email;
      return res.status(423).json({ error: name + ' is currently making direct edits to this file. Accepting suggestions is temporarily disabled.' });
    }

    const result = await suggestions.acceptHunk(req.params.id, req.user.email);
    if (result.stale) {
      return res.status(409).json({ status: 'stale', message: 'File has changed. Suggestion marked stale.' });
    }
    res.json({ status: 'accepted' });
  } catch (err) {
    console.error('Accept hunk error:', err.message);
    // GitHub returns 409 when the SHA is stale (file was modified externally)
    if (err.status === 409 || err.message?.includes('SHA')) {
      return res.status(409).json({ status: 'stale', message: 'The file was modified since you loaded the page. Your suggestion is preserved — reload to see the latest version.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Reject a hunk
router.put('/hunk/:id/reject', async (req, res) => {
  try {
    const hunk = await suggestions.getHunk(req.params.id);
    if (!hunk) return res.status(404).json({ error: 'Not found' });
    if (!(await canReview(req.user.email, hunk.bookPath))) {
      return res.status(403).json({ error: 'No review permission' });
    }

    await suggestions.rejectHunk(req.params.id, req.user.email, req.body.reason);
    res.json({ status: 'rejected' });
  } catch (err) {
    console.error('Reject hunk error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Comments ---

router.post('/comments', async (req, res) => {
  try {
    const { filePath, bookPath, baseCommitSha, from, to, selectedText, commentText, mentionedUsers } = req.body;
    if (!filePath || !commentText) {
      return res.status(400).json({ error: 'filePath and commentText required' });
    }
    if (!(await canEdit(req.user.email, bookPath))) {
      return res.status(403).json({ error: 'No edit permission' });
    }

    // Get file content for building rich anchor data
    let fileContent = null;
    try { fileContent = (await github.getFileContent(filePath)).content; } catch { /* fallback */ }

    const id = await suggestions.createComment({
      filePath, bookPath, baseCommitSha,
      from, to, selectedText, commentText,
      mentionedUsers: mentionedUsers || [],
      authorEmail: req.user.email,
      authorName: req.user.displayName,
      authorPhotoURL: req.user.photoURL || null,
      fileContent,
    });
    res.json({ id, status: 'ok' });

    // Fire-and-forget: queue notifications
    try {
      notifications.processImmediateNotifications({
        bookPath, filePath,
        actorEmail: req.user.email,
        actorName: req.user.displayName || req.user.email,
        action: 'comment',
        text: commentText,
        selectedText,
        mentionedUsers: mentionedUsers || [],
      }).catch(err => console.error('[NOTIFY] comment notification error:', err.message));
    } catch (err) { console.error('[NOTIFY] comment notification error:', err.message); }
  } catch (err) {
    console.error('Create comment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Edit a comment (author only)
router.put('/comments/:id', async (req, res) => {
  try {
    const comment = await suggestions.getComment(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Not found' });
    if (comment.authorEmail !== req.user.email) {
      return res.status(403).json({ error: 'Only the author can edit this comment' });
    }
    const { commentText, mentionedUsers } = req.body;
    if (!commentText || !commentText.trim()) {
      return res.status(400).json({ error: 'commentText required' });
    }
    await suggestions.updateComment(req.params.id, { commentText: commentText.trim(), mentionedUsers });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Edit comment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/comments/:id/resolve', async (req, res) => {
  try {
    await suggestions.resolveComment(req.params.id, req.user.email);
    res.json({ status: 'resolved' });
  } catch (err) {
    console.error('Resolve comment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Replies ---

router.post('/replies', async (req, res) => {
  try {
    const { parentId, parentType, filePath, bookPath, text, mentionedUsers } = req.body;
    if (!parentId || !parentType || !filePath || !text) {
      return res.status(400).json({ error: 'parentId, parentType, filePath, and text required' });
    }
    if (parentType !== 'suggestion' && parentType !== 'comment') {
      return res.status(400).json({ error: 'parentType must be "suggestion" or "comment"' });
    }
    if (!(await canEdit(req.user.email, bookPath))) {
      return res.status(403).json({ error: 'No edit permission' });
    }

    const id = await suggestions.createReply({
      parentId, parentType, filePath, text,
      mentionedUsers: mentionedUsers || [],
      authorEmail: req.user.email,
      authorName: req.user.displayName,
      authorPhotoURL: req.user.photoURL || null,
    });
    res.json({ id, status: 'ok' });

    // Fire-and-forget: queue notifications
    try {
      notifications.processImmediateNotifications({
        bookPath, filePath,
        actorEmail: req.user.email,
        actorName: req.user.displayName || req.user.email,
        action: 'reply',
        text,
        selectedText: null,
        mentionedUsers: mentionedUsers || [],
      }).catch(err => console.error('[NOTIFY] reply notification error:', err.message));
    } catch (err) { console.error('[NOTIFY] reply notification error:', err.message); }
  } catch (err) {
    console.error('Create reply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Edit a reply (author only)
router.put('/replies/:id', async (req, res) => {
  try {
    const reply = await suggestions.getReply(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Not found' });
    if (reply.authorEmail !== req.user.email) {
      return res.status(403).json({ error: 'Only the author can edit this reply' });
    }
    const { text, mentionedUsers } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text required' });
    }
    await suggestions.updateReply(req.params.id, { text: text.trim(), mentionedUsers });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Edit reply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete replies by parentId (cleanup when discarding suggestions)
router.delete('/replies/by-parent/:parentId', async (req, res) => {
  try {
    await suggestions.deleteRepliesForParent(req.params.parentId);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Delete replies error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- History (resolved suggestions + comments with reply threads) ---

router.get('/history', async (req, res) => {
  try {
    const { filePath, bookPath, limit } = req.query;
    const lim = parseInt(limit, 10) || 50;

    const [resolvedSuggestions, resolvedComments] = await Promise.all([
      suggestions.getResolvedSuggestions({ filePath, bookPath, limit: lim }),
      suggestions.getResolvedComments({ filePath, bookPath, limit: lim }),
    ]);

    // Fetch replies and join to their parents
    const allReplies = filePath
      ? await suggestions.getRepliesForFile(filePath)
      : []; // book-level queries: skip reply join (too broad)

    const replyMap = new Map();
    for (const r of allReplies) {
      if (!replyMap.has(r.parentId)) replyMap.set(r.parentId, []);
      replyMap.get(r.parentId).push({
        id: r.id, text: r.text,
        authorEmail: r.authorEmail, authorName: r.authorName,
        authorPhotoURL: r.authorPhotoURL || null,
        createdAt: r.createdAt,
      });
    }

    for (const s of resolvedSuggestions) s.replies = replyMap.get(s.id) || [];
    for (const c of resolvedComments) c.replies = replyMap.get(c.id) || [];

    res.json({ suggestions: resolvedSuggestions, comments: resolvedComments });
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Direct edit (admin only) ---

router.post('/direct-edit', async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { filePath, content, sha, comment } = req.body;
    if (!filePath || !content || !sha) {
      return res.status(400).json({ error: 'filePath, content, and sha required' });
    }

    const { sha: currentSha } = await github.getFileContent(filePath);
    if (currentSha !== sha) {
      return res.status(409).json({ error: 'File was modified. Please reload.' });
    }

    const message = comment
      ? `${comment} (direct edit by ${req.user.email})`
      : `Direct edit by ${req.user.email}`;
    await github.updateFileContent(filePath, content, sha, message);
    await suggestions.reanchorAnnotations(filePath, content);
    cache.invalidateAll();
    res.json({ status: 'ok' });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ error: 'File was modified concurrently.' });
    }
    console.error('Direct edit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
