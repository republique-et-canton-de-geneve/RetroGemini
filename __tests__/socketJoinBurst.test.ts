// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
 * A whole session joining at once — the participants of a drained pod
 * reconnecting during a rolling update, or a room opening its invite links in
 * the same minute — with the team's "last connection" date older than the
 * debounce window.
 *
 * Every join used to load the **full** team record to read the roster, and
 * each one that saw the stale date queued its own team update: on PostgreSQL,
 * where the joins overlap, N joiners meant N queued updaters, each parsing the
 * whole record under the lock before declining. Now a join reads the roster
 * from the team summary and the refresh is shared per team on the pod, so the
 * burst costs one team write.
 *
 * The first update is held open on purpose. SQLite reads are synchronous, so
 * without the hold each join finishes inside its own socket callback and the
 * next one already sees the fresh date — the burst would serialize itself and
 * prove nothing. Held, it behaves like PostgreSQL's overlapping joins.
 */

const tokenService = createTestTokenService();
const teamToken = tokenService.createSessionToken('teamJ', null);

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

type Json = Record<string, unknown>;

const PARTICIPANTS = 12;
const SESSION_ID = 'burst-session';

const once = <T = unknown>(socket: Socket, event: string, timeout = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// About 300 KB of history: what loading the record on every join used to parse.
const history = () =>
  Array.from({ length: 40 }, (_, i) => ({
    id: `r${i}`,
    name: `Retro ${i}`,
    tickets: Array.from({ length: 30 }, (_, k) => ({ id: `r${i}-k${k}`, text: 'x'.repeat(200) }))
  }));

const session = (overrides: Json = {}): Json => ({
  id: SESSION_ID,
  teamId: 'teamJ',
  name: 'Sprint 12 Retro',
  date: '2026-10-22',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  columns: [{ id: 'c1', title: 'Went well' }],
  settings: { isAnonymous: false, maxVotes: 3, revealBrainstorm: false, timerInitial: 300, timerRunning: false },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  finishedUsers: [],
  ...overrides
});

describe('a burst of joins on one team (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];
  const staleDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  let loadTeam: ReturnType<typeof vi.fn>;
  let atomicTeamUpdate: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-join-burst-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
    await dataStore.saveTeam('teamJ', {
      id: 'teamJ',
      name: 'Team J',
      passwordHash: 'x',
      lastConnectionDate: staleDate,
      members: [
        { id: 'fac1', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' },
        ...Array.from({ length: PARTICIPANTS }, (_, i) => ({
          id: `par${i}`,
          name: `Participant ${i}`,
          color: 'bg-rose-500',
          role: 'participant'
        }))
      ],
      customTemplates: [],
      retrospectives: history(),
      healthChecks: [],
      globalActions: [],
      teamFeedbacks: []
    });
    await dataStore.saveSessionState(SESSION_ID, session());

    // The full record is read only after a summary read has thrown (a row
    // PostgreSQL's jsonb refuses); the summary never fails here.
    loadTeam = vi.fn(() => {
      throw new Error('a join must not load the full team');
    });
    atomicTeamUpdate = vi.fn(async (...args: Parameters<typeof dataStore.atomicTeamUpdate>) => {
      await gate;
      return dataStore.atomicTeamUpdate(...args);
    });
    const guardedStore = { ...dataStore, loadTeam, atomicTeamUpdate };

    httpServer = createServer();
    io = new Server(httpServer, { path: '/socket.io' });
    registerSocketHandlers({ io, dataStore: guardedStore, sessionCache: createBoundedCache({ max: 100 }), tokenService });
    await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
    port = (httpServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    releaseGate();
    clients.forEach((c) => c.close());
    io.close();
    await new Promise<void>((res) => httpServer.close(() => res()));
    await dataStore.closeDatabase();
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

  it('writes the team once, never loads the full record, and still resolves every role', async () => {
    const before = (await dataStore.loadTeamRaw('teamJ')) as Json;

    const fiona = await connect();
    const participants = await Promise.all(Array.from({ length: PARTICIPANTS }, () => connect()));

    // Every join in the same tick, each waiting for the state it is sent
    // before the team read.
    const initial = [fiona, ...participants].map((socket) => once<Json>(socket, 'session-update'));
    fiona.emit('join-session', { sessionId: SESSION_ID, userId: 'fac1', userName: 'Fiona', sessionToken: teamToken });
    participants.forEach((socket, i) =>
      socket.emit('join-session', { sessionId: SESSION_ID, userId: `par${i}`, userName: `Participant ${i}`, sessionToken: teamToken })
    );
    const [state] = await Promise.all(initial);
    await settle(200);

    releaseGate();
    await vi.waitFor(async () => {
      expect(((await dataStore.loadTeamRaw('teamJ')) as Json)._rev).toBe((before._rev as number) + 1);
    });
    await settle();

    const after = (await dataStore.loadTeamRaw('teamJ')) as Json;
    expect(after._rev).toBe((before._rev as number) + 1);
    expect(after.lastConnectionDate).not.toBe(staleDate);
    expect(atomicTeamUpdate).toHaveBeenCalledTimes(1);
    expect(loadTeam).not.toHaveBeenCalled();

    // The roles came from the summary: a participant's phase change is put
    // back while the rest of the write lands…
    const paul = participants[0];
    paul.emit('update-session', { ...structuredClone(state), phase: 'GROUP', tickets: [{ id: 't1', colId: 'c1', text: 'Card', authorId: 'par0', groupId: null, votes: [] }] });
    const paulAck = await once<{ rev: number }>(paul, 'session-ack');
    const afterParticipant = (await dataStore.loadSessionState(SESSION_ID)) as Json;
    expect(afterParticipant).toMatchObject({ phase: 'BRAINSTORM', _rev: paulAck.rev });
    expect(afterParticipant.tickets).toHaveLength(1);

    // …and the facilitator's lands whole.
    fiona.emit('update-session', { ...structuredClone(afterParticipant), phase: 'GROUP' });
    const fionaAck = await once<{ rev: number }>(fiona, 'session-ack');
    expect(await dataStore.loadSessionState(SESSION_ID)).toMatchObject({ phase: 'GROUP', _rev: fionaAck.rev });
    expect(loadTeam).not.toHaveBeenCalled();
  }, 30000);
});
