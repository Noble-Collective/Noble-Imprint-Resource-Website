const github = require('./github');
const cache = require('./cache');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const TREE_CACHE_KEY = 'content-tree';
const TREE_TTL = 10 * 60 * 1000; // 10 minutes

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
    order: meta.order || 99,
    banner: meta.banner || null,
    status,
    color: meta.color || {},
    coverPath,
    commonBook,
    sessions,
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

async function buildContentTree() {
  const cached = cache.get(TREE_CACHE_KEY);
  if (cached) return cached;

  try {
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
  cache.set(TREE_CACHE_KEY, tree, TREE_TTL);
  console.log(`Content tree built: ${series.length} series, ${series.reduce((n, s) => n + s.bookCount, 0)} books`);
  return tree;
  } catch (err) {
    console.error('Content tree build failed:', err.message);
    // Return empty tree so the site stays up — pages will show "no content"
    // instead of 500. The cache is NOT set, so the next request retries.
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
  const { content, sha } = await github.getFileContent(session.path);

  // Extract h1 title from content
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : session.displayName;

  return { content, sha, title };
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

// Gather all common content for a session (series + subseries + book level)
function gatherCommonContent(series, subseries, book) {
  const parts = [];
  if (series.commonSeries) parts.push(series.commonSeries);
  if (subseries && subseries.commonSubseries) parts.push(subseries.commonSubseries);
  if (book.commonBook) parts.push(book.commonBook);
  return parts;
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

module.exports = {
  buildContentTree,
  resolveRoute,
  bookUrl,
  sessionUrl,
  loadConfig,
  loadSessionContent,
  loadSessionTitles,
  gatherCommonContent,
  filterContentTree,
  canAccessBook,
  getAllBooks,
  slugify,
};
