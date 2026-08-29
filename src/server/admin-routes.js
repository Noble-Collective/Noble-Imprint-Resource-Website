const express = require('express');
const firestore = require('./firestore');
const content = require('./content');
const github = require('./github');
const cache = require('./cache');
const { isSuperAdmin, SUPER_ADMIN_EMAIL } = require('./auth');
const suggestions = require('./suggestions');
const notifications = require('./notifications');
const bibleValidationRunner = require('./bible-validation-runner');
const bibleSync = require('./bible-sync');
const quoteAudit = require('./bible-quote-audit');
const bibleCompare = require('./bible-compare');
const analyticsAdmin = require('./analytics-admin');
const { patienceDiffPlus } = require('./patience-diff');

// Convert patienceDiffPlus output to rawChunks format [{type, text}]
function patienceToChunks(oldContent, newContent) {
  const aLines = oldContent.split('\n');
  const bLines = newContent.split('\n');
  const result = patienceDiffPlus(aLines, bLines);

  const rawChunks = [];
  let currentType = null;
  let currentLines = [];

  function flush() {
    if (currentLines.length === 0) return;
    rawChunks.push({ type: currentType, text: currentLines.join('\n') + '\n' });
    currentLines = [];
    currentType = null;
  }

  for (const entry of result.lines) {
    let type;
    if (entry.aIndex >= 0 && entry.bIndex >= 0) {
      type = 'equal';
    } else if (entry.aIndex >= 0) {
      type = 'removed';
    } else {
      type = 'added';
    }

    if (type !== currentType) {
      flush();
      currentType = type;
    }
    currentLines.push(entry.line);
  }
  flush();

  // Fix trailing newline: if the last chunk ends with an extra \n, trim it
  if (rawChunks.length > 0) {
    const last = rawChunks[rawChunks.length - 1];
    if (last.text.endsWith('\n\n') && !oldContent.endsWith('\n\n') && !newContent.endsWith('\n\n')) {
      last.text = last.text.slice(0, -1);
    }
  }

  return rawChunks;
}

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

