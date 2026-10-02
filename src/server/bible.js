const github = require('./github');
const usfmAudio = require('./usfm-audio');
const cache = require('./cache');
const fs = require('fs');
const path = require('path');
const scripture = require('../vendor/scripture.cjs');

const translations = {};
let loaded = false;
let reloading = null;

// Lazy caches for audio-chapter rendering (independent of the bible disk cache):
//  - contentListingCache: translationId → github dir listing of bibles/{tx}/content
//  - audioBlocksCache: `${translationId}/${filename}` → parsed { bookName, chapters }
const contentListingCache = {};
const audioBlocksCache = {};

const CACHE_DIR = path.join(__dirname, '../../.bible-cache');
const CACHE_VERSION = 1;

function getCachePath(id) {
  return path.join(CACHE_DIR, `${id}-v${CACHE_VERSION}.json`);
}

function loadFromCache(id) {
  try {
    const cachePath = getCachePath(id);
    if (!fs.existsSync(cachePath)) return null;
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    console.log(`Loaded ${id.toUpperCase()} from cache`);
    return data;
  } catch {
    return null;
  }
}

function saveToCache(id, data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(getCachePath(id), JSON.stringify(data));
    console.log(`Cached ${id.toUpperCase()} to disk`);
  } catch (err) {
    console.warn(`Failed to cache ${id}:`, err.message);
  }
}

// Populate translations[id] from a parsed disk-cache object (rebuilds the chapter Maps).
function hydrateFromCache(id, cached) {
  const books = new Map();
  for (const [bookName, bookData] of Object.entries(cached.books)) {
    const chapters = new Map();
    for (const [ch, verses] of Object.entries(bookData.chapters)) {
      chapters.set(parseInt(ch), verses);
    }
    books.set(bookName, { chapters });
  }
  translations[id] = {
    id: cached.id,
    title: cached.title,
    description: cached.description,
    version: cached.version,
    coverPath: cached.coverPath,
    verses: cached.verses,
    books,
  };
}

// The USFM \h book name occasionally differs from the references.json verse-key name
// (e.g. \h "Psalms" vs key "Psalm"; \h "Song" vs "Song of Solomon"). Resolve \h to the
// references.json name so paragraph/heading flags key-match the verse objects — otherwise
// those books silently get no paragraph breaks or section headings.
function resolveRefBookName(hName, books) {
  if (books.has(hName)) return hName;
  if (hName === 'Psalms' && books.has('Psalm')) return 'Psalm';
  for (const b of books.keys()) if (b.startsWith(hName + ' ')) return b; // "Song" → "Song of Solomon"
  return hName;
}

