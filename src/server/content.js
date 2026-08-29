const github = require('./github');
const cache = require('./cache');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const TREE_CACHE_KEY = 'content-tree';
const TREE_TTL = 10 * 60 * 1000; // 10 minutes
const TREE_DISK_PATH = path.join(__dirname, '..', '.content-tree-cache.json');

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function sessionSortKey(filename) {
  // "4-Session1-TheGospel.md" → "4", "session1.md" → "session1"
  return filename.toLowerCase();
}

function sessionDisplayName(filename) {
  // Strip .md extension
  let name = filename.replace(/\.md$/i, '');
  // Strip leading number prefix: "4-Session1-TheGospel" → "Session1-TheGospel"
  name = name.replace(/^\d+-/, '');
  // Convert camelCase boundaries and dashes/underscores to spaces
  name = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
  return name;
}

function sessionSlug(filename) {
  let name = filename.replace(/\.md$/i, '');
  return slugify(name);
}

async function loadMeta(dirPath) {
  try {
    const { content } = await github.getFileContent(`${dirPath}/meta.json`);
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function loadCommonContent(dirPath, filename) {
  try {
    const { content } = await github.getFileContent(`${dirPath}/${filename}`);
    // Skip if effectively empty (1 byte or whitespace only)
    if (content.trim().length < 5) return null;
    return content;
  } catch {
    return null;
  }
}

async function loadSessions(bookPath) {
  try {
    const items = await github.getDirectoryContents(`${bookPath}/sessions`);
    const sessions = items
      .filter(item => item.type === 'file' && item.name.endsWith('.md'))
      .sort((a, b) => sessionSortKey(a.name).localeCompare(sessionSortKey(b.name)))
      .map(item => ({
        filename: item.name,
        slug: sessionSlug(item.name),
        displayName: sessionDisplayName(item.name),
        path: `${bookPath}/sessions/${item.name}`,
      }));
    return sessions;
  } catch {
    return [];
  }
}

async function loadBook(bookPath, dirName) {
  const meta = await loadMeta(bookPath);

  // Determine status: use explicit status field, fall back to banner for backward compat
  let status = 'public';
  if (meta.status) {
    status = meta.status;
  } else if (meta.banner === 'Hidden') {
    status = 'hidden';
  }

  const sessions = await loadSessions(bookPath);
  const commonBook = await loadCommonContent(bookPath, 'commonBook.md');

  // Check for cover
  let coverPath = null;
  try {
    const items = await github.getDirectoryContents(bookPath);
    const coverFile = items.find(i => i.name.startsWith('cover.'));
    if (coverFile) coverPath = `${bookPath}/${coverFile.name}`;
  } catch { /* ignore */ }

  return {
    type: 'book',
    dirName,
    slug: slugify(meta.title || dirName),
    title: meta.title || dirName,
    subtitle: meta.subtitle || '',
    author: meta.author || '',
    order: meta.order || 99,
    banner: meta.banner || null,
    status,
    color: meta.color || {},
    accent: meta.accent || null,
    coverPath,
    commonBook,
    sessions,
    audiobook: meta.audiobook || null,
    maxNavHeadingLevel: meta.maxNavHeadingLevel || 2,
    // Optional manual nav-number overrides, keyed by session filename:
    //   "sessionNumbers": { "03-Wisdom-Calls-Out.md": 1, "01-Front-Matter.md": false }
    // A number forces that badge; false/null suppresses it; a missing key falls
    // back to auto-detection from the H1 title (sessionNumber()).
    sessionNumbers: meta.sessionNumbers || null,
    repoPath: bookPath,
  };
}

async function isBook(dirPath) {
  // A directory is a book if it has a sessions/ subdirectory or a meta.json with a title
  try {
    const items = await github.getDirectoryContents(dirPath);
    return items.some(i => i.name === 'sessions' && i.type === 'dir');
  } catch {
    return false;
  }
}

async function loadSubseriesOrBooks(parentPath) {
  const items = await github.getDirectoryContents(parentPath);
  const dirs = items.filter(i => i.type === 'dir' && i.name !== 'images' && !i.name.startsWith('.'));

  // Check if children are books or sub-series
  const results = [];
  for (const dir of dirs) {
    const childPath = `${parentPath}/${dir.name}`;
    if (await isBook(childPath)) {
      const book = await loadBook(childPath, dir.name);
      if (book) results.push(book);
    } else {
      // It's a sub-series
      const meta = await loadMeta(childPath);
      const commonSubseries = await loadCommonContent(childPath, 'commonSubseries.md');
      const books = [];
      const subItems = await github.getDirectoryContents(childPath);
      const subDirs = subItems.filter(i => i.type === 'dir' && i.name !== 'images' && !i.name.startsWith('.'));

      for (const subDir of subDirs) {
        const bookPath = `${childPath}/${subDir.name}`;
        if (await isBook(bookPath)) {
          const book = await loadBook(bookPath, subDir.name);
          if (book) books.push(book);
        }
      }

      books.sort((a, b) => a.order - b.order);

      // Skip empty subseries (no books yet)
      if (books.length === 0) continue;

      results.push({
        type: 'subseries',
        dirName: dir.name,
        slug: slugify(meta.title || dir.name),
        title: meta.title || dir.name,
        subtitle: meta.subtitle || '',
        order: meta.order || 99,
        commonSubseries,
        books,
        repoPath: childPath,
      });
    }
  }

  results.sort((a, b) => a.order - b.order);
  return results;
}

// Read the committed on-disk tree snapshot, or null if absent/unreadable.
// `.content-tree-cache.json` is committed to the repo and refreshed nightly, so a
// freshly deployed container ships with a warm snapshot to serve instantly.
function readTreeSnapshot() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TREE_DISK_PATH, 'utf8'));
    return (parsed && Array.isArray(parsed.series)) ? parsed : null;
  } catch {
    return null;
  }
}

