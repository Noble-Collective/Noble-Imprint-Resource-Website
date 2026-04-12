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

module.exports = { get, set, del, invalidateAll };
