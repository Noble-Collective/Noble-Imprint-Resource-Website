// Pure access-control + input-safety helpers for the suggestion/editing surface.
// Kept dependency-free so they can be unit-tested without Firestore/GitHub.

// Does `filePath` legitimately belong to `bookPath`? Guards the suggestion write path:
// a hunk is authorized on create/accept against its bookPath, but the commit is written to
// its filePath — so filePath must not be allowed to point at a DIFFERENT book's file.
// Allowed:
//   - anything inside the book directory (sessions/*.md, commonBook.md, meta.json, …)
//   - an ANCESTOR shared common file the book includes (commonSubseries.md / commonSeries.md
//     whose directory is a prefix of bookPath) — this is the shared-content editing feature.
// Rejected: another book's session/meta, or a common file on a different branch of the tree.
function filePathBelongsToBook(filePath, bookPath) {
  if (!filePath || !bookPath) return false;
  if (filePath === bookPath || filePath.startsWith(bookPath + '/')) return true;
  const base = filePath.split('/').pop();
  if (base === 'commonSeries.md' || base === 'commonSubseries.md') {
    const commonDir = filePath.slice(0, filePath.length - base.length - 1); // strip "/commonX.md"
    if (commonDir && (bookPath === commonDir || bookPath.startsWith(commonDir + '/'))) return true;
  }
  return false;
}

// The directory that "owns" a file for read-authorization:
//   - session file        -> its book dir (the part before /sessions/)
//   - commonBook.md        -> its book dir (parent)
//   - commonSubseries.md   -> the subseries dir (parent)
//   - commonSeries.md      -> the series dir (parent)
function owningDirForFile(filePath) {
  const i = filePath.indexOf('/sessions/');
  if (i >= 0) return filePath.substring(0, i);
  const slash = filePath.lastIndexOf('/');
  return slash >= 0 ? filePath.substring(0, slash) : filePath;
}

// Does this user's bookRoles map grant a role at `dir` or on any book UNDER it? For a book
// dir that's the exact book; for a series/subseries dir it matches any book in that group —
// exactly who legitimately edits shared content there.
function hasRoleAtOrUnder(bookRoles, dir) {
  if (!bookRoles || !dir) return false;
  const exact = dir.replace(/\//g, '|');
  const prefix = exact + '|';
  for (const key of Object.keys(bookRoles)) {
    if (bookRoles[key] && (key === exact || key.startsWith(prefix))) return true;
  }
  return false;
}

// Neutralize the specific HTML constructs that would be stored XSS if an accepted suggestion
// carried them into content (markdown-it renders with html:true). This is a targeted floor
// beyond admin review — it does NOT touch ordinary markdown or the custom tags (<Question>,
// <Callout>, <<, <image>) the renderer relies on, only script-y elements, inline event
// handlers, and javascript:/vbscript: URIs.
function neutralizeDangerousHtml(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    // Paired dangerous elements (with their content)
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Self-closing / unpaired dangerous or metadata elements
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math|link|meta|base)\b[^>]*\/?>/gi, '')
    // Inline event handlers: onclick="…" onerror='…' onload=…
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // javascript:/vbscript: URIs in href/src
    .replace(/((?:href|src)\s*=\s*["']?)\s*(?:javascript|vbscript):/gi, '$1#');
}

module.exports = { filePathBelongsToBook, owningDirForFile, hasRoleAtOrUnder, neutralizeDangerousHtml };