let treeRebuildInFlight = null;

// The real build: hits the GitHub API (~90 directory calls + per-book meta),
// enriches every session with its H1 title (so the snapshot AND the in-memory
// tree are fully populated and the home route's loadAllSessionTitles is a no-op),
// then caches in memory + on disk. This is the SLOW path (~seconds) — it must not
// run on a user's request thread while a snapshot is available (see
// buildContentTree's stale-while-revalidate).
async function rebuildContentTree() {
  console.log('Building content tree from GitHub API...');
  const seriesItems = await github.getDirectoryContents('series');
  const seriesDirs = seriesItems.filter(i => i.type === 'dir' && !i.name.startsWith('.'));

  const series = [];
  for (const dir of seriesDirs) {
    const seriesPath = `series/${dir.name}`;
    const meta = await loadMeta(seriesPath);
    const commonSeries = await loadCommonContent(seriesPath, 'commonSeries.md');
    const children = await loadSubseriesOrBooks(seriesPath);

    // Count total books
    let bookCount = 0;
    for (const child of children) {
      if (child.type === 'book') bookCount++;
      else if (child.type === 'subseries') bookCount += child.books.length;
    }

    series.push({
      type: 'series',
      dirName: dir.name,
      slug: slugify(meta.title || dir.name),
      title: meta.title || dir.name,
      subtitle: meta.subtitle || '',
      order: meta.order || 99,
      commonSeries,
      children,
      bookCount,
      repoPath: seriesPath,
    });
  }

  series.sort((a, b) => a.order - b.order);
  const tree = { series };

  // Bake H1 titles into the tree so the snapshot is complete — otherwise a cold
  // page load would still fan out one GitHub call per session to fill them in,
  // which is most of the cold-start cost this whole mechanism exists to avoid.
  try { await loadAllSessionTitles(tree); } catch (e) { console.error('Title enrichment failed:', e.message); }

  cache.set(TREE_CACHE_KEY, tree, TREE_TTL);
  // Persist to disk so the tree survives rate limits/restarts AND so a freshly
  // deployed container can serve it instantly (this file is committed to the repo).
  try { fs.writeFileSync(TREE_DISK_PATH, JSON.stringify(tree)); } catch { /* ignore disk errors */ }
  console.log(`Content tree built: ${series.length} series, ${series.reduce((n, s) => n + s.bookCount, 0)} books`);
  return tree;
}

// Kick off a background rebuild if one isn't already running. Never rejects.
function triggerTreeRebuild() {
  if (!treeRebuildInFlight) {
    treeRebuildInFlight = rebuildContentTree()
      .catch(err => { console.error('Background content tree rebuild failed:', err.message); return null; })
      .finally(() => { treeRebuildInFlight = null; });
  }
  return treeRebuildInFlight;
}

