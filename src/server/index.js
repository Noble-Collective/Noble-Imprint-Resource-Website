require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const content = require('./content');
const bible = require('./bible');
const auth = require('./auth');
const firestore = require('./firestore');
const { renderMarkdown, renderCommonContent } = require('../renderer/parser');

const app = express();
const PORT = process.env.PORT || 8080;

// Trust proxy — needed for secure cookies on Cloud Run
app.set('trust proxy', true);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// Static files
app.use('/static', express.static(path.join(__dirname, '../public')));

// Attach user to every request
app.use(auth.attachUser);

// Prevent CDN from caching HTML pages (they vary by auth state)
app.use((req, res, next) => {
  // Only allow caching on static assets and cover/image proxies (they set their own headers)
  if (!req.path.startsWith('/static') && !req.path.startsWith('/cover/') && !req.path.startsWith('/image/')) {
    res.set('Cache-Control', 'private, no-store');
  }
  next();
});

// Build timestamp — available in all templates
const buildTimeRaw = process.env.BUILD_TIME;
let buildTimeFormatted = null;
if (buildTimeRaw) {
  try {
    const d = new Date(buildTimeRaw);
    buildTimeFormatted = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }).toLowerCase();
  } catch { /* ignore */ }
}
app.use((req, res, next) => {
  res.locals.buildTime = buildTimeFormatted;
  res.locals.firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || '',
  };
  next();
});

// Cover image proxy — serves covers from the resources repo
app.get('/cover/*', async (req, res) => {
  try {
    const repoPath = req.params[0];
    const github = require('./github');
    const ext = path.extname(repoPath).toLowerCase();
    const mimeTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
    res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');

    if (ext === '.svg') {
      const data = await github.getFileRaw(repoPath);
      res.send(typeof data === 'string' ? data : Buffer.from(data));
    } else {
      const buf = await github.getFileBinary(repoPath);
      res.send(buf);
    }
  } catch (err) {
    res.status(404).send('Cover not found');
  }
});

// Session image proxy — serves images from sessions/images/ folders
app.get('/image/*', async (req, res) => {
  try {
    const repoPath = req.params[0];
    const github = require('./github');
    const response = await github.getFileRaw(repoPath);
    const ext = path.extname(repoPath).toLowerCase();
    const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    if (typeof response === 'string') {
      res.send(response);
    } else {
      res.send(Buffer.from(response));
    }
  } catch (err) {
    res.status(404).send('Image not found');
  }
});

