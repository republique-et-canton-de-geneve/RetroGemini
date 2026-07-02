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
import { findProtectedFieldViolations } from '../server/services/sessionGuard.js';

// Server-side authorization of `update-session`. The UI only *hides* the
// facilitator controls (phase navigation, reveal toggles, vote allocation,
// column editing...), so before this guard any participant socket could send a
// full session blob that changed those fields and the server persisted and
// broadcast it. These tests prove the server itself now rejects a
// non-facilitator write that alters facilitator-only state, while every
// legitimate participant flow (tickets, votes, happiness/ROTI, timer-expiry
// sync, alarm acknowledgement) still goes through.
//
// The last describe covers the persistence-failure path: it used to cache and
// broadcast the raw client blob without any revision check, letting a stale
// snapshot clobber newer state for every connected client whenever the
// database hiccupped. It now applies the same compare-and-swap against the
// in-memory cache (degraded mode).

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

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

const baseSession = (id: string, overrides: SessionBlob = {}): SessionBlob => ({
  id,
  teamId: 'teamA',
  name: 'Sprint 12 Retro',
  date: '2026-07-01',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  icebreakerQuestion: 'What made you smile this sprint?',
  columns: [
    { id: 'c1', title: 'Went well', color: 'bg-emerald-100', border: 'border-emerald-300', icon: 'thumb_up', text: 'text-emerald-700', ring: 'ring-emerald-200' }
  ],
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

describe('sessionGuard.findProtectedFieldViolations', () => {
  const authoritative = baseSession('s0', { _rev: 1 });

  const modified = (mutate: (blob: SessionBlob) => void): SessionBlob => {
    const blob = structuredClone(authoritative);
    mutate(blob);
    return blob;
  };

  it('reports no violation for an identical blob', () => {
    expect(findProtectedFieldViolations(structuredClone(authoritative), authoritative)).toEqual([]);
  });

  it('flags a phase change', () => {
    const incoming = modified((b) => { b.phase = 'CLOSE'; });
    expect(findProtectedFieldViolations(incoming, authoritative)).toContain('phase');
  });

  it('flags facilitator-only settings changes', () => {
    const incoming = modified((b) => {
      (b.settings as SessionBlob).revealBrainstorm = true;
      (b.settings as SessionBlob).maxVotes = 99;
    });
    const violations = findProtectedFieldViolations(incoming, authoritative);
    expect(violations).toContain('settings.revealBrainstorm');
    expect(violations).toContain('settings.maxVotes');
  });

  it('flags column edits and icebreaker changes', () => {
    const incoming = modified((b) => {
      (b.columns as SessionBlob[])[0].title = 'Hacked';
      b.icebreakerQuestion = 'Changed';
    });
    const violations = findProtectedFieldViolations(incoming, authoritative);
    expect(violations).toContain('columns');
    expect(violations).toContain('icebreakerQuestion');
  });

  it('ignores participant-writable data (tickets, votes, happiness, finishedUsers)', () => {
    const incoming = modified((b) => {
      b.tickets = [{ id: 't1', colId: 'c1', text: 'New ticket', authorId: 'par1', groupId: null, votes: ['par1'] }];
      b.happiness = { par1: 4 };
      b.finishedUsers = ['par1'];
      b.discussionNextTopicVotes = { t1: ['par1'] };
    });
    expect(findProtectedFieldViolations(incoming, authoritative)).toEqual([]);
  });

  it('ignores timer runtime fields and the participants panel toggle', () => {
    // Every client syncs timer expiry and alarm acknowledgement, and any user
    // can toggle the participants panel in health checks — these must never be
    // rejected.
    const incoming = modified((b) => {
      const settings = b.settings as SessionBlob;
      settings.timerRunning = true;
      settings.timerSeconds = 0;
      settings.timerStartedAt = Date.now();
      settings.timerAcknowledged = true;
      settings.participantsPanelCollapsed = true;
    });
    expect(findProtectedFieldViolations(incoming, authoritative)).toEqual([]);
  });

  it('treats null and undefined as equivalent', () => {
    const withNull = modified((b) => { b.discussionFocusId = null; });
    expect(findProtectedFieldViolations(withNull, authoritative)).toEqual([]);
  });

  it('is insensitive to object key order', () => {
    const incoming = modified((b) => {
      const col = (b.columns as SessionBlob[])[0];
      (b.columns as SessionBlob[])[0] = { ring: col.ring, title: col.title, id: col.id, color: col.color, border: col.border, icon: col.icon, text: col.text };
    });
    expect(findProtectedFieldViolations(incoming, authoritative)).toEqual([]);
  });

  it('flags a blob that drops the settings object entirely', () => {
    const incoming = modified((b) => { delete b.settings; });
    expect(findProtectedFieldViolations(incoming, authoritative).length).toBeGreaterThan(0);
  });
});

describe('update-session authorization (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  let failPersistence = false;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-authz-'));
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

    // Same store, but persistence can be switched off to simulate a database
    // outage (degraded-mode tests below).
    const flakyStore = {
      ...dataStore,
      saveSessionState: (...args: Parameters<typeof dataStore.saveSessionState>) => {
        if (failPersistence) return Promise.reject(new Error('simulated database outage'));
        return dataStore.saveSessionState(...args);
      }
    };

    httpServer = createServer();
    io = new Server(httpServer, { path: '/socket.io' });
    registerSocketHandlers({ io, dataStore: flakyStore, sessionCache: createBoundedCache({ max: 100 }) });
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

  const joinSession = async (socket: Socket, sessionId: string, userId: string, userName: string) => {
    socket.emit('join-session', { sessionId, userId, userName });
    await once(socket, 'member-roster');
  };

  const sendAccepted = async (socket: Socket, session: SessionBlob): Promise<number> => {
    socket.emit('update-session', session);
    const ack = await once<{ rev: number }>(socket, 'session-ack');
    return ack.rev;
  };

  // Facilitator creates the session, participant joins and receives it.
  const setupSession = async (sessionId: string, overrides: SessionBlob = {}) => {
    const fiona = await connect();
    await joinSession(fiona, sessionId, 'fac1', 'Fiona');
    const rev = await sendAccepted(fiona, baseSession(sessionId, overrides));

    const paul = await connect();
    paul.emit('join-session', { sessionId, userId: 'par1', userName: 'Paul' });
    const initial = await once<SessionBlob>(paul, 'session-update');
    return { fiona, paul, rev, initial };
  };

  it('rejects a participant write that changes the phase', async () => {
    const { fiona, paul, rev, initial } = await setupSession('authz-phase');

    const fionaUpdates: SessionBlob[] = [];
    fiona.on('session-update', (s: SessionBlob) => fionaUpdates.push(s));

    const heal = once<SessionBlob>(paul, 'session-update');
    const attack = structuredClone(initial);
    attack.phase = 'CLOSE';
    attack.status = 'CLOSED';
    paul.emit('update-session', attack);

    // The sender is resynced with the authoritative state...
    const healed = await heal;
    expect(healed.phase).toBe('BRAINSTORM');
    expect(healed._rev).toBe(rev);

    // ...nothing is broadcast to the others, and nothing is persisted.
    await settle();
    expect(fionaUpdates).toHaveLength(0);
    const stored = await dataStore.loadSessionState('authz-phase') as SessionBlob;
    expect(stored.phase).toBe('BRAINSTORM');
    expect(stored.status).toBe('IN_PROGRESS');
    expect(stored._rev).toBe(rev);
  }, 20000);

  it('rejects a participant write that flips reveal settings or vote allocation', async () => {
    const { fiona, paul, rev, initial } = await setupSession('authz-settings');

    const fionaUpdates: SessionBlob[] = [];
    fiona.on('session-update', (s: SessionBlob) => fionaUpdates.push(s));

    const heal = once<SessionBlob>(paul, 'session-update');
    const attack = structuredClone(initial);
    (attack.settings as SessionBlob).revealBrainstorm = true;
    (attack.settings as SessionBlob).maxVotes = 100;
    paul.emit('update-session', attack);

    const healed = await heal;
    expect((healed.settings as SessionBlob).revealBrainstorm).toBe(false);

    await settle();
    expect(fionaUpdates).toHaveLength(0);
    const stored = await dataStore.loadSessionState('authz-settings') as SessionBlob;
    expect((stored.settings as SessionBlob).revealBrainstorm).toBe(false);
    expect((stored.settings as SessionBlob).maxVotes).toBe(3);
    expect(stored._rev).toBe(rev);
  }, 20000);

  it('accepts a participant write that adds a ticket, votes and finishes', async () => {
    const { fiona, paul, rev, initial } = await setupSession('authz-ticket');

    const broadcast = once<SessionBlob>(fiona, 'session-update');
    const update = structuredClone(initial);
    update.tickets = [{ id: 't1', colId: 'c1', text: 'More pairing', authorId: 'par1', groupId: null, votes: ['par1'] }];
    update.happiness = { par1: 4 };
    update.finishedUsers = ['par1'];
    const newRev = await sendAccepted(paul, update);
    expect(newRev).toBe(rev + 1);

    const received = await broadcast;
    expect((received.tickets as SessionBlob[])).toHaveLength(1);

    const stored = await dataStore.loadSessionState('authz-ticket') as SessionBlob;
    expect((stored.tickets as SessionBlob[])).toHaveLength(1);
    expect(stored.happiness).toEqual({ par1: 4 });
  }, 20000);

  it('accepts a participant write that syncs timer expiry and acknowledges the alarm', async () => {
    const { fiona, paul, rev, initial } = await setupSession('authz-timer');

    // Facilitator starts the timer.
    const running = structuredClone(initial);
    (running.settings as SessionBlob).timerRunning = true;
    (running.settings as SessionBlob).timerStartedAt = Date.now() - 301000;
    (running.settings as SessionBlob).timerInitial = 300;
    const paulSawTimerStart = once(paul, 'session-update');
    const runningRev = await sendAccepted(fiona, { ...running, _rev: rev });
    await paulSawTimerStart;

    // Paul's client is the first to see the timer hit zero and syncs the end
    // state — a legitimate every-client write.
    const expiry = structuredClone(running);
    expiry._rev = runningRev;
    (expiry.settings as SessionBlob).timerRunning = false;
    (expiry.settings as SessionBlob).timerSeconds = 0;
    (expiry.settings as SessionBlob).timerAcknowledged = false;
    const expiryRev = await sendAccepted(paul, expiry);
    expect(expiryRev).toBe(runningRev + 1);

    // Paul acknowledges the alarm.
    const ack = structuredClone(expiry);
    ack._rev = expiryRev;
    (ack.settings as SessionBlob).timerAcknowledged = true;
    (ack.settings as SessionBlob).timerSeconds = 300;
    (ack.settings as SessionBlob).timerStartedAt = undefined;
    const ackRev = await sendAccepted(paul, ack);
    expect(ackRev).toBe(expiryRev + 1);
  }, 20000);

  it('accepts facilitator writes that change phase, columns and reveal settings', async () => {
    const { fiona, paul, rev, initial } = await setupSession('authz-facilitator');

    const broadcast = once<SessionBlob>(paul, 'session-update');
    const update = structuredClone(initial);
    update.phase = 'GROUP';
    (update.settings as SessionBlob).revealBrainstorm = true;
    (update.columns as SessionBlob[]).push({ id: 'c2', title: 'To improve', color: 'bg-rose-100', border: 'border-rose-300', icon: 'build', text: 'text-rose-700', ring: 'ring-rose-200' });
    const newRev = await sendAccepted(fiona, { ...update, _rev: rev });
    expect(newRev).toBe(rev + 1);

    const received = await broadcast;
    expect(received.phase).toBe('GROUP');
    const stored = await dataStore.loadSessionState('authz-facilitator') as SessionBlob;
    expect(stored.phase).toBe('GROUP');
    expect((stored.columns as SessionBlob[])).toHaveLength(2);
  }, 20000);

  it('rejects a teamId change from anyone, including the facilitator', async () => {
    const { fiona, rev } = await setupSession('authz-teamid');

    const heal = once<SessionBlob>(fiona, 'session-update');
    const hijack = baseSession('authz-teamid', { teamId: 'teamB', _rev: rev });
    fiona.emit('update-session', hijack);

    const healed = await heal;
    expect(healed.teamId).toBe('teamA');

    const stored = await dataStore.loadSessionState('authz-teamid') as SessionBlob;
    expect(stored.teamId).toBe('teamA');
    expect(stored._rev).toBe(rev);
  }, 20000);

  it('treats a user who is not a team member as a participant', async () => {
    const { fiona, rev } = await setupSession('authz-stranger');

    const fionaUpdates: SessionBlob[] = [];
    fiona.on('session-update', (s: SessionBlob) => fionaUpdates.push(s));

    const mallory = await connect();
    mallory.emit('join-session', { sessionId: 'authz-stranger', userId: 'mallory1', userName: 'Mallory' });
    const initial = await once<SessionBlob>(mallory, 'session-update');

    const heal = once<SessionBlob>(mallory, 'session-update');
    const attack = structuredClone(initial);
    attack.phase = 'CLOSE';
    mallory.emit('update-session', attack);

    const healed = await heal;
    expect(healed.phase).toBe('BRAINSTORM');

    await settle();
    expect(fionaUpdates).toHaveLength(0);
    const stored = await dataStore.loadSessionState('authz-stranger') as SessionBlob;
    expect(stored.phase).toBe('BRAINSTORM');
    expect(stored._rev).toBe(rev);
  }, 20000);

  it('survives malformed update payloads', async () => {
    const { fiona, paul, rev, initial } = await setupSession('authz-malformed');

    paul.emit('update-session', null);
    paul.emit('update-session', 42);
    paul.emit('update-session', [1, 2, 3]);
    paul.emit('update-session', { id: 'some-other-session', phase: 'CLOSE' });
    await settle();

    // The server is still alive and processes a valid write.
    const update = structuredClone(initial);
    update.tickets = [{ id: 't1', colId: 'c1', text: 'Still alive', authorId: 'par1', groupId: null, votes: [] }];
    const newRev = await sendAccepted(paul, update);
    expect(newRev).toBe(rev + 1);

    const stored = await dataStore.loadSessionState('authz-malformed') as SessionBlob;
    expect(stored.phase).toBe('BRAINSTORM');
    void fiona;
  }, 20000);

  describe('degraded mode: persistence failure', () => {
    it('still rejects a stale blob instead of broadcasting it, and keeps live collaboration going', async () => {
      const { fiona, paul, rev, initial } = await setupSession('authz-outage');

      // Advance once more so the cache holds rev+1 while a stale client is
      // still on `rev`.
      const fresh = structuredClone(initial);
      fresh.tickets = [{ id: 't1', colId: 'c1', text: 'First', authorId: 'fac1', groupId: null, votes: [] }];
      const paulSawFresh = once(paul, 'session-update');
      const rev2 = await sendAccepted(fiona, { ...fresh, _rev: rev });
      await paulSawFresh;

      failPersistence = true;
      try {
        // A stale participant snapshot (built on rev, before t1 existed) must
        // not clobber the cached state nor reach the other clients — even
        // though the database is down and the CAS cannot run there.
        const fionaUpdates: SessionBlob[] = [];
        fiona.on('session-update', (s: SessionBlob) => fionaUpdates.push(s));

        const heal = once<SessionBlob>(paul, 'session-update');
        const stale = structuredClone(initial);
        stale.tickets = [];
        stale._rev = rev; // built before rev2
        paul.emit('update-session', stale);

        const healed = await heal;
        expect(healed._rev).toBe(rev2);
        expect((healed.tickets as SessionBlob[])).toHaveLength(1);
        await settle();
        expect(fionaUpdates).toHaveLength(0);

        // An up-to-date write keeps flowing during the outage (zero-downtime):
        // accepted from the in-memory cache, broadcast and acked with a bumped
        // rev.
        const broadcast = once<SessionBlob>(paul, 'session-update');
        const live = structuredClone(fresh);
        (live.tickets as SessionBlob[]).push({ id: 't2', colId: 'c1', text: 'Second', authorId: 'fac1', groupId: null, votes: [] });
        live._rev = rev2;
        const rev3 = await sendAccepted(fiona, live);
        expect(rev3).toBe(rev2 + 1);
        const received = await broadcast;
        expect((received.tickets as SessionBlob[])).toHaveLength(2);

        // The database never saw the writes made during the outage.
        const storedDuringOutage = await dataStore.loadSessionState('authz-outage') as SessionBlob;
        expect(storedDuringOutage._rev).toBe(rev2);
      } finally {
        failPersistence = false;
      }

      // After recovery the next write persists with a monotonically advanced
      // rev — the in-memory revs never went backwards.
      const afterRecovery = structuredClone(initial);
      afterRecovery.tickets = [
        { id: 't1', colId: 'c1', text: 'First', authorId: 'fac1', groupId: null, votes: [] },
        { id: 't2', colId: 'c1', text: 'Second', authorId: 'fac1', groupId: null, votes: [] },
        { id: 't3', colId: 'c1', text: 'Third', authorId: 'fac1', groupId: null, votes: [] }
      ];
      afterRecovery._rev = rev2 + 1;
      const rev4 = await sendAccepted(fiona, afterRecovery);
      expect(rev4).toBe(rev2 + 2);
      const stored = await dataStore.loadSessionState('authz-outage') as SessionBlob;
      expect(stored._rev).toBe(rev4);
      expect((stored.tickets as SessionBlob[])).toHaveLength(3);
    }, 20000);
  });
});