async function loadBibles({ force = false } = {}) {
  if (loaded && !force) return { ok: true, failed: [] };

  const ids = ['bsb', 'kjv'];
  const failed = [];
  for (const id of ids) {
    // Try loading from cache first — unless forcing a fresh fetch (e.g. after a Bible-copy
    // edit), in which case we go straight to GitHub and overwrite the snapshot on success.
    if (!force) {
      const cached = loadFromCache(id);
      if (cached) { hydrateFromCache(id, cached); continue; }
    }
    try {
      const raw = await github.getFileRaw(`bibles/${id}/references.json`);
      const str = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8');
      const data = JSON.parse(str);

      // Clean out non-verse keys (BSB has a copyright notice and "Verse" key)
      const verses = {};
      for (const [key, value] of Object.entries(data)) {
        if (/^[A-Z1-3]/.test(key) && /\d+:\d+/.test(key)) {
          verses[key] = value;
        }
      }

      // Load meta
      const metaRaw = await github.getFileContent(`bibles/${id}/meta.json`);
      const meta = JSON.parse(metaRaw.content);

      // Check for cover
      let coverPath = null;
      try {
        const items = await github.getDirectoryContents(`bibles/${id}`);
        const coverFile = items.find(i => i.name.startsWith('cover.'));
        if (coverFile) coverPath = `bibles/${id}/${coverFile.name}`;
      } catch { /* ignore */ }

      // Build book list from verse keys
      const books = new Map();
      for (const key of Object.keys(verses)) {
        const match = key.match(/^(.+?)\s+(\d+):(\d+)$/);
        if (!match) continue;
        const [, bookName, chapter, verse] = match;
        if (!books.has(bookName)) {
          books.set(bookName, { chapters: new Map() });
        }
        const book = books.get(bookName);
        const ch = parseInt(chapter);
        if (!book.chapters.has(ch)) {
          book.chapters.set(ch, []);
        }
        book.chapters.get(ch).push({ verse: parseInt(verse), text: verses[key] });
      }

      // Sort verses within each chapter
      for (const book of books.values()) {
        for (const [ch, verseList] of book.chapters) {
          verseList.sort((a, b) => a.verse - b.verse);
        }
      }

      // Parse USFM files for paragraph breaks and section headings
      const paragraphStarts = new Set(); // "BookName Ch:V" keys where a new paragraph starts
      const sectionHeadings = {};        // "BookName Ch:V" → heading text
      try {
        const usfmFiles = await github.getDirectoryContents(`bibles/${id}/content`);
        for (const file of usfmFiles.filter(f => f.name.endsWith('.SFM') || f.name.endsWith('.usfm'))) {
          try {
            const { content: usfmContent } = await github.getFileContent(`bibles/${id}/content/${file.name}`);
            let currentBook = null;
            let currentChapter = 0;
            let nextVerseStartsParagraph = false;
            let pendingHeading = null;

            for (const line of usfmContent.split('\n')) {
              const trimmed = line.trim();
              if (trimmed.startsWith('\\h ')) {
                currentBook = resolveRefBookName(trimmed.substring(3).trim(), books);
              } else if (trimmed.startsWith('\\c ')) {
                currentChapter = parseInt(trimmed.substring(3));
                nextVerseStartsParagraph = true;
              } else if (/^\\(p|pmo?|m|pi)\s*$/.test(trimmed) || trimmed === '\\b') {
                // Poetry line markers (\q1/\q2) are intentionally NOT paragraph breaks —
                // otherwise every poetic line becomes its own paragraph (the old
                // "one verse per line" look). Poetry groups into stanzas separated by \b;
                // prose still breaks on \p/\m/\pm/\pmo/\pi. This matches the audiobook
                // converter's grouping and drives both the /bible reader and the inline
                // verse-reference popup (both render bible.getVerses paragraphStart flags).
                nextVerseStartsParagraph = true;
              } else if (/^\\s[12]\s+/.test(trimmed)) {
                pendingHeading = trimmed.replace(/^\\s[12]\s+/, '').trim();
                nextVerseStartsParagraph = true;
              }

              const verseMatch = trimmed.match(/^\\v\s+(\d+)\s/);
              if (verseMatch && currentBook) {
                const v = parseInt(verseMatch[1]);
                const key = `${currentBook} ${currentChapter}:${v}`;
                if (nextVerseStartsParagraph) {
                  paragraphStarts.add(key);
                  nextVerseStartsParagraph = false;
                }
                if (pendingHeading) {
                  sectionHeadings[key] = pendingHeading;
                  pendingHeading = null;
                }
              }
            }
          } catch { /* skip individual file errors */ }
        }
      } catch (err) {
        console.warn(`Could not load USFM files for ${id}:`, err.message);
      }

      // Mark paragraph starts on verse objects
      for (const [bookName, bookData] of books) {
        for (const [ch, verseList] of bookData.chapters) {
          for (const v of verseList) {
            const key = `${bookName} ${ch}:${v.verse}`;
            v.paragraphStart = paragraphStarts.has(key);
            if (sectionHeadings[key]) {
              v.sectionHeading = sectionHeadings[key];
            }
          }
        }
      }

      translations[id] = {
        id,
        title: meta.title,
        description: meta.description || '',
        version: meta.version || id.toUpperCase(),
        coverPath,
        verses,
        books,
      };

      console.log(`Loaded ${id.toUpperCase()}: ${Object.keys(verses).length} verses, ${books.size} books, ${paragraphStarts.size} paragraph breaks`);

      // Cache to disk for fast restarts
      const cacheData = {
        id, title: meta.title, description: meta.description || '',
        version: meta.version || id.toUpperCase(), coverPath, verses,
        books: Object.fromEntries(
          Array.from(books.entries()).map(([name, data]) => [
            name, { chapters: Object.fromEntries(Array.from(data.chapters.entries())) }
          ])
        ),
      };
      saveToCache(id, cacheData);
    } catch (err) {
      console.error(`Failed to load Bible ${id}:`, err.message);
      // Fallback: keep serving the previous on-disk snapshot rather than leaving this
      // translation blank — critical when force-reloading during a GitHub rate limit,
      // since we no longer delete the snapshot before re-fetching (rebuild-then-swap).
      const cached = loadFromCache(id);
      if (cached) {
        hydrateFromCache(id, cached);
        console.warn(`[BIBLE] ${id.toUpperCase()}: fetch failed, served previous disk snapshot`);
      } else {
        failed.push(id);
      }
    }
  }
  // Only mark fully-loaded when every translation is present. On partial failure we leave
  // `loaded` false so a later call retries the missing one (survivors load from disk cache).
  loaded = failed.length === 0;
  if (failed.length) console.error(`[BIBLE] load incomplete — no text for: ${failed.join(', ')}`);
  return { ok: failed.length === 0, failed };
}

