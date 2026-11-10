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
import { createTokenService } from '../server/services/sessionTokens.js';
import { registerSocketHandlers } from '../server/services/socketHandlers.js';
import { secureCompare } from '../server/services/security.js';

/**
 * The relay of the live "is typing" signal (`participant-activity`, 43.0).
 *
 * Any team credential, an invitation-link login included, can join a session
 * and send the signal, and the server relayed whatever it was sent to the
 * whole room: a '__proto__' made every expanded participants panel's label an
 * object, React threw, and the screens went blank (there is no error
 * boundary); a string of any size went to each client. The relay now passes
 * on only a kind the clients draw, or `null`, and only from a joined socket
 * that says who it is. The payload keeps the three fields every client
 * release reads.
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
type ActivityEvent = { userId: unknown; userName: unknown; activity: unknown };

const once = <T = unknown>(socket: Socket, event: string, timeout = 3000): Promise<T> =>
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
  phase: 'BRAINSTORM',
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
  finishedUsers: [],
  _rev: 0,
  ...overrides
});

describe('participant-activity relay (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let tokenService: ReturnType<typeof createTokenService>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];

  let teamAToken: string;
  // The facilitator's socket (it seeded the session) and the participant's.
  let fac1: Socket;
  let par1: Socket;

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-activity-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();

    await dataStore.saveTeam('teamA', {
      id: 'teamA',
      name: 'Team A',
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

    tokenService = createTokenService({
      secureCompare,
      superAdminPassword: 'unused',
      tokenSecret: 'test-signing-secret-for-participant-activity'
    });
    teamAToken = tokenService.createSessionToken('teamA', null);

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

    // Seed a real persisted session owned by teamA, joined as the facilitator.
    fac1 = await connect();
    fac1.emit('join-session', {
      sessionId: 'live-session',
      userId: 'fac1',
      userName: 'Fiona',
      sessionToken: teamAToken
    });
    await once(fac1, 'member-roster');
    fac1.emit('update-session', baseSession('live-session', 'teamA'));
    await once(fac1, 'session-ack');

    // The participant joins the same session with the team's token.
    par1 = await connect();
    par1.emit('join-session', {
      sessionId: 'live-session',
      userId: 'par1',
      userName: 'Paul',
      sessionToken: teamAToken
    });
    await once(par1, 'member-roster');
    await settle();
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

  // Records everything a socket receives, so "relayed nothing" is provable.
  const recordAll = (socket: Socket) => {
    const events: { event: string; payload: unknown }[] = [];
    socket.onAny((event: string, payload: unknown) => events.push({ event, payload }));
    return events;
  };

  const activitiesIn = (events: { event: string; payload: unknown }[]) =>
    events.filter((entry) => entry.event === 'participant-activity');

  // What the facilitator receives when the participant sends `payload`.
  const relayed = async (payload: unknown, missing = false): Promise<ActivityEvent> => {
    const received = once<ActivityEvent>(fac1, 'participant-activity');
    if (missing) par1.emit('participant-activity');
    else par1.emit('participant-activity', payload);
    return received;
  };

  it('relays a kind to the rest of the session, never back to its sender', async () => {
    const parEvents = recordAll(par1);

    expect(await relayed({ activity: 'brainstorm' })).toEqual({ userId: 'par1', userName: 'Paul', activity: 'brainstorm' });
    expect(await relayed({ activity: 'proposal' })).toEqual({ userId: 'par1', userName: 'Paul', activity: 'proposal' });
    expect(await relayed({ activity: null })).toEqual({ userId: 'par1', userName: 'Paul', activity: null });

    await settle(300);
    expect(activitiesIn(parEvents)).toEqual([]);
  });

  it.each([
    ['"__proto__"', { activity: '__proto__' }],
    ['an object', { activity: {} }],
    ['an array', { activity: ['brainstorm'] }],
    ['an unknown kind', { activity: 'vote' }],
    ['a number', { activity: 7 }],
    ['a 100 kB string', { activity: 'x'.repeat(100_000) }],
    ['a bare string payload', 'brainstorm'],
    ['a missing payload', undefined]
  ])('relays %s as no activity', async (_label, payload) => {
    expect(await relayed(payload, payload === undefined)).toEqual({ userId: 'par1', userName: 'Paul', activity: null });
  });

  it('keeps the payload a client of an earlier release reads', async () => {
    const event = await relayed({ activity: 'brainstorm' });
    expect(Object.keys(event).sort()).toEqual(['activity', 'userId', 'userName']);
  });

  it('relays nothing from a socket that joined no session', async () => {
    const facEvents = recordAll(fac1);
    const stranger = await connect();

    stranger.emit('participant-activity', { activity: 'brainstorm' });
    await settle(300);

    expect(activitiesIn(facEvents)).toEqual([]);
    stranger.close();
  });

  it('relays nothing from a socket that joined with an empty user id', async () => {
    const nameless = await connect();
    nameless.emit('join-session', {
      sessionId: 'live-session',
      userId: '',
      userName: 'Nobody',
      sessionToken: teamAToken
    });
    await once(nameless, 'member-roster');
    await settle(300);

    const facEvents = recordAll(fac1);
    nameless.emit('participant-activity', { activity: 'brainstorm' });
    await settle(300);

    expect(activitiesIn(facEvents)).toEqual([]);
    nameless.close();
  });
});
