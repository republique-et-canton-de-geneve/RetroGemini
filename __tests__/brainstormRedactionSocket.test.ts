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
 * Hiding brainstorm content from the wire, end to end.
 *
 * The unit tests in `brainstormRedaction.test.ts` pin the two pure functions.
 * These pin the wiring, which is where this feature can silently stop working:
 * `session-update` leaves the server from seven places, and one of them
 * forgetting to redact is invisible in the UI — the client blurs whatever it
 * receives, so a leak looks exactly like a non-leak until someone opens
 * devtools.
 *
 * The third test is the important one. Redacting outbound without restoring
 * inbound does not fail loudly: it destroys the board, because every client
 * syncs the whole session back and hands the filler over as if it were real.
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

type SessionBlob = Record<string, any>;

const FIONA_SECRET = 'We keep shipping on Fridays';
const PAUL_SECRET = 'Standups run far too long';

const once = <T = any>(socket: Socket, event: string, timeout = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const baseSession = (overrides: SessionBlob = {}): SessionBlob => ({
  id: 'retro-1',
  teamId: 'teamA',
  name: 'Sprint 12 Retro',
  date: '2026-07-01',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  columns: [{ id: 'c1', title: 'Went well' }],
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
  tickets: [{ id: 't-fiona', colId: 'c1', text: FIONA_SECRET, authorId: 'fac1', groupId: null, votes: [] }],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  _rev: 0,
  ...overrides
});

const ticket = (session: SessionBlob, id: string) =>
  session.tickets.find((t: SessionBlob) => t.id === id);

describe('brainstorm redaction over the socket (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let tokenService: ReturnType<typeof createTokenService>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];
  let teamToken: string;

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-redaction-'));
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
      tokenSecret: 'test-signing-secret-for-redaction'
    });
    teamToken = tokenService.createSessionToken('teamA', null);

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

  // The server emits the joiner's `session-update` before the roster, so the
  // listener has to be attached before the join is sent or the payload under
  // test is already gone by the time the roster resolves. `firstUpdate` is left
  // unawaited by callers that join an empty session (no state to send yet), so
  // its timeout is swallowed rather than surfacing as an unhandled rejection.
  async function joinSession(
    userId: string,
    userName: string
  ): Promise<{ socket: Socket; firstUpdate: Promise<SessionBlob | null> }> {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false
    });
    clients.push(socket);
    await once(socket, 'connect');

    const firstUpdate = once<SessionBlob>(socket, 'session-update').catch(() => null);
    const roster = once(socket, 'member-roster');
    socket.emit('join-session', { sessionId: 'retro-1', userId, userName, sessionToken: teamToken });
    await roster;

    return { socket, firstUpdate };
  }

  const expectUpdate = async (firstUpdate: Promise<SessionBlob | null>): Promise<SessionBlob> => {
    const payload = await firstUpdate;
    if (!payload) throw new Error('expected a session-update on join, received none');
    return payload;
  };

  it('hides a foreign ticket from the payload, and keeps the reader their own', async () => {
    const { socket: fiona } = await joinSession('fac1', 'Fiona');
    fiona.emit('update-session', baseSession());
    await once(fiona, 'session-ack');

    // Paul joins and is served the session for the first time.
    const { firstUpdate } = await joinSession('par1', 'Paul');
    const onJoin = await expectUpdate(firstUpdate);

    expect(ticket(onJoin, 't-fiona').text).not.toBe(FIONA_SECRET);
    expect(ticket(onJoin, 't-fiona').text).toHaveLength(FIONA_SECRET.length);
    // Nothing anywhere in the payload carries the real words.
    expect(JSON.stringify(onJoin)).not.toContain('Fridays');

    // The card itself still arrives: the column layout is unchanged.
    expect(ticket(onJoin, 't-fiona').authorId).toBe('fac1');
  });

  it('keeps redacting on the broadcast that follows someone else writing', async () => {
    const { socket: paul } = await joinSession('par1', 'Paul');

    const { socket: fiona, firstUpdate } = await joinSession('fac1', 'Fiona');
    const fionasView = await expectUpdate(firstUpdate);

    const broadcast = once<SessionBlob>(paul, 'session-update');
    fiona.emit('update-session', {
      ...fionasView,
      tickets: [
        ...fionasView.tickets,
        { id: 't-fiona-2', colId: 'c1', text: 'And another thing', authorId: 'fac1', groupId: null, votes: [] }
      ]
    });

    const received = await broadcast;
    expect(ticket(received, 't-fiona-2').text).not.toBe('And another thing');
    expect(JSON.stringify(received)).not.toContain('another thing');
  });

  it('does not let a participant hand the filler back as real text', async () => {
    // The regression that makes this whole feature dangerous without its
    // inbound half: Paul holds gibberish for Fiona's card, writes a card of his
    // own, and syncs the entire blob back.
    const { socket: paul, firstUpdate } = await joinSession('par1', 'Paul');
    const paulsView = await expectUpdate(firstUpdate);
    expect(ticket(paulsView, 't-fiona').text).not.toBe(FIONA_SECRET);

    paul.emit('update-session', {
      ...paulsView,
      tickets: [
        ...paulsView.tickets,
        { id: 't-paul', colId: 'c1', text: PAUL_SECRET, authorId: 'par1', groupId: null, votes: [] }
      ]
    });
    await once(paul, 'session-ack');

    const persisted = await dataStore.loadSessionState('retro-1');
    expect(ticket(persisted, 't-fiona').text).toBe(FIONA_SECRET);
    expect(ticket(persisted, 't-paul').text).toBe(PAUL_SECRET);
  });

  it('releases the real text on reveal, including from the revealing client', async () => {
    const { socket: paul } = await joinSession('par1', 'Paul');

    const { socket: fiona, firstUpdate } = await joinSession('fac1', 'Fiona');
    const fionasView = await expectUpdate(firstUpdate);

    // Paul's card is filler in Fiona's copy too, and her reveal write carries
    // that filler back up. The board must survive it.
    const paulsCard = ticket(fionasView, 't-paul');
    expect(paulsCard.text).not.toBe(PAUL_SECRET);

    const broadcast = once<SessionBlob>(paul, 'session-update');
    fiona.emit('update-session', {
      ...fionasView,
      settings: { ...fionasView.settings, revealBrainstorm: true }
    });

    const revealed = await broadcast;
    expect(ticket(revealed, 't-fiona').text).toBe(FIONA_SECRET);
    expect(ticket(revealed, 't-paul').text).toBe(PAUL_SECRET);

    const persisted = await dataStore.loadSessionState('retro-1');
    expect(ticket(persisted, 't-fiona').text).toBe(FIONA_SECRET);
    expect(ticket(persisted, 't-paul').text).toBe(PAUL_SECRET);
  });
});
