// Library search for the websites (Collective-Shared plans/2026-10-09-library-search-terms.md §3c, P3):
//   GET /api/library/search?q=&limit=  → { q, count, results }   (count = every match; results ≤ limit)
//   GET /api/library/index             → { version, count, books } + ETag (every visible book's fields)
// The matching is the ONE shared matcher, @noble-collective/userdata/library-search (ARCHITECTURE §9d),
// vendored as src/vendor/library-search.cjs (scripts/vendor-library-search.sh). Never add matching rules
// here — change the case file + module in Collective-Shared, then re-vendor.
// The terms come from the content tree (`tree.searchTerms`, loaded by content.rebuildContentTree), the
// catalog from the same tree + the Bibles, in Library order (series, shelf, book; Bibles last).
// Hidden books are never indexed, whoever asks: the responses are public and cached.
const crypto = require('crypto');
const express = require('express');
const LS = require('../vendor/library-search.cjs');
const content = require('./content');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_RATE_LIMIT = 120; // per IP per minute, like /api/home

// The content tree + Bibles → the matcher's catalog, plus each key's page link, cover and banner.
function buildCatalog(tree, bibles) {
  const catalog = [];
  const links = new Map();
  const add = (series, subseries, book) => {
    const key = book.key || book.slug;
    catalog.push({
      key,
      id: book.key || null,
      title: book.title,
      subtitle: book.subtitle || null,
      path: book.repoPath,
      hidden: book.status === 'hidden',
      order: catalog.length,
    });
    links.set(key, {
      url: content.bookUrl(series, subseries, book),
      cover: book.coverPath ? `/cover/${book.coverPath}` : null,
      banner: book.banner || null,
    });
  };
  for (const series of (tree && tree.series) || []) {
    for (const child of series.children || []) {
      if (child.type === 'book') add(series, null, child);
      else if (child.type === 'subseries') for (const b of child.books || []) add(series, child, b);
    }
  }
  for (const b of bibles || []) {
    catalog.push({ key: b.id, id: null, title: b.title, subtitle: null, path: `bibles/${b.id}`, hidden: false, order: catalog.length });
    links.set(b.id, { url: `/bible/${b.id}`, cover: b.coverPath ? `/cover/${b.coverPath}` : null, banner: null });
  }
  return { catalog, links };
}

// One index per (tree object, Bible list): the tree object changes on every rebuild, so this is
// recomputed only when the content does.
const memo = new WeakMap();
function getIndex(tree, bibles) {
  const bibleSig = JSON.stringify((bibles || []).map((b) => [b.id, b.title, b.coverPath || null]));
  let perTree = memo.get(tree);
  if (!perTree) { perTree = new Map(); memo.set(tree, perTree); }
  const hit = perTree.get(bibleSig);
  if (hit) return hit;

  const { catalog, links } = buildCatalog(tree, bibles);
  const index = LS.resolveIndex(tree.searchTerms || null, catalog);
  for (const w of index.warnings) console.warn(`[library-search] ${w}`);
  if (index.unusedKeys.length) console.warn(`[library-search] search-terms.json keys with no visible book: ${index.unusedKeys.join(', ')}`);
  const body = {
    version: index.version,
    count: index.books.length,
    books: index.books.map((b) => ({ ...b, ...links.get(b.key) })),
  };
  const etag = `"${crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`;
  const built = { index, links, body, etag };
  perTree.clear(); // only the latest Bible list is worth keeping
  perTree.set(bibleSig, built);
  return built;
}

function parseLimit(raw) {
  const n = /^\d+$/.test(String(raw ?? '')) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// A query param as one string ("" for an array/object/absent), cut to the matcher's 100 characters.
function queryText(raw) {
  return (typeof raw === 'string' ? raw : '').trim().slice(0, LS.MAX_QUERY_LENGTH);
}

function searchLibrary(built, q, limit) {
  const all = LS.search(built.index, q);
  return {
    q,
    count: all.length,
    results: all.slice(0, limit ?? DEFAULT_LIMIT).map((r) => ({ ...r, ...built.links.get(r.key) })),
  };
}

// The two routes. getTree → the (unfiltered) content tree; getBibles → bible.getAllTranslations().
function router({ getTree, getBibles, rateLimitMax = DEFAULT_RATE_LIMIT }) {
  const r = express.Router();
  const hits = new Map();
  const common = (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    const now = Date.now();
    const key = req.ip || 'unknown';
    const hit = hits.get(key);
    if (!hit || now - hit.start > 60000) hits.set(key, { start: now, n: 1 });
    else if (++hit.n > rateLimitMax) return res.status(429).json({ error: 'rate limited' });
    if (hits.size > 5000) hits.clear();
    next();
  };

  r.get('/api/library/search', common, async (req, res) => {
    try {
      const built = getIndex(await getTree(), getBibles());
      res.set('Cache-Control', 'public, max-age=600');
      res.json(searchLibrary(built, queryText(req.query.q), parseLimit(req.query.limit)));
    } catch (err) {
      console.error('[api/library/search]', err.message);
      res.status(500).json({ error: 'search failed' });
    }
  });

  r.get('/api/library/index', common, async (req, res) => {
    try {
      const built = getIndex(await getTree(), getBibles());
      res.set('Cache-Control', 'public, max-age=600');
      res.set('ETag', built.etag);
      if (req.fresh) return res.status(304).end();
      res.json(built.body);
    } catch (err) {
      console.error('[api/library/index]', err.message);
      res.status(500).json({ error: 'index failed' });
    }
  });
  return r;
}

module.exports = { buildCatalog, getIndex, searchLibrary, parseLimit, queryText, router, DEFAULT_RATE_LIMIT };
