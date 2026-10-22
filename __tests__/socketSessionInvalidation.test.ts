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

    registerSocketHandlers({
      io: io as never,
      dataStore: {} as never,
      sessionCache,
      // This suite only drives the cross-pod invalidation listener; no join
      // ever reaches the token service.
      tokenService: {} as never
    });

    // The handler must have subscribed to the cross-pod invalidation event.
    const handler = listeners.get('sessions-invalidated');
    expect(handler).toBeTypeOf('function');

    expect(sessionCache.size).toBe(2);
    handler!();
    expect(sessionCache.size).toBe(0);
    expect(sessionCache.has('s1')).toBe(false);
    expect(sessionCache.has('s2')).toBe(false);
  });

  it('re-checks every joined socket against its team\'s session epoch (decision D3b)', async () => {
    // The restore on the other pod may have rolled a team's password back,
    // and with it given the team a new epoch: a socket joined under the old
    // one must leave its session here too.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { io, listeners } = captureIo();
    const emit = vi.fn();
    const socket = {
      id: 'sock-1',
      sessionId: 's1',
      userId: 'par1',
      userName: 'Paul',
      data: { authClaims: { teamId: 't1', sessionEpoch: '0', createdAt: 1 }, joinId: 'j1' },
      leave: vi.fn(),
      to: () => ({ emit: vi.fn() }),
      emit
    };
    io.sockets.sockets.set('sock-1', socket);
    const loadTeamAuthState = vi.fn(async () => ({ exists: true, sessionEpoch: 'rotated', revokedAt: 5 }));

    registerSocketHandlers({
      io: io as never,
      dataStore: { loadTeamAuthState } as never,
      sessionCache: createBoundedCache({ max: 10 }),
      tokenService: {} as never,
      revocationSweepMs: 0
    });

    listeners.get('sessions-invalidated')!();
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('join-denied', {
      sessionId: 's1',
      reason: 'unauthenticated',
      cause: 'session_revoked',
      joinId: 'j1'
    }));
    expect(loadTeamAuthState).toHaveBeenCalledWith('t1');
    expect(socket.leave).toHaveBeenCalledWith('s1');
    expect(socket.sessionId).toBeNull();
    vi.restoreAllMocks();
  });
});