// Content tree endpoint — list all books and sessions (for API/bot access)
app.get('/api/content-tree', async (req, res) => {
  try {
    const tree = await content.buildContentTree();
    const result = [];
    for (const s of tree.series) {
      for (const child of s.children) {
        if (child.type === 'book') {
          result.push({
            series: s.title,
            book: child.title,
            bookPath: child.repoPath,
            sessions: (child.sessions || []).map(sess => ({
              title: sess.displayName,
              filePath: sess.path,
            })),
          });
        } else if (child.type === 'subseries') {
          for (const book of child.books) {
            result.push({
              series: s.title,
              subseries: child.title,
              book: book.title,
              bookPath: book.repoPath,
              sessions: (book.sessions || []).map(sess => ({
                title: sess.displayName,
                filePath: sess.path,
              })),
            });
          }
        }
      }
    }
    res.json({ books: result });
  } catch (err) {
    console.error('Content tree error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cache refresh endpoint — called after deploy or content update to clear stale content
app.post('/api/refresh', async (req, res) => {
  const cache = require('./cache');
  cache.invalidateAll();
  // Proactively rebuild the content tree so the first visitor doesn't wait
  try { await content.buildContentTree(); } catch (e) { console.error('Content tree rebuild error:', e.message); }
  res.json({ ok: true, message: 'Cache cleared, content tree rebuilt' });
});

// Clean up test book suggestions/comments/replies after deploy
app.post('/api/cleanup-test-data', async (req, res) => {
  try {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    const testFile = 'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md';
    let deleted = 0;

    for (const col of ['suggestions', 'comments', 'replies']) {
      const snap = await db.collection(col)
        .where('filePath', '==', testFile)
        .get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
      }
    }

    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('Cleanup test data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Verse lookup API
app.get('/api/verses', (req, res) => {
  const ref = req.query.ref;
  const translation = req.query.translation || 'bsb';
  if (!ref) return res.status(400).json({ error: 'ref parameter required' });

  const verses = bible.getVerses(translation, ref);
  if (verses.length === 0) {
    return res.status(404).json({ error: 'No verses found', ref, translation });
  }
  res.json({ ref, translation, verses });
});

// Bible browsing routes
app.get('/bible', (req, res) => {
  const bibles = bible.getAllTranslations();
  res.render('bible-index', { bibles, title: 'Bibles' });
});

app.get('/bible/:translationId', (req, res) => {
  const t = bible.getTranslation(req.params.translationId);
  if (!t) return res.status(404).render('error', { title: 'Not Found', message: 'Bible translation not found.' });
  const { ot, nt } = bible.getBookListGrouped(req.params.translationId);
  res.render('bible-books', { translation: t, ot, nt, title: t.title });
});

app.get('/bible/:translationId/:bookName', (req, res) => {
  const t = bible.getTranslation(req.params.translationId);
  if (!t) return res.status(404).render('error', { title: 'Not Found', message: 'Bible translation not found.' });
  const bookName = decodeURIComponent(req.params.bookName);
  const chapter = parseInt(req.query.chapter) || 1;
  const verses = bible.getChapter(req.params.translationId, bookName, chapter);
  if (!verses) return res.status(404).render('error', { title: 'Not Found', message: 'Chapter not found.' });
  const books = bible.getBookList(req.params.translationId);
  const bookInfo = books.find(b => b.name === bookName);
  const totalChapters = bookInfo ? bookInfo.chapterCount : 1;
  res.render('bible-chapter', {
    translation: t,
    bookName,
    chapter,
    totalChapters,
    verses,
    title: `${bookName} ${chapter} — ${t.title}`,
  });
});

// --- Auth routes ---

app.post('/api/auth/session', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'ID token required' });

  try {
    const sessionCookie = await auth.createSessionCookie(idToken);
    const secure = process.env.NODE_ENV === 'production';
    res.cookie('__session', sessionCookie, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: auth.SESSION_EXPIRES_IN,
    });

    // Create or update user in Firestore
    const admin = require('firebase-admin');
    const decoded = await admin.auth().verifyIdToken(idToken);
    await firestore.createOrUpdateUser(decoded.email, decoded.name, decoded.picture);

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Session creation error:', err.code, err.message);
    res.status(401).json({ error: 'Invalid token', detail: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('__session', { path: '/' });
  res.json({ status: 'ok' });
});

// --- Test auth helper (development only) ---
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/auth/test-login', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'email required' });
      // Set a dev-only cookie that attachUser recognizes
      res.cookie('__dev_auth', email, {
        httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60 * 1000,
      });
      await firestore.createOrUpdateUser(email, email.split('@')[0], null);
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('Test login error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

// --- Admin routes ---
const adminRoutes = require('./admin-routes');
app.use('/admin', auth.requireAdmin, adminRoutes.page);
app.use('/api/admin', auth.requireAdmin, adminRoutes.api);

// --- Suggestion routes ---
const suggestionRoutes = require('./suggestion-routes');
app.use('/api/suggestions', suggestionRoutes);

// Homepage
app.get('/', async (req, res, next) => {
  try {
    const tree = await content.buildContentTree();
    const filtered = await content.filterContentTree(tree, req.user);
    const bibles = bible.getAllTranslations();
    res.render('home', {
      tree: filtered,
      content,
      bibles,
      title: 'Resource Library',
    });
  } catch (err) {
    next(err);
  }
});

// Content routes — catch-all resolver
app.get('/:seg1/:seg2?/:seg3?/:seg4?', async (req, res, next) => {
  try {
    const segments = [req.params.seg1, req.params.seg2, req.params.seg3, req.params.seg4].filter(Boolean);
    const tree = await content.buildContentTree();
    const resolved = content.resolveRoute(tree, segments);

    if (!resolved) return next();

    // Permission check for hidden books
    const book = resolved.book;
    if (book && book.status === 'hidden') {
      const canAccess = await content.canAccessBook(req.user, book.repoPath);
      if (!canAccess) return next(); // 404 — don't reveal the book exists
    }

    if (resolved.type === 'book') {
      const { series, subseries, book } = resolved;
      await content.loadSessionTitles(book);

      // Suggestion counts for badge display (users with suggest access or higher)
      let suggestionCounts = {};
      if (req.user) {
        const editRole = await firestore.getUserBookRole(req.user.email, book.repoPath);
        if (editRole === 'admin' || editRole === 'manuscript-owner' || editRole === 'comment-suggest') {
          const suggestions = require('./suggestions');
          suggestionCounts = await suggestions.getSuggestionCountsByBook(book.repoPath);
        }
      }

      res.render('book', {
        series,
        subseries: subseries || null,
        book,
        content,
        title: book.title,
        suggestionCounts,
      });
    } else if (resolved.type === 'session') {
      const { series, subseries, book, session } = resolved;
      await content.loadSessionTitles(book);
      const sessionData = await content.loadSessionContent(session);
      const commonParts = content.gatherCommonContent(series, subseries || null, book);
      const commonHtml = renderCommonContent(commonParts);
      const sessionHtml = renderMarkdown(sessionData.content, { color: book.color });

      // Extract h2 headings for sidebar table of contents
      const h2s = [];
      const h2Pattern = /^##\s+(.+)$/gm;
      let h2Match;
      while ((h2Match = h2Pattern.exec(sessionData.content)) !== null) {
        const text = h2Match[1].trim();
        const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        h2s.push({ text, slug });
      }

      // Find prev/next sessions
      const idx = book.sessions.findIndex(s => s.slug === session.slug);
      const prevSession = idx > 0 ? book.sessions[idx - 1] : null;
      const nextSession = idx < book.sessions.length - 1 ? book.sessions[idx + 1] : null;

      // Editor data — for users with edit/review permissions
      // Disable editing when content came from disk cache (GitHub API unavailable) —
      // editing must always start with the latest content to prevent stale edits
      const suggestions = require('./suggestions');
      let editRole = null;
      let allPendingSuggestions = [];
      if (req.user && !sessionData.fromDiskCache) {
        editRole = await firestore.getUserBookRole(req.user.email, book.repoPath);
      }
      const canEdit = editRole === 'admin' || editRole === 'manuscript-owner' || editRole === 'comment-suggest';
      const canReview = editRole === 'admin' || editRole === 'manuscript-owner';
      let allPendingComments = [];
      let allReplies = [];
      if (canEdit || canReview) {
        allPendingSuggestions = await suggestions.getSuggestionsForFile(session.path);
        allPendingComments = await suggestions.getCommentsForFile(session.path);
        allReplies = await suggestions.getRepliesForFile(session.path);

        // Resolve anchor positions against current file content — without this,
        // suggestions have stale originalFrom after other suggestions are accepted
        const fileContent = sessionData.content;
        for (const s of allPendingSuggestions) {
          const resolved = suggestions.resolveAnchor(s, fileContent);
          if (!resolved.stale) {
            s.resolvedFrom = resolved.from;
            s.resolvedTo = resolved.to;
          } else {
            s.resolvedStale = true;
            console.log('[RESOLVE] suggestion', s.id, 'marked STALE — type:', s.type, 'origText:', (s.originalText||'').substring(0,20), 'anchor.exact:', (s.anchor?.exact||'').substring(0,20), 'prefix:', (s.anchor?.prefix || s.contextBefore || '').substring(0,20));
          }
        }
        for (const c of allPendingComments) {
          const resolved = suggestions.resolveAnchor(c, fileContent);
          if (!resolved.stale) {
            c.resolvedFrom = resolved.from;
            c.resolvedTo = resolved.to;
          } else {
            c.resolvedStale = true;
          }
        }
      }

      res.render('session', {
        series,
        subseries: subseries || null,
        book,
        session: { ...session, title: sessionData.title },
        h2s,
        commonHtml,
        sessionHtml,
        prevSession,
        nextSession,
        content,
        title: `${sessionData.title} — ${book.title}`,
        editRole: canEdit ? editRole : null,
        canReview: canReview || false,
        rawContent: canEdit ? sessionData.content : null,
        contentSha: canEdit ? sessionData.sha : null,
        pendingSuggestions: allPendingSuggestions,
        pendingComments: allPendingComments,
        pendingReplies: allReplies,
        sessionFilePath: canEdit ? session.path : null,
        bookRepoPath: canEdit ? book.repoPath : null,
      });
    }
  } catch (err) {
    next(err);
  }
});

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'The page you requested could not be found.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong. Please try again.' });
});

// Start server immediately so Cloud Run health check passes, then load bibles
app.listen(PORT, () => {
  console.log(`Noble Imprint Resource Website running on port ${PORT}`);
  bible.loadBibles().then(() => {
    console.log('Bibles loaded successfully');
  }).catch(err => {
    console.error('Failed to load Bibles:', err.message);
  });
});
