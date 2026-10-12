// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createBoundedCache } from '../server/services/boundedCache.js';
import { createTeamService } from '../server/services/teamService.js';
import { createLiveSessionRename } from '../server/services/liveSessionRename.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * Incident ISS (2026-10-12) began with a rename. The facilitator renamed a
 * retro on the Dashboard while it was being run; the rename route wrote the
 * team record and nothing else, so the live session — the copy every
 * participant syncs — kept the old name. From then on two copies disagreed,
 * and a client that corrected one from the other was writing a facilitator-only
 * field. The rename routes now carry the new name into the live session too,
 * through the same compare-and-swap every socket write uses.
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

const createFakeIo = () => {
  const emitted: { room: string; event: string; payload: SessionBlob }[] = [];
  return {
    emitted,
    to: (room: string) => ({
      emit: (event: string, payload: SessionBlob) => {
        emitted.push({ room, event, payload });
      }
    })
  };
};

const session = (id: string, overrides: SessionBlob = {}): SessionBlob => ({
  id,
  teamId: 'teamA',
  name: 'Sprint 12',
  phase: 'BRAINSTORM',
  tickets: [],
  _rev: 0,
  ...overrides
});

let dir: string;
let dataStore: ReturnType<typeof createDataStore>;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of PG_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'retro-live-rename-'));
  process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
  dataStore = createDataStore({ rootDir: dir });
  await dataStore.initDatabase();
});

