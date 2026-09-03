const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttl = DEFAULT_TTL) {
  store.set(key, { value, expires: Date.now() + ttl });
}

function del(key) {
  store.delete(key);
}

function invalidateAll() {
  store.clear();
}

// Invalidate only cached file CONTENTS (keys prefixed 'file:'), preserving the
// content tree and directory listings. Lets the scoped /api/refresh force fresh
// file reads WITHOUT triggering a full 22-book tree rebuild (~70 GitHub calls) —
// which is what drains the rate-limit budget during the Playwright suite.
function invalidateFiles() {
  for (const key of Array.from(store.keys())) {
    if (key.startsWith('file:')) store.delete(key);
  }
}

// Invalidate only keys starting with `prefix` — lets a subsystem clear its own cache
// entries without nuking everyone else's (e.g. audio refresh shouldn't drop the content tree).
function invalidatePrefix(prefix) {
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { get, set, del, invalidateAll, invalidateFiles, invalidatePrefix };