// Public accessor used by every page. Stale-while-revalidate:
//   1. in-memory cache hit         → return it (fast path on warm instances)
//   2. committed disk snapshot     → return it IMMEDIATELY and refresh from GitHub
//                                     in the background (turns a ~13s cold build
//                                     into a single file read)
//   3. no snapshot (first-ever build / missing file) → block on a full rebuild
// The snapshot only holds navigation structure (never page content, which is
// always loaded fresh per request), so the only cost of staleness is briefly-old
// nav that self-heals within seconds of the background rebuild completing.
async function buildContentTree() {
  const cached = cache.get(TREE_CACHE_KEY);
  if (cached) return cached;

  const snapshot = readTreeSnapshot();
  if (snapshot) {
    cache.set(TREE_CACHE_KEY, snapshot, 60 * 1000); // short TTL — the rebuild replaces it
    triggerTreeRebuild();
    return snapshot;
  }

  // No snapshot available: block on a full rebuild (first deploy / snapshot gone).
  try {
    return await rebuildContentTree();
  } catch (err) {
    console.error('Content tree build failed:', err.message);
    // Last-ditch: re-check for a snapshot (e.g. written by a concurrent rebuild).
    const fallback = readTreeSnapshot();
    if (fallback) {
      cache.set(TREE_CACHE_KEY, fallback, 60 * 1000);
      return fallback;
    }
    return { series: [] };
  }
}

// Resolve a URL path to a book or session in the tree
function resolveRoute(tree, pathSegments) {
  // Try to match: /:series/:bookOrSubseries/:bookOrSession/:session
  const [seriesSlug, seg2, seg3, seg4] = pathSegments;

  const seriesNode = tree.series.find(s => s.slug === seriesSlug);
  if (!seriesNode) return null;

  for (const child of seriesNode.children) {
    if (child.type === 'book' && child.slug === seg2) {
      // Direct book under series
      if (!seg3) {
        return { type: 'book', series: seriesNode, book: child };
      }
      // Session under direct book
      const session = child.sessions.find(s => s.slug === seg3);
      if (session) {
        return { type: 'session', series: seriesNode, book: child, session };
      }
    } else if (child.type === 'subseries' && child.slug === seg2) {
      // Sub-series
      const book = child.books.find(b => b.slug === seg3);
      if (book && !seg4) {
        return { type: 'book', series: seriesNode, subseries: child, book };
      }
      if (book && seg4) {
        const session = book.sessions.find(s => s.slug === seg4);
        if (session) {
          return { type: 'session', series: seriesNode, subseries: child, book, session };
        }
      }
    }
  }

  return null;
}

// Build URL for a book
function bookUrl(series, subseries, book) {
  if (subseries) return `/${series.slug}/${subseries.slug}/${book.slug}`;
  return `/${series.slug}/${book.slug}`;
}

// Build URL for a session
function sessionUrl(series, subseries, book, session) {
  if (subseries) return `/${series.slug}/${subseries.slug}/${book.slug}/${session.slug}`;
  return `/${series.slug}/${book.slug}/${session.slug}`;
}

// Load config
function loadConfig() {
  try {
    const configPath = path.join(__dirname, '../../website-config.yaml');
    const raw = fs.readFileSync(configPath, 'utf-8');
    return yaml.load(raw) || {};
  } catch {
    return {};
  }
}

// Get session content with title extraction
async function loadSessionContent(session) {
  const result = await github.getFileContent(session.path);

  // Extract h1 title from content
  const h1Match = result.content.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : session.displayName;

  return { content: result.content, sha: result.sha, title, fromDiskCache: result.fromDiskCache || false };
}

// Load h1 titles for all sessions in a book (for book detail page)
async function loadSessionTitles(book) {
  const promises = book.sessions.map(async (session) => {
    if (session._h1Loaded) return;
    try {
      const { content } = await github.getFileContent(session.path);
      const h1Match = content.match(/^#\s+(.+)$/m);
      if (h1Match) {
        session.displayName = h1Match[1].trim();
      }
      session._h1Loaded = true;
    } catch {
      // Keep filename-derived displayName as fallback
    }
  });
  await Promise.all(promises);
}

// The nav number badge for a session. A per-book meta override
// (book.sessionNumbers, keyed by session filename) wins: a number forces that
// badge, false/null suppresses it. With no override entry, fall back to
// auto-detection — the first Arabic numeral or number-word (one–twelve) in the
// H1 title (displayName). Returns a string ('' = no number). Single source of
// truth for book.ejs, session-sidebar.ejs, and numberedSessionCount.
const _WORDNUMS = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
function sessionNumber(book, session) {
  const ov = book && book.sessionNumbers;
  const key = session && (session.filename || session.name);
  if (ov && key && Object.prototype.hasOwnProperty.call(ov, key)) {
    const v = ov[key];
    return (v === false || v === null || v === '') ? '' : String(v);
  }
  const dn = (session && session.displayName) || '';
  const m = dn.match(/\b(\d+)\b/) || dn.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i);
  if (!m) return '';
  return String(_WORDNUMS[m[1].toLowerCase()] || m[1]);
}

