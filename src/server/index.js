require('dotenv').config();
const express = require('express');
const compression = require('compression');
const path = require('path');
const cookieParser = require('cookie-parser');
const content = require('./content');
const bible = require('./bible');
const github = require('./github');
const audio = require('./audio');
const auth = require('./auth');
const firestore = require('./firestore');
const { renderMarkdown, renderCommonContent, resolveIncludes } = require('../renderer/parser');

const app = express();
const PORT = process.env.PORT || 8080;

// Trust proxy — needed for secure cookies on Cloud Run
app.set('trust proxy', true);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
// Compress text responses (HTML, CSS, JS, JSON). The app served everything
// uncompressed before; gzip takes the ~124KB stylesheet down to ~20KB over the
// wire and shrinks every HTML/JS/JSON payload too. No build step, no source
// changes — the compression happens at request time.
app.use(compression());
// Baseline security headers (dependency-free — avoids a new runtime dep and the CSP
// mis-config risk of full helmet defaults, which would block the site's font/icon CDNs).
// A tuned Content-Security-Policy is deferred pending a CDN allowlist audit.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// Static files. All /static assets are cache-busted with ?v=N in the templates,
// so a changed file always gets a new URL — which makes it safe to tell browsers
// to hold each asset for a year (immutable). This removes the per-navigation
// revalidation round-trip (notably for the 124KB style.css). IMPORTANT: keep
// bumping ?v=N whenever an asset changes, or clients will serve the stale copy.
app.use('/static', express.static(path.join(__dirname, '../public'), {
  maxAge: '1y',
  immutable: true,
}));

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
  // Convergence per-user data layer (account/settings site-wide; answers/notes/highlights on
  // session pages only). Flag-gated so it ships dark until enabled. The footer loads the bundle
  // on every page when this is on; the reading features additionally require window.__READER_CTX.
  res.locals.featureUserData = process.env.FEATURE_USER_DATA === '1';
  // Convergence Phase 1b — when on, end-user identity is unified on noble-imprint-463519: the reader
  // bundle owns sign-in (mints the __session cookie via the 463519 admin app), the legacy compat
  // login is dropped, and the account menu carries role-aware links (admin/notifications).
  res.locals.featureAuthUnified = process.env.AUTH_UNIFIED === '1';
  // Available Bible translations (id + title) for the reader's "Default Bible Translation" setting
  // + the verse-popup translation switch. Cheap in-memory read.
  try { res.locals.bibleTranslations = bible.getAllTranslations().map((t) => ({ id: t.id, title: t.title })); }
  catch { res.locals.bibleTranslations = []; }
  // Canonical analytics content identity — set per content route below, echoed
  // into the page as window.__analyticsContext (see footer.ejs). null by default
  // (non-content pages fall back to the server's coarse path parse).
  res.locals.analyticsContext = null;
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

    if (ext === '.svg') {
      const data = await github.getFileRaw(repoPath);
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(typeof data === 'string' ? data : Buffer.from(data));
    } else {
      const buf = await github.getFileBinary(repoPath);
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buf);
    }
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    res.status(404).send('Cover not found');
  }
});

