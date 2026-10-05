// /sign-in?returnTo= and the home "Continue reading" shelf (web sign-in plan P3,
// Collective-Shared plans/2026-10-05-common-web-sign-in.md). Pure: callers pass the content tree and
// the content module (resolveRoute / sessionNumber / numberedSessionCount).

const HOME = '/';

// returnTo is navigated to after sign-in, so it may only ever be a path on this site — never another
// origin ("//host", "/\host"), a scheme, whitespace/control characters, or /sign-in itself (a loop).
function safeReturnTo(raw) {
  if (typeof raw !== 'string' || raw.length > 1000) return HOME;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return HOME;
  if (/[\u0000- \u007f]/.test(raw)) return HOME;
  if (/^\/sign-in(?:[/?#]|$)/.test(raw)) return HOME;
  return raw;
}

// The "You'll return to {label}" chip.
function returnLabel(returnTo, tree, content) {
  const path = String(returnTo || HOME).split(/[?#]/)[0];
  if (path === HOME) return 'Resource Library';
  if (path === '/notes') return 'My Notebooks';
  if (path === '/bible' || path.startsWith('/bible/')) return 'the Bible';
  const segs = path.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const hit = tree && tree.series && segs.length ? content.resolveRoute(tree, segs) : null;
  if (hit && hit.type === 'book') return hit.book.title;
  if (hit && hit.type === 'session') return `${hit.book.title} · ${hit.session.displayName}`;
  return 'the page you were on';
}

// One entry per book the visitor can see: its cover and each numbered session's place in the book
// (the Continue card's bar = "session n of total" — the reader's place, not a completion %).
function shelfFromTree(tree, content) {
  const out = [];
  const add = (book) => {
    const order = {};
    let n = 0;
    for (const s of book.sessions || []) if (content.sessionNumber(book, s) !== '') order[s.filename] = ++n;
    out.push({
      key: book.key || null,
      path: book.repoPath,
      title: book.title,
      cover: book.coverPath ? `/cover/${book.coverPath}` : null,
      total: n,
      order,
    });
  };
  for (const series of (tree && tree.series) || []) {
    for (const child of series.children || []) {
      if (child.type === 'book') add(child);
      else if (child.type === 'subseries') for (const b of child.books || []) add(b);
    }
  }
  return out;
}

module.exports = { safeReturnTo, returnLabel, shelfFromTree };
