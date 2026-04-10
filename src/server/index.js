const express = require('express');
const path = require('path');
const content = require('./content');
const { renderMarkdown, renderCommonContent } = require('../renderer/parser');

const app = express();
const PORT = process.env.PORT || 8080;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Static files
app.use('/static', express.static(path.join(__dirname, '../public')));

// Cover image proxy — serves cover SVGs from the resources repo
app.get('/cover/*', async (req, res) => {
  try {
    const repoPath = req.params[0];
    const github = require('./github');
    const data = await github.getFileRaw(repoPath);
    const ext = path.extname(repoPath).toLowerCase();
    const mimeTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
    res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    if (typeof data === 'string') {
      res.send(data);
    } else {
      res.send(Buffer.from(data));
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

// Homepage
app.get('/', async (req, res, next) => {
  try {
    const tree = await content.buildContentTree();
    res.render('home', {
      tree,
      content,
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

    if (resolved.type === 'book') {
      const { series, subseries, book } = resolved;
      await content.loadSessionTitles(book);
      res.render('book', {
        series,
        subseries: subseries || null,
        book,
        content,
        title: book.title,
      });
    } else if (resolved.type === 'session') {
      const { series, subseries, book, session } = resolved;
      await content.loadSessionTitles(book);
      const sessionData = await content.loadSessionContent(session);
      const commonParts = content.gatherCommonContent(series, subseries || null, book);
      const commonHtml = renderCommonContent(commonParts);
      const sessionHtml = renderMarkdown(sessionData.content, { color: book.color });

      // Find prev/next sessions
      const idx = book.sessions.findIndex(s => s.slug === session.slug);
      const prevSession = idx > 0 ? book.sessions[idx - 1] : null;
      const nextSession = idx < book.sessions.length - 1 ? book.sessions[idx + 1] : null;

      res.render('session', {
        series,
        subseries: subseries || null,
        book,
        session: { ...session, title: sessionData.title },
        commonHtml,
        sessionHtml,
        prevSession,
        nextSession,
        content,
        title: `${sessionData.title} — ${book.title}`,
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

app.listen(PORT, () => {
  console.log(`Noble Imprint Resource Website running on port ${PORT}`);
});