// Session image proxy — serves images from sessions/images/ folders
// Supports extensionless requests by trying common image formats
app.get('/image/*', async (req, res) => {
  try {
    let repoPath = req.params[0];
    const ext = path.extname(repoPath).toLowerCase();
    const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif' };

    // For binary images, use getFileBinary which returns a proper Buffer.
    // getFileRaw returns strings which corrupt binary data.
    // For SVGs, use getFileRaw (they're text).
    async function fetchImage(imgPath) {
      const imgExt = path.extname(imgPath).toLowerCase();
      if (imgExt === '.svg') return { data: await github.getFileRaw(imgPath), mime: 'image/svg+xml' };
      return { data: await github.getFileBinary(imgPath), mime: mimeTypes[imgExt] || 'application/octet-stream' };
    }

    // If no extension, try common formats
    if (!ext) {
      const tryExts = ['.webp', '.png', '.jpg', '.svg'];
      let found = false;
      for (const tryExt of tryExts) {
        try {
          const { data, mime } = await fetchImage(repoPath + tryExt);
          res.set('Content-Type', mime);
          res.set('Cache-Control', 'private, max-age=86400');
          res.send(typeof data === 'string' ? data : Buffer.from(data));
          found = true;
          break;
        } catch { /* try next extension */ }
      }
      if (!found) {
        res.set('Cache-Control', 'no-store');
        res.status(404).send('Image not found');
      }
      return;
    }

    const { data, mime } = await fetchImage(repoPath);
    res.set('Content-Type', mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(typeof data === 'string' ? data : Buffer.from(data));
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    res.status(404).send('Image not found');
  }
});

// Health check for Cloud Run probes + uptime monitors. 200 only when a content tree is
// servable (in-memory cache or committed snapshot). Bible-load status is reported in the
// body for observability but does NOT fail the check — the ~2min first-boot bible warm-up
// must not make a healthy container look dead to a liveness probe.
// NOTE: served under /api/ deliberately — Google Front End intercepts a bare /healthz
// before it reaches the container, so that path never works on Cloud Run.
app.get('/api/health', (req, res) => {
  const treeOk = content.hasServableTree();
  const biblesOk = bible.isReady();
  res.status(treeOk ? 200 : 503).json({ status: treeOk ? 'ok' : 'unhealthy', tree: treeOk, bibles: biblesOk });
});

// Content tree endpoint — list all books and sessions (for API/bot access)
app.get('/api/content-tree', async (req, res) => {
  try {
    const tree = await content.buildContentTree();
    // Filter to what this requester may see (hidden/unpublished books stay invisible
    // to non-privileged callers) — mirrors the homepage, which never exposes the raw tree.
    const filtered = await content.filterContentTree(tree, req.user);
    const result = [];
    for (const s of filtered.series) {
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

// Cache refresh endpoint — called after deploy or content update to clear stale content.
// Gated: admin session, or REFRESH_SECRET (Bearer/x-refresh-key). Open in local dev only.
app.post('/api/refresh', auth.requireRefreshSecret, async (req, res) => {
  const cache = require('./cache');
  // Scoped refresh (used by the test suite): drop only cached file contents and
  // keep the content tree, skipping the full rebuild. A full rebuild is ~70+
  // GitHub API calls; scoped is ~0. Backward-compatible — no ?scope=files means
  // the original full refresh below, unchanged.
  if (req.query.scope === 'files') {
    cache.invalidateFiles();
    return res.json({ ok: true, scope: 'files' });
  }
  cache.invalidateAll();
  github.clearDiskCache();
  // Proactively rebuild the content tree so the first visitor doesn't wait
  try { await content.buildContentTree(); } catch (e) { console.error('Content tree rebuild error:', e.message); }
  // Re-discover bible cover paths in case covers were added/changed/renamed
  try { await bible.refreshCoverPaths(); } catch (e) { console.error('Bible cover refresh error:', e.message); }
  res.json({ ok: true, message: 'Cache cleared, disk cache cleared, content tree rebuilt' });
});

// Audio manifest endpoint
app.get('/api/audio/manifest/*', async (req, res) => {
  try {
    const bookRepoPath = 'series/' + req.params[0];
    const manifest = await audio.getAudioManifest(bookRepoPath);
    if (!manifest) return res.status(404).json({ error: 'No audiobook found' });
    res.json(manifest);
  } catch (err) {
    console.error('[audio] Manifest error:', err.message);
    res.status(500).json({ error: 'Failed to load audio manifest' });
  }
});

// Audio signed URL endpoint
app.get('/api/audio/url/*', async (req, res) => {
  try {
    const parts = req.params[0];
    const lastSlash = parts.lastIndexOf('/');
    const bookRepoPath = 'series/' + parts.substring(0, lastSlash);
    const filename = parts.substring(lastSlash + 1);
    const url = await audio.getSignedUrl(bookRepoPath, filename);
    res.json({ url });
  } catch (err) {
    console.error('[audio] Signed URL error:', err.message);
    res.status(500).json({ error: 'Failed to generate audio URL' });
  }
});

// Audio cache refresh — called by the audiobook generation workflow (Noble-Imprint-Audiobooks).
// Gated: admin session, or REFRESH_SECRET (Bearer/x-refresh-key). The audiobook workflow must
// send the secret. Open in local dev only.
app.post('/api/refresh-audio', auth.requireRefreshSecret, (req, res) => {
  audio.clearCache();
  res.json({ ok: true, message: 'Audio cache cleared' });
});

// Clean up test book suggestions/comments/replies — a TEST-ONLY utility (the Playwright
// fixture calls it before each test). Never exposed in production: it batch-deletes Firestore
// documents and has no place on the live site.
app.post('/api/cleanup-test-data', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    // Test files whose suggestion/comment/reply state must be reset between tests.
    // Session 5 + its shared common files back the shared-content-editing specs.
    const testFiles = [
      'series/Narrative Journey Series/Foundations/Test Book/sessions/1-Session1-TheGospel.md',
      'series/Narrative Journey Series/Foundations/Test Book/sessions/5-Session5-Includes.md',
      'series/Narrative Journey Series/Foundations/Test Book/commonBook.md',
      'series/Narrative Journey Series/commonSeries.md',
    ];
    let deleted = 0;

    for (const col of ['suggestions', 'comments', 'replies']) {
      for (const testFile of testFiles) {
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

// Voice comparison test page — side-by-side voice samples of a passage.
// Default slug is the Psalm 1 & 2 test.
app.get('/voice-test/:slug?', async (req, res, next) => {
  try {
    const slug = req.params.slug || 'psalm-1-2';
    const data = await audio.getVoiceCompareData(slug);
    if (!data) {
      return res.status(404).render('error', {
        title: 'Voice Test',
        message: 'No voice samples have been published yet. Run the Voice Compare workflow to generate them.',
      });
    }
    res.render('voice-test', { data, title: `Voice Test — ${data.title}` });
  } catch (err) {
    next(err);
  }
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

app.get('/bible/:translationId/:bookName', async (req, res) => {
  const t = bible.getTranslation(req.params.translationId);
  if (!t) return res.status(404).render('error', { title: 'Not Found', message: 'Bible translation not found.' });
  const bookName = decodeURIComponent(req.params.bookName);
  const chapter = parseInt(req.query.chapter) || 1;
  const verses = bible.getChapter(req.params.translationId, bookName, chapter);
  if (!verses) return res.status(404).render('error', { title: 'Not Found', message: 'Chapter not found.' });
  const books = bible.getBookList(req.params.translationId);
  const bookInfo = books.find(b => b.name === bookName);
  const totalChapters = bookInfo ? bookInfo.chapterCount : 1;

  // Audio: if this chapter has a generated audiobook, render from the converter's
  // blocks (matching the timestamps) and enable the player. Degrades to text-only.
  let audioSession = null;
  let audioBlocks = null;
  let audioBookPath = null;
  try {
    audioSession = await audio.getBibleAudioChapter(req.params.translationId, bookName, chapter);
    if (audioSession) {
      // bookPath is "bibles/{tx}/{CODE}" — the 3-letter USFM code is the last segment.
      const code = String(audioSession.bookPath || '').split('/').pop();
      audioBlocks = code ? await bible.getAudioChapterBlocks(req.params.translationId, code, chapter) : null;
      if (!audioBlocks) audioSession = null; // no blocks → fall back to text-only
      else audioBookPath = `bible/${req.params.translationId}/${audioSession.bookSlug}`;
    }
  } catch (err) {
    console.error('[bible] audio lookup failed:', err.message);
    audioSession = null;
  }

  res.locals.analyticsContext = {
    content_type: 'bible_chapter',
    bible_translation: req.params.translationId,
    bible_book: bookName,
    bible_chapter: String(chapter),
  };
  res.render('bible-chapter', {
    translation: t,
    bookName,
    chapter,
    totalChapters,
    verses,
    audioSession,
    audioBlocks,
    audioBookPath,
    audioFormatDuration: audio.formatDuration,
    title: `${bookName} ${chapter} — ${t.title}`,
  });
});

// --- Auth routes ---

app.post('/api/auth/session', async (req, res) => {
  const { idToken, profile } = req.body;
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

    // Create or update user in Firestore. Verify the ID token against whichever project owns
    // identity under the current flag (463519 when AUTH_UNIFIED, else noble-imprint-website).
    const decoded = await auth.verifyIdToken(idToken);
    // Prefer the client-sent Google profile (session cookies drop name/picture sometimes).
    const displayName = (profile && profile.displayName) || decoded.name;
    const photoURL = (profile && profile.photoURL) || decoded.picture;
    await firestore.createOrUpdateUser(decoded.email, displayName, photoURL);
    // Drop any cached role/profile flags so the next request reflects the fresh profile immediately.
    try { require('./cache').del('roleflags:' + String(decoded.email).toLowerCase()); } catch { /* ignore */ }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Session creation error:', err.code, err.message);
    res.status(401).json({ error: 'Invalid token' });
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

// --- Notification routes ---
const notificationRoutes = require('./notification-routes');
app.use('/notifications', notificationRoutes.page);
app.use('/api/notifications', notificationRoutes.api);

// --- Analytics ingestion (public beacon) ---
const analytics = require('./analytics');
const contentRegistry = require('./content-registry');
app.post('/api/analytics/collect', analytics.collect);

// Homepage
app.get('/', async (req, res, next) => {
  try {
    const tree = await content.buildContentTree();
    const filtered = await content.filterContentTree(tree, req.user);
    await content.loadAllSessionTitles(filtered); // so numberedSessionCount is accurate on the cards
    const bibles = bible.getAllTranslations();
    res.locals.analyticsContext = { content_type: 'home' };
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

// Shared helper: gather all session page data for a resolved session route.
// Used by both the catch-all page route and the /api/session-data JSON endpoint.
async function getSessionPageData(req, resolvedRoute) {
  const { series, subseries, book, session } = resolvedRoute;
  await content.loadSessionTitles(book);
  const sessionData = await content.loadSessionContent(session);
  const commonParts = content.gatherCommonContent(series, subseries || null, book);
  const commonHtml = renderCommonContent(commonParts);
  // Resolve <!-- @include: Key -->  directives against the common-content blocks
  // (book → subseries → series). Done on the raw markdown so injected content
  // (questions, callouts, blockquotes, attributions) flows through the normal pipeline.
  const includeBlocks = content.gatherCommonBlocks(series, subseries || null, book);
  // A malformed @include (unknown key, missing id=, non-matching bold=/active=) throws.
  // Degrade to the raw session rather than 500-ing a published page — the unresolved
  // directive is an HTML comment so it renders invisibly, and the console.error trips the
  // Cloud Logging error alert so the bad include still gets surfaced and fixed.
  let resolvedContent;
  try {
    resolvedContent = resolveIncludes(sessionData.content, includeBlocks);
  } catch (e) {
    console.error('[INCLUDE] resolve failed for', session.path, '-', (e && e.message) || e);
    resolvedContent = sessionData.content;
  }
  // Build images path from session path: series/.../sessions/file.md → series/.../sessions/images
  const sessionsDir = session.path ? session.path.replace(/\/[^/]+$/, '') : '';
  const imagesPath = sessionsDir ? sessionsDir + '/images' : '';
  const maxNavHeadingLevel = book.maxNavHeadingLevel || 2;
  const sessionHtml = renderMarkdown(resolvedContent, { color: book.color, accent: book.accent, imagesPath, maxNavHeadingLevel });

  // Extract headings for ALL sessions in the book for full sidebar navigation.
  // Content is already cached after loadSessionTitles, so this is fast.
  function extractHeadings(rawContent) {
    const items = [];
    // Ignore headings inside HTML comments (e.g. commented-out sections) so they
    // don't create phantom sidebar/nav entries that link to nothing on the page.
    const src = String(rawContent).replace(/<!--[\s\S]*?-->/g, '');
    const pattern = /^(#{1,6})\s+(.+)$/gm;
    const counts = {};
    let m;
    while ((m = pattern.exec(src)) !== null) {
      const level = m[1].length;
      if (level < 2 || level > maxNavHeadingLevel) continue;
      const text = m[2].trim();
      let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (counts[slug]) { counts[slug]++; slug = slug + '-' + counts[slug]; }
      else { counts[slug] = 1; }
      items.push({ text, slug, level });
    }
    return items;
  }

  // Headings for the current session (used for rendering)
  const headings = extractHeadings(resolvedContent);
  const h2s = headings.filter(h => h.level === 2);

  // Headings for all sessions in the book (used for sidebar navigation)
  const allSessionHeadings = {};
  allSessionHeadings[session.slug] = headings;
  await Promise.all(book.sessions.map(async (s) => {
    if (s.slug === session.slug) return; // already have it
    try {
      const data = await content.loadSessionContent(s);
      allSessionHeadings[s.slug] = extractHeadings(resolveIncludes(data.content, includeBlocks));
    } catch { allSessionHeadings[s.slug] = []; }
  }));

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
  // Shared-content editing: when the session has @include directives, build the
  // editor model (resolved buffer + segment map + per-file annotations pre-mapped
  // to BUFFER offsets). Gated on hasIncludes so no-@include sessions take the exact
  // path (and cost) they always have.
  const hasIncludes = sessionData.content.indexOf('@include') !== -1;
  let editorModelData = null;
  if ((canEdit || canReview) && hasIncludes && !sessionData.fromDiskCache) {
    const editorModel = require('./editor-model');
    try {
      editorModelData = await editorModel.getEditorModel({ series, subseries: subseries || null, book, session });
      // Client works in BUFFER space (originalContent = resolvedContent), so expose
      // each annotation's buffer offsets as resolvedFrom/To. Include annotations from
      // the session file AND every referenced shared file (pre-mapped to the buffer).
      const toClient = (a) => ({ ...a, resolvedFrom: a.bufferFrom, resolvedTo: a.bufferTo });
      allPendingSuggestions = editorModelData.pendingSuggestions.filter(s => s.bufferMapped).map(toClient);
      allPendingComments = editorModelData.pendingComments.filter(c => c.bufferMapped).map(toClient);
      const replyLists = await Promise.all(editorModelData.files.map(f => suggestions.getRepliesForFile(f.path)));
      allReplies = replyLists.flat();
    } catch (err) {
      console.error('[editor-model] getSessionPageData fallback:', err.message);
      editorModelData = null; // fall through to the plain single-file path below
    }
  }
  if ((canEdit || canReview) && !editorModelData) {
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

  // If content came from disk cache and user has edit access, show a message
  const ghub = require('./github');
  const editUnavailable = sessionData.fromDiskCache && req.user ? true : false;
  const rateLimitReset = editUnavailable ? ghub.getRateLimitReset() : null;

  // P4/D3: open a common file directly (single-file edit) via ?editFile=<repo path>.
  // Reuses the proven single-file editor — NO include resolution, so hasShared is
  // false on the client and it behaves like editing any normal file. Admins may
  // edit any shared file; manuscript-owners may edit book/subseries files but not
  // series-level (which spans the whole series). The server is the real gate.
  let editingSharedFile = null;
  const editFileParam = req.query && req.query.editFile;
  if (editFileParam && canEdit && !sessionData.fromDiskCache) {
    const dir = editFileParam.replace(/\/[^/]+$/, '');
    const role = await firestore.getUserBookRole(req.user.email, dir);
    const isSeries = /commonSeries\.md$/.test(editFileParam);
    const allowed = role === 'admin' || (role === 'manuscript-owner' && !isSeries);
    if (allowed) {
      try {
        const f = await github.getFileContent(editFileParam);
        const fSug = await suggestions.getSuggestionsForFile(editFileParam);
        const fCom = await suggestions.getCommentsForFile(editFileParam);
        const fRep = await suggestions.getRepliesForFile(editFileParam);
        for (const s of fSug) { const r = suggestions.resolveAnchor(s, f.content); if (!r.stale) { s.resolvedFrom = r.from; s.resolvedTo = r.to; } else { s.resolvedStale = true; } }
        for (const c of fCom) { const r = suggestions.resolveAnchor(c, f.content); if (!r.stale) { c.resolvedFrom = r.from; c.resolvedTo = r.to; } else { c.resolvedStale = true; } }
        editingSharedFile = { path: editFileParam, dir, content: f.content, sha: f.sha, suggestions: fSug, comments: fCom, replies: fRep };
      } catch (err) { console.error('[editFile] load failed:', editFileParam, err.message); }
    } else {
      console.warn('[editFile] denied for', req.user.email, '→', editFileParam, '(role:', role, ')');
    }
  }

  // Audio data — load if audiobook is enabled for this book
  let audioSession = null;
  if (book.audiobook && book.audiobook.enabled) {
    try {
      audioSession = await audio.getAudioSession(book.repoPath, session.filename);
    } catch { /* degrade gracefully — no audio */ }
  }

  return {
    series,
    subseries: subseries || null,
    book,
    session: { ...session, title: sessionData.title },
    h2s,
    headings,
    allSessionHeadings,
    maxNavHeadingLevel,
    commonHtml,
    sessionHtml,
    prevSession,
    nextSession,
    editRole: canEdit ? editRole : null,
    canReview: canReview || false,
    // When editing a common file directly (?editFile), the edit target is that file
    // (single-file, no includes); otherwise it's the session (with its segment map).
    rawContent: canEdit ? (editingSharedFile ? editingSharedFile.content : sessionData.content) : null,
    contentSha: canEdit ? (editingSharedFile ? editingSharedFile.sha : sessionData.sha) : null,
    // Shared-content editing (null unless the session has @include and we're NOT in
    // single-file edit mode): the resolved editor buffer, its segment map, and the
    // committable files with SHAs. The client edits `resolvedContent` (buffer space)
    // and routes each change back to the correct file via the segment map.
    resolvedContent: (!editingSharedFile && canEdit && editorModelData) ? editorModelData.resolvedContent : null,
    segments: (!editingSharedFile && canEdit && editorModelData) ? editorModelData.segments : null,
    editorFiles: (!editingSharedFile && canEdit && editorModelData) ? editorModelData.files : null,
    editingSharedFile: editingSharedFile ? { path: editingSharedFile.path, backUrl: req.path } : null,
    pendingSuggestions: editingSharedFile ? editingSharedFile.suggestions : allPendingSuggestions,
    pendingComments: editingSharedFile ? editingSharedFile.comments : allPendingComments,
    pendingReplies: editingSharedFile ? editingSharedFile.replies : allReplies,
    sessionFilePath: canEdit ? (editingSharedFile ? editingSharedFile.path : session.path) : null,
    bookRepoPath: canEdit ? (editingSharedFile ? editingSharedFile.dir : book.repoPath) : null,
    // Always-present reader context for the per-user data layer (answers/bookmarks). Keyed to the
    // shared convergence store; independent of edit access. contentVersion = the session file SHA.
    readerContext: {
      bookPath: book.repoPath,
      sessionFile: session.filename,
      contentVersion: sessionData.sha || null,
    },
    editUnavailable,
    rateLimitReset: rateLimitReset ? rateLimitReset.toISOString() : null,
    audioSession,
  };
}

// Editor-model endpoint (shared-content editing P1). Returns the resolved editor
// buffer + segment map + referenced files (with SHAs) + annotations pre-mapped to
// buffer offsets. Backward-compatible: a session with no @include returns
// segments=[one session segment], files=[session], and only session annotations.
app.get('/api/editor-model/:seg1/:seg2?/:seg3?/:seg4?', async (req, res) => {
  try {
    const segments = [req.params.seg1, req.params.seg2, req.params.seg3, req.params.seg4].filter(Boolean);
    const tree = await content.buildContentTree();
    const resolved = content.resolveRoute(tree, segments);

    if (!resolved || resolved.type !== 'session') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const book = resolved.book;
    if (book && book.status === 'hidden') {
      const canAccess = await content.canAccessBook(req.user, book.repoPath);
      if (!canAccess) return res.status(404).json({ error: 'Session not found' });
    }

    if (!req.user) return res.status(403).json({ error: 'Not authorized' });
    const editRole = await firestore.getUserBookRole(req.user.email, book.repoPath);
    const canEdit = editRole === 'admin' || editRole === 'manuscript-owner' || editRole === 'comment-suggest';
    if (!canEdit) return res.status(403).json({ error: 'Not authorized' });

    const editorModel = require('./editor-model');
    const model = await editorModel.getEditorModel(resolved);

    if (model.fromDiskCache) {
      const ghub = require('./github');
      const reset = ghub.getRateLimitReset();
      return res.status(409).json({ error: 'Editing unavailable — content served from cache', rateLimitReset: reset ? reset.toISOString() : null });
    }

    res.json({
      ...model,
      editRole,
      canReview: editRole === 'admin' || editRole === 'manuscript-owner',
      user: { email: req.user.email, displayName: req.user.displayName, photoURL: req.user.photoURL },
    });
  } catch (err) {
    console.error('[editor-model] error:', err.message);
    res.status(500).json({ error: 'Failed to load editor model' });
  }
});

// AJAX session navigation endpoint — returns JSON with pre-rendered HTML fragments
app.get('/api/session-data/:seg1/:seg2?/:seg3?/:seg4?', async (req, res) => {
  try {
    const segments = [req.params.seg1, req.params.seg2, req.params.seg3, req.params.seg4].filter(Boolean);
    const tree = await content.buildContentTree();
    const resolved = content.resolveRoute(tree, segments);

    if (!resolved || resolved.type !== 'session') {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Permission check for hidden books
    const book = resolved.book;
    if (book && book.status === 'hidden') {
      const canAccess = await content.canAccessBook(req.user, book.repoPath);
      if (!canAccess) return res.status(404).json({ error: 'Session not found' });
    }

    const data = await getSessionPageData(req, resolved);
    const ejs = require('ejs');
    const viewsDir = path.join(__dirname, '../views');

    // Render HTML fragments via EJS partials
    // Include user (from res.locals, set by auth middleware) so sidebar-auth renders correctly
    const ejsData = { ...data, content, audioFormatDuration: audio.formatDuration, user: req.user || null };
    const [sidebarHtml, breadcrumbHtml, editToolbarHtml, sessionNavHtml] = await Promise.all([
      ejs.renderFile(path.join(viewsDir, 'partials/session-sidebar.ejs'), ejsData),
      ejs.renderFile(path.join(viewsDir, 'partials/session-breadcrumb.ejs'), ejsData),
      ejs.renderFile(path.join(viewsDir, 'partials/session-edit-toolbar.ejs'), ejsData),
      ejs.renderFile(path.join(viewsDir, 'partials/session-nav.ejs'), ejsData),
    ]);

    res.json({
      title: `${data.session.title} — ${data.book.title}`,
      sidebarHtml,
      mobileLabel: data.session.title || data.session.displayName,
      breadcrumbHtml,
      editToolbarHtml,
      sessionHtml: data.sessionHtml,
      sessionNavHtml,
      audioSession: data.audioSession,
      bookPath: data.book.repoPath.replace(/^series\//, ''),
      bookUrl: content.bookUrl(data.series, data.subseries, data.book),
      // Reader per-user data layer: the new session's context, so ajax-nav can re-attach
      // highlights/notes/bookmarks/answers without a full page reload.
      readerContext: data.readerContext || null,
      nextSessionUrl: data.nextSession ? content.sessionUrl(data.series, data.subseries, data.book, data.nextSession) : '',
      audioDurationFormatted: data.audioSession ? audio.formatDuration(data.audioSession.durationSeconds) : '',
      editData: data.editRole ? {
        rawContent: data.rawContent,
        contentSha: data.contentSha,
        editRole: data.editRole,
        sessionFilePath: data.sessionFilePath,
        bookRepoPath: data.bookRepoPath,
        resolvedContent: data.resolvedContent || null,
        segments: data.segments || null,
        editorFiles: data.editorFiles || null,
        pendingSuggestions: data.pendingSuggestions || [],
        pendingComments: data.pendingComments || [],
        pendingReplies: data.pendingReplies || [],
        canReview: data.canReview || false,
        user: req.user ? { email: req.user.email, displayName: req.user.displayName, photoURL: req.user.photoURL } : null,
      } : null,
    });
  } catch (err) {
    console.error('[ajax-nav] Session data error:', err.message);
    res.status(500).json({ error: 'Failed to load session data' });
  }
});

// "My Notes" — a personal page listing everything the signed-in user has saved across all books.
// Server renders a shell; the reader bundle fills it client-side from the shared store.
app.get('/notes', async (req, res, next) => {
  try {
    // Book metadata (title + cover + url) keyed by repoPath, so the client can render covers/titles
    // for saved annotations (which only store the bookPath).
    const tree = await content.buildContentTree();
    const books = {};
    for (const series of tree.series) {
      for (const child of series.children) {
        if (child.type === 'book') books[child.repoPath] = { title: child.title, cover: child.coverPath || null, url: content.bookUrl(series, null, child) };
        else if (child.type === 'subseries') for (const b of child.books) books[b.repoPath] = { title: b.title, cover: b.coverPath || null, url: content.bookUrl(series, child, b) };
      }
    }
    res.render('my-notes', { title: 'My Notes', booksMeta: books });
  } catch (err) { next(err); }
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

      // Audio manifest for audiobook badge
      let audioManifest = null;
      if (book.audiobook && book.audiobook.enabled) {
        try { audioManifest = await audio.getAudioManifest(book.repoPath); } catch { /* no audio */ }
      }

      res.locals.analyticsContext = {
        content_type: 'book_index',
        content_id: await contentRegistry.contentIdFor('book', book.repoPath, {
          title: book.title,
          series: series && series.title,
          subseries: subseries && subseries.title,
          book: book.title,
        }, tree),
        series: series && series.title,
        subseries: subseries && subseries.title,
        book: book && book.title,
      };
      res.render('book', {
        series,
        subseries: subseries || null,
        book,
        content,
        title: book.title,
        suggestionCounts,
        audioManifest,
        audioFormatDuration: audio.formatDuration,
      });
    } else if (resolved.type === 'session') {
      const data = await getSessionPageData(req, resolved);

      res.locals.analyticsContext = {
        content_type: 'book_session',
        content_id: await contentRegistry.contentIdFor('session', data.session && data.session.path, {
          title: data.session && data.session.title,
          series: data.series && data.series.title,
          subseries: data.subseries && data.subseries.title,
          book: data.book && data.book.title,
          sessionNumber: content.sessionNumber(data.book, data.session),
        }, tree),
        series: data.series && data.series.title,
        subseries: data.subseries && data.subseries.title,
        book: data.book && data.book.title,
        session: data.session && data.session.title,
      };
      res.render('session', {
        ...data,
        content,
        title: `${data.session.title} — ${data.book.title}`,
        audioFormatDuration: audio.formatDuration,
        // Convergence per-user data layer (answers/bookmarks). Flag-gated; off by default so this
        // ships dark until enabled. Reading is fully server-rendered and unaffected either way.
        featureUserData: process.env.FEATURE_USER_DATA === '1',
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

// Process-level safety net. Without these, a single stray rejected promise terminates the
// process (Node 15+ default) and drops every in-flight request on this instance with no
// signal beyond a default stack trace. Log with a stable "FATAL" marker so a Cloud Logging
// alert can page on it.
process.on('unhandledRejection', (reason) => {
  console.error('FATAL unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('FATAL uncaughtException:', err && err.stack ? err.stack : err);
  // Process state is undefined after an uncaught exception — exit so Cloud Run replaces the
  // instance cleanly rather than serving from a corrupted state.
  process.exit(1);
});

// Start server immediately so Cloud Run health check passes, then load bibles
app.listen(PORT, () => {
  console.log(`Noble Imprint Resource Website running on port ${PORT}`);
  contentRegistry.init(); // load stable content ids into memory (best-effort)
  bible.loadBibles().then(() => {
    console.log('Bibles loaded successfully');
  }).catch(err => {
    console.error('Failed to load Bibles:', err.message);
  });
  // Warm up disk cache 30s after startup — gives the server time to handle
  // initial requests from the deploy health check before using API budget.
  // Only runs if .file-cache/ is empty or missing (committed to git, so
  // Docker builds should include it — warm-up is only needed if cache was deleted).
  const fileCacheDir = require('path').join(__dirname, '..', '.file-cache');
  const fileCacheExists = require('fs').existsSync(fileCacheDir) &&
    require('fs').readdirSync(fileCacheDir).length > 10;
  if (!fileCacheExists) {
    setTimeout(() => {
      content.warmDiskCache().catch(err => {
        console.error('Disk cache warm-up error:', err.message);
      });
    }, 30000);
  } else {
    console.log('Disk cache already populated (' + require('fs').readdirSync(fileCacheDir).length + ' files) — skipping warm-up');
  }
});