// Analytics dashboard data (admin-gated by the router mount). Returns all views
// in one payload for a range ('7d'|'30d'|'90d'|'365d'|'all') + bot policy.
api.get('/analytics', async (req, res) => {
  try {
    const range = req.query.range || '30d';
    const includeBots = req.query.includeBots === '1' || req.query.includeBots === 'true';
    const book = req.query.book ? String(req.query.book).slice(0, 300) : null;
    const data = await analyticsAdmin.getDashboard(range, { includeBots, book });
    res.json(data);
  } catch (err) {
    console.error('[admin] analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Book comparison: leaderboard + multi-book trend.
api.get('/analytics/books', async (req, res) => {
  try {
    const range = req.query.range || '30d';
    const includeBots = req.query.includeBots === '1' || req.query.includeBots === 'true';
    res.json(await analyticsAdmin.getBooksComparison(range, { includeBots }));
  } catch (err) {
    console.error('[admin] analytics/books error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Within-book drop-off funnel.
api.get('/analytics/funnel', async (req, res) => {
  try {
    const range = req.query.range || '30d';
    const includeBots = req.query.includeBots === '1' || req.query.includeBots === 'true';
    const book = req.query.book ? String(req.query.book).slice(0, 300) : null;
    res.json(await analyticsAdmin.getBookFunnel(range, { includeBots }, book));
  } catch (err) {
    console.error('[admin] analytics/funnel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

      // Two-pass diff: patience diff for lines, then words within changed pairs
      const rawChunks = patienceToChunks(oldContent, newContent);

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
      const STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','of','to','for','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','shall','should','may','might','can','could','it','its','this','that','these','those','with','at','by','from','not','no','as','he','she','they','we','you','his','her','their','our','your']);

      function textSimilarity(a, b) {
        if (!a || !b) return 0;
        // Extract meaningful words (skip stop words, min 3 chars)
        function getWords(t) {
          return t.replace(/[*#_<>[\]()\\]/g, '').replace(/\s+/g, ' ').trim()
            .split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()));
        }
        const wordsA = getWords(a);
        const wordsB = getWords(b);
        if (wordsA.length === 0 || wordsB.length === 0) return 0;
        const setA = new Set(wordsA.map(w => w.toLowerCase()));
        const setB = new Set(wordsB.map(w => w.toLowerCase()));
        let shared = 0;
        for (const w of setA) { if (setB.has(w)) shared++; }
        return shared / Math.max(setA.size, setB.size);
      }

      const SIMILARITY_THRESHOLD = 0.65;
      const MIN_TEXT_LENGTH = 80;
      const MAX_SIZE_RATIO = 5;

      // No pre-split needed — patience diff handles paragraph-level matching

      const unpairedRemoved = [];
      const unpairedAdded = [];
      chunks.forEach((c, i) => {
        if (c.type === 'removed') unpairedRemoved.push(i);
        else if (c.type === 'added') unpairedAdded.push(i);
      });

      const pairedRemovedSet = new Set();
      const pairedAddedSet = new Set();
      for (const ri of unpairedRemoved) {
        const rText = chunks[ri].text || '';
        if (rText.length < MIN_TEXT_LENGTH) continue; // skip short blocks
        let bestIdx = -1, bestSim = SIMILARITY_THRESHOLD;
        for (const ai of unpairedAdded) {
          if (pairedAddedSet.has(ai)) continue;
          const aText = chunks[ai].text || '';
          if (aText.length < MIN_TEXT_LENGTH) continue;
          // Size ratio check — don't pair very different-sized blocks
          const ratio = Math.max(rText.length, aText.length) / Math.min(rText.length, aText.length);
          if (ratio > MAX_SIZE_RATIO) continue;
          const sim = textSimilarity(rText, aText);
          if (sim > bestSim) { bestSim = sim; bestIdx = ai; }
        }
        if (bestIdx >= 0) {
          const wordDiffs = Diff.diffWords(chunks[ri].text, chunks[bestIdx].text);
          const hasRealDiff = wordDiffs.some(w => w.added || w.removed);
          if (hasRealDiff) {
            // Replace the added chunk with a changed chunk, null the removed
            chunks[bestIdx] = {
              type: 'changed',
              words: wordDiffs.map(w => ({ type: w.added ? 'added' : w.removed ? 'removed' : 'equal', text: w.value })),
            };
            chunks[ri] = null;
            pairedRemovedSet.add(ri);
            pairedAddedSet.add(bestIdx);
          }
        }
      }
      // Dedup pass: remove 'removed' or 'added' blocks whose text already appears
      // within a nearby 'changed' block (as either the equal+added or equal+removed portion)
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if (!c || (c.type !== 'removed' && c.type !== 'added')) continue;
        if ((c.text || '').length < 80) continue;
        for (let j = 0; j < chunks.length; j++) {
          if (i === j || !chunks[j] || chunks[j].type !== 'changed') continue;
          // Check against the full "to" side (equal+added) and full "from" side (equal+removed)
          const toText = chunks[j].words.filter(w => w.type !== 'removed').map(w => w.text).join('');
          const fromText = chunks[j].words.filter(w => w.type !== 'added').map(w => w.text).join('');
          const targetText = c.type === 'removed' ? toText : fromText;
          if (targetText.length < 80) continue;
          const sim = textSimilarity(c.text, targetText);
          if (sim > 0.6) {
            chunks[i] = null;
            break;
          }
        }
      }

      const finalChunks = chunks.filter(c => c !== null);
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

    // Two-pass diff: patience diff for lines, then words within changed pairs
    const rawChunks = patienceToChunks(oldContent, newContent);

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
    const STOP_WORDS2 = new Set(['the','a','an','and','or','but','in','on','of','to','for','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','shall','should','may','might','can','could','it','its','this','that','these','those','with','at','by','from','not','no','as','he','she','they','we','you','his','her','their','our','your']);
    function textSimilarity2(a, b) {
      if (!a || !b) return 0;
      function getWords(t) {
        return t.replace(/[*#_<>[\]()\\]/g, '').replace(/\s+/g, ' ').trim()
          .split(' ').filter(w => w.length >= 3 && !STOP_WORDS2.has(w.toLowerCase()));
      }
      const wordsA = getWords(a), wordsB = getWords(b);
      if (wordsA.length === 0 || wordsB.length === 0) return 0;
      const setA = new Set(wordsA.map(w => w.toLowerCase()));
      const setB = new Set(wordsB.map(w => w.toLowerCase()));
      let shared = 0;
      for (const w of setA) { if (setB.has(w)) shared++; }
      return shared / Math.max(setA.size, setB.size);
    }
      // No pre-split needed

    const unpairedRemoved2 = [], unpairedAdded2 = [];
    chunks.forEach((c, i) => {
      if (c.type === 'removed') unpairedRemoved2.push(i);
      else if (c.type === 'added') unpairedAdded2.push(i);
    });
    const pairedAddedSet2 = new Set();
    for (const ri of unpairedRemoved2) {
      const rText = chunks[ri].text || '';
      if (rText.length < 80) continue;
      let bestIdx = -1, bestSim = 0.65;
      for (const ai of unpairedAdded2) {
        if (pairedAddedSet2.has(ai)) continue;
        const aText = chunks[ai].text || '';
        if (aText.length < 80) continue;
        const ratio = Math.max(rText.length, aText.length) / Math.min(rText.length, aText.length);
        if (ratio > 3) continue;
        const sim = textSimilarity2(rText, aText);
        if (sim > bestSim) { bestSim = sim; bestIdx = ai; }
      }
      if (bestIdx >= 0) {
        const wordDiffs = Diff.diffWords(chunks[ri].text, chunks[bestIdx].text);
        if (wordDiffs.some(w => w.added || w.removed)) {
          chunks[bestIdx] = { type: 'changed', words: wordDiffs.map(w => ({ type: w.added ? 'added' : w.removed ? 'removed' : 'equal', text: w.value })) };
          chunks[ri] = null;
          pairedAddedSet2.add(bestIdx);
        }
      }
    }
    // Dedup pass
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (!c || (c.type !== 'removed' && c.type !== 'added')) continue;
      if ((c.text || '').length < 80) continue;
      for (let j = 0; j < chunks.length; j++) {
        if (i === j || !chunks[j] || chunks[j].type !== 'changed') continue;
        const toText = chunks[j].words.filter(w => w.type !== 'removed').map(w => w.text).join('');
        const fromText = chunks[j].words.filter(w => w.type !== 'added').map(w => w.text).join('');
        const targetText = c.type === 'removed' ? toText : fromText;
        if (targetText.length < 80) continue;
        if (textSimilarity2(c.text, targetText) > 0.6) { chunks[i] = null; break; }
      }
    }
    const finalChunks2 = chunks.filter(c => c !== null);
    chunks.length = 0;
    finalChunks2.forEach(c => chunks.push(c));

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

// --- Bible text validation ---
// Runs synchronously (like /diff-report): fetch the official BSB master from
// bereanbible.com, compare against our stored copy, persist a summary to
// Firestore, and return it. Guarded by requireAdmin via the router mount.
api.post('/bible-validation/run', async (req, res) => {
  try {
    const translationId = (req.body && req.body.translationId) || 'bsb';
    const footnotes = !(req.body && req.body.footnotes === false);
    const result = await bibleValidationRunner.runValidation({ translationId, footnotes });
    const runBy = (req.user && req.user.email) || 'unknown';
    const saved = await firestore.saveValidationRun({ ...result, runBy });
    res.json({ id: saved.id, runBy, ...result });
  } catch (err) {
    console.error('Bible validation run error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

api.get('/bible-validation/runs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    res.json({ runs: await firestore.getValidationRuns(limit) });
  } catch (err) {
    console.error('Bible validation history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Scan for changes needed to bring our copy (and library quotations) up to the
// latest official BSB. Read-only — proposes changes, applies nothing.
api.get('/bible-validation/sync-scan', async (req, res) => {
  try {
    const translationId = req.query.translationId || 'bsb';
    res.json(await bibleSync.detectSyncChanges({ translationId }));
  } catch (err) {
    console.error('Bible sync scan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Apply ONE accepted change (a single scoped commit). The client sends back the
// exact change object from the scan.
api.post('/bible-validation/apply-change', async (req, res) => {
  try {
    const change = req.body && req.body.change;
    if (!change || !change.type) return res.status(400).json({ error: 'change is required' });
    const result = await bibleSync.applyChange(change);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Bible sync apply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Library-wide quotation-integrity audit: compare every cited quotation against
// our current stored Bible. Read-only. Persists a summary to Firestore history.
api.post('/bible-quote-audit/run', async (req, res) => {
  try {
    const translationId = (req.body && req.body.translationId) || 'bsb';
    const result = await quoteAudit.auditLibraryQuotations({ translationId });
    const runBy = (req.user && req.user.email) || 'unknown';
    // Store a compact summary (counts + tier sizes), not the full findings.
    firestore.saveQuoteAuditRun({
      translationId, runBy, scannedFiles: result.scannedFiles, checked: result.checked,
      counts: result.counts,
      tierSizes: { review: result.tiers.review.length, minor: result.tiers.minor.length, differentTranslation: result.tiers.differentTranslation.length },
    }).catch(err => console.warn('quote-audit history save failed:', err.message));
    res.json({ ...result, runBy });
  } catch (err) {
    console.error('Quote audit run error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

api.get('/bible-quote-audit/runs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    res.json({ runs: await firestore.getQuoteAuditRuns(limit) });
  } catch (err) {
    console.error('Quote audit history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Streaming "Compare to current BSB" (Server-Sent Events). Emits a live
// checklist (download → load → per-book → structure → library) then the full
// result with Accept/Reject changes. Read-only. Auth via the admin session
// cookie (EventSource sends same-origin cookies).
api.get('/bible-compare/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // don't let any proxy buffer the stream
  if (res.flushHeaders) res.flushHeaders();
  const emit = (evt) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
    if (res.flush) res.flush(); // push past the compression middleware's buffer
  };
  try {
    const translationId = req.query.translationId || 'bsb';
    const result = await bibleCompare.runStreamingCompare({ translationId, emit });
    // Persist a compact summary to run history (fire-and-forget).
    const st = result.structure.totals;
    const structureDiffBooks = (st.booksWithHeadingDiffs || 0) + (st.booksWithFootnoteDiffs || 0) + (st.missingBooks || 0) + (st.extraBooks || 0);
    const clean = result.verse.changed === 0 && result.verse.missing === 0 && result.verse.extra === 0 && structureDiffBooks === 0;
    firestore.saveValidationRun({
      translationId,
      runBy: (req.user && req.user.email) || 'unknown',
      status: clean ? 'pass' : 'fail',
      verse: result.verse,
      structureDiffBooks,
      upstreamLastModified: result.upstream.lastModified,
      durationMs: result.durationMs,
    }).catch(err => console.warn('compare history save failed:', err.message));
  } catch (err) {
    console.error('Bible compare stream error:', err.message);
    emit({ type: 'error', error: err.message });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// Read the pinned version label for a translation (or null if not pinned yet).
api.get('/bible-version', async (req, res) => {
  const translationId = req.query.translationId || 'bsb';
  try {
    const { content } = await github.getFileContent(`bibles/${translationId}/version.json`);
    res.json({ version: JSON.parse(content) });
  } catch {
    res.json({ version: null });
  }
});

module.exports = { page, api };
