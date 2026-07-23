import { describe, it, expect } from 'vitest';
import { createBoundedCache } from '../server/services/boundedCache.js';

describe('createBoundedCache', () => {
  it('stores and retrieves values', () => {
    const cache = createBoundedCache({ max: 3 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('missing')).toBe(false);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the least-recently-used entry when full', () => {
    const cache = createBoundedCache({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // over capacity -> evicts 'a'
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('treats a read as recent use so it is not evicted next', () => {
    const cache = createBoundedCache({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' becomes most-recent
    cache.set('c', 3); // evicts 'b', not 'a'
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('refreshes recency and value when setting an existing key', () => {
    const cache = createBoundedCache({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // update + refresh recency
    cache.set('c', 3); // evicts 'b', not the just-refreshed 'a'
    expect(cache.get('a')).toBe(10);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('supports delete', () => {
    const cache = createBoundedCache({ max: 2 });
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.has('a')).toBe(false);
  });

  it('clears all entries', () => {
    const cache = createBoundedCache({ max: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
    // Still usable after clearing.
    cache.set('d', 4);
    expect(cache.get('d')).toBe(4);
  });

  it('falls back to a sane default when given an invalid max', () => {
    expect(createBoundedCache({ max: 0 }).max).toBe(500);
    expect(createBoundedCache({ max: -5 }).max).toBe(500);
    expect(createBoundedCache().max).toBe(500);
  });
});
