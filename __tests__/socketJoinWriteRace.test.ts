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

/**
 * A write emitted immediately after `join-session` must not be silently lost.
 *
 * Since audit H1 the join handler authorizes the socket against the persisted
 * session, so it `await`s a database read *before* assigning `socket.sessionId`.
 * Socket.IO does not wait for one handler to settle before dispatching the next
 * event on the same socket, so an `update-session` sent right behind the join
 * ran while `socket.sessionId` was still null and was dropped with **no ack and
 * no healing snapshot** — the one shape of rejection the client cannot recover
 * from, since `syncService` re-sends on a healing `session-update` and there is
 * none.
 *
 * Two real flows sit exactly in that window:
 *  - session creation: the facilitator joins and immediately writes the initial
 *    blob (the load-test harness measured this write taking a full 8 s op
 *    timeout before its retry landed),
 *  - the automatic re-join after a reconnect, i.e. every rolling update — the
 *    zero-downtime path where a dropped write costs a user's action.
 *
 * The fix must not weaken H1: a write behind a *denied* join stays refused.
 */

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

type SessionBlob = Record<string, unknown>;

const once = <T = unknown>(socket: Socket, event: string, timeout = 4000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const baseSession = (id: string, teamId: string, overrides: SessionBlob = {}): SessionBlob => ({
  id,
  teamId,
  name: 'Sprint 12 Retro',
  date: '2026-07-01',
  status: 'IN_PROGRESS',
  phase: 'ICEBREAKER',
  icebreakerQuestion: 'What made you smile this sprint?',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 3,
    oneVotePerTicket: false,
    revealBrainstorm: false,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  participants: [],
  finishedUsers: [],
  _rev: 0,
  ...overrides
});

describe('a write sent immediately after join-session (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let tokenService: ReturnType<typeof createTestTokenService>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];

  let teamAToken: string;
  let teamBToken: string;

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-join-race-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();

    for (const [id, name] of [['teamA', 'Team A'], ['teamB', 'Team B']]) {
      await dataStore.saveTeam(id, {
        id,
        name,
        passwordHash: 'x',
        members: [
          { id: 'fac1', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' },
          { id: 'par1', name: 'Paul', color: 'bg-rose-500', role: 'participant' }
        ],
        customTemplates: [],
        retrospectives: [],
        healthChecks: [],
        globalActions: [],
        teamFeedbacks: []
      });
    }

    tokenService = createTestTokenService();
    teamAToken = tokenService.createSessionToken('teamA', null);
    teamBToken = tokenService.createSessionToken('teamB', null);

    httpServer = createServer();
    io = new Server(httpServer, { path: '/socket.io' });
    registerSocketHandlers({
      io,
      dataStore,
      sessionCache: createBoundedCache({ max: 100 }),
      tokenService
    });
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

  async function connect(): Promise<Socket> {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false
    });
    clients.push(socket);
    await once(socket, 'connect');
    return socket;
  }

  it('persists the session-creating write sent in the same tick as the join', async () => {
    // The facilitator creating a retro: join a session that does not exist yet,
    // then immediately send the initial blob. No await in between — this is the
    // real ordering, both events reach the server in one read.
    const facilitator = await connect();
    facilitator.emit('join-session', {
      sessionId: 'created-in-race',
      userId: 'fac1',
      userName: 'Fiona',
      sessionToken: teamAToken
    });
    facilitator.emit('update-session', baseSession('created-in-race', 'teamA'));

    const ack = await once<{ sessionId: string; rev: number }>(facilitator, 'session-ack');
    expect(ack.sessionId).toBe('created-in-race');
    expect(ack.rev).toBeGreaterThanOrEqual(1);

    const stored = await dataStore.loadSessionState('created-in-race');
    expect(stored).toBeTruthy();
    expect(stored.teamId).toBe('teamA');
  });

  it('persists a write sent in the same tick as the re-join after a reconnect', async () => {
    // What a rolling update does: the socket comes back, syncService re-joins
    // and the pending user action goes out behind it.
    const seeder = await connect();
    seeder.emit('join-session', {
      sessionId: 'rejoin-race',
      userId: 'fac1',
      userName: 'Fiona',
      sessionToken: teamAToken
    });
    seeder.emit('update-session', baseSession('rejoin-race', 'teamA'));
    const seeded = await once<{ rev: number }>(seeder, 'session-ack');

    const reconnected = await connect();
    reconnected.emit('join-session', {
      sessionId: 'rejoin-race',
      userId: 'par1',
      userName: 'Paul',
      sessionToken: teamAToken
    });
    reconnected.emit('update-session', {
      ...baseSession('rejoin-race', 'teamA'),
      happiness: { par1: 4 },
      _rev: seeded.rev
    });

    await once(reconnected, 'session-ack');

    const stored = await dataStore.loadSessionState('rejoin-race');
    expect(stored.happiness).toEqual({ par1: 4 });
  });

  it('still refuses a write sent in the same tick as a denied join (audit H1)', async () => {
    // Waiting for the join to settle must not become a way to slip a write in
    // ahead of the authorization it depends on.
    const seeder = await connect();
    seeder.emit('join-session', {
      sessionId: 'guarded-race',
      userId: 'fac1',
      userName: 'Fiona',
      sessionToken: teamAToken
    });
    seeder.emit('update-session', baseSession('guarded-race', 'teamA'));
    await once(seeder, 'session-ack');

    const outsider = await connect();
    outsider.emit('join-session', {
      sessionId: 'guarded-race',
      userId: 'par1',
      userName: 'Outsider',
      // Genuine credential, wrong team: the join is refused.
      sessionToken: teamBToken
    });
    outsider.emit('update-session', baseSession('guarded-race', 'teamA', { phase: 'CLOSE', _rev: 99 }));

    const denial = await once<{ reason: string }>(outsider, 'join-denied');
    expect(denial.reason).toBe('forbidden');
    await settle();

    const stored = await dataStore.loadSessionState('guarded-race');
    expect(stored.phase).toBe('ICEBREAKER');
  });

  it('keeps the order of several writes queued behind one join', async () => {
    const client = await connect();
    client.emit('join-session', {
      sessionId: 'ordered-race',
      userId: 'fac1',
      userName: 'Fiona',
      sessionToken: teamAToken
    });
    client.emit('update-session', baseSession('ordered-race', 'teamA', { name: 'first' }));
    client.emit('update-session', baseSession('ordered-race', 'teamA', { name: 'second', _rev: 1 }));

    await once(client, 'session-ack');
    await settle();

    const stored = await dataStore.loadSessionState('ordered-race');
    expect(stored.name).toBe('second');
  });
});
