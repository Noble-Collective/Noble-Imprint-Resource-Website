const express = require('express');
const firestore = require('./firestore');
const content = require('./content');
const github = require('./github');
const cache = require('./cache');
const { isSuperAdmin, SUPER_ADMIN_EMAIL } = require('./auth');
const suggestions = require('./suggestions');

// --- Page routes ---
const page = express.Router();

page.get('/', async (req, res, next) => {
  try {
    const users = await firestore.getAllUsers();
    const tree = await content.buildContentTree();
    const books = content.getAllBooks(tree);

    // Ensure super admin appears in users list even if not in Firestore
    const superAdminInList = users.some(u => u.email === SUPER_ADMIN_EMAIL);
    const displayUsers = superAdminInList ? users : [
      {
        email: SUPER_ADMIN_EMAIL,
        displayName: 'Steve (Super Admin)',
        photoURL: null,
        globalRole: 'super-admin',
        bookRoles: {},
      },
      ...users,
    ];

    // Mark super admin in the list
    const usersWithFlags = displayUsers.map(u => ({
      ...u,
      isSuperAdmin: isSuperAdmin(u.email),
      isAdmin: isSuperAdmin(u.email) || u.globalRole === 'admin',
      bookRoleCount: u.bookRoles ? Object.keys(u.bookRoles).length : 0,
    }));

    const pendingSuggestions = await suggestions.listSuggestions({ status: 'pending' });

    res.render('admin', {
      title: 'Admin Console',
      users: usersWithFlags,
      books,
      pendingSuggestionCount: pendingSuggestions.length,
      firestore: { decodeBookPath: firestore.decodeBookPath },
    });
  } catch (err) {
    next(err);
  }
});

// --- API routes ---
const api = express.Router();

// List all users
api.get('/users', async (req, res) => {
  try {
    const users = await firestore.getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a user
api.post('/users', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await firestore.createUser(email.trim());
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set global role for a user
api.put('/users/:email/role', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { role } = req.body; // 'admin' or null

    if (isSuperAdmin(email)) {
      return res.status(403).json({ error: 'Cannot modify super admin role' });
    }

    await firestore.setGlobalRole(email, role || null);

    // Clear admin status cache
    cache.del(`admin-check:${email.toLowerCase()}`);

    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a user
api.delete('/users/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);

    if (isSuperAdmin(email)) {
      return res.status(403).json({ error: 'Cannot remove super admin' });
    }

    await firestore.removeUser(email);
    cache.del(`admin-check:${email.toLowerCase()}`);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set book role for a user
api.put('/users/:email/books', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { bookPath, role } = req.body;

    if (!bookPath || !role) {
      return res.status(400).json({ error: 'bookPath and role required' });
    }

    await firestore.setBookRole(email, bookPath, role);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove book role for a user
api.delete('/users/:email/books', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { bookPath } = req.body;

    if (!bookPath) {
      return res.status(400).json({ error: 'bookPath required' });
    }

    await firestore.removeBookRole(email, bookPath);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle book status (commits to resources repo)
api.put('/books/status', async (req, res) => {
  try {
    const { bookPath, status } = req.body;
    if (!bookPath || !['public', 'hidden'].includes(status)) {
      return res.status(400).json({ error: 'bookPath and status (public|hidden) required' });
    }

    const metaPath = `${bookPath}/meta.json`;
    const { content: raw, sha } = await github.getFileContent(metaPath);
    const meta = JSON.parse(raw);

    // Update status
    if (status === 'public') {
      delete meta.status;
    } else {
      meta.status = status;
    }

    const updated = JSON.stringify(meta, null, 2) + '\n';
    const message = `Set ${meta.title || bookPath} to ${status}`;

    await github.updateFileContent(metaPath, updated, sha, message);

    // Clear content tree cache so the change is visible immediately
    cache.invalidateAll();

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Book status update error:', err.message);
    if (err.status === 409) {
      return res.status(409).json({ error: 'File was modified concurrently. Please try again.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// List repo tags
api.get('/tags', async (req, res) => {
  try {
    const tags = await github.listTags();
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate diff report for a book between two refs
api.get('/diff-report', async (req, res) => {
  try {
    const { bookPath, from, to } = req.query;
    if (!bookPath || !from) return res.status(400).json({ error: 'bookPath and from are required' });
    const toRef = to || 'main';
    const sessionsPath = bookPath + '/sessions';
    const Diff = require('diff');

    // List sessions at both refs (detect added/removed files)
    let fromFiles = [], toFiles = [];
    try { fromFiles = (await github.getDirectoryContentsAtRef(sessionsPath, from)).filter(f => f.name.endsWith('.md')); } catch { /* dir may not exist at old ref */ }
    try { toFiles = (await github.getDirectoryContentsAtRef(sessionsPath, toRef)).filter(f => f.name.endsWith('.md')); } catch { /* dir may not exist at new ref */ }

    const allNames = [...new Set([...fromFiles.map(f => f.name), ...toFiles.map(f => f.name)])].sort();

    // Fetch all files at both refs in parallel
    const fetches = allNames.map(async (name) => {
      const filePath = sessionsPath + '/' + name;
      const inFrom = fromFiles.some(f => f.name === name);
      const inTo = toFiles.some(f => f.name === name);
      let oldContent = '', newContent = '';
      try { if (inFrom) oldContent = (await github.getFileContentAtRef(filePath, from)).content; } catch { /* file may not exist */ }
      try { if (inTo) newContent = (await github.getFileContentAtRef(filePath, toRef)).content; } catch { /* file may not exist */ }
      return { name, oldContent, newContent, inFrom, inTo };
    });
    const fileResults = await Promise.all(fetches);

    // Compute diffs
    const files = [];
    for (const { name, oldContent, newContent, inFrom, inTo } of fileResults) {
      if (oldContent === newContent) continue; // skip unchanged

      let status = 'modified';
      if (!inFrom) status = 'added';
      else if (!inTo) status = 'removed';

      // Two-pass diff: lines first, then words within changed pairs
      const lineDiffs = Diff.diffLines(oldContent, newContent);
      const rawChunks = lineDiffs.map(part => ({
        type: part.added ? 'added' : part.removed ? 'removed' : 'equal',
        text: part.value,
      }));

      // Pair adjacent removed+added chunks into 'changed' with word-level detail
      const chunks = [];
      for (let i = 0; i < rawChunks.length; i++) {
        if (rawChunks[i].type === 'removed' && i + 1 < rawChunks.length && rawChunks[i + 1].type === 'added') {
          const wordDiffs = Diff.diffWords(rawChunks[i].text, rawChunks[i + 1].text);
          chunks.push({
            type: 'changed',
            words: wordDiffs.map(w => ({ type: w.added ? 'added' : w.removed ? 'removed' : 'equal', text: w.value })),
          });
          i++; // skip the paired 'added'
        } else {
          chunks.push(rawChunks[i]);
        }
      }

      // Derive display name from filename
      const displayName = name.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/([A-Z])/g, ' $1').trim();
      files.push({ filename: name, displayName, status, chunks });
    }

    res.json({ bookPath, from, to: toRef, files });
  } catch (err) {
    console.error('Diff report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { page, api };
