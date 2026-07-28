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
 * Audit H1 — the Socket.IO channel had no authentication at all.
 *
 * `join-session` took `{sessionId, userId, userName}` at face value and
 * immediately emitted the whole session back, so **knowing a session id was
 * enough to read and write a live retrospective**: no team password, no invite
 * credential, no session token. Session ids leak the way session ids do — a
 * shared screen, a pasted URL, a browser-history entry on a shared machine.
 *
 * These tests pin the two halves of the fix: a join must carry a valid team
 * session token, and that token must be minted for the team that owns the
 * session being joined.
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
  tickets: [{ id: 't1', colId: 'c1', text: 'Secret retro content', authorId: 'fac1', groupId: null, votes: [] }],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  _rev: 0,
  ...overrides
});

describe('join-session authentication (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let tokenService: ReturnType<typeof createTokenService>;
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
    dir = mkdtempSync(join(tmpdir(), 'retro-join-auth-'));
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

    tokenService = createTokenService({
      secureCompare,
      superAdminPassword: 'unused',
      tokenSecret: 'test-signing-secret-for-join-auth'
    });
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

    // Seed a real persisted session owned by teamA.
    const seeder = await connect();
    seeder.emit('join-session', {
      sessionId: 'live-session',
      userId: 'fac1',
      userName: 'Fiona',
      sessionToken: teamAToken
    });
    await once(seeder, 'member-roster');
    seeder.emit('update-session', baseSession('live-session', 'teamA'));
    await once(seeder, 'session-ack');
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

  // Records everything a socket receives, so "leaked nothing" is provable.
  const recordAll = (socket: Socket) => {
    const events: { event: string; payload: unknown }[] = [];
    socket.onAny((event: string, payload: unknown) => events.push({ event, payload }));
    return events;
  };

  it('denies a join that carries no credential and leaks no session state', async () => {
    const attacker = await connect();
    const events = recordAll(attacker);

    attacker.emit('join-session', {
      sessionId: 'live-session',
      userId: 'fac1',
      userName: 'Mallory'
    });

    const denial = await once<{ sessionId: string; reason: string }>(attacker, 'join-denied');
    await settle();

    expect(denial).toEqual({ sessionId: 'live-session', reason: 'unauthenticated' });
    expect(events.map((e) => e.event)).not.toContain('session-update');
    expect(events.map((e) => e.event)).not.toContain('member-roster');
  });

  it('denies a forged or malformed token', async () => {
    const attacker = await connect();
    const events = recordAll(attacker);

    attacker.emit('join-session', {
      sessionId: 'live-session',
      userId: 'fac1',
      userName: 'Mallory',
      sessionToken: 'rg1.eyJmYWtlIjp0cnVlfQ.not-a-real-signature'
    });

    await once(attacker, 'join-denied');
    await settle();

    expect(events.map((e) => e.event)).not.toContain('session-update');
  });

  it('denies a valid token minted for a different team', async () => {
    // The credential is genuine, just not for this session's team. Knowing a
    // session id must not let one team read another team's retrospective.
    const outsider = await connect();
    const events = recordAll(outsider);

    outsider.emit('join-session', {
      sessionId: 'live-session',
      userId: 'par1',
      userName: 'Outsider',
      sessionToken: teamBToken
    });

    const denial = await once<{ sessionId: string; reason: string }>(outsider, 'join-denied');
    await settle();

    expect(denial.reason).toBe('forbidden');
    expect(events.map((e) => e.event)).not.toContain('session-update');
  });

  it('does not place a denied socket in the room, so later broadcasts miss it', async () => {
    const attacker = await connect();
    attacker.emit('join-session', {
      sessionId: 'live-session',
      userId: 'fac1',
      userName: 'Mallory'
    });
    await once(attacker, 'join-denied');

    const events = recordAll(attacker);

    // A legitimate member now writes to the session.
    const member = await connect();
    member.emit('join-session', {
      sessionId: 'live-session',
      userId: 'fac1',
      userName: 'Fiona',
      sessionToken: teamAToken
    });
    const current = await once<SessionBlob>(member, 'session-update');
    member.emit('update-session', { ...current, phase: 'VOTE' });
    await once(member, 'session-ack');
    await settle();

    expect(events.map((e) => e.event)).not.toContain('session-update');
  });

  it('ignores update-session from a socket whose join was denied', async () => {
    const attacker = await connect();
    attacker.emit('join-session', {
      sessionId: 'live-session',
      userId: 'fac1',
      userName: 'Mallory'
    });
    await once(attacker, 'join-denied');

    attacker.emit('update-session', baseSession('live-session', 'teamA', { phase: 'CLOSE', _rev: 99 }));
    await settle();

    const stored = await dataStore.loadSessionState('live-session');
    expect(stored.phase).not.toBe('CLOSE');
  });

  it('admits a member holding a valid token for the session team', async () => {
    const member = await connect();

    member.emit('join-session', {
      sessionId: 'live-session',
      userId: 'par1',
      userName: 'Paul',
      sessionToken: teamAToken
    });

    const state = await once<SessionBlob>(member, 'session-update');
    expect(state.id).toBe('live-session');
    expect(state.teamId).toBe('teamA');
  });

  it('admits a join for a session that does not exist yet (facilitator creating one)', async () => {
    const facilitator = await connect();

    facilitator.emit('join-session', {
      sessionId: 'brand-new-session',
      userId: 'fac1',
      userName: 'Fiona',
      sessionToken: teamAToken
    });

    // No persisted state to send, but the join itself must succeed: the roster
    // broadcast is the signal that the socket entered the room.
    const roster = await once<{ id: string; name: string }[]>(facilitator, 'member-roster');
    expect(roster.some((m) => m.name === 'Fiona')).toBe(true);

    facilitator.emit('update-session', baseSession('brand-new-session', 'teamA'));
    const ack = await once<{ rev: number }>(facilitator, 'session-ack');
    expect(ack.rev).toBe(1);
  });

  it('refuses to create a session under a team the credential does not cover', async () => {
    // Otherwise a teamB token could seed a fresh session claiming teamId
    // "teamA" and inherit teamA's roster for role resolution.
    const attacker = await connect();
    attacker.emit('join-session', {
      sessionId: 'cross-team-session',
      userId: 'fac1',
      userName: 'Mallory',
      sessionToken: teamBToken
    });
    await once(attacker, 'member-roster');

    attacker.emit('update-session', baseSession('cross-team-session', 'teamA'));
    await settle();

    const stored = await dataStore.loadSessionState('cross-team-session');
    expect(stored).toBeNull();
  });

  it('lets a reconnecting client re-join with the same credential (zero-downtime)', async () => {
    // The rolling-update path: syncService re-emits join-session after every
    // reconnect, so the credential has to survive that round trip.
    const member = await connect();
    member.emit('join-session', {
      sessionId: 'live-session',
      userId: 'par1',
      userName: 'Paul',
      sessionToken: teamAToken
    });
    await once(member, 'session-update');

    member.emit('leave-session', { sessionId: 'live-session' });
    member.emit('join-session', {
      sessionId: 'live-session',
      userId: 'par1',
      userName: 'Paul',
      sessionToken: teamAToken
    });

    const state = await once<SessionBlob>(member, 'session-update');
    expect(state.id).toBe('live-session');
  });
});
