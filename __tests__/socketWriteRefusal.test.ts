// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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
 * Incident ISS (2026-10-12), the server half.
 *
 * A facilitator renamed a retro on the Dashboard after participants had joined.
 * A participant's client, holding the old name, put it back on every write it
 * sent; `name` is facilitator-only, so the server refused the **whole** write,
 * tickets included, and healed the sender. The client re-sent the same blob
 * about three times a second, forever, and each card it carried left the
 * author's screen when its 60-second pending-creation TTL ran out. Nothing
 * told the client its writes were being refused, and the refusal log flushed
 * the super-admin log ring.
 *
 * These pin the replacement contract:
 *   - a participant write that also changes facilitator-only fields is saved
 *     with those fields restored from the server's state — the cards survive;
 *   - a write whose *only* changes were facilitator-only is healed, not saved;
 *   - every heal is preceded by `session-update-refused`, naming why, and a
 *     write from a socket that never joined is answered instead of dropped;
 *   - a refusal loop costs at most two log lines, not one per write.
 */

const tokenService = createTestTokenService();
const teamToken = tokenService.createSessionToken('teamA', null);

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
type Received = { event: string; payload: unknown };

const once = <T = unknown>(socket: Socket, event: string, timeout = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

const ticket = (id: string, authorId = 'par1') => ({ id, colId: 'c1', text: `Card ${id}`, authorId, groupId: null, votes: [] });

const baseSession = (id: string, overrides: SessionBlob = {}): SessionBlob => ({
  id,
  teamId: 'teamA',
  name: 'Retro B',
  date: '2026-10-12',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  columns: [{ id: 'c1', title: 'Went well' }],
  settings: { isAnonymous: false, maxVotes: 3, revealBrainstorm: false, timerInitial: 300, timerRunning: false },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  finishedUsers: [],
  _rev: 0,
  ...overrides
});

describe('update-session: restore, refuse, report (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  let failPersistence = false;
  let failTeamRead = false;
  let sessionCache: ReturnType<typeof createBoundedCache>;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-refusal-'));
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

    const flakyStore = {
      ...dataStore,
      saveSessionState: (...args: Parameters<typeof dataStore.saveSessionState>) => {
        if (failPersistence) return Promise.reject(new Error('simulated database outage'));
        return dataStore.saveSessionState(...args);
      },
      // The team record is where the sender's role comes from; a read that
      // throws is the one case where the server cannot say who is writing.
      loadTeam: (...args: Parameters<typeof dataStore.loadTeam>) => {
        if (failTeamRead) return Promise.reject(new Error('simulated team read failure'));
        return dataStore.loadTeam(...args);
      }
    };

    httpServer = createServer();
    io = new Server(httpServer, { path: '/socket.io' });
    sessionCache = createBoundedCache({ max: 100 });
    registerSocketHandlers({ io, dataStore: flakyStore, sessionCache, tokenService });
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

  afterEach(() => {
    failPersistence = false;
    failTeamRead = false;
    vi.restoreAllMocks();
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

  // The write path's answers only: presence traffic (roster, joins) arrives on
  // its own timer and says nothing about what happened to a write.
  const WRITE_ANSWERS = new Set(['session-update-refused', 'session-update', 'session-ack']);
  const record = (socket: Socket) => {
    const events: Received[] = [];
    socket.onAny((event: string, payload: unknown) => {
      if (WRITE_ANSWERS.has(event)) events.push({ event, payload });
    });
    return events;
  };

  const setupSession = async (sessionId: string, overrides: SessionBlob = {}) => {
    const fiona = await connect();
    fiona.emit('join-session', { sessionId, userId: 'fac1', userName: 'Fiona', sessionToken: teamToken });
    await once(fiona, 'member-roster');
    fiona.emit('update-session', baseSession(sessionId, overrides));
    const { rev } = await once<{ rev: number }>(fiona, 'session-ack');

    const paul = await connect();
    paul.emit('join-session', { sessionId, userId: 'par1', userName: 'Paul', sessionToken: teamToken });
    const initial = await once<SessionBlob>(paul, 'session-update');
    return { fiona, paul, rev, initial };
  };

  it('saves a participant’s card even when the same write carries a stale retro name', async () => {
    // The incident, reduced to one write: the card must land, the name must not.
    const { fiona, paul, rev, initial } = await setupSession('iss-ride-along');
    const paulEvents = record(paul);
    const fionaSaw = once<SessionBlob>(fiona, 'session-update');

    paul.emit('update-session', { ...structuredClone(initial), name: 'Retro A', tickets: [ticket('t1')] });
    await once(paul, 'session-ack');

    // The sender learns the authoritative blob *before* the ack, so its
    // syncService delivers the restored name and the ack synthesizes nothing.
    expect(paulEvents.map((e) => e.event)).toEqual(['session-update', 'session-ack']);
    const delivered = paulEvents[0].payload as SessionBlob;
    expect(delivered).toMatchObject({ name: 'Retro B', _rev: rev + 1 });
    expect(delivered.tickets).toEqual([ticket('t1')]);
    expect(paulEvents[1].payload).toEqual({ sessionId: 'iss-ride-along', rev: rev + 1 });

    const broadcast = await fionaSaw;
    expect(broadcast).toMatchObject({ name: 'Retro B', _rev: rev + 1 });
    expect(broadcast.tickets).toEqual([ticket('t1')]);

    const stored = await dataStore.loadSessionState('iss-ride-along') as SessionBlob;
    expect(stored.name).toBe('Retro B');
    expect(stored.tickets).toEqual([ticket('t1')]);
  }, 20000);

  it('keeps the plain ack for a write that needed no restoration', async () => {
    const { paul, rev, initial } = await setupSession('iss-clean');
    const paulEvents = record(paul);

    paul.emit('update-session', { ...structuredClone(initial), tickets: [ticket('t1')] });
    await once(paul, 'session-ack');
    await settle(100);

    expect(paulEvents).toEqual([{ event: 'session-ack', payload: { sessionId: 'iss-clean', rev: rev + 1 } }]);
  }, 20000);

  it('heals without saving a write whose only change is facilitator-only, and says which fields', async () => {
    const { fiona, paul, rev, initial } = await setupSession('iss-protected-only');
    const paulEvents = record(paul);
    const fionaUpdates: SessionBlob[] = [];
    fiona.on('session-update', (s: SessionBlob) => fionaUpdates.push(s));

    paul.emit('update-session', { ...structuredClone(initial), name: 'Retro A' });
    await once(paul, 'session-update');
    await settle();

    expect(paulEvents.map((e) => e.event)).toEqual(['session-update-refused', 'session-update']);
    expect(paulEvents[0].payload).toEqual({ sessionId: 'iss-protected-only', reason: 'protected-fields', fields: ['name'], rev });
    expect(paulEvents[1].payload).toMatchObject({ name: 'Retro B', _rev: rev });
    expect(fionaUpdates).toHaveLength(0);
    const stored = await dataStore.loadSessionState('iss-protected-only') as SessionBlob;
    expect(stored._rev).toBe(rev);
  }, 20000);

  it('reports a write built on an older revision as stale, not as unauthorized', async () => {
    // The facilitator moved to GROUP; a participant's write still built on
    // BRAINSTORM differs on `phase` only because it is old. Calling that a
    // facilitator-only change would send the client looking for the wrong fix.
    const { fiona, paul, rev, initial } = await setupSession('iss-stale-first');
    const paulSaw = once(paul, 'session-update');
    fiona.emit('update-session', { ...structuredClone(initial), phase: 'GROUP', _rev: rev });
    const { rev: rev2 } = await once<{ rev: number }>(fiona, 'session-ack');
    await paulSaw;

    const paulEvents = record(paul);
    paul.emit('update-session', { ...structuredClone(initial), tickets: [ticket('t1')], _rev: rev });
    await once(paul, 'session-update');

    expect(paulEvents.map((e) => e.event)).toEqual(['session-update-refused', 'session-update']);
    expect(paulEvents[0].payload).toEqual({ sessionId: 'iss-stale-first', reason: 'stale', rev: rev2 });
    expect(paulEvents[1].payload).toMatchObject({ phase: 'GROUP', _rev: rev2 });
  }, 20000);

  it('reports a write another pod made stale in the database as stale too', async () => {
    // The pod's cache lags the database when the newer write landed elsewhere,
    // so the pre-check passes and the compare-and-swap is what refuses it.
    const { paul, rev, initial } = await setupSession('iss-cas-stale');
    const elsewhere = await dataStore.saveSessionState('iss-cas-stale', { ...structuredClone(initial), happiness: { fac1: 5 }, _rev: rev });
    expect(elsewhere.success).toBe(true);

    const paulEvents = record(paul);
    paul.emit('update-session', { ...structuredClone(initial), tickets: [ticket('t1')], _rev: rev });
    await once(paul, 'session-update');

    expect(paulEvents.map((e) => e.event)).toEqual(['session-update-refused', 'session-update']);
    expect(paulEvents[0].payload).toEqual({ sessionId: 'iss-cas-stale', reason: 'stale', rev: rev + 1 });
    expect(paulEvents[1].payload).toMatchObject({ happiness: { fac1: 5 }, _rev: rev + 1 });
  }, 20000);

  it('heals a stale write with the database row when another pod wrote past this pod’s cache', async () => {
    // Multi-pod: each pod's cache advances only on writes through that pod, so
    // it can sit one revision ahead of a participant's write and one behind the
    // database. The stale pre-check refuses that write without reaching the
    // compare-and-swap, and healing it from the cache handed the client a
    // state older than the one already stored — the CAS it replaced healed
    // from the database row.
    const sessionId = 'iss-stale-lagging-cache';
    const { fiona, paul, rev, initial } = await setupSession(sessionId);

    // This pod's cache moves to rev+1 through an ordinary facilitator write…
    const paulSawFirst = once<SessionBlob>(paul, 'session-update');
    fiona.emit('update-session', { ...structuredClone(initial), happiness: { fac1: 3 }, _rev: rev });
    const { rev: cachedRev } = await once<{ rev: number }>(fiona, 'session-ack');
    await paulSawFirst;
    expect(cachedRev).toBe(rev + 1);

    // …and another pod moves the database on to rev+2 behind its back.
    const elsewhere = await dataStore.saveSessionState(sessionId, {
      ...structuredClone(initial),
      happiness: { fac1: 5 },
      phase: 'GROUP',
      _rev: cachedRev
    });
    expect(elsewhere).toMatchObject({ success: true, data: { _rev: rev + 2 } });
    expect((sessionCache.get(sessionId) as SessionBlob)._rev).toBe(rev + 1);

    const paulEvents = record(paul);
    paul.emit('update-session', { ...structuredClone(initial), tickets: [ticket('t1')], _rev: rev });
    await once(paul, 'session-update');

    expect(paulEvents.map((e) => e.event)).toEqual(['session-update-refused', 'session-update']);
    expect(paulEvents[0].payload).toEqual({ sessionId, reason: 'stale', rev: rev + 2 });
    expect(paulEvents[1].payload).toMatchObject({ phase: 'GROUP', happiness: { fac1: 5 }, _rev: rev + 2 });
    // The pod learned the newer row too, so the next stale write is answered
    // from memory with the right state.
    expect((sessionCache.get(sessionId) as SessionBlob)._rev).toBe(rev + 2);
    const stored = await dataStore.loadSessionState(sessionId) as SessionBlob;
    expect(stored).toMatchObject({ _rev: rev + 2, tickets: [] });
  }, 20000);

  it('refuses a facilitator’s phase change whole when the team record cannot be read to confirm the role', async () => {
    // Restoring facilitator-only fields is right for a confirmed participant.
    // For a sender whose role could not be established — the team record read
    // threw — it would split a facilitator's gesture in two: the phase put
    // back, the timer reset that goes with it saved. Refuse the whole write,
    // as the guard did before restoring existed; the client re-sends it.
    const sessionId = 'iss-role-unknown';
    const { fiona, paul, rev, initial } = await setupSession(sessionId);

    // A reconnect (rolling update) during a database blip: the join cannot
    // read the team record either, so no role is known for this socket.
    failTeamRead = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fiona.emit('join-session', { sessionId, userId: 'fac1', userName: 'Fiona', sessionToken: teamToken });
    await once(fiona, 'session-update');
    await settle(100);

    const fionaEvents = record(fiona);
    const paulUpdates: SessionBlob[] = [];
    paul.on('session-update', (s: SessionBlob) => paulUpdates.push(s));
    const settings = (initial.settings ?? {}) as SessionBlob;
    fiona.emit('update-session', {
      ...structuredClone(initial),
      phase: 'GROUP',
      settings: { ...settings, timerRunning: true, timerSeconds: 600, timerStartedAt: 1760000000000 }
    });
    await once(fiona, 'session-update');
    await settle();

    expect(fionaEvents.map((e) => e.event)).toEqual(['session-update-refused', 'session-update']);
    expect(fionaEvents[0].payload).toEqual({ sessionId, reason: 'protected-fields', fields: ['phase'], rev });
    expect(fionaEvents[1].payload).toMatchObject({ phase: 'BRAINSTORM', _rev: rev, settings: { timerRunning: false } });
    expect(paulUpdates).toHaveLength(0);
    const stored = await dataStore.loadSessionState(sessionId) as SessionBlob;
    expect(stored).toMatchObject({ phase: 'BRAINSTORM', _rev: rev, settings: { timerRunning: false } });
    expect((stored.settings as SessionBlob).timerStartedAt).toBeUndefined();

    // Once the record reads again the role is known and the same gesture lands.
    failTeamRead = false;
    fiona.emit('update-session', {
      ...structuredClone(initial),
      phase: 'GROUP',
      settings: { ...settings, timerRunning: true, timerSeconds: 600, timerStartedAt: 1760000000000 }
    });
    const { rev: landed } = await once<{ rev: number }>(fiona, 'session-ack');
    expect(landed).toBe(rev + 1);
    expect(await dataStore.loadSessionState(sessionId)).toMatchObject({ phase: 'GROUP', settings: { timerRunning: true } });
  }, 20000);

  it('still restores rather than refuses when the team record confirms a participant', async () => {
    // The unknown-role refusal must not bring back incident ISS for the
    // ordinary case: a participant the roster names keeps its cards.
    const sessionId = 'iss-role-confirmed';
    const { paul, rev, initial } = await setupSession(sessionId);

    paul.emit('update-session', { ...structuredClone(initial), phase: 'GROUP', tickets: [ticket('t1')] });
    const { rev: landed } = await once<{ rev: number }>(paul, 'session-ack');

    expect(landed).toBe(rev + 1);
    expect(await dataStore.loadSessionState(sessionId)).toMatchObject({ phase: 'BRAINSTORM', tickets: [ticket('t1')] });
  }, 20000);

  it('refuses a teamId change as immutable, for the facilitator too', async () => {
    const { fiona, rev, initial } = await setupSession('iss-immutable');
    const fionaEvents = record(fiona);

    fiona.emit('update-session', { ...structuredClone(initial), teamId: 'teamB', tickets: [ticket('t1', 'fac1')] });
    await once(fiona, 'session-update');

    expect(fionaEvents.map((e) => e.event)).toEqual(['session-update-refused', 'session-update']);
    expect(fionaEvents[0].payload).toEqual({ sessionId: 'iss-immutable', reason: 'immutable', rev });
    const stored = await dataStore.loadSessionState('iss-immutable') as SessionBlob;
    expect(stored).toMatchObject({ teamId: 'teamA', _rev: rev, tickets: [] });
  }, 20000);

  it('refuses a participant write whose leftUsers or settings cannot be restored field by field', async () => {
    const { paul, rev, initial } = await setupSession('iss-malformed');

    for (const malformed of [{ leftUsers: 'fac1' }, { settings: 'open' }]) {
      const paulEvents = record(paul);
      paul.emit('update-session', { ...structuredClone(initial), ...malformed, tickets: [ticket('t1')] });
      await once(paul, 'session-update');
      paul.offAny();

      expect(paulEvents.map((e) => e.event)).toEqual(['session-update-refused', 'session-update']);
      expect(paulEvents[0].payload).toMatchObject({ sessionId: 'iss-malformed', reason: 'malformed', rev });
    }
    const stored = await dataStore.loadSessionState('iss-malformed') as SessionBlob;
    expect(stored).toMatchObject({ _rev: rev, tickets: [] });
  }, 20000);

  it('answers a write from a socket that never joined instead of dropping it silently', async () => {
    // A write that reaches the server before (or without) a join used to be
    // logged and dropped: no ack, no heal, nothing the client could act on.
    const stranger = await connect();
    const events = record(stranger);

    stranger.emit('update-session', baseSession('iss-nowhere'));
    stranger.emit('update-session', { ...baseSession('x'), id: 42 });
    await settle();

    expect(events).toEqual([
      { event: 'session-update-refused', payload: { sessionId: 'iss-nowhere', reason: 'not-joined' } },
      { event: 'session-update-refused', payload: { sessionId: null, reason: 'not-joined' } }
    ]);
    expect(await dataStore.loadSessionState('iss-nowhere')).toBeNull();
  }, 20000);

  it('restores the facilitator-only fields in degraded mode too, with the same emit order', async () => {
    const { fiona, paul, rev, initial } = await setupSession('iss-degraded');
    const paulEvents = record(paul);
    const fionaSaw = once<SessionBlob>(fiona, 'session-update');

    failPersistence = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    paul.emit('update-session', { ...structuredClone(initial), name: 'Retro A', tickets: [ticket('t1')] });
    await once(paul, 'session-ack');

    expect(paulEvents.map((e) => e.event)).toEqual(['session-update', 'session-ack']);
    expect(paulEvents[0].payload).toMatchObject({ name: 'Retro B', _rev: rev + 1, tickets: [ticket('t1')] });
    const broadcast = await fionaSaw;
    expect(broadcast).toMatchObject({ name: 'Retro B', tickets: [ticket('t1')] });
  }, 20000);

  it('logs a refusal loop in at most two lines, naming the field and both values', async () => {
    // The incident's loop ran ~3 writes a second and logged every one, which
    // flushed the 1000-line log ring the super admin investigates from.
    const { paul, initial } = await setupSession('iss-log-flood');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    for (let i = 0; i < 50; i++) {
      paul.emit('update-session', { ...structuredClone(initial), name: 'Retro A' });
      await once(paul, 'session-update');
    }
    paul.emit('leave-session', { sessionId: 'iss-log-flood' });
    await settle();

    const lines = (spy: typeof warn) =>
      spy.mock.calls.map((args) => args.map(String).join(' ')).filter((line) => line.includes('iss-log-flood'));
    const warnLines = lines(warn);
    expect(warnLines.length).toBeGreaterThanOrEqual(1);
    expect(warnLines.length).toBeLessThanOrEqual(2);
    expect(warnLines[0]).toContain('Paul');
    expect(warnLines[0]).toContain('participant');
    expect(warnLines[0]).toContain('name: sent "Retro A" vs stored "Retro B"');
    expect(warnLines[1]).toMatch(/repeated 49 times in \d+s/);
    // A refused write is not "a session update" in the activity trail either.
    expect(lines(log).filter((line) => line.includes('Session update from'))).toEqual([]);
  }, 30000);

  it('truncates a long value in the refusal line and escapes it', async () => {
    const { paul, initial } = await setupSession('iss-log-escape');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    paul.emit('update-session', { ...structuredClone(initial), name: `Line\nbreak ${'x'.repeat(200)}` });
    await once(paul, 'session-update');

    const line = warn.mock.calls.map((args) => args.map(String).join(' ')).find((l) => l.includes('iss-log-escape'));
    expect(line).toBeDefined();
    expect(line).not.toContain('\n');
    expect(line).toContain('sent "Line\\nbreak xxx');
    expect(line!.length).toBeLessThan(400);
  }, 20000);
});
