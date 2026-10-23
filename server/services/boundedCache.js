// Bounded LRU cache used for ephemeral, per-pod session state.
//
// The realtime session blob is always recoverable from the data store, so this
// cache only needs to hold the most recently active sessions. Capping it
// prevents the unbounded memory growth that would otherwise accumulate on a
// long-lived pod as hundreds of teams run retrospectives over time (the raw
// Map it replaces never evicted anything).
//
// Two caps, either of which evicts the least-recently-used entry: a count
// (`max`, SESSION_CACHE_MAX) and, optionally, the total JSON size of what is
// cached (`maxBytes`, SESSION_CACHE_MAX_MB). A count alone bounds nothing
// when one session weighs a hundred times another. The entry just set is
// never evicted, even when it alone exceeds the byte cap: it is the most
// active session, and without it every write to it would read the database
// and a throttled write could not be healed.
const DEFAULT_MAX = 500;
const DEFAULT_MAX_MB = 32;

// A memory proxy: the JSON text length in UTF-16 code units (the parsed
// object is a few times larger). A value that cannot be serialized counts
// as nothing rather than breaking the cache.
const jsonLength = (value) => {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? json.length : 0;
  } catch {
    return 0;
  }
};

// SESSION_CACHE_MAX_MB: total JSON size of the cached sessions, in MiB of
// characters (1,048,576 per MiB). Unset, blank, non-numeric or <= 0 falls back
// to the default: there is no "off" value, since the count cap alone is what
// let a few huge sessions grow a pod's heap.
const parseSessionCacheMaxBytes = (env = process.env) => {
  const raw = env.SESSION_CACHE_MAX_MB;
  const parsed = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_MB;
  return Math.floor(mb * 1024 * 1024);
};

// `sizeHint(value)` answers a known size when it has one — the data store
// remembers the text length of every session it parsed or wrote
// (`dataStore.sessionTextLength`), so the hot paths cost no second
// serialization — and anything else falls back to `sizeOf`. With no byte cap
// nothing is measured at all.
const createBoundedCache = ({ max = DEFAULT_MAX, maxBytes = Infinity, sizeHint = null, sizeOf = jsonLength } = {}) => {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : DEFAULT_MAX;
  const byteLimit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : Infinity;
  const measured = byteLimit !== Infinity;
  const store = new Map(); // key -> { value, bytes }
  let totalBytes = 0;

  const measure = (value) => {
    if (!measured) return 0;
    const hinted = typeof sizeHint === 'function' ? sizeHint(value) : undefined;
    return Number.isFinite(hinted) && hinted >= 0 ? hinted : sizeOf(value);
  };

  const remove = (key) => {
    const entry = store.get(key);
    if (!entry) return false;
    store.delete(key);
    totalBytes -= entry.bytes;
    return true;
  };

  const get = (key) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    // Refresh recency: re-insert so the key moves to the most-recent position.
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  };

  const has = (key) => store.has(key);

  const set = (key, value) => {
    remove(key);
    const bytes = measure(value);
    store.set(key, { value, bytes });
    totalBytes += bytes;
    // Evict the least-recently-used entries (first keys in insertion order)
    // while either cap is exceeded, never the entry just set.
    while ((store.size > limit || totalBytes > byteLimit) && store.size > 1) {
      remove(store.keys().next().value);
    }
    return value;
  };

  const del = (key) => remove(key);

  // Drop every entry. Used to invalidate this pod's session snapshots after a
  // super-admin restore, so stale cached sessions cannot be re-served or
  // re-persisted once the underlying store has been rewritten.
  const clear = () => {
    store.clear();
    totalBytes = 0;
  };

  return {
    get,
    set,
    has,
    delete: del,
    clear,
    get size() {
      return store.size;
    },
    get max() {
      return limit;
    },
    get bytes() {
      return totalBytes;
    },
    get maxBytes() {
      return byteLimit;
    }
  };
};

export { createBoundedCache, parseSessionCacheMaxBytes, jsonLength };
