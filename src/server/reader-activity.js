// Reader Activity — privacy-safe aggregate engagement over the shared converged store
// (collective-user-data on 463519). Counts highlights/notes/bookmarks/answers per book, distinct
// readers, and the most-highlighted passages. NEVER exposes note bodies, answer text, or identities —
// only counts and highlighted book-content quotes (a.ref), which are the book's own words.
const auth = require('./auth');
const content = require('./content');
const cache = require('./cache');

const CACHE_KEY = 'reader-activity';
const TTL = 5 * 60 * 1000;

async function getReaderActivity() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  const db = auth.getReaderFirestore();
  const [annSnap, ansSnap] = await Promise.all([
    db.collectionGroup('annotations').get(),
    db.collectionGroup('answers').get(),
  ]);

  const totals = { highlights: 0, notes: 0, bookmarks: 0, answers: ansSnap.size, readers: 0 };
  const readers = new Set();
  const books = new Map(); // bookPath -> { highlights, notes, bookmarks, answers, readers:Set }
  const passages = new Map(); // key -> { bookPath, sessionFile, ref, count }
  const uidOf = (doc) => (doc.ref.parent.parent && doc.ref.parent.parent.id) || '?';
  const book = (bp, uid) => {
    if (!books.has(bp)) books.set(bp, { highlights: 0, notes: 0, bookmarks: 0, answers: 0, readers: new Set() });
    const b = books.get(bp); if (uid) b.readers.add(uid); return b;
  };

  annSnap.forEach((doc) => {
    const d = doc.data() || {};
    const uid = uidOf(doc); readers.add(uid);
    const bp = (d.locator && d.locator.bookPath) || 'unknown';
    const b = book(bp, uid);
    if (d.kind === 'highlight') {
      totals.highlights++; b.highlights++;
      const ref = (d.ref || '').trim();
      if (ref) {
        const key = bp + '|' + ((d.locator && d.locator.sessionFile) || '') + '|' + ref;
        if (!passages.has(key)) passages.set(key, { bookPath: bp, sessionFile: (d.locator && d.locator.sessionFile) || '', ref, count: 0 });
        passages.get(key).count++;
      }
    } else if (d.kind === 'note') { totals.notes++; b.notes++; }
    else if (d.kind === 'bookmark') { totals.bookmarks++; b.bookmarks++; }
  });
  ansSnap.forEach((doc) => {
    const d = doc.data() || {};
    const uid = uidOf(doc); readers.add(uid);
    const bp = (d.locator && d.locator.bookPath) || 'unknown';
    book(bp, uid).answers++;
  });
  totals.readers = readers.size;

  // Resolve book titles + covers from the content tree.
  const meta = {};
  try {
    const tree = await content.buildContentTree();
    for (const bk of content.getAllBooks(tree)) meta[bk.repoPath] = { title: bk.title, cover: bk.coverPath || null };
  } catch { /* ignore — fall back to path labels */ }
  const label = (bp) => (meta[bp] && meta[bp].title) || String(bp).split('/').filter(Boolean).pop() || bp;

  const byBook = [...books.entries()].map(([bp, b]) => ({
    bookPath: bp, title: label(bp), cover: meta[bp] && meta[bp].cover,
    highlights: b.highlights, notes: b.notes, bookmarks: b.bookmarks, answers: b.answers,
    readers: b.readers.size, total: b.highlights + b.notes + b.bookmarks + b.answers,
  })).sort((x, y) => y.total - x.total);

  const topPassages = [...passages.values()]
    .sort((a, b) => b.count - a.count).slice(0, 15)
    .map((p) => ({ book: label(p.bookPath), ref: p.ref, count: p.count }));

  const result = { totals, byBook, topPassages, generatedAt: Date.now() };
  cache.set(CACHE_KEY, result, TTL);
  return result;
}

module.exports = { getReaderActivity };
