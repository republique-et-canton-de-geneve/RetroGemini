// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createBoundedCache } from '../server/services/boundedCache.js';
import {
  registerSocketHandlers,
  parseRosterBroadcastConfig,
  createRosterBroadcaster
} from '../server/services/socketHandlers.js';

// Audit R28: roster rebroadcast is O(N^2) during a reconnect stampede — every
// join/leave triggers a cross-pod fetchSockets() + a full-roster broadcast to
// the whole room, so N near-simultaneous rejoins after a rolling update produce
// N cross-pod fetches and ~N^2 roster messages. Coalescing collapses a burst to
// at most one rebuild + one broadcast per room per debounce window while the
// immediate member-joined/left signals still drive incremental UI, and the
// roster (rebuilt at fire time) stays accurate.

describe('parseRosterBroadcastConfig (unit)', () => {
  it('defaults to a 250ms window when unset', () => {
    expect(parseRosterBroadcastConfig({})).toBe(250);
  });

  it('honors an explicit window, including 0 (coalescing disabled)', () => {
    expect(parseRosterBroadcastConfig({ ROSTER_BROADCAST_DEBOUNCE_MS: '500' })).toBe(500);
    expect(parseRosterBroadcastConfig({ ROSTER_BROADCAST_DEBOUNCE_MS: '0' })).toBe(0);
  });

  it('falls back to the default for invalid or negative values', () => {
    expect(parseRosterBroadcastConfig({ ROSTER_BROADCAST_DEBOUNCE_MS: '-5' })).toBe(250);
    expect(parseRosterBroadcastConfig({ ROSTER_BROADCAST_DEBOUNCE_MS: 'nope' })).toBe(250);
  });
});

// A manual timer queue so the coalescing logic is tested without wall-clock
// waits: setTimer stashes the callback, runAll fires every pending callback.
const makeFakeTimers = () => {
  const queue = new Map<number, () => void>();
  let nextId = 0;
  const setTimer = ((cb: () => void) => {
    const id = ++nextId;
    queue.set(id, cb);
    return { id, unref() {} };
  }) as unknown as typeof setTimeout;
  const clearTimer = ((handle: { id: number }) => {
    if (handle) queue.delete(handle.id);
  }) as unknown as typeof clearTimeout;
  const runAll = () => {
    const cbs = [...queue.values()];
    queue.clear();
    cbs.forEach((cb) => cb());
  };
  return { setTimer, clearTimer, runAll, size: () => queue.size };
};

describe('createRosterBroadcaster (unit)', () => {
  it('coalesces a burst of schedules for one room into a single broadcast', () => {
    const { setTimer, clearTimer, runAll } = makeFakeTimers();
    const calls: string[] = [];
    const broadcaster = createRosterBroadcaster({
      delayMs: 250,
      broadcast: (s: string) => calls.push(s),
      setTimer,
      clearTimer
    });

    // 50 near-simultaneous rejoins (the stampede) — nothing fires yet, and they
    // all fold into one pending window.
    for (let i = 0; i < 50; i++) broadcaster.schedule('room-1');
    expect(calls).toEqual([]);
    expect(broadcaster.pendingCount()).toBe(1);

    runAll();
    expect(calls).toEqual(['room-1']); // one broadcast for 50 joins, not 50
    expect(broadcaster.pendingCount()).toBe(0);

    // A later event opens a fresh window (every join is reflected within one).
    broadcaster.schedule('room-1');
    expect(broadcaster.pendingCount()).toBe(1);
    runAll();
    expect(calls).toEqual(['room-1', 'room-1']);
  });

  it('keeps rooms independent (one coalesced broadcast each)', () => {
    const { setTimer, clearTimer, runAll } = makeFakeTimers();
    const calls: string[] = [];
    const broadcaster = createRosterBroadcaster({
      delayMs: 250,
      broadcast: (s: string) => calls.push(s),
      setTimer,
      clearTimer
    });

    for (let i = 0; i < 10; i++) {
      broadcaster.schedule('room-a');
      broadcaster.schedule('room-b');
    }
    expect(broadcaster.pendingCount()).toBe(2);

    runAll();
    expect(calls.filter((s) => s === 'room-a')).toHaveLength(1);
    expect(calls.filter((s) => s === 'room-b')).toHaveLength(1);
  });

  it('broadcasts synchronously with no pending timers when disabled (delayMs 0)', () => {
    const { setTimer, clearTimer } = makeFakeTimers();
    const calls: string[] = [];
    const broadcaster = createRosterBroadcaster({
      delayMs: 0,
      broadcast: (s: string) => calls.push(s),
      setTimer,
      clearTimer
    });

    broadcaster.schedule('room-1');
    broadcaster.schedule('room-1');
    broadcaster.schedule('room-1');
    // Legacy behaviour: each schedule broadcasts immediately, nothing queued.
    expect(calls).toEqual(['room-1', 'room-1', 'room-1']);
    expect(broadcaster.pendingCount()).toBe(0);
  });

  it('swallows a rejected async broadcast so one bad rebuild cannot crash the loop', async () => {
    const { setTimer, clearTimer, runAll } = makeFakeTimers();
    const broadcaster = createRosterBroadcaster({
      delayMs: 250,
      broadcast: () => Promise.reject(new Error('fetchSockets blew up')),
      setTimer,
      clearTimer
    });
    broadcaster.schedule('room-1');
    expect(() => runAll()).not.toThrow();
    // Give the rejected promise a tick to settle without an unhandled rejection.
    await Promise.resolve();
  });
});