// Count sessions that get a number in the nav / book page (override or auto-detected).
// Front/back-matter pages (Front Matter, Introduction, Conclusion, Bibliography, etc.)
// have no number and are excluded.
function numberedSessionCount(book) {
  if (!book || !book.sessions) return 0;
  return book.sessions.filter(s => sessionNumber(book, s) !== '').length;
}

// Load H1 titles for every book in a tree so numberedSessionCount is accurate on
// the home listing. Sequential per book to avoid spiking the GitHub API on a cold
// cache; idempotent (loadSessionTitles skips sessions already loaded).
async function loadAllSessionTitles(tree) {
  if (!tree || !tree.series) return;
  for (const series of tree.series) {
    for (const child of (series.children || [])) {
      if (child.type === 'book') await loadSessionTitles(child);
      else if (child.type === 'subseries') {
        for (const b of (child.books || [])) await loadSessionTitles(b);
      }
    }
  }
}

// Gather all common content for a session (series + subseries + book level)
function gatherCommonContent(series, subseries, book) {
  const parts = [];
  if (series.commonSeries) parts.push(series.commonSeries);
  if (subseries && subseries.commonSubseries) parts.push(subseries.commonSubseries);
  if (book.commonBook) parts.push(book.commonBook);
  return parts;
}

// Parse a common-content markdown string into a { KeyName: innerContent } map.
// Blocks are defined as <KeyName>\n ...content... \n</KeyName>.
function parseCommonBlocks(md) {
  const blocks = {};
  if (!md) return blocks;
  const re = /<([A-Za-z][A-Za-z0-9_-]*)>\r?\n([\s\S]*?)\r?\n<\/\1>/g;
  let m;
  while ((m = re.exec(md)) !== null) blocks[m[1]] = m[2];
  return blocks;
}

// Build the include-key map for a session, resolving book → subseries → series.
// Book-level keys win over subseries, which win over series (keys should be
// unique across the series dir, so this only matters as a documented precedence).
function gatherCommonBlocks(series, subseries, book) {
  const blocks = {};
  if (series && series.commonSeries) Object.assign(blocks, parseCommonBlocks(series.commonSeries));
  if (subseries && subseries.commonSubseries) Object.assign(blocks, parseCommonBlocks(subseries.commonSubseries));
  if (book && book.commonBook) Object.assign(blocks, parseCommonBlocks(book.commonBook));
  return blocks;
}

// Parse a common-content markdown string into an ordered list of blocks, each
// carrying the offset of its body within the source string. Mirrors
// parseCommonBlocks' regex but keeps positions (needed for the editor segment map).
function parseCommonBlocksTracked(md) {
  const blocks = [];
  if (!md) return blocks;
  const re = /<([A-Za-z][A-Za-z0-9_-]*)>\r?\n([\s\S]*?)\r?\n<\/\1>/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const bodyStart = m.index + m[0].indexOf('\n') + 1; // after the `<Key>\n` open line
    blocks.push({ key: m[1], body: m[2], srcFrom: bodyStart });
  }
  return blocks;
}

// Load a common-content file WITH its SHA (unlike loadCommonContent, which drops
// it). Returns { content, sha } or null when the file is missing/effectively empty.
async function loadCommonFileWithSha(dirPath, filename) {
  try {
    const { content, sha } = await github.getFileContent(`${dirPath}/${filename}`);
    if (content.trim().length < 5) return null;
    return { content, sha };
  } catch {
    return null;
  }
}

// Build the editor-side include index for a session, resolving book → subseries →
// series. Loads each common file WITH its SHA at its deterministic committable
// path and records, per block, where its body sits in the source file. Returns:
//   { index: { key: { body, sourceFile, sourceSha, level, srcFrom } },
//     files: [ { path, level, sha } ]  }   // only the common files that exist
// Book-level keys win over subseries, which win over series (same precedence as
// gatherCommonBlocks). `files` lists lowest-precedence first (series → book).
async function gatherCommonBlocksTracked(series, subseries, book) {
  const index = {};
  const files = [];
  const levels = [
    { obj: series, filename: 'commonSeries.md', level: 'series' },
    { obj: subseries, filename: 'commonSubseries.md', level: 'subseries' },
    { obj: book, filename: 'commonBook.md', level: 'book' },
  ];
  for (const { obj, filename, level } of levels) {
    if (!obj || !obj.repoPath) continue;
    const path = `${obj.repoPath}/${filename}`;
    const loaded = await loadCommonFileWithSha(obj.repoPath, filename);
    if (!loaded) continue;
    files.push({ path, level, sha: loaded.sha });
    for (const blk of parseCommonBlocksTracked(loaded.content)) {
      index[blk.key] = {
        body: blk.body,
        sourceFile: path,
        sourceSha: loaded.sha,
        level,
        srcFrom: blk.srcFrom,
      };
    }
  }
  return { index, files };
}

