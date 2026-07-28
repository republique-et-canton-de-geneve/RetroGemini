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
import { createTestTokenService } from './helpers/socketAuth';

// Socket joins are authenticated since audit H1: the harness presents the
// same team session token the real client holds after login.
const tokenService = createTestTokenService();
const teamToken = tokenService.createSessionToken('teamConcurrency', null);

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
    registerSocketHandlers({ io, dataStore, sessionCache: createBoundedCache({ max: 100 }), tokenService });
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
    alice.emit('join-session', { sessionId: 'retro1', userId: 'uA', userName: 'Alice', sessionToken: teamToken });
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
    bob.emit('join-session', { sessionId: 'retro1', userId: 'uB', userName: 'Bob', sessionToken: teamToken });
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

  it('preserves the full grouped/voted/actioned/ROTI state when a stale participant acts', async () => {
    // Mirrors the reported manual scenario: Bob adds a ticket then goes offline;
    // the facilitator groups both tickets, votes, proposes+accepts an action,
    // assigns it, and records a ROTI; Bob comes back and his client pushes its
    // stale snapshot. Everything the facilitator built must survive. The two
    // tickets stay in tickets[] with a groupId (which is why the Group phase
    // still shows them and the Brainstorm phase — ungrouped-only by design —
    // looks empty). Nothing the facilitator submitted is lost.
    const alice = await connect();
    alice.emit('join-session', { sessionId: 'retro3', userId: 'uA', userName: 'Alice', sessionToken: teamToken });
    await once(alice, 'member-roster');

    const send = async (socket: Socket, session: Record<string, unknown>): Promise<number> => {
      socket.emit('update-session', session);
      const ack = await once<{ rev: number }>(socket, 'session-ack');
      return ack.rev;
    };

    const G = 'g1';
    const grouped = [
      { id: 'tB', colId: 'c1', text: 'TAB B (offline)', authorId: 'uB', groupId: G, votes: [] },
      { id: 'tA', colId: 'c1', text: 'Tab facilitateur', authorId: 'uA', groupId: G, votes: [] }
    ];
    const group = [{ id: G, title: 'Titres des onglets', colId: 'c1', votes: ['uA'] }];
    const actions = [
      { id: 'a1', text: 'Do X', assigneeId: 'uA', accepted: true },
      { id: 'a2', text: 'Maybe Y', assigneeId: null, accepted: false }
    ];

    let rev = 0;
    // Bob's ticket (added before going offline), then Alice's.
    rev = await send(alice, { id: 'retro3', phase: 'BRAINSTORM', tickets: [{ id: 'tB', colId: 'c1', text: 'TAB B (offline)', authorId: 'uB', groupId: null, votes: [] }], groups: [], roti: {}, actions: [], _rev: rev });
    rev = await send(alice, { id: 'retro3', phase: 'BRAINSTORM', tickets: [{ id: 'tB', colId: 'c1', text: 'TAB B (offline)', authorId: 'uB', groupId: null, votes: [] }, { id: 'tA', colId: 'c1', text: 'Tab facilitateur', authorId: 'uA', groupId: null, votes: [] }], groups: [], roti: {}, actions: [], _rev: rev });
    // Group, vote, review (assign accepted action), close (ROTI).
    rev = await send(alice, { id: 'retro3', phase: 'GROUP', tickets: grouped, groups: [{ id: G, title: 'Titres des onglets', colId: 'c1', votes: [] }], roti: {}, actions: [], _rev: rev });
    rev = await send(alice, { id: 'retro3', phase: 'VOTE', tickets: grouped, groups: group, roti: {}, actions: [], _rev: rev });
    rev = await send(alice, { id: 'retro3', phase: 'REVIEW', tickets: grouped, groups: group, roti: {}, actions, _rev: rev });
    rev = await send(alice, { id: 'retro3', phase: 'CLOSE', tickets: grouped, groups: group, roti: { uA: 5 }, actions, _rev: rev });
    expect(rev).toBe(6);

    // Bob returns and his client pushes its STALE brainstorm snapshot (rev 1),
    // now also carrying a freshly typed ticket.
    const bob = await connect();
    bob.emit('join-session', { sessionId: 'retro3', userId: 'uB', userName: 'Bob', sessionToken: teamToken });
    await once(bob, 'session-update');
    bob.emit('update-session', {
      id: 'retro3',
      phase: 'BRAINSTORM',
      tickets: [
        { id: 'tB', colId: 'c1', text: 'TAB B (offline)', authorId: 'uB', groupId: null, votes: [] },
        { id: 'tBnew', colId: 'c1', text: 'late ticket', authorId: 'uB', groupId: null, votes: [] }
      ],
      groups: [],
      roti: {},
      actions: [],
      _rev: 1
    });
    await new Promise((r) => setTimeout(r, 200));

    const s = await dataStore.loadSessionState('retro3') as {
      phase: string;
      _rev: number;
      tickets: Array<{ id: string; groupId: string | null }>;
      groups: Array<{ id: string; votes: string[] }>;
      actions: Array<{ id: string; assigneeId: string | null }>;
      roti: Record<string, number>;
    };

    // The completed retro is fully intact; the stale write changed nothing.
    expect(s.phase).toBe('CLOSE');
    expect(s._rev).toBe(6);

    // Both original tickets are still present AND grouped — not lost. (This is
    // the state the "empty Brainstorm / full Group" screenshots reflect.)
    const byId = Object.fromEntries(s.tickets.map((t) => [t.id, t]));
    expect(Object.keys(byId).sort()).toEqual(['tA', 'tB']);
    expect(byId.tA.groupId).toBe(G);
    expect(byId.tB.groupId).toBe(G);

    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].votes).toEqual(['uA']);
    expect(s.actions.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(s.actions.find((a) => a.id === 'a1')?.assigneeId).toBe('uA');
    expect(s.roti).toEqual({ uA: 5 });

    // Bob's late ticket was rejected with the rest of his stale blob (Step 1:
    // rejected writes are not yet replayed — that is the PR2 follow-up).
    expect(byId.tBnew).toBeUndefined();
  }, 20000);

  it('accepts an up-to-date write and broadcasts it to the other participant', async () => {
    // Fresh session to keep assertions independent.
    const alice = await connect();
    alice.emit('join-session', { sessionId: 'retro2', userId: 'uA', userName: 'Alice', sessionToken: teamToken });
    await once(alice, 'member-roster');

    const bob = await connect();
    bob.emit('join-session', { sessionId: 'retro2', userId: 'uB', userName: 'Bob', sessionToken: teamToken });
    await once(bob, 'member-roster');

    const bobUpdate = once<{ phase: string }>(bob, 'session-update');
    alice.emit('update-session', { id: 'retro2', phase: 'brainstorm', tickets: [{ id: 'x1' }], groups: [], roti: {}, actions: [], _rev: 0 });
    const ack = await once<{ rev: number }>(alice, 'session-ack');
    expect(ack.rev).toBe(1);

    const received = await bobUpdate;
    expect(received.phase).toBe('brainstorm');
  }, 20000);
});
