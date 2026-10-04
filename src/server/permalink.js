// The ONE ecosystem permalink (Noble-Imprint-App plans/2026-10-03-live-content-sync.md §5.3):
//
//   https://resources.noblecollective.org/s/<bookKey>/<sessionKey>[/<chapterKey>]
//
//   bookKey    = the book's meta.json "id" (permanent; a Bible: "bible-<translation>")
//   sessionKey = the session's file name without ".md" (a Bible book: its USFM code, "JHN")
//   chapterKey = the "##" heading's slug within its session, "~2" for a repeat (a Bible: the
//                chapter number). The app's resource_processor chapterKeyFor is the source rule.
//
// Both products share it: with the app installed, /s/* opens the app (AASA + assetlinks in
// firebase-public/.well-known claim only /s/*); otherwise this site 302s to the session page.
// Links shared before keys (/s/<deeplinkId>/<sessionId>/<chapterId>, mostly from
// app.noblecollective.org, which now 302s here) resolve through the FROZEN table
// src/data/legacy-links.json — copied verbatim from the app repo, never edited.
const { refToBookCode } = require('./bible-validation');

const LEGACY = require('../data/legacy-links.json');

const PUBLIC_ORIGIN = 'https://resources.noblecollective.org';

// resource_processor.dart chapterKeyFor: apostrophes dropped, other non-alphanumerics → '-'.
function chapterSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

function sessionKeyOf(session) {
  return String(session.filename || '').replace(/\.md$/i, '');
}

// Every book with its route parents.
function* allBooks(tree) {
  for (const series of tree.series || []) {
    for (const child of series.children || []) {
      if (child.type === 'book') yield { series, subseries: null, book: child };
      else if (child.type === 'subseries') {
        for (const book of child.books || []) yield { series, subseries: child, book };
      }
    }
  }
}

// The book whose permanent key is bookKey. A tree snapshot from before keys were read has no
// `key`; the ids were made as slugify(title), so the slug is the fallback.
function findBookByKey(tree, bookKey) {
  let bySlug = null;
  for (const hit of allBooks(tree)) {
    if (hit.book.key === bookKey) return hit;
    if (!hit.book.key && hit.book.slug === bookKey && !bySlug) bySlug = hit;
  }
  return bySlug;
}

// A stored series locator -> its route nodes { series, subseries, book, session? }, or null. By the
// permanent bookKey first (a folder move can't break it), else by the folder path (docs written
// before keys — the shared contract's sameSeriesBook rule, Collective-Shared ARCHITECTURE §4).
function findForLocator(tree, { bookKey, bookPath, sessionFile } = {}) {
  let hit = null;
  if (bookKey) {
    for (const h of allBooks(tree)) if (h.book.key === bookKey) { hit = h; break; }
  }
  if (!hit && bookPath) {
    for (const h of allBooks(tree)) if (h.book.repoPath === bookPath) { hit = h; break; }
  }
  if (!hit) return null;
  const session = sessionFile ? (hit.book.sessions || []).find((s) => s.filename === sessionFile) || null : null;
  return { series: hit.series, subseries: hit.subseries || null, book: hit.book, session };
}

// The permanent link of a session (+ chapter), or null when the book has no key.
function permalinkFor(book, session, chapterKey) {
  const bookKey = book && (book.key || null);
  if (!bookKey || !session) return null;
  const parts = [bookKey, sessionKeyOf(session)];
  if (chapterKey) parts.push(chapterKey);
  return `${PUBLIC_ORIGIN}/s/${parts.map(encodeURIComponent).join('/')}`;
}

// What /s/<a>[/<b>[/<c>]] names: { bookKey, sessionKey, chapterKey } (keys), read either as a
// permanent link or — when <a> isn't a book we have — as an old link via the frozen table.
// Returns null when it names nothing.
function parsePermalink(tree, segs, legacy = LEGACY) {
  const [a, b, c] = segs;
  if (!a) return null;
  if (a.startsWith('bible-') || findBookByKey(tree, a)) {
    return { bookKey: a, sessionKey: b || null, chapterKey: c || null };
  }
  const old = legacy.books[a];
  if (!old) return null;
  const chapter = c != null ? old.chapters[c] : null;
  if (chapter) return { bookKey: old.bookKey, sessionKey: chapter[0], chapterKey: chapter[1] };
  return { bookKey: old.bookKey, sessionKey: (b != null && old.sessions[b]) || null, chapterKey: null };
}

// The page heading id (this site's slugs, as renderMarkdown + extractHeadings make them) for the
// chapter whose app key is chapterKey. The app counts only the session's own "##" headings
// (includes unresolved); this site slugs every h2..maxNavHeadingLevel of the RESOLVED text and
// keeps apostrophes as separators. So: find the "##" line the key names in the session source,
// then the same heading (same text, same repeat) among the resolved page's headings.
function chapterAnchor(sessionSource, resolvedContent, chapterKey, maxNavHeadingLevel = 2) {
  if (!chapterKey) return null;
  const strip = (s) => String(s || '').replace(/<!--[\s\S]*?-->/g, '');
  const h2s = [...strip(sessionSource).matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const hit = keyedHeading(h2s, chapterKey);
  if (!hit) return null;
  const counts = {};
  let found = 0;
  const pattern = /^(#{1,6})\s+(.+)$/gm;
  const src = strip(resolvedContent);
  let m;
  while ((m = pattern.exec(src)) !== null) {
    const level = m[1].length;
    if (level < 2 || level > maxNavHeadingLevel) continue;
    const text = m[2].trim();
    let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (counts[slug]) { counts[slug]++; slug = slug + '-' + counts[slug]; } else { counts[slug] = 1; }
    if (level === 2 && text === hit.text && ++found === hit.nth) return slug;
  }
  return null;
}

// The "##" heading chapterKey names: its text, and which occurrence of that exact text it is.
function keyedHeading(h2s, chapterKey) {
  const seen = {};
  const byText = {};
  for (const text of h2s) {
    byText[text] = (byText[text] || 0) + 1;
    const slug = chapterSlug(text.replace(/<icon\s+[^>]+>/g, ''));
    seen[slug] = (seen[slug] || 0) + 1;
    const key = seen[slug] === 1 ? slug : `${slug}~${seen[slug]}`;
    if (key === chapterKey) return { text, nth: byText[text] };
  }
  return null;
}

// A Bible permalink → this site's chapter URL. bookNames = the translation's book names
// (bible.getBookList). Unknown book → the translation's book list.
function bibleUrl(translationId, usfmCode, chapter, bookNames) {
  const code = String(usfmCode || '').toUpperCase();
  const name = (bookNames || []).find((n) => refToBookCode(`${n} 1:1`) === code);
  if (!name) return `/bible/${encodeURIComponent(translationId)}`;
  const ch = parseInt(chapter, 10);
  return `/bible/${encodeURIComponent(translationId)}/${encodeURIComponent(name)}` + (ch > 0 ? `?chapter=${ch}` : '');
}

module.exports = {
  LEGACY,
  PUBLIC_ORIGIN,
  chapterSlug,
  sessionKeyOf,
  findBookByKey,
  findForLocator,
  permalinkFor,
  parsePermalink,
  chapterAnchor,
  bibleUrl,
};
