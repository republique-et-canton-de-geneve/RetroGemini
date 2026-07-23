// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { registerSocketHandlers } from '../server/services/socketHandlers.js';
import { createBoundedCache } from '../server/services/boundedCache.js';

// Audit PR-6 / C-6: cross-pod session-cache invalidation. A super-admin restore
// on one pod broadcasts a `sessions-invalidated` server-side event; every other
// pod must drop its in-memory session cache so no replica serves or re-persists
// pre-restore state. This test captures the server-side listener registered by
// registerSocketHandlers and verifies it clears the cache when fired.
const captureIo = () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const io = {
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      listeners.set(event, fn);
    }),
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } }
  };
  return { io, listeners };
};

describe('cross-pod sessions-invalidated listener', () => {
  it('clears the session cache when the server-side event fires', () => {
    const { io, listeners } = captureIo();
    const sessionCache = createBoundedCache({ max: 10 });
    sessionCache.set('s1', { id: 's1', _rev: 3 });
    sessionCache.set('s2', { id: 's2', _rev: 1 });

    registerSocketHandlers({ io: io as never, dataStore: {} as never, sessionCache });

    // The handler must have subscribed to the cross-pod invalidation event.
    const handler = listeners.get('sessions-invalidated');
    expect(handler).toBeTypeOf('function');

    expect(sessionCache.size).toBe(2);
    handler!();
    expect(sessionCache.size).toBe(0);
    expect(sessionCache.has('s1')).toBe(false);
    expect(sessionCache.has('s2')).toBe(false);
  });
});
