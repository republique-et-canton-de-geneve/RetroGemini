import { describe, it, expect, vi } from 'vitest';
import { createBoundedCache, parseSessionCacheMaxBytes } from '../server/services/boundedCache.js';

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

// A count alone bounds nothing when one session weighs a hundred times
// another: the cache also caps the total JSON size of what it holds.
describe('createBoundedCache: the byte cap', () => {
  const sized = (bytes: number) => ({ bytes });
  const sizeOf = (value: unknown) => (value as { bytes: number }).bytes;

  it('evicts the least-recently-used entries while the total exceeds the cap', () => {
    const cache = createBoundedCache({ max: 10, maxBytes: 100, sizeOf });
    cache.set('a', sized(40));
    cache.set('b', sized(40));
    expect(cache.bytes).toBe(80);
    cache.set('c', sized(40));
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.bytes).toBe(80);
  });

  it('keeps the entry just set even when it alone exceeds the cap', () => {
    const cache = createBoundedCache({ max: 10, maxBytes: 100, sizeOf });
    cache.set('a', sized(30));
    cache.set('huge', sized(500));
    expect(cache.has('a')).toBe(false);
    expect(cache.get('huge')).toEqual(sized(500));
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(500);
  });

  it('keeps the total right when a key is replaced, deleted or cleared', () => {
    const cache = createBoundedCache({ max: 10, maxBytes: 1000, sizeOf });
    cache.set('a', sized(40));
    cache.set('b', sized(10));
    cache.set('a', sized(70));
    expect(cache.bytes).toBe(80);
    expect(cache.delete('b')).toBe(true);
    expect(cache.bytes).toBe(70);
    expect(cache.delete('missing')).toBe(false);
    expect(cache.bytes).toBe(70);
    cache.clear();
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });

  it('still honours the count cap when the bytes are well under theirs', () => {
    const cache = createBoundedCache({ max: 2, maxBytes: 1000, sizeOf });
    cache.set('a', sized(1));
    cache.set('b', sized(1));
    cache.set('c', sized(1));
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(2);
  });

  it('uses a size the store already knows, and measures only when it does not', () => {
    const measure = vi.fn(sizeOf);
    const known = new WeakMap<object, number>();
    const hinted = { bytes: 999 };
    known.set(hinted, 25);
    const cache = createBoundedCache({ max: 10, maxBytes: 10000, sizeHint: (value: unknown) => known.get(value as object), sizeOf: measure });

    cache.set('hinted', hinted);
    expect(measure).not.toHaveBeenCalled();
    expect(cache.bytes).toBe(25);

    cache.set('copy', { ...hinted });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(cache.bytes).toBe(25 + 999);
  });

  it('measures nothing without a byte cap', () => {
    const measure = vi.fn(sizeOf);
    const hint = vi.fn(() => 5);
    const cache = createBoundedCache({ max: 10, sizeHint: hint, sizeOf: measure });
    cache.set('a', sized(40));
    expect(measure).not.toHaveBeenCalled();
    expect(hint).not.toHaveBeenCalled();
    expect(cache.bytes).toBe(0);
    expect(cache.maxBytes).toBe(Infinity);
  });

  it('measures JSON text length by default', () => {
    const cache = createBoundedCache({ max: 10, maxBytes: 1000 });
    cache.set('a', { id: 'x' });
    expect(cache.bytes).toBe(JSON.stringify({ id: 'x' }).length);
  });
});

describe('parseSessionCacheMaxBytes', () => {
  it('defaults to 32 MiB of JSON', () => {
    expect(parseSessionCacheMaxBytes({})).toBe(32 * 1024 * 1024);
  });

  it('reads a number of MiB', () => {
    expect(parseSessionCacheMaxBytes({ SESSION_CACHE_MAX_MB: '8' })).toBe(8 * 1024 * 1024);
    expect(parseSessionCacheMaxBytes({ SESSION_CACHE_MAX_MB: '0.5' })).toBe(512 * 1024);
  });

  it.each(['0', '-1', 'abc', '  ', ''])('falls back to the default for %j (there is no "off")', (raw) => {
    expect(parseSessionCacheMaxBytes({ SESSION_CACHE_MAX_MB: raw })).toBe(32 * 1024 * 1024);
  });
});