// Rebuild the in-memory + on-disk bible cache from the current repo content. Called
// after a Bible-copy commit so the rendered reader reflects the latest text instead of a
// stale snapshot. Clears the GitHub file cache first (so references.json/USFM are refetched
// fresh, not the pre-commit cached copy), then force-reloads. Rebuild-then-swap: it does
// NOT delete the disk snapshot up front — loadBibles({force}) overwrites it only on a
// successful fetch, and on failure falls back to the intact snapshot so the reader never
// goes blank during a rate limit. Coalesces concurrent calls.
async function reload() {
  if (reloading) return reloading;
  reloading = (async () => {
    try {
      cache.invalidateFiles();
      loaded = false;
      for (const id of Object.keys(translations)) delete translations[id];
      return await loadBibles({ force: true });
    } finally { reloading = null; }
  })();
  return reloading;
}

// The verse text the reader actually SERVES (in-memory ref→text map, loaded from the
// committed .bible-cache snapshot or a fresh parse). Ensures bibles are loaded. Used by
// the compare tool to verify the rendered/served copy matches the repo source. Returns
// { verses, cacheVersion, fromCache } — fromCache indicates the snapshot path was used.
async function getServedVerses(translationId) {
  await loadBibles();
  const t = translations[translationId];
  if (!t) return null;
  return { verses: t.verses, cacheVersion: CACHE_VERSION };
}

// Look up a single verse like "Acts 2:1"
function getVerse(translation, ref) {
  const t = translations[translation];
  if (!t) return null;
  return t.verses[ref] || null;
}

// Per-translation index for the shared resolver: chapter lengths from the verse keys, and the
// translation's own spelling of each canonical (BSB) book name. Rebuilt when a reload replaces t.
const passageIndex = new WeakMap();
function indexFor(t) {
  let ix = passageIndex.get(t);
  if (!ix) {
    const names = new Map();
    for (const name of t.books.keys()) names.set(scripture.canonicalBook(name) || name, name);
    ix = { names, lengths: scripture.chapterLengthsFromKeys(Object.keys(t.verses)) };
    passageIndex.set(t, ix);
  }
  return ix;
}

// The verses a reference names, through the shared resolver (Collective-Shared ARCHITECTURE §9c):
// "Genesis 1-50" (whole chapters), "Exodus 11:1-13:16" (every chapter between), "Acts 2:23, 25-31",
// "2 Samuel 7:12-16; Isaiah 11:1-5" (";" parts; a part without a book keeps the previous one's).
// Returns { verses: [{ ref, verse, text, paragraphStart?, sectionHeading? } | { gap: true }],
// continuesThrough: { book, chapter, verse } | null, problems }. With maxChapters, each part
// stops after that many chapters and continuesThrough names where it would have ended.
function getPassage(translation, refString, { maxChapters } = {}) {
  const out = { verses: [], continuesThrough: null, problems: [] };
  const t = translations[translation];
  if (!t) return out;
  const { names, lengths } = indexFor(t);

  let book = null;
  let prev = null; // the last verse added, for gaps
  for (const part of String(refString).split(/;\s*/)) {
    const m = part.trim().match(/^(?:(.+?)\s+)?(\d[\d:,\s\-–—a-c]*)$/);
    if (!m) continue;
    if (m[1]) book = scripture.canonicalBook(m[1]);
    if (!book) continue;
    const p = scripture.resolvePassage(book, m[2], lengths, maxChapters ? { maxChapters } : {});
    out.problems.push(...p.problems);
    if (p.continuesThrough && !out.continuesThrough) out.continuesThrough = { book: p.book, ...p.continuesThrough };
    const name = names.get(p.book) || p.book;
    const chapters = t.books.get(name) ? t.books.get(name).chapters : null;
    for (const { chapter, verse } of p.verses) {
      const key = `${name} ${chapter}:${verse}`;
      const text = t.verses[key];
      if (!text) continue;
      if (prev && prev.book === p.book && prev.chapter === chapter && verse !== prev.verse + 1) out.verses.push({ gap: true });
      const entry = { ref: key, verse, text };
      const verseObj = chapters && (chapters.get(chapter) || []).find(cv => cv.verse === verse);
      if (verseObj) {
        if (verseObj.paragraphStart) entry.paragraphStart = true;
        if (verseObj.sectionHeading) entry.sectionHeading = verseObj.sectionHeading;
      }
      out.verses.push(entry);
      prev = { book: p.book, chapter, verse };
    }
  }
  return out;
}

