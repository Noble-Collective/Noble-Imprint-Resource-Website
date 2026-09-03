const express = require('express');
const firestore = require('./firestore');
const content = require('./content');

// --- Page route ---
const page = express.Router();

page.use((req, res, next) => {
  if (!req.user) return res.redirect('/');
  next();
});

page.get('/', async (req, res, next) => {
  try {
    const prefs = await firestore.getNotificationPrefs(req.user.email);

    // Get books the user has comment-suggest access or higher
    const tree = await content.buildContentTree();
    const allBooks = content.getAllBooks(tree);
    // Resolve every book's role in parallel (was ~22 sequential Firestore round-trips).
    const roleResults = await Promise.all(allBooks.map(async (book) => ({
      book,
      role: await firestore.getUserBookRole(req.user.email, book.repoPath),
    })));
    const userBooks = [];
    for (const { book, role } of roleResults) {
      if (role === 'admin' || role === 'manuscript-owner' || role === 'comment-suggest') {
        const encodedPath = book.repoPath.replace(/\//g, '|');
        const isTestBook = book.repoPath.includes('Foundations/Test Book');
        userBooks.push({
          repoPath: book.repoPath,
          title: book.title,
          seriesTitle: book.seriesTitle || '',
          encodedPath,
          enabled: encodedPath in prefs.bookOverrides
            ? prefs.bookOverrides[encodedPath]
            : !isTestBook, // Test Book defaults to OFF
          isTestBook,
        });
      }
    }

    res.render('notifications', {
      title: 'Notification Settings',
      prefs,
      userBooks,
    });
  } catch (err) {
    next(err);
  }
});

// --- API routes ---
const api = express.Router();

api.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
});

api.get('/preferences', async (req, res) => {
  try {
    const prefs = await firestore.getNotificationPrefs(req.user.email);
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.put('/preferences', async (req, res) => {
  try {
    const { globalOptIn, bookOverrides } = req.body;
    if (typeof globalOptIn !== 'boolean') {
      return res.status(400).json({ error: 'globalOptIn must be a boolean' });
    }
    await firestore.updateNotificationPrefs(req.user.email, {
      globalOptIn,
      bookOverrides: bookOverrides || {},
    });
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Internal endpoint for Cloud Scheduler ---
api.post('/send-daily-summary', async (req, res) => {
  // Authenticate via shared secret (from Cloud Scheduler), constant-time compared.
  // FAIL CLOSED: an admin session always passes; otherwise a matching SCHEDULER_SECRET is
  // required. If SCHEDULER_SECRET is unset we reject in production (never fall open — an
  // unset secret must not make this batch-email trigger public); local dev is allowed through.
  const auth = require('./auth');
  const isAdmin = req.user && req.user.isAdmin;
  if (!isAdmin) {
    const schedulerKey = process.env.SCHEDULER_SECRET;
    const providedKey = req.headers['x-cloudscheduler-key'];
    if (schedulerKey) {
      if (!auth.timingSafeEqualStr(providedKey, schedulerKey)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Server misconfigured: SCHEDULER_SECRET is not set' });
    }
  }

  try {
    const notifications = require('./notifications');
    const result = await notifications.sendDailySummary();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('Daily summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { page, api };
