// Bounded LRU cache used for ephemeral, per-pod session state.
//
// The realtime session blob is always recoverable from the data store, so this
// cache only needs to hold the most recently active sessions. Capping it
// prevents the unbounded memory growth that would otherwise accumulate on a
// long-lived pod as hundreds of teams run retrospectives over time (the raw
// Map it replaces never evicted anything).
const DEFAULT_MAX = 500;

const createBoundedCache = ({ max = DEFAULT_MAX } = {}) => {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : DEFAULT_MAX;
  const store = new Map();

  const get = (key) => {
    if (!store.has(key)) return undefined;
    const value = store.get(key);
    // Refresh recency: re-insert so the key moves to the most-recent position.
    store.delete(key);
    store.set(key, value);
    return value;
  };

  const has = (key) => store.has(key);

  const set = (key, value) => {
    if (store.has(key)) {
      store.delete(key);
    } else if (store.size >= limit) {
      // Evict the least-recently-used entry (first key in insertion order).
      const oldest = store.keys().next().value;
      if (oldest !== undefined) {
        store.delete(oldest);
      }
    }
    store.set(key, value);
    return value;
  };

  const del = (key) => store.delete(key);

  // Drop every entry. Used to invalidate this pod's session snapshots after a
  // super-admin restore, so stale cached sessions cannot be re-served or
  // re-persisted once the underlying store has been rewritten.
  const clear = () => store.clear();

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
    }
  };
};

export { createBoundedCache };