// The verses alone (see getPassage).
function getVerses(translation, refString) {
  return getPassage(translation, refString).verses;
}

function getTranslation(id) {
  return translations[id] || null;
}

function getAllTranslations() {
  return Object.values(translations).map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    version: t.version,
    coverPath: t.coverPath,
    bookCount: t.books.size,
  }));
}

function getBookList(translationId) {
  const t = translations[translationId];
  if (!t) return [];
  return Array.from(t.books.entries()).map(([name, data]) => ({
    name,
    chapterCount: data.chapters.size,
  }));
}

function getChapter(translationId, bookName, chapter) {
  const t = translations[translationId];
  if (!t) return null;
  const book = t.books.get(bookName);
  if (!book) return null;
  const verses = book.chapters.get(chapter);
  if (!verses) return null;
  return verses;
}

// Resolve a book's USFM filename from its 3-letter code via a cached content-dir listing.
// BSB files look like "562TIBSB.SFM"; KJV like "59-2TIeng-kjv.usfm" — match by code.
async function resolveUsfmFilename(translationId, code) {
  let listing = contentListingCache[translationId];
  if (!listing) {
    listing = await github.getDirectoryContents(`bibles/${translationId}/content`);
    contentListingCache[translationId] = listing;
  }
  const upper = code.toUpperCase();
  const marker = translationId === 'kjv' ? 'ENG-KJV' : 'BSB';
  const hit = listing.find(f => {
    const u = f.name.toUpperCase();
    return (u.endsWith('.SFM') || u.endsWith('.USFM')) && u.includes(upper) && u.includes(marker);
  });
  return hit ? hit.name : null;
}

/**
 * Blocks for rendering an audio-enabled chapter (section headings + stanza paragraphs
 * with <sup> verse numbers), produced by the SAME parser the audio timestamps came from
 * (usfm-audio.js) so the DOM block order matches. `code` is the 3-letter USFM book code
 * (from the audio manifest's bookPath). Returns [{type,text}] or null. Fetches + parses
 * the book's USFM on first use, then serves from an in-memory cache.
 */
async function getAudioChapterBlocks(translationId, code, chapter) {
  try {
    const filename = await resolveUsfmFilename(translationId, code);
    if (!filename) return null;
    const key = `${translationId}/${filename}`;
    let parsed = audioBlocksCache[key];
    if (!parsed) {
      const { content } = await github.getFileContent(`bibles/${translationId}/content/${filename}`);
      parsed = usfmAudio.parseUsfmBook(content);
      audioBlocksCache[key] = parsed;
    }
    const ch = parsed.chapters.find(c => c.num === chapter);
    return ch ? ch.blocks : null;
  } catch (err) {
    console.error(`[bible] Failed to load USFM audio blocks (${translationId}/${code}):`, err.message);
    return null;
  }
}

const NT_BOOKS = new Set([
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
  '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
  '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
  'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
]);

function getBookListGrouped(translationId) {
  const books = getBookList(translationId);
  const ot = [];
  const nt = [];
  for (const b of books) {
    if (NT_BOOKS.has(b.name)) {
      nt.push(b);
    } else {
      ot.push(b);
    }
  }
  return { ot, nt };
}

// Re-discover cover paths from GitHub (called on /api/refresh)
async function refreshCoverPaths() {
  const ids = Object.keys(translations);
  for (const id of ids) {
    try {
      const items = await github.getDirectoryContents(`bibles/${id}`);
      const coverFile = items.find(i => i.name.startsWith('cover.'));
      const newPath = coverFile ? `bibles/${id}/${coverFile.name}` : null;
      if (translations[id] && newPath !== translations[id].coverPath) {
        console.log(`[BIBLE] Cover path updated: ${translations[id].coverPath} → ${newPath}`);
        translations[id].coverPath = newPath;
      }
    } catch { /* ignore */ }
  }
}

// True once at least the primary translation is loaded and serving verses (for /healthz).
function isReady() {
  return loaded && !!translations['bsb'];
}

module.exports = {
  loadBibles,
  isReady,
  reload,
  refreshCoverPaths,
  getServedVerses,
  getVerse,
  getVerses,
  getPassage,
  getTranslation,
  getAllTranslations,
  getBookList,
  getBookListGrouped,
  getChapter,
  getAudioChapterBlocks,
};
