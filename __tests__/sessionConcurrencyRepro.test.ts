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
import { registerSocketHandlers } from '../server/services/socketHandlers.js';

// End-to-end reproduction of the 21-participant data-loss bug, with simulated
// socket clients instead of 21 humans. One client drives a retro to completion
// (review-step action assignments + ROTI + action proposals); then a stale
// participant's client fires an automatic sync built on an earlier snapshot
// (the exact catastrophe trigger). The test proves the completed retro survives
// because the server rejects the stale write.
//
// On the pre-fix code (saveSessionState blindly upserts, no compare-and-swap)
// the stale write is accepted and broadcast, reverting the session to 'discuss'
// and wiping the ROTI/actions, so this test fails.

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

const once = <T = unknown>(socket: Socket, event: string, timeout = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

describe('session concurrency: a stale write cannot clobber a completed retro', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-repro-'));
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

  it('keeps the completed state when a stale participant syncs an old snapshot', async () => {
    const alice = await connect();
    alice.emit('join-session', { sessionId: 'retro1', userId: 'uA', userName: 'Alice' });
    await once(alice, 'member-roster');

    // Alice drives the retro forward, waiting for each server ack (the new rev).
    const send = async (socket: Socket, session: Record<string, unknown>): Promise<number> => {
      socket.emit('update-session', session);
      const ack = await once<{ rev: number }>(socket, 'session-ack');
      return ack.rev;
    };

    let rev = 0;
    rev = await send(alice, { id: 'retro1', phase: 'brainstorm', tickets: [{ id: 't1' }], groups: [], roti: {}, actions: [], _rev: rev });
    rev = await send(alice, { id: 'retro1', phase: 'discuss', tickets: [{ id: 't1' }, { id: 't2' }], groups: [], roti: {}, actions: [], _rev: rev });
    rev = await send(alice, { id: 'retro1', phase: 'review', tickets: [{ id: 't1' }, { id: 't2' }], groups: [], roti: {}, actions: [{ id: 'a1', assigneeId: 'uA' }], _rev: rev });
    rev = await send(alice, {
      id: 'retro1',
      phase: 'close',
      tickets: [{ id: 't1' }, { id: 't2' }],
      groups: [],
      roti: { uA: 5 },
      actions: [{ id: 'a1', assigneeId: 'uA' }],
      actionProposals: [{ id: 'p1', text: 'Do the thing' }],
      _rev: rev
    });
    expect(rev).toBe(4);

    // Bob joins late; the server sends him the authoritative completed state.
    const bob = await connect();
    bob.emit('join-session', { sessionId: 'retro1', userId: 'uB', userName: 'Bob' });
    const bobInitial = await once<{ phase: string }>(bob, 'session-update');
    expect(bobInitial.phase).toBe('close');

    // Capture every session-update each client receives from here on. With the
    // fix, Alice receives nothing (the stale write is rejected) and Bob receives
    // one heal with the authoritative state. Without the fix, Alice receives a
    // reverting broadcast and storage is clobbered — the assertions below fail.
    const aliceUpdates: Array<{ phase?: string }> = [];
    const bobUpdates: Array<{ phase?: string }> = [];
    alice.on('session-update', (s: { phase?: string }) => aliceUpdates.push(s));
    bob.on('session-update', (s: { phase?: string }) => bobUpdates.push(s));

    // Bob's client fires an automatic sync built on a STALE snapshot (rev 2,
    // from the 'discuss' phase) — the catastrophe trigger.
    bob.emit('update-session', {
      id: 'retro1',
      phase: 'discuss',
      tickets: [{ id: 't1' }, { id: 't2' }],
      groups: [],
      roti: {},
      actions: [],
      _rev: 2
    });

    // Let the write be processed and any broadcast/heal settle.
    await new Promise((r) => setTimeout(r, 250));

    // The completed retro survived: Alice never reverted, and Bob was healed.
    expect(aliceUpdates).toHaveLength(0);
    expect(bobUpdates.map((u) => u.phase)).toEqual(['close']);

    const stored = await dataStore.loadSessionState('retro1') as {
      phase: string;
      roti: Record<string, number>;
      actions: unknown[];
      actionProposals: unknown[];
      _rev: number;
    };
    expect(stored.phase).toBe('close');
    expect(stored.roti).toEqual({ uA: 5 });
    expect(stored.actions).toHaveLength(1);
    expect(stored.actionProposals).toHaveLength(1);
    expect(stored._rev).toBe(4);
  }, 20000);

  it('accepts an up-to-date write and broadcasts it to the other participant', async () => {
    // Fresh session to keep assertions independent.
    const alice = await connect();
    alice.emit('join-session', { sessionId: 'retro2', userId: 'uA', userName: 'Alice' });
    await once(alice, 'member-roster');

    const bob = await connect();
    bob.emit('join-session', { sessionId: 'retro2', userId: 'uB', userName: 'Bob' });
    await once(bob, 'member-roster');

    const bobUpdate = once<{ phase: string }>(bob, 'session-update');
    alice.emit('update-session', { id: 'retro2', phase: 'brainstorm', tickets: [{ id: 'x1' }], groups: [], roti: {}, actions: [], _rev: 0 });
    const ack = await once<{ rev: number }>(alice, 'session-ack');
    expect(ack.rev).toBe(1);

    const received = await bobUpdate;
    expect(received.phase).toBe('brainstorm');
  }, 20000);
});