afterAll(() => {
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

describe('createLiveSessionRename', () => {
  let io: ReturnType<typeof createFakeIo>;
  let sessionCache: ReturnType<typeof createBoundedCache>;

  beforeEach(() => {
    io = createFakeIo();
    sessionCache = createBoundedCache({ max: 10 });
  });

  it('renames the live session through the compare-and-swap and tells the room', async () => {
    const created = await dataStore.saveSessionState('lr-renamed', session('lr-renamed'));
    const rename = createLiveSessionRename({ dataStore, sessionCache, io });

    expect(await rename({ teamId: 'teamA', sessionId: 'lr-renamed', name: 'Sprint 12 — retro' })).toBe('renamed');

    const stored = await dataStore.loadSessionState('lr-renamed') as SessionBlob;
    // The revision moves: that is how every connected client learns of it.
    expect(stored).toMatchObject({ name: 'Sprint 12 — retro', _rev: (created.data._rev as number) + 1 });
    expect(sessionCache.get('lr-renamed')).toEqual(stored);
    expect(io.emitted).toEqual([{ room: 'lr-renamed', event: 'session-update', payload: stored }]);
  });

  it('leaves a session of another team alone', async () => {
    await dataStore.saveSessionState('lr-other', session('lr-other', { teamId: 'teamB' }));
    const rename = createLiveSessionRename({ dataStore, sessionCache, io });

    expect(await rename({ teamId: 'teamA', sessionId: 'lr-other', name: 'Hijacked' })).toBe('other-team');
    expect((await dataStore.loadSessionState('lr-other') as SessionBlob).name).toBe('Sprint 12');
    expect(io.emitted).toEqual([]);
  });

  it('does nothing for a retro that is not being run, or already has the name', async () => {
    const rename = createLiveSessionRename({ dataStore, sessionCache, io });
    expect(await rename({ teamId: 'teamA', sessionId: 'lr-none', name: 'x' })).toBe('no-session');

    const created = await dataStore.saveSessionState('lr-same', session('lr-same'));
    expect(await rename({ teamId: 'teamA', sessionId: 'lr-same', name: 'Sprint 12' })).toBe('unchanged');
    expect((await dataStore.loadSessionState('lr-same') as SessionBlob)._rev).toBe(created.data._rev);
    expect(io.emitted).toEqual([]);
  });

  it('retries when a participant’s write lands between its read and its save, and keeps that write', async () => {
    await dataStore.saveSessionState('lr-race', session('lr-race'));
    let raced = false;
    const racingStore = {
      ...dataStore,
      saveSessionState: async (sessionId: string, data: SessionBlob) => {
        if (!raced) {
          raced = true;
          const current = await dataStore.loadSessionState(sessionId) as SessionBlob;
          await dataStore.saveSessionState(sessionId, { ...current, tickets: [{ id: 't1' }] });
        }
        return dataStore.saveSessionState(sessionId, data);
      }
    };
    const rename = createLiveSessionRename({ dataStore: racingStore, sessionCache, io });

    expect(await rename({ teamId: 'teamA', sessionId: 'lr-race', name: 'Renamed' })).toBe('renamed');
    expect(await dataStore.loadSessionState('lr-race')).toMatchObject({ name: 'Renamed', tickets: [{ id: 't1' }] });
  });

  it('gives up after three attempts on a session that keeps changing, and says so', async () => {
    await dataStore.saveSessionState('lr-busy', session('lr-busy'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const save = vi.fn(async () => ({ success: false, stale: true, data: null }));
    const rename = createLiveSessionRename({ dataStore: { ...dataStore, saveSessionState: save }, sessionCache, io });

    expect(await rename({ teamId: 'teamA', sessionId: 'lr-busy', name: 'Renamed' })).toBe('conflict');
    expect(save).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(io.emitted).toEqual([]);
    warn.mockRestore();
  });

  it('never throws: a store failure is logged and reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = { ...dataStore, loadSessionState: async () => { throw new Error('db down'); } };
    const rename = createLiveSessionRename({ dataStore: failing, sessionCache, io });

    await expect(rename({ teamId: 'teamA', sessionId: 'lr-fail', name: 'x' })).resolves.toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('the rename routes carry the new name into the live session', () => {
  const tokenService = {
    createSessionToken: (teamId: string) => `session-${teamId}`,
    validateSessionToken: (token: string) =>
      token?.startsWith('session-') ? { teamId: token.slice('session-'.length), visitorId: null } : null,
    invalidateSessionToken: () => {},
    createInviteCredential: () => 'invite',
    validateInviteCredential: () => null,
    validateSuperAdminAuth: () => false
  };

  const buildApp = (liveSessionRename?: Parameters<typeof registerTeamRoutes>[0]['liveSessionRename']) => {
    const app = express();
    app.use(express.json());
    registerTeamRoutes({
      app,
      dataStore,
      teamService: createTeamService({ dataStore, tokenService }),
      tokenService,
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: () => {} },
      escapeHtml: (s: string) => s,
      ...(liveSessionRename ? { liveSessionRename } : {})
    });
    return new Promise<{ post: (path: string, body: unknown) => Promise<Response>; close: () => Promise<void> }>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          post: (path, body) =>
            fetch(`http://127.0.0.1:${port}${path}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }),
          close: () => new Promise((res) => server.close(() => res()))
        });
      });
    });
  };

  const seedTeam = async (teamId: string) => {
    await dataStore.saveTeam(teamId, {
      id: teamId,
      name: `Team ${teamId}`,
      passwordHash: 'x',
      members: [],
      retrospectives: [{ id: `${teamId}-r1`, name: 'Sprint 12', status: 'IN_PROGRESS', actions: [], _rev: 7 }],
      healthChecks: [{ id: `${teamId}-h1`, name: 'Q3 check', status: 'IN_PROGRESS', actions: [], _rev: 3 }],
      globalActions: []
    });
  };

  it('renames a retrospective’s live session and broadcasts it, leaving the team record revision alone', async () => {
    await seedTeam('teamR');
    await dataStore.saveSessionState('teamR-r1', session('teamR-r1', { teamId: 'teamR' }));
    const io = createFakeIo();
    const sessionCache = createBoundedCache({ max: 10 });
    const app = await buildApp(createLiveSessionRename({ dataStore, sessionCache, io }));

    const res = await app.post('/api/team/teamR/retrospective/teamR-r1/name', { sessionToken: 'session-teamR', name: 'Sprint 12 — retro' });
    expect(res.status).toBe(200);

    await vi.waitFor(async () => {
      expect((await dataStore.loadSessionState('teamR-r1') as SessionBlob).name).toBe('Sprint 12 — retro');
    });
    expect(io.emitted.map((e) => [e.room, e.event, e.payload.name])).toEqual([['teamR-r1', 'session-update', 'Sprint 12 — retro']]);
    const team = await dataStore.loadTeam('teamR') as { retrospectives: { name: string; _rev: number }[] };
    expect(team.retrospectives[0]).toMatchObject({ name: 'Sprint 12 — retro', _rev: 7 });
    await app.close();
  });

  it('renames a health check’s live session too', async () => {
    await seedTeam('teamH');
    await dataStore.saveSessionState('teamH-h1', session('teamH-h1', { teamId: 'teamH', name: 'Q3 check' }));
    const app = await buildApp(createLiveSessionRename({ dataStore, sessionCache: createBoundedCache({ max: 10 }), io: createFakeIo() }));

    const res = await app.post('/api/team/teamH/healthcheck/teamH-h1/name', { sessionToken: 'session-teamH', name: 'Q3 team health' });
    expect(res.status).toBe(200);

    await vi.waitFor(async () => {
      expect((await dataStore.loadSessionState('teamH-h1') as SessionBlob).name).toBe('Q3 team health');
    });
    await app.close();
  });

  it('heals a session that kept an older name when the rename is repeated', async () => {
    // The state the incident left behind: team record renamed, session not.
    await seedTeam('teamS');
    await dataStore.saveSessionState('teamS-r1', session('teamS-r1', { teamId: 'teamS', name: 'Before the rename' }));
    const app = await buildApp(createLiveSessionRename({ dataStore, sessionCache: createBoundedCache({ max: 10 }), io: createFakeIo() }));

    const res = await app.post('/api/team/teamS/retrospective/teamS-r1/name', { sessionToken: 'session-teamS', name: 'Sprint 12' });
    expect(res.status).toBe(200);

    await vi.waitFor(async () => {
      expect((await dataStore.loadSessionState('teamS-r1') as SessionBlob).name).toBe('Sprint 12');
    });
    await app.close();
  });

  it('answers without waiting for the live session, and is not failed by it', async () => {
    await seedTeam('teamW');
    const hanging = vi.fn(() => new Promise<string>(() => {}));
    const app = await buildApp(hanging);
    const res = await app.post('/api/team/teamW/retrospective/teamW-r1/name', { sessionToken: 'session-teamW', name: 'Never waits' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(hanging).toHaveBeenCalledWith({ teamId: 'teamW', sessionId: 'teamW-r1', name: 'Never waits' }));
    await app.close();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn(async () => { throw new Error('boom'); });
    const failingApp = await buildApp(failing);
    const failed = await failingApp.post('/api/team/teamW/retrospective/teamW-r1/name', { sessionToken: 'session-teamW', name: 'Still renamed' });
    expect(failed.status).toBe(200);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
    await failingApp.close();
  });

  it('does not touch any session for a rename that found nothing', async () => {
    await seedTeam('teamN');
    const renamer = vi.fn(async () => 'renamed');
    const app = await buildApp(renamer);
    const res = await app.post('/api/team/teamN/retrospective/missing/name', { sessionToken: 'session-teamN', name: 'x' });
    expect(res.status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(renamer).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('wired into the real server', () => {
  it('passes the live-session rename, built on the socket handlers’ own cache, to the team routes', () => {
    // `registerTeamRoutes` defaults it to a no-op so the other route suites
    // need no session store — which is also what would let a forgotten
    // argument here leave every suite green and production renaming the team
    // record only, the state the incident started from. A source check: it
    // proves the argument is written, not that it runs (the same limit the
    // H45 wiring check states).
    const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

    const call = (name: string) => {
      const start = source.indexOf(`${name}({`);
      expect(start, `${name} is not called in server.js`).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf('})', start));
    };

    expect(call('registerTeamRoutes')).toContain('liveSessionRename');
    const factory = call('createLiveSessionRename');
    expect(factory).toContain('sessionCache');
    expect(factory).toContain('io');
    expect(factory).toContain('dataStore');
    // The same cache instance the socket handlers read and write.
    expect(call('registerSocketHandlers')).toContain('sessionCache');
    expect(source.match(/createBoundedCache\(/g)).toHaveLength(1);
  });
});
