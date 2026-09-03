const github = require('./github');
const usfmAudio = require('./usfm-audio');
const cache = require('./cache');
const fs = require('fs');
const path = require('path');

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

// Look up a range like "Acts 2:1-5" or complex refs like "Acts 2:23, 25-31"
// Returns array of { ref, text } objects
function getVerses(translation, refString) {
  const t = translations[translation];
  if (!t) return [];

  const results = [];

  // Split on semicolons for multi-book refs: "2 Samuel 7:12-16; Isaiah 11:1-5"
  const parts = refString.split(/;\s*/);

  for (const part of parts) {
    // Match "Book Chapter:Verse" pattern
    const bookMatch = part.match(/^(.+?)\s+(\d+):(.+)$/);
    if (!bookMatch) continue;

    const [, bookName, chapter, verseSpec] = bookMatch;

    // Parse verse spec: "1-5" or "23, 25-31" or "1-19:38" (cross-chapter)
    const segments = verseSpec.split(/,\s*/);

    const ch = parseInt(chapter);
    const book = t.books.get(bookName);
    const chapterVerses = book ? book.chapters.get(ch) : null;

    let lastVerse = null;
    for (const seg of segments) {
      // Cross-chapter range: "1-19:38" means chapter:1 through chapter 19:38
      const crossMatch = seg.trim().match(/^(\d+)[–-](\d+):(\d+)$/);
      if (crossMatch && book) {
        const startVerse = parseInt(crossMatch[1]);
        const endChapter = parseInt(crossMatch[2]);
        const endVerse = parseInt(crossMatch[3]);

        for (let c = ch; c <= endChapter; c++) {
          const cVerses = book.chapters.get(c);
          if (!cVerses) continue;
          const vStart = (c === ch) ? startVerse : 1;
          const vEnd = (c === endChapter) ? endVerse : Math.max(...cVerses.map(v => v.verse));

          for (let v = vStart; v <= vEnd; v++) {
            const key = `${bookName} ${c}:${v}`;
            const text = t.verses[key];
            if (text) {
              const entry = { ref: key, verse: v, text };
              const verseObj = cVerses.find(cv => cv.verse === v);
              if (verseObj) {
                if (verseObj.paragraphStart) entry.paragraphStart = true;
                if (verseObj.sectionHeading) entry.sectionHeading = verseObj.sectionHeading;
              }
              results.push(entry);
            }
          }
        }
        continue;
      }

      // Single-chapter range: "1-5" or just "1"
      const rangeMatch = seg.trim().match(/^(\d+)(?:[–-](\d+))?$/);
      if (!rangeMatch) continue;

      const start = parseInt(rangeMatch[1]);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : start;

      if (lastVerse !== null && start !== lastVerse + 1) {
        results.push({ gap: true });
      }

      for (let v = start; v <= end; v++) {
        const key = `${bookName} ${chapter}:${v}`;
        const text = t.verses[key];
        if (text) {
          const entry = { ref: key, verse: v, text };
          if (chapterVerses) {
            const verseObj = chapterVerses.find(cv => cv.verse === v);
            if (verseObj) {
              if (verseObj.paragraphStart) entry.paragraphStart = true;
              if (verseObj.sectionHeading) entry.sectionHeading = verseObj.sectionHeading;
            }
          }
          results.push(entry);
          lastVerse = v;
        }
      }
    }
  }

  return results;
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

module.exports = {
  loadBibles,
  reload,
  refreshCoverPaths,
  getServedVerses,
  getVerse,
  getVerses,
  getTranslation,
  getAllTranslations,
  getBookList,
  getBookListGrouped,
  getChapter,
  getAudioChapterBlocks,
};
