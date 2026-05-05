const express = require('express');
const firestore = require('./firestore');
const content = require('./content');
const github = require('./github');
const cache = require('./cache');
const { isSuperAdmin, SUPER_ADMIN_EMAIL } = require('./auth');
const suggestions = require('./suggestions');
const notifications = require('./notifications');

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

    // Fire-and-forget: notify the user if they were granted admin
    if (role === 'admin') {
      try {
        notifications.sendAdminRoleEmail({
          recipientEmail: email,
          assignedByName: req.user.displayName || req.user.email,
        }).catch(err => console.error('[NOTIFY] admin role error:', err.message));
      } catch (err) { console.error('[NOTIFY] admin role error:', err.message); }
    }
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

    // Fire-and-forget: notify the user about their new role
    try {
      const tree = await content.buildContentTree();
      const allBooks = content.getAllBooks(tree);
      const book = allBooks.find(b => b.repoPath === bookPath);
      const bookTitle = book ? book.title : bookPath;
      notifications.sendRoleChangeEmail({
        recipientEmail: email,
        bookPath,
        bookTitle,
        role,
        assignedByName: req.user.displayName || req.user.email,
      }).catch(err => console.error('[NOTIFY] role change error:', err.message));
    } catch (err) { console.error('[NOTIFY] role change error:', err.message); }
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
          const hasRealDiff = wordDiffs.some(w => w.added || w.removed);
          if (hasRealDiff) {
            chunks.push({
              type: 'changed',
              words: wordDiffs.map(w => ({ type: w.added ? 'added' : w.removed ? 'removed' : 'equal', text: w.value })),
            });
          } else {
            chunks.push({ type: 'equal', text: rawChunks[i + 1].text });
          }
          i++;
        } else {
          chunks.push(rawChunks[i]);
        }
      }

      // Fuzzy pairing: find unpaired removed/added blocks with similar content
      // and convert them to 'changed' blocks with word-level detail
      function textSimilarity(a, b) {
        if (!a || !b) return 0;
        const wordsA = a.replace(/\s+/g, ' ').trim();
        const wordsB = b.replace(/\s+/g, ' ').trim();
        if (wordsA === wordsB) return 1;
        // Use longest common subsequence ratio as similarity
        const shorter = wordsA.length < wordsB.length ? wordsA : wordsB;
        const longer = wordsA.length < wordsB.length ? wordsB : wordsA;
        if (longer.length === 0) return 1;
        // Quick check: count shared words
        const setA = new Set(wordsA.split(' '));
        const setB = new Set(wordsB.split(' '));
        let shared = 0;
        for (const w of setA) { if (setB.has(w)) shared++; }
        return shared / Math.max(setA.size, setB.size);
      }

      const SIMILARITY_THRESHOLD = 0.5;
      // Collect indices of unpaired removed and added chunks
      const unpairedRemoved = [];
      const unpairedAdded = [];
      chunks.forEach((c, i) => {
        if (c.type === 'removed') unpairedRemoved.push(i);
        else if (c.type === 'added') unpairedAdded.push(i);
      });

      // Try to pair each removed with the most similar added
      const pairedIndices = new Set();
      for (const ri of unpairedRemoved) {
        let bestIdx = -1, bestSim = SIMILARITY_THRESHOLD;
        for (const ai of unpairedAdded) {
          if (pairedIndices.has(ai)) continue;
          const sim = textSimilarity(chunks[ri].text, chunks[ai].text);
          if (sim > bestSim) { bestSim = sim; bestIdx = ai; }
        }
        if (bestIdx >= 0) {
          // Pair them: replace both with a changed chunk at the added position,
          // mark the removed position for deletion
          const wordDiffs = Diff.diffWords(chunks[ri].text, chunks[bestIdx].text);
          const hasRealDiff = wordDiffs.some(w => w.added || w.removed);
          if (hasRealDiff) {
            chunks[bestIdx] = {
              type: 'changed',
              words: wordDiffs.map(w => ({ type: w.added ? 'added' : w.removed ? 'removed' : 'equal', text: w.value })),
            };
            chunks[ri] = null; // mark for removal
            pairedIndices.add(bestIdx);
          }
        }
      }
      // Remove nulled-out chunks
      const finalChunks = chunks.filter(c => c !== null);
      // Replace chunks array (used below)
      chunks.length = 0;
      finalChunks.forEach(c => chunks.push(c));

      // Extract heading hierarchy from BOTH contents for breadcrumbs
      const newLines = newContent.split('\n');
      const headings = [];
      for (let li = 0; li < newLines.length; li++) {
        const m = newLines[li].match(/^(#{1,6})\s+(.+)/);
        if (m) headings.push({ line: li, level: m[1].length, text: m[2].trim() });
      }

      // Also parse headings from the "from" content for fromBreadcrumb
      const oldLines = oldContent.split('\n');
      const oldHeadings = [];
      for (let li = 0; li < oldLines.length; li++) {
        const m = oldLines[li].match(/^(#{1,6})\s+(.+)/);
        if (m) oldHeadings.push({ line: li, level: m[1].length, text: m[2].trim() });
      }

      // Walk chunks tracking positions in BOTH documents
      let toLinePos = 0;
      let fromLinePos = 0;
      let lastHeadingIdx = 0;
      let lastOldHeadingIdx = 0;
      const headingStack = [];
      const oldHeadingStack = [];

      function updateStack(upToLine) {
        while (lastHeadingIdx < headings.length && headings[lastHeadingIdx].line <= upToLine) {
          const h = headings[lastHeadingIdx];
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= h.level) headingStack.pop();
          headingStack.push({ level: h.level, text: h.text });
          lastHeadingIdx++;
        }
      }
      function updateOldStack(upToLine) {
        while (lastOldHeadingIdx < oldHeadings.length && oldHeadings[lastOldHeadingIdx].line <= upToLine) {
          const h = oldHeadings[lastOldHeadingIdx];
          while (oldHeadingStack.length > 0 && oldHeadingStack[oldHeadingStack.length - 1].level >= h.level) oldHeadingStack.pop();
          oldHeadingStack.push({ level: h.level, text: h.text });
          lastOldHeadingIdx++;
        }
      }

      for (const chunk of chunks) {
        if (chunk.type !== 'equal') {
          updateStack(toLinePos);
          updateOldStack(fromLinePos);
          chunk.breadcrumb = headingStack.map(h => h.text);
          chunk.fromBreadcrumb = oldHeadingStack.map(h => h.text);
          chunk.toLine = toLinePos + 1;
          chunk.fromLine = fromLinePos + 1;
        }

        // Advance toLinePos for chunks in the "to" content
        if (chunk.type === 'equal' || chunk.type === 'added') {
          toLinePos += (chunk.text || '').split('\n').length - 1;
        } else if (chunk.type === 'changed') {
          const addedText = chunk.words.filter(w => w.type !== 'removed').map(w => w.text).join('');
          toLinePos += addedText.split('\n').length - 1;
        }

        // Advance fromLinePos for chunks in the "from" content
        if (chunk.type === 'equal' || chunk.type === 'removed') {
          fromLinePos += (chunk.text || '').split('\n').length - 1;
        } else if (chunk.type === 'changed') {
          const removedText = chunk.words.filter(w => w.type !== 'added').map(w => w.text).join('');
          fromLinePos += removedText.split('\n').length - 1;
        }
      }

      // Also include the full heading outline for the sidebar navigation
      const outline = headings.map(h => ({ level: h.level, text: h.text }));

      // Derive display name from filename
      const displayName = name.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/([A-Z])/g, ' $1').trim();
      files.push({ filename: name, displayName, status, chunks, outline });
    }

    res.json({ bookPath, from, to: toRef, files });
  } catch (err) {
    console.error('Diff report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate diff report comparing uploaded file against current book content
api.post('/diff-report-upload', async (req, res) => {
  try {
    const { bookPath, to, uploadedContent } = req.body;
    if (!bookPath || !uploadedContent) return res.status(400).json({ error: 'bookPath and uploadedContent are required' });
    const toRef = to || 'main';
    const sessionsPath = bookPath + '/sessions';
    const Diff = require('diff');

    // Fetch all session files from the "to" ref and concatenate into one
    let toFiles = [];
    try { toFiles = (await github.getDirectoryContentsAtRef(sessionsPath, toRef)).filter(f => f.name.endsWith('.md')); } catch { /* */ }
    toFiles.sort((a, b) => a.name.localeCompare(b.name));

    const toContents = await Promise.all(toFiles.map(async (f) => {
      try {
        const { content } = await github.getFileContentAtRef(sessionsPath + '/' + f.name, toRef);
        return content;
      } catch { return ''; }
    }));
    const newContent = toContents.join('\n\n');
    const oldContent = uploadedContent;

    if (oldContent === newContent) {
      return res.json({ bookPath, from: 'uploaded file', to: toRef, files: [] });
    }

    // Two-pass diff: lines first, then words within changed pairs
    const lineDiffs = Diff.diffLines(oldContent, newContent);
    const rawChunks = lineDiffs.map(part => ({
      type: part.added ? 'added' : part.removed ? 'removed' : 'equal',
      text: part.value,
    }));

    // Adjacent pairing
    const chunks = [];
    for (let i = 0; i < rawChunks.length; i++) {
      if (rawChunks[i].type === 'removed' && i + 1 < rawChunks.length && rawChunks[i + 1].type === 'added') {
        const wordDiffs = Diff.diffWords(rawChunks[i].text, rawChunks[i + 1].text);
        const hasRealDiff = wordDiffs.some(w => w.added || w.removed);
        if (hasRealDiff) {
          chunks.push({ type: 'changed', words: wordDiffs.map(w => ({ type: w.added ? 'added' : w.removed ? 'removed' : 'equal', text: w.value })) });
        } else {
          chunks.push({ type: 'equal', text: rawChunks[i + 1].text });
        }
        i++;
      } else {
        chunks.push(rawChunks[i]);
      }
    }

    // Fuzzy pairing of similar removed/added blocks
    function textSimilarity(a, b) {
      if (!a || !b) return 0;
      const setA = new Set(a.replace(/\s+/g, ' ').trim().split(' '));
      const setB = new Set(b.replace(/\s+/g, ' ').trim().split(' '));
      let shared = 0;
      for (const w of setA) { if (setB.has(w)) shared++; }
      return shared / Math.max(setA.size, setB.size);
    }
    const unpairedRemoved = [], unpairedAdded = [];
    chunks.forEach((c, i) => {
      if (c.type === 'removed') unpairedRemoved.push(i);
      else if (c.type === 'added') unpairedAdded.push(i);
    });
    const pairedIndices = new Set();
    for (const ri of unpairedRemoved) {
      let bestIdx = -1, bestSim = 0.5;
      for (const ai of unpairedAdded) {
        if (pairedIndices.has(ai)) continue;
        const sim = textSimilarity(chunks[ri].text, chunks[ai].text);
        if (sim > bestSim) { bestSim = sim; bestIdx = ai; }
      }
      if (bestIdx >= 0) {
        const wordDiffs = Diff.diffWords(chunks[ri].text, chunks[bestIdx].text);
        if (wordDiffs.some(w => w.added || w.removed)) {
          chunks[bestIdx] = { type: 'changed', words: wordDiffs.map(w => ({ type: w.added ? 'added' : w.removed ? 'removed' : 'equal', text: w.value })) };
          chunks[ri] = null;
          pairedIndices.add(bestIdx);
        }
      }
    }
    const finalChunks = chunks.filter(c => c !== null);
    chunks.length = 0;
    finalChunks.forEach(c => chunks.push(c));

    // Heading hierarchies from both contents
    const newLines = newContent.split('\n');
    const headings = [];
    for (let li = 0; li < newLines.length; li++) {
      const m = newLines[li].match(/^(#{1,6})\s+(.+)/);
      if (m) headings.push({ line: li, level: m[1].length, text: m[2].trim() });
    }
    const oldLines = oldContent.split('\n');
    const oldHeadings = [];
    for (let li = 0; li < oldLines.length; li++) {
      const m = oldLines[li].match(/^(#{1,6})\s+(.+)/);
      if (m) oldHeadings.push({ line: li, level: m[1].length, text: m[2].trim() });
    }

    // Track positions in both documents
    let toLinePos = 0, fromLinePos = 0;
    let lastHeadingIdx = 0, lastOldHeadingIdx = 0;
    const headingStack = [], oldHeadingStack = [];
    function updateStack(upToLine) {
      while (lastHeadingIdx < headings.length && headings[lastHeadingIdx].line <= upToLine) {
        const h = headings[lastHeadingIdx];
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= h.level) headingStack.pop();
        headingStack.push({ level: h.level, text: h.text });
        lastHeadingIdx++;
      }
    }
    function updateOldStack(upToLine) {
      while (lastOldHeadingIdx < oldHeadings.length && oldHeadings[lastOldHeadingIdx].line <= upToLine) {
        const h = oldHeadings[lastOldHeadingIdx];
        while (oldHeadingStack.length > 0 && oldHeadingStack[oldHeadingStack.length - 1].level >= h.level) oldHeadingStack.pop();
        oldHeadingStack.push({ level: h.level, text: h.text });
        lastOldHeadingIdx++;
      }
    }

    for (const chunk of chunks) {
      if (chunk.type !== 'equal') {
        updateStack(toLinePos);
        updateOldStack(fromLinePos);
        chunk.breadcrumb = headingStack.map(h => h.text);
        chunk.fromBreadcrumb = oldHeadingStack.map(h => h.text);
        chunk.toLine = toLinePos + 1;
        chunk.fromLine = fromLinePos + 1;
      }
      if (chunk.type === 'equal' || chunk.type === 'added') {
        toLinePos += (chunk.text || '').split('\n').length - 1;
      } else if (chunk.type === 'changed') {
        toLinePos += chunk.words.filter(w => w.type !== 'removed').map(w => w.text).join('').split('\n').length - 1;
      }
      if (chunk.type === 'equal' || chunk.type === 'removed') {
        fromLinePos += (chunk.text || '').split('\n').length - 1;
      } else if (chunk.type === 'changed') {
        fromLinePos += chunk.words.filter(w => w.type !== 'added').map(w => w.text).join('').split('\n').length - 1;
      }
    }

    const outline = headings.map(h => ({ level: h.level, text: h.text }));
    const files = [{
      filename: 'uploaded-comparison',
      displayName: 'Full Book Comparison',
      status: 'modified',
      chunks,
      outline
    }];

    res.json({ bookPath, from: 'uploaded file', to: toRef, files });
  } catch (err) {
    console.error('Diff report upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { page, api };