// Check if a user can access a specific book (for hidden books)
async function canAccessBook(user, bookRepoPath) {
  if (!user) return false;
  if (user.isAdmin || user.isSuperAdmin) return true;

  const firestore = require('./firestore');
  const role = await firestore.getUserBookRole(user.email, bookRepoPath);
  return role !== null;
}

// Filter content tree based on user permissions — removes hidden books the user can't see
async function filterContentTree(tree, user) {
  const firestore = require('./firestore');

  // Get user's book roles for efficient lookup
  let userBookRoles = {};
  const isAdmin = user && (user.isAdmin || user.isSuperAdmin);
  if (user && !isAdmin) {
    const userData = await firestore.getUser(user.email);
    if (userData && userData.bookRoles) {
      userBookRoles = userData.bookRoles;
    }
  }

  // Deep clone and filter
  const filtered = {
    series: tree.series.map(s => {
      const children = s.children
        .map(child => {
          if (child.type === 'book') {
            if (child.status === 'hidden' && !isAdmin) {
              const key = child.repoPath.replace(/\//g, '|');
              if (!userBookRoles[key]) return null;
            }
            return { ...child };
          } else if (child.type === 'subseries') {
            const books = child.books.filter(book => {
              if (book.status === 'hidden' && !isAdmin) {
                const key = book.repoPath.replace(/\//g, '|');
                return !!userBookRoles[key];
              }
              return true;
            }).map(b => ({ ...b }));
            return { ...child, books };
          }
          return child;
        })
        .filter(Boolean);

      // Recalculate book count
      let bookCount = 0;
      for (const child of children) {
        if (child.type === 'book') bookCount++;
        else if (child.type === 'subseries') bookCount += child.books.length;
      }

      return { ...s, children, bookCount };
    }).filter(s => s.bookCount > 0), // Remove empty series
  };

  return filtered;
}

// Get all books from the tree (flat list) — used by admin console
function getAllBooks(tree) {
  const books = [];
  for (const series of tree.series) {
    for (const child of series.children) {
      if (child.type === 'book') {
        books.push({ ...child, seriesTitle: series.title, subseriesTitle: null });
      } else if (child.type === 'subseries') {
        for (const book of child.books) {
          books.push({ ...book, seriesTitle: series.title, subseriesTitle: child.title });
        }
      }
    }
  }
  return books;
}

// Pre-fetch all session content and cover images into disk cache.
// Runs in the background after startup so the disk cache is warm
// before a rate limit can hit. Fetches sequentially to avoid spiking API usage.
async function warmDiskCache() {
  try {
    // Force a fresh build (not the snapshot-first path) so the nightly refresh job
    // regenerates and re-commits .content-tree-cache.json with current content.
    const tree = await rebuildContentTree();
    const books = getAllBooks(tree);
    let sessions = 0, covers = 0;
    for (const book of books) {
      // Cache cover image
      if (book.coverPath) {
        try {
          const ext = path.extname(book.coverPath).toLowerCase();
          if (ext === '.svg') {
            await github.getFileRaw(book.coverPath);
          } else {
            await github.getFileBinary(book.coverPath);
          }
          covers++;
        } catch { /* ignore individual failures */ }
      }
      // Cache all session content
      for (const session of (book.sessions || [])) {
        try {
          await github.getFileContent(session.path);
          sessions++;
        } catch { /* ignore individual failures */ }
      }
    }
    console.log(`Disk cache warm-up complete: ${sessions} sessions, ${covers} covers across ${books.length} books`);
  } catch (err) {
    console.error('Disk cache warm-up failed:', err.message);
  }
}

module.exports = {
  buildContentTree,
  rebuildContentTree,
  resolveRoute,
  bookUrl,
  sessionUrl,
  loadConfig,
  loadSessionContent,
  loadSessionTitles,
  loadAllSessionTitles,
  numberedSessionCount,
  sessionNumber,
  gatherCommonContent,
  parseCommonBlocks,
  gatherCommonBlocks,
  parseCommonBlocksTracked,
  gatherCommonBlocksTracked,
  filterContentTree,
  canAccessBook,
  getAllBooks,
  warmDiskCache,
  slugify,
};
