const github = require('./github');

const translations = {};
let loaded = false;

async function loadBibles() {
  if (loaded) return;

  const ids = ['bsb', 'kjv'];
  for (const id of ids) {
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
                currentBook = trimmed.substring(3).trim();
              } else if (trimmed.startsWith('\\c ')) {
                currentChapter = parseInt(trimmed.substring(3));
                nextVerseStartsParagraph = true;
              } else if (/^\\(p|pmo?|m|q\d?|pi)\s*$/.test(trimmed) || trimmed === '\\b') {
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
    } catch (err) {
      console.error(`Failed to load Bible ${id}:`, err.message);
    }
  }
  loaded = true;
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

    // Parse verse spec: "1-5" or "23, 25-31, 33-35" or just "1"
    const segments = verseSpec.split(/,\s*/);

    // Get the chapter's verse objects (with paragraph/heading data)
    const ch = parseInt(chapter);
    const book = t.books.get(bookName);
    const chapterVerses = book ? book.chapters.get(ch) : null;

    let lastVerse = null;
    for (const seg of segments) {
      const rangeMatch = seg.trim().match(/^(\d+)(?:[–-](\d+))?$/);
      if (!rangeMatch) continue;

      const start = parseInt(rangeMatch[1]);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : start;

      // Mark a gap if verses aren't continuous
      if (lastVerse !== null && start !== lastVerse + 1) {
        results.push({ gap: true });
      }

      for (let v = start; v <= end; v++) {
        const key = `${bookName} ${chapter}:${v}`;
        const text = t.verses[key];
        if (text) {
          const entry = { ref: key, verse: v, text };
          // Add paragraph/heading info from chapter data
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

module.exports = {
  loadBibles,
  getVerse,
  getVerses,
  getTranslation,
  getAllTranslations,
  getBookList,
  getBookListGrouped,
  getChapter,
};
