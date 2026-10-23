// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'events';
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
import { createSessionRevocation, TEAM_SESSIONS_REVOKED_EVENT } from '../server/services/sessionRevocation.js';
import { secureCompare } from '../server/services/security.js';

/**
 * Decision D3b, the socket half — a password rotation cuts the team's live
 * sessions, on every pod, and a revoked token cannot join again.
 *
 * A socket authenticates once, at `join-session`, and stays in its room until
 * it disconnects, so revoking the token on the HTTP routes alone would leave
 * every participant of a live retrospective reading and writing it for as
 * long as their tab stays open. Real Socket.IO servers on one real store, two
 * of them where a case plays two pods.
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

type Denial = { sessionId: string; reason: string; cause?: string; joinId?: string };

const once = <T = unknown>(socket: Socket, event: string, timeout = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

describe('a password rotation cuts the team\'s live sessions (decision D3b)', () => {
  let dir: string;
  let dataStore: ReturnType<typeof createDataStore>;
  let tokenService: ReturnType<typeof createTokenService>;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];
  const pods: { close: () => Promise<void> }[] = [];
  let teamSeq = 0;
  // Set by a case to make the next `loadTeamAuthState` of a pod's store throw.
  const failNextAuthRead = { value: false };
  // Set by a case to hold the next `loadSessionState` of a gated pod: a join
  // reads the session after the epoch, so a join held there has judged its
  // token and not yet taken its place in the room.
  let sessionReadGate: { reached: () => void; opened: Promise<void> } | null = null;
  const armSessionReadGate = () => {
    let reached!: () => void;
    let open!: () => void;
    const atGate = new Promise<void>((resolve) => { reached = resolve; });
    sessionReadGate = { reached, opened: new Promise<void>((resolve) => { open = resolve; }) };
    return { atGate, open };
  };

  // Set by a case to hold the next `loadTeamAuthState` of a flaky pod until
  // the case releases it: a query sent on a connection that died answers no
  // sooner than the kernel gives up on it, many minutes later.
  let hangNextAuthRead: { reached: () => void; released: Promise<void> } | null = null;
  const armAuthReadHang = () => {
    let reached!: () => void;
    let release!: () => void;
    const atHang = new Promise<void>((resolve) => { reached = resolve; });
    hangNextAuthRead = { reached, released: new Promise<void>((resolve) => { release = resolve; }) };
    return { atHang, release };
  };
  // Holds every `atomicTeamUpdate` of a pod built with `hangingTeamWrite`
  // until the case releases them: a team write waiting on a row lock a dead
  // client still holds.
  const teamWriteHang = (() => {
    let reached!: () => void;
    let release!: () => void;
    const state = {
      atHang: new Promise<void>((resolve) => { reached = resolve; }),
      released: new Promise<void>((resolve) => { release = resolve; }),
      reached: () => reached(),
      release: () => release()
    };
    return state;
  })();

  type Pod = { io: Server; port: number; revocation: ReturnType<typeof createSessionRevocation> };

  type PodOptions = {
    revocationSweepMs?: number;
    flakyStore?: boolean;
    gatedSessionRead?: boolean;
    hangingTeamWrite?: boolean;
    joinAuthWaitMs?: number;
    schedule?: (run: () => void, delayMs: number) => void;
    clock?: () => number;
  };

  const startPod = async ({
    revocationSweepMs = 0,
    flakyStore = false,
    gatedSessionRead = false,
    hangingTeamWrite = false,
    joinAuthWaitMs,
    schedule,
    clock
  }: PodOptions = {}): Promise<Pod> => {
    const httpServer: HttpServer = createServer();
    const io = new Server(httpServer, { path: '/socket.io' });
    const revocation = createSessionRevocation({ io, serverRuntime: { multiPodAdapter: false } });
    const store = flakyStore || gatedSessionRead || hangingTeamWrite
      ? {
          ...dataStore,
          usePostgres: dataStore.usePostgres,
          getSqliteDb: dataStore.getSqliteDb,
          ...(flakyStore
            ? {
                loadTeamAuthState: async (teamId: string) => {
                  if (failNextAuthRead.value) {
                    failNextAuthRead.value = false;
                    throw new Error('database unavailable');
                  }
                  const hang = hangNextAuthRead;
                  if (hang) {
                    hangNextAuthRead = null;
                    hang.reached();
                    await hang.released;
                  }
                  return dataStore.loadTeamAuthState(teamId);
                }
              }
            : {}),
          ...(hangingTeamWrite
            ? {
                atomicTeamUpdate: async (...args: Parameters<typeof dataStore.atomicTeamUpdate>) => {
                  teamWriteHang.reached();
                  await teamWriteHang.released;
                  return dataStore.atomicTeamUpdate(...args);
                }
              }
            : {}),
          ...(gatedSessionRead
            ? {
                loadSessionState: async (sessionId: string) => {
                  const gate = sessionReadGate;
                  if (gate) {
                    sessionReadGate = null;
                    gate.reached();
                    await gate.opened;
                  }
                  return dataStore.loadSessionState(sessionId);
                }
              }
            : {})
        }
      : dataStore;
    registerSocketHandlers({
      io,
      dataStore: store,
      sessionCache: createBoundedCache({ max: 100 }),
      tokenService,
      sessionRevocation: revocation,
      revocationSweepMs,
      ...(joinAuthWaitMs !== undefined ? { joinAuthWaitMs } : {}),
      ...(schedule ? { schedule } : {}),
      ...(clock ? { clock } : {})
    });
    await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
    const port = (httpServer.address() as { port: number }).port;
    pods.push({
      close: async () => {
        io.close();
        await new Promise<void>((res) => httpServer.close(() => res()));
      }
    });
    return { io, port, revocation };
  };

  const connect = async (pod: Pod): Promise<Socket> => {
    const socket = ioClient(`http://127.0.0.1:${pod.port}`, { path: '/socket.io', transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await once(socket, 'connect');
    return socket;
  };

  const newTeam = async () => {
    teamSeq += 1;
    const id = `team${teamSeq}`;
    await dataStore.saveTeam(id, {
      id,
      name: `Team ${teamSeq}`,
      passwordHash: 'x',
      members: [{ id: 'fac1', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' }],
      retrospectives: []
    });
    return id;
  };

  const tokenFor = async (teamId: string) =>
    tokenService.createSessionToken(teamId, null, { sessionEpoch: (await dataStore.loadTeamAuthState(teamId)).sessionEpoch });

  // Joins and waits for the roster, which the server sends only to a socket
  // it placed in the room.
  const joinSession = async (socket: Socket, payload: Record<string, unknown>) => {
    const roster = once(socket, 'member-roster');
    socket.emit('join-session', payload);
    await roster;
  };

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-socket-revocation-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
    tokenService = createTokenService({ secureCompare, superAdminPassword: 'unused', tokenSecret: 'socket-revocation-secret' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    teamWriteHang.release();
    hangNextAuthRead?.reached();
    clients.forEach((c) => c.close());
    for (const pod of pods) await pod.close();
    await dataStore.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it('cuts a socket joined with the old token, keeps one joined with the new token, and the cut socket can no longer write', async () => {
    const pod = await startPod();
    const teamId = await newTeam();
    const oldToken = await tokenFor(teamId);
    const participant = await connect(pod);
    await joinSession(participant, { sessionId: 's1', userId: 'par1', userName: 'Paul', sessionToken: oldToken, joinId: 'join-1' });

    await dataStore.rotateTeamSessionEpoch(teamId);
    const facilitator = await connect(pod);
    await joinSession(facilitator, { sessionId: 's1', userId: 'fac1', userName: 'Fiona', sessionToken: await tokenFor(teamId) });

    const denial = once<Denial>(participant, 'join-denied');
    const left = once<{ userId: string }>(facilitator, 'member-left');
    let facilitatorDenied = false;
    facilitator.on('join-denied', () => { facilitatorDenied = true; });
    await pod.revocation.revokeTeamSessions(teamId);

    expect(await denial).toEqual({ sessionId: 's1', reason: 'unauthenticated', cause: 'session_revoked', joinId: 'join-1' });
    expect((await left).userId).toBe('par1');

    const refused = once<{ reason: string }>(participant, 'session-update-refused');
    participant.emit('update-session', { id: 's1', teamId, phase: 'BRAINSTORM', tickets: [{ id: 'k', text: 'after the cut' }], _rev: 0 });
    expect((await refused).reason).toBe('not-joined');
    await settle();
    expect(await dataStore.loadSessionState('s1')).toBeNull();
    expect(facilitatorDenied).toBe(false);
  });

  it('denies a re-join with the revoked token, naming the cause and the join', async () => {
    const pod = await startPod();
    const teamId = await newTeam();
    const oldToken = await tokenFor(teamId);
    await dataStore.rotateTeamSessionEpoch(teamId);
    const socket = await connect(pod);

    const denial = once<Denial>(socket, 'join-denied');
    socket.emit('join-session', { sessionId: 's2', userId: 'par1', userName: 'Paul', sessionToken: oldToken, joinId: 'join-7' });

    expect(await denial).toEqual({ sessionId: 's2', reason: 'unauthenticated', cause: 'session_revoked', joinId: 'join-7' });
  });

  // A join that read the epoch just before a rotation holds no claims yet when
  // the rotation's sweep looks at it, so a sweep that skipped it would leave
  // it in the room, writing, until the next periodic sweep — a minute in
  // production. The likeliest moment is the reconnect burst of a rolling
  // update. No periodic sweep here, so only the rotation's own can cut it.
  it('cuts a socket whose join read the epoch just before the rotation, once that join lands', async () => {
    const pod = await startPod({ gatedSessionRead: true });
    const teamId = await newTeam();
    const oldToken = await tokenFor(teamId);
    const participant = await connect(pod);

    const gate = armSessionReadGate();
    participant.emit('join-session', { sessionId: 's10', userId: 'par1', userName: 'Paul', sessionToken: oldToken, joinId: 'join-10' });
    await gate.atGate;

    await dataStore.rotateTeamSessionEpoch(teamId);
    const observer = await connect(pod);
    await joinSession(observer, { sessionId: 's10', userId: 'fac1', userName: 'Fiona', sessionToken: await tokenFor(teamId) });

    const denial = once<Denial>(participant, 'join-denied');
    const left = once<{ userId: string }>(observer, 'member-left');
    const revoking = pod.revocation.revokeTeamSessions(teamId);
    gate.open();
    await revoking;

    expect(await denial).toEqual({ sessionId: 's10', reason: 'unauthenticated', cause: 'session_revoked', joinId: 'join-10' });
    expect((await left).userId).toBe('par1');
  });

  // A joined socket presenting its revoked token again (a remount re-joining
  // the same session, a client from before this release) must leave the room
  // it is in. Clearing its claims alone would leave it there, still writing,
  // and with no claims no sweep would ever look at it again.
  it('takes a socket out of its session when it re-joins it with a token revoked since', async () => {
    const pod = await startPod();
    const teamId = await newTeam();
    const oldToken = await tokenFor(teamId);
    const participant = await connect(pod);
    await joinSession(participant, { sessionId: 's11', userId: 'par1', userName: 'Paul', sessionToken: oldToken });

    await dataStore.rotateTeamSessionEpoch(teamId);
    const observer = await connect(pod);
    await joinSession(observer, { sessionId: 's11', userId: 'fac1', userName: 'Fiona', sessionToken: await tokenFor(teamId) });

    const denial = once<Denial>(participant, 'join-denied');
    const left = once<{ userId: string }>(observer, 'member-left');
    participant.emit('join-session', { sessionId: 's11', userId: 'par1', userName: 'Paul', sessionToken: oldToken, joinId: 'join-11' });

    expect(await denial).toEqual({ sessionId: 's11', reason: 'unauthenticated', cause: 'session_revoked', joinId: 'join-11' });
    expect((await left).userId).toBe('par1');

    const refused = once<{ reason: string }>(participant, 'session-update-refused');
    participant.emit('update-session', { id: 's11', teamId, phase: 'BRAINSTORM', tickets: [{ id: 'k', text: 'after the re-join' }], _rev: 0 });
    expect((await refused).reason).toBe('not-joined');
    await settle();
    expect(await dataStore.loadSessionState('s11')).toBeNull();
  });

  it('cuts a socket on another pod through the adapter event, and a forged event cuts nothing', async () => {
    const podA = await startPod();
    const podB = await startPod();
    const teamId = await newTeam();
    const steady = await newTeam();
    const socket = await connect(podB);
    await joinSession(socket, { sessionId: 's3', userId: 'par1', userName: 'Paul', sessionToken: await tokenFor(teamId) });
    const bystander = await connect(podB);
    await joinSession(bystander, { sessionId: 's3b', userId: 'par2', userName: 'Pia', sessionToken: await tokenFor(steady) });
    let bystanderDenied = false;
    bystander.on('join-denied', () => { bystanderDenied = true; });

    // A forged (or duplicated) event: the decision is the row, read again.
    EventEmitter.prototype.emit.call(podB.io.of('/'), TEAM_SESSIONS_REVOKED_EVENT, { teamId: steady });
    await settle();
    expect(bystanderDenied).toBe(false);

    await dataStore.rotateTeamSessionEpoch(teamId);
    await podA.revocation.revokeTeamSessions(teamId);
    const denial = once<Denial>(socket, 'join-denied');
    // What the adapter does with podA's serverSideEmit on podB.
    EventEmitter.prototype.emit.call(podB.io.of('/'), TEAM_SESSIONS_REVOKED_EVENT, { teamId });

    expect((await denial).cause).toBe('session_revoked');
    await settle();
    expect(bystanderDenied).toBe(false);
  });

  it('cuts within the periodic sweep a socket whose pod heard of no rotation', async () => {
    const pod = await startPod({ revocationSweepMs: 50 });
    const teamId = await newTeam();
    const socket = await connect(pod);
    await joinSession(socket, { sessionId: 's4', userId: 'par1', userName: 'Paul', sessionToken: await tokenFor(teamId) });

    const denial = once<Denial>(socket, 'join-denied', 2000);
    await dataStore.rotateTeamSessionEpoch(teamId);

    expect((await denial).cause).toBe('session_revoked');
  });

  it('accepts a join on its signature while the epoch cannot be read, and the sweep cuts it once the store answers', async () => {
    const pod = await startPod({ revocationSweepMs: 50, flakyStore: true });
    const teamId = await newTeam();
    const oldToken = await tokenFor(teamId);
    await dataStore.rotateTeamSessionEpoch(teamId);
    const observer = await connect(pod);
    await joinSession(observer, { sessionId: 's5', userId: 'fac1', userName: 'Fiona', sessionToken: await tokenFor(teamId) });
    const socket = await connect(pod);

    // The observer sees the join accepted (the read failed, so the signature
    // decided), then the participant leave once the sweep reads the epoch.
    failNextAuthRead.value = true;
    const joined = once<{ userId: string }>(observer, 'member-joined');
    const left = once<{ userId: string }>(observer, 'member-left', 2000);
    const denial = once<Denial>(socket, 'join-denied', 2000);
    socket.emit('join-session', { sessionId: 's5', userId: 'par1', userName: 'Paul', sessionToken: oldToken });

    expect((await joined).userId).toBe('par1');
    expect((await denial).cause).toBe('session_revoked');
    expect((await left).userId).toBe('par1');
  });

  it('denies a join for a team that no longer exists', async () => {
    const pod = await startPod();
    const socket = await connect(pod);
    const denial = once<Denial>(socket, 'join-denied');
    socket.emit('join-session', { sessionId: 's6', userId: 'par1', userName: 'Paul', sessionToken: tokenService.createSessionToken('deleted-team', null, { sessionEpoch: '0' }) });

    expect(await denial).toMatchObject({ reason: 'unauthenticated', cause: 'team_not_found' });
  });

  it('re-checks every socket on sessions-invalidated (a restore on another pod)', async () => {
    const pod = await startPod();
    const teamId = await newTeam();
    const socket = await connect(pod);
    await joinSession(socket, { sessionId: 's7', userId: 'par1', userName: 'Paul', sessionToken: await tokenFor(teamId) });

    await dataStore.rotateTeamSessionEpoch(teamId);
    const denial = once<Denial>(socket, 'join-denied');
    EventEmitter.prototype.emit.call(pod.io.of('/'), 'sessions-invalidated');

    expect((await denial).cause).toBe('session_revoked');
  });

  it('cuts a socket once when two sweeps race, and the denial names the session', async () => {
    const pod = await startPod();
    const teamId = await newTeam();
    const socket = await connect(pod);
    await joinSession(socket, { sessionId: 's8', userId: 'par1', userName: 'Paul', sessionToken: await tokenFor(teamId) });
    const denials: Denial[] = [];
    socket.on('join-denied', (payload: Denial) => denials.push(payload));

    await dataStore.rotateTeamSessionEpoch(teamId);
    await Promise.all([pod.revocation.revokeTeamSessions(teamId), pod.revocation.revokeTeamSessions(teamId), pod.revocation.sweepAllLocal()]);
    await settle();

    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ sessionId: 's8', cause: 'session_revoked' });
  });

  it('denies a join, and cuts a joined socket, when the team\'s epoch row is corrupt', async () => {
    const pod = await startPod();
    const teamId = await newTeam();
    const joined = await connect(pod);
    await joinSession(joined, { sessionId: 's9', userId: 'par1', userName: 'Paul', sessionToken: await tokenFor(teamId) });
    dataStore.getSqliteDb().prepare(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(`team-auth:${teamId}`, '{"sessionEpoch":');

    const late = await connect(pod);
    const refused = once<Denial>(late, 'join-denied');
    late.emit('join-session', { sessionId: 's9', userId: 'par2', userName: 'Pia', sessionToken: tokenService.createSessionToken(teamId, null, { sessionEpoch: '0' }) });
    expect(await refused).toEqual({ sessionId: 's9', reason: 'unauthenticated' });

    const cut = once<Denial>(joined, 'join-denied');
    await pod.revocation.revokeTeamSessions(teamId);
    expect((await cut).sessionId).toBe('s9');
  });

  // Audit H1 binds a session's creation to the team the socket joined as. The
  // write read that team live, after awaiting the session read, and D3b made
  // a revocation clear it: a revoked join sent behind the write, on the same
  // socket, emptied it and let the write seed a session claiming another
  // team's id.
  it('binds a session creation in flight to the team it joined as, even when a revoked join lands meanwhile', async () => {
    const pod = await startPod({ gatedSessionRead: true });
    const teamId = await newTeam();
    const otherTeam = await newTeam();
    const token = await tokenFor(teamId);
    const socket = await connect(pod);
    await joinSession(socket, { sessionId: 's23', userId: 'fac1', userName: 'Fiona', sessionToken: token });
    // The token the socket holds is revoked; no sweep runs on this pod.
    await dataStore.rotateTeamSessionEpoch(teamId);

    const gate = armSessionReadGate();
    socket.emit('update-session', { id: 's23', teamId: otherTeam, phase: 'BRAINSTORM', tickets: [], _rev: 0 });
    await gate.atGate;
    const denial = once<Denial>(socket, 'join-denied');
    socket.emit('join-session', { sessionId: 's23', userId: 'fac1', userName: 'Fiona', sessionToken: token, joinId: 'join-23' });
    expect((await denial).cause).toBe('session_revoked');
    gate.open();
    await settle();

    expect(await dataStore.loadSessionState('s23')).toBeNull();
  });

  // A sweep waits for the joins in flight on its pod, so that a join that read
  // the old epoch is judged on the claims it ends up holding. It used to wait
  // for the whole join, of every team, with no limit: a join stuck on a team
  // write (a row lock held by a client that died) stopped every revocation on
  // its pod — the rotation's own sweep, the broadcast behind it, and the
  // periodic sweep, which only rescheduled itself once the previous run ended.
  describe('a stuck join never stops revocation on its pod', () => {
    const memberTeam = async () => {
      const teamId = await newTeam();
      await dataStore.atomicTeamUpdate(teamId, (team: Record<string, unknown>) => ({
        ...team,
        members: [
          { id: 'fac1', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' },
          { id: 'parA', name: 'Ada', color: 'bg-rose-500', role: 'participant' }
        ]
      }));
      return teamId;
    };

    it('cuts another team\'s revoked socket while a join waits on its team\'s write', async () => {
      const pod = await startPod({ hangingTeamWrite: true });
      const stuckTeam = await memberTeam();
      await dataStore.saveSessionState('s20a', { id: 's20a', teamId: stuckTeam, phase: 'BRAINSTORM', _rev: 0 });
      const revokedTeam = await newTeam();
      const revoked = await connect(pod);
      await joinSession(revoked, { sessionId: 's20b', userId: 'par1', userName: 'Paul', sessionToken: await tokenFor(revokedTeam) });

      // A participant of the other team joins; the join has its claims and is
      // now refreshing the team's last connection, which never answers.
      const stuck = await connect(pod);
      stuck.emit('join-session', { sessionId: 's20a', userId: 'parA', userName: 'Ada', sessionToken: await tokenFor(stuckTeam) });
      await teamWriteHang.atHang;

      await dataStore.rotateTeamSessionEpoch(revokedTeam);
      const denial = once<Denial>(revoked, 'join-denied', 1500);
      void pod.revocation.revokeTeamSessions(revokedTeam);

      expect((await denial).cause).toBe('session_revoked');
    });

    it('waits a bounded time for a join that has not decided yet, then judges the sockets it can', async () => {
      const pod = await startPod({ gatedSessionRead: true, joinAuthWaitMs: 100 });
      const revokedTeam = await newTeam();
      const revoked = await connect(pod);
      await joinSession(revoked, { sessionId: 's21b', userId: 'par1', userName: 'Paul', sessionToken: await tokenFor(revokedTeam) });

      // Another team's join held before its claims: its session read hangs.
      const otherTeam = await newTeam();
      const pending = await connect(pod);
      const gate = armSessionReadGate();
      pending.emit('join-session', { sessionId: 's21a', userId: 'par2', userName: 'Pia', sessionToken: await tokenFor(otherTeam) });
      await gate.atGate;

      await dataStore.rotateTeamSessionEpoch(revokedTeam);
      const denial = once<Denial>(revoked, 'join-denied', 1500);
      void pod.revocation.revokeTeamSessions(revokedTeam);
      try {
        expect((await denial).cause).toBe('session_revoked');
      } finally {
        gate.open();
      }
    });

    it('keeps the periodic sweep running while an earlier run is stuck', async () => {
      const ticks: (() => void)[] = [];
      let now = 1_000_000;
      const pod = await startPod({
        revocationSweepMs: 1000,
        flakyStore: true,
        schedule: (run) => { ticks.push(run); },
        clock: () => now
      });
      const teamId = await newTeam();
      const socket = await connect(pod);
      await joinSession(socket, { sessionId: 's22', userId: 'par1', userName: 'Paul', sessionToken: await tokenFor(teamId) });
      await dataStore.rotateTeamSessionEpoch(teamId);
      const denials: Denial[] = [];
      socket.on('join-denied', (payload: Denial) => denials.push(payload));

      // The first run hangs on its epoch read.
      expect(ticks).toHaveLength(1);
      const hang = armAuthReadHang();
      ticks.shift()!();
      await hang.atHang;

      // The next tick is already scheduled; within one period it skips its
      // turn rather than stacking a second run on the first.
      expect(ticks).toHaveLength(1);
      now += 500;
      ticks.shift()!();
      await settle(50);
      expect(denials).toHaveLength(0);

      // A period later, a new run judges the socket the stuck one never did.
      expect(ticks).toHaveLength(1);
      now += 600;
      const denial = once<Denial>(socket, 'join-denied', 1500);
      ticks.shift()!();
      expect((await denial).cause).toBe('session_revoked');
      hang.release();
    });
  });

  // The other pods re-read the epoch themselves, and the rotation has
  // committed before this is called, so they need not wait for this pod's
  // sweep — which may itself be waiting.
  it('asks the other pods to sweep before sweeping its own sockets', async () => {
    const emitted: unknown[][] = [];
    const revocation = createSessionRevocation({
      io: { serverSideEmit: (...args: unknown[]) => { emitted.push(args); return true; } } as unknown as Server,
      serverRuntime: { multiPodAdapter: true }
    });
    revocation.attachLocalSweeper(() => new Promise(() => undefined));

    void revocation.revokeTeamSessions('team-x');
    await settle(10);

    expect(emitted).toEqual([[TEAM_SESSIONS_REVOKED_EVENT, { teamId: 'team-x' }]]);
  });
});