// --- integration: real socket.io server end-to-end -------------------------

const once = <T = unknown>(socket: Socket, event: string, timeout = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PG_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_HOST',
  'POSTGRESQL_SERVICE_HOST',
  'POSTGRES_USER',
  'POSTGRESQL_USER',
  'POSTGRES_PASSWORD',
  'POSTGRESQL_PASSWORD',
  'POSTGRES_DB',
  'POSTGRESQL_DATABASE',
  'DATA_STORE_PATH'
];

type RosterMember = { id: string; name: string };

describe('roster coalescing (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];
  const WINDOW_MS = 200;

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    savedEnv.ROSTER_BROADCAST_DEBOUNCE_MS = process.env.ROSTER_BROADCAST_DEBOUNCE_MS;
    process.env.ROSTER_BROADCAST_DEBOUNCE_MS = String(WINDOW_MS);

    dir = mkdtempSync(join(tmpdir(), 'retro-roster-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();

    httpServer = createServer();
    io = new Server(httpServer, { path: '/socket.io' });
    registerSocketHandlers({ io, dataStore, sessionCache: createBoundedCache({ max: 100 }) });
    await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
    port = (httpServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    io.close();
    await new Promise<void>((res) => httpServer.close(() => res()));
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const connect = async (): Promise<Socket> => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false
    });
    clients.push(socket);
    await once(socket, 'connect');
    return socket;
  };

  it('collapses a join stampede into far fewer roster broadcasts while staying accurate', async () => {
    const sessionId = 'stampede';

    // An observer already in the room. Consume its own initial roster first.
    const observer = await connect();
    observer.emit('join-session', { sessionId, userId: 'obs', userName: 'Observer' });
    await once(observer, 'member-roster');

    // Count the roster broadcasts the observer receives while a burst rejoins.
    let rosterEvents = 0;
    let lastRoster: RosterMember[] = [];
    observer.on('member-roster', (roster: RosterMember[]) => {
      rosterEvents += 1;
      lastRoster = roster;
    });

    // Six clients join within the same debounce window (the reconnect burst).
    const N = 6;
    const joiners: Socket[] = [];
    for (let i = 0; i < N; i++) {
      const s = await connect();
      joiners.push(s);
      s.emit('join-session', { sessionId, userId: `u${i}`, userName: `User ${i}` });
    }

    // Wait past the window for the coalesced broadcast(s) to fire and settle.
    await settle(WINDOW_MS + 400);

    // Coalescing: the observer saw strictly fewer roster events than joiners
    // (without it there would be one per join, i.e. >= N).
    expect(rosterEvents).toBeGreaterThan(0);
    expect(rosterEvents).toBeLessThan(N);

    // Accuracy: the final roster the observer holds contains everyone.
    const ids = lastRoster.map((m) => m.id).sort();
    expect(ids).toEqual(['obs', 'u0', 'u1', 'u2', 'u3', 'u4', 'u5']);
  }, 20000);

  it('reflects a departure in the coalesced roster', async () => {
    const sessionId = 'departure';

    const a = await connect();
    a.emit('join-session', { sessionId, userId: 'a', userName: 'Alice' });
    await once(a, 'member-roster');

    const b = await connect();
    b.emit('join-session', { sessionId, userId: 'b', userName: 'Bob' });

    // Wait for the coalesced roster that includes both.
    await settle(WINDOW_MS + 300);

    let lastRoster: RosterMember[] = [];
    a.on('member-roster', (roster: RosterMember[]) => {
      lastRoster = roster;
    });

    // Bob leaves; the coalesced roster rebuilt at fire time drops him.
    b.emit('leave-session');
    await settle(WINDOW_MS + 300);

    const ids = lastRoster.map((m) => m.id).sort();
    expect(ids).toEqual(['a']);
  }, 20000);
});
