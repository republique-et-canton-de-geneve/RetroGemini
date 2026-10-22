// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import { createDataStore } from '../server/services/dataStore.js';
import { createBackupService } from '../server/services/backupService.js';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { hashPassword } from '../server/services/passwordHashing.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { SECURITY_ACTIONS } from '../server/services/securityEvents.js';

/**
 * Restoring one team from a stored backup, end to end on a real SQLite store.
 *
 * The promise to the administrator: the team chosen comes back as the backup
 * holds it, and **no other team moves**. Around that, what the whole-store
 * restore already guarantees (a protected snapshot first, an audit row), and
 * what only a single-team restore has to get right: the team keeps its current
 * password, a live session is put back too, a stale client cannot persist the
 * pre-restore state over it, and a deleted team returns with its feedbacks.
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

const SUPER_ADMIN_PASSWORD = 'super-admin-restore-test';
const OLD_PASSWORD = 'password-at-backup-time';
const NEW_PASSWORD = 'password-changed-since';
const OTHER_PASSWORD = 'password-other-team';

type Json = Record<string, any>;

let dir: string;
let dataStore: ReturnType<typeof createDataStore>;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of PG_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'retro-team-restore-'));
  process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
  dataStore = createDataStore({ rootDir: dir });
  await dataStore.initDatabase();
});

afterAll(async () => {
  await dataStore.closeDatabase?.();
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

let suffix = 0;

const indexTeam = async (team: Json) => {
  await dataStore.atomicTeamIndexUpdate((index: Map<string, string>) => {
    index.set(team.name.toLowerCase(), team.id);
    return index;
  });
};

/** Two teams; the first is the one an incident hits. */
const seedTeams = async () => {
  suffix += 1;
  const target = {
    id: `target${suffix}`,
    name: `Plateforme ${suffix}`,
    passwordHash: await hashPassword(OLD_PASSWORD),
    facilitatorEmail: 'lead@example.ch',
    members: [{ id: `admin${suffix}`, name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
    archivedMembers: [],
    customTemplates: [],
    retrospectives: [
      { id: `r1-${suffix}`, teamId: `target${suffix}`, name: 'Sprint 1', status: 'CLOSED', phase: 'CLOSE', tickets: [{ id: 'kept', text: 'Slow CI' }], actions: [], _rev: 4 },
      { id: `r2-${suffix}`, teamId: `target${suffix}`, name: 'Sprint 2', status: 'IN_PROGRESS', phase: 'BRAINSTORM', tickets: [], actions: [], _rev: 2 }
    ],
    healthChecks: [],
    globalActions: [{ id: `a1-${suffix}`, text: 'Fix the pipeline', done: false }],
    teamFeedbacks: [{ id: `f1-${suffix}`, teamId: `target${suffix}`, teamName: `Plateforme ${suffix}`, type: 'bug', title: 'Bug', comments: [] }]
  };
  const other = {
    id: `other${suffix}`,
    name: `Design ${suffix}`,
    passwordHash: await hashPassword(OTHER_PASSWORD),
    facilitatorEmail: 'design@example.ch',
    members: [{ id: `oadmin${suffix}`, name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
    archivedMembers: [],
    customTemplates: [],
    retrospectives: [],
    healthChecks: [],
    globalActions: []
  };
  for (const team of [target, other]) {
    await dataStore.saveTeam(team.id, team);
    await indexTeam(team);
  }
  return { target, other };
};

// `store` is a second connection to the same SQLite file when a case plays two
// pods: two connections share nothing in memory, as two pods do not.
const buildApp = (store: ReturnType<typeof createDataStore> = dataStore) => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const tokenService = createTokenService({
    secureCompare: (x: string, y: string) => x === y,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    tokenSecret: 'team-restore-route-test-secret'
  });
  const logService = { addServerLog: () => {}, getServerLogs: () => [], clearServerLogs: () => {} };
  const backupService = createBackupService({ dataStore: store, logService });
  const recorded: Json[] = [];
  const broadcasts: { room: string; event: string; data: Json }[] = [];
  const cache = new Map<string, Json>();
  const securityEvents = { record: async (_req: unknown, event: Json) => { recorded.push(event); } };

  registerTeamRoutes({
    app,
    dataStore: store,
    teamService: createTeamService({ dataStore: store, tokenService }),
    tokenService,
    mailerService: { smtpEnabled: false, mailer: null },
    logService,
    escapeHtml: (s: string) => s,
    securityEvents
  });
  registerSuperAdminRoutes({
    app,
    io: {
      emit: () => {},
      serverSideEmit: () => {},
      fetchSockets: async () => [],
      to: (room: string) => ({ emit: (event: string, data: Json) => { broadcasts.push({ room, event, data }); } })
    },
    dataStore: store,
    tokenService,
    mailerService: { smtpEnabled: false, mailer: null },
    logService,
    escapeHtml: (s: string) => s,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    sessionCache: { get: (id: string) => cache.get(id), set: (id: string, v: Json) => cache.set(id, v), has: (id: string) => cache.has(id), clear: () => cache.clear() },
    backupService,
    aiService: {},
    serverRuntime: { multiPodAdapter: false },
    securityEvents
  });

  return new Promise<{
    post: (path: string, body: Json) => Promise<{ status: number; body: Json }>;
    raw: (path: string, init: Parameters<typeof fetch>[1]) => Promise<Response>;
    close: () => Promise<void>;
    recorded: Json[];
    broadcasts: typeof broadcasts;
    cache: typeof cache;
    backupService: ReturnType<typeof createBackupService>;
  }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        post: async (path, body) => {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const text = await response.text();
          return { status: response.status, body: text ? JSON.parse(text) : {} };
        },
        raw: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init),
        close: () => new Promise((done) => server.close(() => done())),
        recorded,
        broadcasts,
        cache,
        backupService
      });
    });
  });
};

const admin = (body: Json) => ({ password: SUPER_ADMIN_PASSWORD, ...body });

describe('super-admin single-team restore', () => {
  let server: Awaited<ReturnType<typeof buildApp>>;
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(async () => {
    consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined)
    ];
    server = await buildApp();
  });

  afterEach(async () => {
    await server.close();
    for (const spy of consoleSpies) spy.mockRestore();
  });

  const takeBackup = async () => {
    const backup = await server.backupService.createBackup('manual', 'Before the incident');
    expect(backup).toBeTruthy();
    return backup!.id as string;
  };

  const restoreTeam = (backupId: string, teamId: string, extra: Json = {}) =>
    server.post('/api/super-admin/backups/restore-team', admin({ backupId, teamId, ...extra }));

  it('puts one team back as the backup holds it and leaves every other team as it is now', async () => {
    const { target, other } = await seedTeams();
    const backupId = await takeBackup();

    // The incident: a retro and the backlog of one team are gone, and its
    // password was changed since. Meanwhile the other team kept working.
    await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
      ...team,
      retrospectives: team.retrospectives.filter((r: Json) => r.id !== `r1-${suffix}`),
      globalActions: [],
      passwordHash: '' // replaced right below
    }));
    expect((await server.post('/api/super-admin/update-password', admin({ teamId: target.id, newPassword: NEW_PASSWORD }))).status).toBe(200);
    await dataStore.atomicTeamUpdate(other.id, (team: Json) => ({
      ...team,
      retrospectives: [{ id: `new-${suffix}`, teamId: other.id, name: 'Written after the backup', tickets: [], _rev: 1 }]
    }));

    const response = await restoreTeam(backupId, target.id);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      team: { id: target.id, name: target.name },
      recreated: false,
      counts: { retrospectives: 2, globalActions: 1 }
    });

    const restored = await dataStore.loadTeam(target.id);
    expect(restored.retrospectives.map((r: Json) => r.id)).toEqual([`r1-${suffix}`, `r2-${suffix}`]);
    expect(restored.retrospectives[0].tickets).toEqual([{ id: 'kept', text: 'Slow CI' }]);
    expect(restored.globalActions).toEqual([{ id: `a1-${suffix}`, text: 'Fix the pipeline', done: false }]);

    // The password set since still opens the team; the archived one does not.
    expect((await server.post('/api/team/login', { teamName: target.name, password: NEW_PASSWORD })).status).toBe(200);
    expect((await server.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD })).status).toBe(401);

    // The other team did not move.
    const untouched = await dataStore.loadTeam(other.id);
    expect(untouched.retrospectives.map((r: Json) => r.id)).toEqual([`new-${suffix}`]);
  });

  it('takes a protected snapshot first and records the restore in the audit trail', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();

    const response = await restoreTeam(backupId, target.id);
    expect(response.status).toBe(200);

    const backups = await server.backupService.listBackups();
    const snapshot = backups.find((entry: Json) => entry.id === response.body.preRestoreSnapshot);
    expect(snapshot).toMatchObject({ label: 'Pre-restore snapshot', protected: true });

    const event = server.recorded.find((entry) => entry.action === SECURITY_ACTIONS.TEAM_RESTORE);
    expect(event).toMatchObject({
      actor: 'super-admin',
      outcome: 'success',
      target: target.id,
      detail: { backupId, recreated: false, preRestoreSnapshot: snapshot!.id }
    });
  });

  it('puts a live session back too, above every copy a client can still persist', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    const sessionId = `r2-${suffix}`;

    // Sprint 2 is being run: its session row has moved on to revision 7 with a
    // card the backup does not have, and the record followed to 7.
    const live = { ...target.retrospectives[1], tickets: [{ id: 'later', text: 'Written after the backup' }], _rev: 6 };
    const saved = await dataStore.saveSessionState(sessionId, live);
    expect(saved.data._rev).toBe(7);
    await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
      ...team,
      retrospectives: team.retrospectives.map((r: Json) => (r.id === sessionId ? saved.data : r))
    }));

    const response = await restoreTeam(backupId, target.id);
    expect(response.status).toBe(200);
    expect(response.body.sessionsUpdated).toBe(1);
    expect(response.body.sessionsNotUpdated).toEqual([]);

    const row = await dataStore.loadSessionState(sessionId);
    expect(row.tickets).toEqual([]);
    expect(row._rev).toBe(8);
    const record = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    expect(record._rev).toBe(8);
    expect(server.cache.get(sessionId)?._rev).toBe(8);
    expect(server.broadcasts).toContainEqual({ room: sessionId, event: 'session-update', data: expect.objectContaining({ _rev: 8, tickets: [] }) });

    // A client still holding the pre-restore state persists it: refused.
    const token = await server.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD });
    const stale = await server.post(`/api/team/${target.id}/retrospective/${sessionId}`, {
      sessionToken: token.body.sessionToken,
      retrospective: saved.data
    });
    expect(stale.status).toBe(200);
    const after = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    expect(after.tickets).toEqual([]);
  });

  it('recreates a deleted team with its password and gives it back the feedbacks its deletion orphaned', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();

    // A reply posted after the backup, then the team deleted.
    await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
      ...team,
      teamFeedbacks: team.teamFeedbacks.map((f: Json) => ({ ...f, comments: [{ id: 'reply', content: 'Fixed' }] }))
    }));
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    expect(await dataStore.loadTeam(target.id)).toBeNull();
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).toContain(`f1-${suffix}`);

    const response = await restoreTeam(backupId, target.id);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ recreated: true, team: { name: target.name }, counts: { feedbacksRecovered: 1 } });

    expect((await server.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD })).status).toBe(200);
    const restored = await dataStore.loadTeam(target.id);
    expect(restored.teamFeedbacks).toHaveLength(1);
    expect(restored.teamFeedbacks[0].comments).toEqual([{ id: 'reply', content: 'Fixed' }]);
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).not.toContain(`f1-${suffix}`);
  });

  it('keeps the sessions of a team that still exists, and signs out the tokens a team deleted since outlived (decision D3b)', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    const login = await server.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD });
    const token = login.body.sessionToken as string;

    // The team still exists: its password is kept, and so are its sessions.
    expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    expect((await server.post(`/api/team/${target.id}`, { sessionToken: token })).status).toBe(200);

    // Deleted since: the archived password comes back, and a token minted
    // before the deletion must not come back to life with it.
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    expect((await restoreTeam(backupId, target.id)).body).toMatchObject({ recreated: true });

    const refused = await server.post(`/api/team/${target.id}`, { sessionToken: token });
    expect(refused).toEqual({ status: 401, body: { error: 'session_revoked' } });
    const relogin = await server.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD });
    expect((await server.post(`/api/team/${target.id}`, { sessionToken: relogin.body.sessionToken })).status).toBe(200);
  });

  it('refuses a deleted team whose name was taken since, writing nothing, then restores it under another name', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    const usurper = { id: `usurper${suffix}`, name: target.name, passwordHash: await hashPassword('x-password'), members: [], retrospectives: [] };
    await dataStore.saveTeam(usurper.id, usurper);
    await indexTeam(usurper);
    const backupsBefore = (await server.backupService.listBackups()).length;

    const refused = await restoreTeam(backupId, target.id);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: 'team_name_exists' });
    expect(await dataStore.loadTeam(target.id)).toBeNull();
    expect((await server.backupService.listBackups()).length).toBe(backupsBefore);

    const renamed = await restoreTeam(backupId, target.id, { name: `${target.name} (restored)` });
    expect(renamed.status).toBe(200);
    expect((await dataStore.loadTeam(target.id)).name).toBe(`${target.name} (restored)`);
    expect((await dataStore.loadTeamIndex()).get(`${target.name} (restored)`.toLowerCase())).toBe(target.id);
    expect((await dataStore.loadTeamIndex()).get(target.name.toLowerCase())).toBe(usurper.id);
  });

  it('answers the usual refusals', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();

    expect((await server.post('/api/super-admin/backups/restore-team', { password: 'wrong', backupId, teamId: target.id })).status).toBe(401);
    expect((await restoreTeam(backupId, '')).body).toEqual({ error: 'missing_team_id' });
    expect((await restoreTeam('', target.id)).body).toEqual({ error: 'missing_backup_id' });
    const unknownBackup = await restoreTeam('backup_missing', target.id);
    expect([unknownBackup.status, unknownBackup.body]).toEqual([404, { error: 'backup_not_found' }]);
    const unknownTeam = await restoreTeam(backupId, 'not-in-it');
    expect([unknownTeam.status, unknownTeam.body]).toEqual([404, { error: 'team_not_in_backup' }]);

    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    expect((await restoreTeam(backupId, target.id, { name: '   ' })).body).toEqual({ error: 'team_name_empty' });
    expect((await restoreTeam(backupId, target.id, { name: 'x'.repeat(201) })).body).toEqual({ error: 'team_name_too_long' });
  });

  // ---- Races found in review. Each stages one with the real store's methods
  // ---- patched for a single call, so the interleaving is deterministic.

  const patchOnce = <T extends object, K extends keyof T>(target: T, key: K, replacement: (original: T[K]) => T[K]) => {
    const original = target[key];
    target[key] = ((...args: unknown[]) => {
      target[key] = original;
      return (replacement(original) as unknown as (...a: unknown[]) => unknown)(...args);
    }) as T[K];
    return () => { target[key] = original; };
  };

  it('never takes the name from a record that a concurrent restore of the same team saved', async () => {
    // Two admins restore the same deleted team. This request claimed the name;
    // the other found it already the team's, saved first, and this save is
    // refused. Releasing the claim then would leave the other's record with no
    // name to log in by.
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    const restoreTarget = dataStore as unknown as Record<string, any>;
    const undo = patchOnce(restoreTarget, 'atomicTeamSave', (original) => async (teamId: string, team: Json, rev: number) => {
      await original(teamId, { ...team }, rev); // the other restore lands first
      return { success: false, data: await dataStore.loadTeamRaw(teamId) };
    });
    try {
      const refused = await restoreTeam(backupId, target.id);
      expect([refused.status, refused.body]).toEqual([409, { error: 'team_changed' }]);
    } finally {
      undo();
    }
    expect((await dataStore.loadTeamIndex()).get(target.name.toLowerCase())).toBe(target.id);
    expect((await server.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD })).status).toBe(200);
  });

  it('puts its name back after saving when a concurrent restore released the shared claim', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    const restoreTarget = dataStore as unknown as Record<string, any>;
    const undo = patchOnce(restoreTarget, 'atomicTeamSave', (original) => async (teamId: string, team: Json, rev: number) => {
      // The other restore failed before this save and gave the name back.
      await dataStore.atomicTeamIndexUpdate((index: Map<string, string>) => {
        index.delete(target.name.toLowerCase());
        return index;
      });
      return original(teamId, team, rev);
    });
    try {
      expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    } finally {
      undo();
    }
    expect((await dataStore.loadTeamIndex()).get(target.name.toLowerCase())).toBe(target.id);
  });

  it('reads the live revisions after the snapshot, so a write made during it cannot undo the restore', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    const sessionId = `r2-${suffix}`;
    const live = await dataStore.saveSessionState(sessionId, { ...target.retrospectives[1], tickets: [{ id: 'old', text: 'Before' }], _rev: 6 });
    expect(live.data._rev).toBe(7);

    // While the whole store is dumped, a participant still on the old state
    // writes once more.
    let duringSnapshot: Json = {};
    const undo = patchOnce(server.backupService as unknown as Record<string, any>, 'createBackup', (original) => async (...args: unknown[]) => {
      const entry = await original(...args);
      duringSnapshot = (await dataStore.saveSessionState(sessionId, { ...live.data, tickets: [{ id: 'old', text: 'Still before' }] })).data;
      return entry;
    });
    try {
      expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    } finally {
      undo();
    }
    expect(duringSnapshot._rev).toBe(8);

    const row = await dataStore.loadSessionState(sessionId);
    const record = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    expect(record._rev).toBe(row._rev);
    // That participant persists what it held: refused, the restore stands.
    const token = await server.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD });
    await server.post(`/api/team/${target.id}/retrospective/${sessionId}`, {
      sessionToken: token.body.sessionToken,
      retrospective: duringSnapshot
    });
    const after = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    expect(after.tickets).toEqual([]);
  });

  it('writes a session row for a restored retro that had none, so a stale cached copy cannot seed it', async () => {
    // After a whole-store restore no retro has a row. A Dashboard left open
    // holds the record at revision 4; opening the retro would seed the session
    // from that cache at revision 5, which a restore landing at 5 accepts.
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    const sessionId = `r1-${suffix}`;
    expect(await dataStore.loadSessionState(sessionId)).toBeNull();

    const response = await restoreTeam(backupId, target.id);
    expect(response.status).toBe(200);
    expect(response.body.sessionsSeeded).toBeGreaterThanOrEqual(1);

    const row = await dataStore.loadSessionState(sessionId);
    const record = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    expect(row).toMatchObject({ teamId: target.id, tickets: [{ id: 'kept', text: 'Slow CI' }] });
    expect(row._rev).toBe(record._rev);
    // A stale client's first write is refused by the row it finds.
    const stale = await dataStore.saveSessionState(sessionId, { ...target.retrospectives[0], tickets: [], _rev: 4 });
    expect(stale).toMatchObject({ success: false, stale: true });
  });

  it('keeps an orphaned feedback that received a reply while the restore ran, rather than dropping the reply', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    const restoreTarget = dataStore as unknown as Record<string, any>;
    const undo = patchOnce(restoreTarget, 'atomicTeamSave', (original) => async (teamId: string, team: Json, rev: number) => {
      // The super admin replies to the orphan before the record lands.
      await dataStore.atomicMetaUpdate((meta: Json) => ({
        ...meta,
        orphanedFeedbacks: meta.orphanedFeedbacks.map((f: Json) => (f.id === `f1-${suffix}` ? { ...f, comments: [{ id: 'late-reply' }] } : f))
      }));
      return original(teamId, team, rev);
    });
    let response: { status: number; body: Json };
    try {
      response = await restoreTeam(backupId, target.id);
    } finally {
      undo();
    }
    expect(response!.status).toBe(200);
    expect(response!.body.feedbacksStillOrphaned).toBe(true);
    const orphan = (await dataStore.loadMetaData()).orphanedFeedbacks.find((f: Json) => f.id === `f1-${suffix}`);
    expect(orphan?.comments).toEqual([{ id: 'late-reply' }]);
  });

  it('runs one restore at a time on this pod, single-team or whole-store alike', async () => {
    // Overlapping, a whole-store replace and a team write each report success
    // and leave a hybrid of two backups.
    const { target, other } = await seedTeams();
    const backupId = await takeBackup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const inSnapshot = new Promise<void>((resolve) => { reached = resolve; });
    const undo = patchOnce(server.backupService as unknown as Record<string, any>, 'createBackup', (original) => async (...args: unknown[]) => {
      reached();
      await held;
      return original(...args);
    });
    try {
      const first = restoreTeam(backupId, target.id);
      await inSnapshot;
      const second = await restoreTeam(backupId, other.id);
      const whole = await server.post('/api/super-admin/backups/restore', admin({ backupId }));
      release();
      expect((await first).status).toBe(200);
      expect([second.status, second.body]).toEqual([409, { error: 'restore_in_progress' }]);
      expect([whole.status, whole.body]).toEqual([409, { error: 'restore_in_progress' }]);
    } finally {
      undo();
    }
    // Once it has finished, the next one runs.
    expect((await restoreTeam(backupId, other.id)).status).toBe(200);
  });

  it('never publishes a restored state that a newer write has already replaced', async () => {
    // Clients apply every `session-update` they receive: broadcasting the
    // restored revision after a participant's newer write would take the room
    // back over that write.
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    const sessionId = `r2-${suffix}`;
    await dataStore.saveSessionState(sessionId, { ...target.retrospectives[1], _rev: 6 });

    const store = dataStore as unknown as Record<string, any>;
    const original = store.saveSessionState;
    let newer: Json = {};
    store.saveSessionState = async (id: string, data: Json) => {
      const result = await original(id, data);
      if (id === sessionId && result.success && !newer._rev) {
        // A participant writes on top of the restore before it is published.
        newer = (await original(id, { ...result.data, tickets: [{ id: 'new', text: 'Written right after' }] })).data;
      }
      return result;
    };
    try {
      expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    } finally {
      store.saveSessionState = original;
    }
    expect(newer._rev).toBeGreaterThan(0);
    expect(server.broadcasts.filter((b) => b.room === sessionId)).toEqual([]);
    expect(server.cache.get(sessionId)?._rev ?? 0).not.toBe(newer._rev - 1);
    expect((await dataStore.loadSessionState(sessionId)).tickets).toEqual([{ id: 'new', text: 'Written right after' }]);
  });

  it('lifts the record to the revision its live row landed on, so a write accepted in between cannot revert it', async () => {
    // The record is written at a revision read before it. A socket write that
    // reaches the row before the restore does is acked at exactly that
    // revision, so the sender's next persist would pass the record's guard.
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    const sessionId = `r2-${suffix}`;
    const live = await dataStore.saveSessionState(sessionId, { ...target.retrospectives[1], tickets: [{ id: 'old', text: 'Before' }], _rev: 6 });
    await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
      ...team,
      retrospectives: team.retrospectives.map((r: Json) => (r.id === sessionId ? live.data : r))
    }));

    let accepted: Json = {};
    const undo = patchOnce(dataStore as unknown as Record<string, any>, 'atomicTeamUpdate', (original) => async (...args: unknown[]) => {
      const result = await original(...args);
      accepted = (await dataStore.saveSessionState(sessionId, { ...live.data, tickets: [{ id: 'old', text: 'In the window' }] })).data;
      return result;
    });
    try {
      expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    } finally {
      undo();
    }
    const row = await dataStore.loadSessionState(sessionId);
    const record = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    expect(row._rev).toBeGreaterThan(accepted._rev);
    expect(record._rev).toBe(row._rev);

    // The sender persists what it was acked: refused, the restore stands.
    const token = await server.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD });
    await server.post(`/api/team/${target.id}/retrospective/${sessionId}`, {
      sessionToken: token.body.sessionToken,
      retrospective: { ...accepted, tickets: [...accepted.tickets, { id: 'next', text: 'Next edit' }] }
    });
    const after = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    expect(after.tickets).toEqual([]);
  });

  // The re-stamp writes the planned entry, computed before the session rows
  // were written, which takes seconds for a team with many retros. A Jira
  // batch run from the live session meanwhile writes its key on the record's
  // copy — for an action with no backlog copy, its only copy. Overwritten, the
  // next persist drops the key from the row too, and the next click creates a
  // second issue.
  it('keeps a Jira key written on the record while the restore wrote its rows', async () => {
    const { target } = await seedTeams();
    const sessionId = `r2-${suffix}`;
    const actionId = `x-${suffix}`;
    await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
      ...team,
      retrospectives: team.retrospectives.map((r: Json) => (
        r.id === sessionId ? { ...r, actions: [{ id: actionId, text: 'Ship it', done: false, type: 'new' }] } : r
      ))
    }));
    const backupId = await takeBackup();
    const current = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    const live = await dataStore.saveSessionState(sessionId, { ...current, _rev: 6 });

    const key = { key: 'OPS-42', createdAt: '2026-10-21T08:00:00.000Z' };
    const undo = patchOnce(dataStore as unknown as Record<string, any>, 'atomicTeamUpdate', (original) => async (...args: unknown[]) => {
      const result = await original(...args);
      // A socket write reaches the row first, so the record is re-stamped…
      await dataStore.saveSessionState(sessionId, { ...live.data, tickets: [{ id: 'w', text: 'In the window' }] });
      // …and the Jira route links the action on the record meanwhile.
      await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
        ...team,
        retrospectives: team.retrospectives.map((r: Json) => (
          r.id === sessionId ? { ...r, actions: r.actions.map((a: Json) => (a.id === actionId ? { ...a, jira: key } : a)) } : r
        ))
      }));
      return result;
    });
    try {
      expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    } finally {
      undo();
    }
    const row = await dataStore.loadSessionState(sessionId);
    const record = (await dataStore.loadTeam(target.id)).retrospectives.find((r: Json) => r.id === sessionId);
    // Re-stamped (the restore stands over the write in the window)…
    expect(record._rev).toBe(row._rev);
    expect(record.tickets).toEqual([]);
    // …with the key the record held.
    expect(record.actions.find((a: Json) => a.id === actionId).jira).toEqual(key);
  });

  // sessionParent mode (F2): a session's parent issue exists in Jira and the
  // team's token stays, so a parent rolled back would have the session's next
  // actions create a second one; a parent re-pointed since must not be
  // undone. The plan is made inside the final write, so a parent created
  // while the snapshot ran is carried too.
  it('keeps the session parents as they are now, a parent created while the restore ran included', async () => {
    const { target } = await seedTeams();
    const parent = (key: string) => ({ key, createdAt: '2026-10-21T08:00:00.000Z', subtaskTypeId: '10005' });
    await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
      ...team,
      jiraParents: { [`retro:r1-${suffix}`]: parent('OLD-1'), backlog: { uncertainSince: '2026-10-01T00:00:00.000Z' } },
      jiraParentClaims: { [`retro:r2-${suffix}`]: { at: '2026-10-01T00:00:00.000Z', requestId: 'archived-claim' } }
    }));
    const backupId = await takeBackup();
    await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
      ...team,
      jiraParents: { [`retro:r1-${suffix}`]: parent('NOW-1'), backlog: parent('NOW-9') },
      jiraParentClaims: { 'healthcheck:h9': { at: '2026-10-21T08:00:00.000Z', requestId: 'live-claim' } }
    }));

    const undo = patchOnce(server.backupService as unknown as Record<string, any>, 'createBackup', (original) => async (...args: unknown[]) => {
      const entry = await original(...args);
      // A batch creates Sprint 2's parent while the store is dumped.
      await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({
        ...team,
        jiraParents: { ...team.jiraParents, [`retro:r2-${suffix}`]: parent('NOW-2') }
      }));
      return entry;
    });
    try {
      expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    } finally {
      undo();
    }

    const restored = await dataStore.loadTeam(target.id);
    expect(restored.jiraParents).toEqual({
      [`retro:r1-${suffix}`]: parent('NOW-1'),
      backlog: parent('NOW-9'),
      [`retro:r2-${suffix}`]: parent('NOW-2')
    });
    expect(restored.jiraParentClaims).toEqual({ 'healthcheck:h9': { at: '2026-10-21T08:00:00.000Z', requestId: 'live-claim' } });
  });

  it('gives a team deleted since the backup the parents the archive holds', async () => {
    const { target } = await seedTeams();
    const parents = { [`retro:r1-${suffix}`]: { key: 'OLD-1', createdAt: '2026-10-01T00:00:00.000Z' } };
    await dataStore.atomicTeamUpdate(target.id, (team: Json) => ({ ...team, jiraParents: parents }));
    const backupId = await takeBackup();
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);

    expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    expect((await dataStore.loadTeam(target.id)).jiraParents).toEqual(parents);
  });

  it('finishes a restore that recreated the team even when re-asserting its name fails', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    const store = dataStore as unknown as Record<string, any>;
    const original = store.atomicTeamIndexUpdate;
    let calls = 0;
    store.atomicTeamIndexUpdate = async (...args: unknown[]) => {
      calls += 1;
      if (calls === 2) throw new Error('index store unavailable');
      return original(...args);
    };
    let response: { status: number; body: Json };
    try {
      response = await restoreTeam(backupId, target.id);
    } finally {
      store.atomicTeamIndexUpdate = original;
    }
    expect(response!.status).toBe(200);
    expect(response!.body).toMatchObject({ recreated: true, counts: { feedbacksRecovered: 1 } });
    // The steps after the save still ran.
    expect((await dataStore.loadMetaData()).orphanedFeedbacks.map((f: Json) => f.id)).not.toContain(`f1-${suffix}`);
    expect(server.recorded.some((e) => e.action === SECURITY_ACTIONS.TEAM_RESTORE && e.target === target.id)).toBe(true);
  });

  // A deletion by a pod from before team secrets, or a token saved while the
  // team was being deleted, leaves a secret under the team's id. The restored
  // team comes back under that same id: without this it would silently get a
  // Jira token back that nobody set for it since.
  it('recreates a deleted team without the Jira secret its deletion left behind', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    await dataStore.saveTeamSecret(target.id, { jira: { v: 1, iv: 'aXY', tag: 'dGFn', ct: 'orphan' } });

    const response = await restoreTeam(backupId, target.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ recreated: true });
    expect(await dataStore.loadTeamSecret(target.id)).toBeNull();
  });

  it('leaves the Jira secret of a team that still exists alone: a restore never rolls a credential back', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    const secret = { jira: { v: 1, iv: 'aXY', tag: 'dGFn', ct: 'current' } };
    await dataStore.saveTeamSecret(target.id, secret);

    expect((await restoreTeam(backupId, target.id)).status).toBe(200);
    expect(await dataStore.loadTeamSecret(target.id)).toEqual(secret);
  });

  it('refuses to recreate a deleted team when its leftover secret cannot be removed, writing nothing and keeping no snapshot', async () => {
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    const backupsBefore = (await server.backupService.listBackups()).length;
    const store = dataStore as unknown as Record<string, any>;
    const original = store.deleteTeamSecret;
    store.deleteTeamSecret = async () => {
      throw new Error('store unavailable');
    };
    let response: { status: number; body: Json };
    try {
      response = await restoreTeam(backupId, target.id);
    } finally {
      store.deleteTeamSecret = original;
    }

    expect([response!.status, response!.body]).toEqual([503, { error: 'team_secret_delete_failed' }]);
    expect(await dataStore.loadTeamRaw(target.id)).toBeNull();
    expect((await server.backupService.listBackups()).length).toBe(backupsBefore);
    // The name claim went with it, so the same restore can simply be retried.
    expect((await dataStore.loadTeamIndex()).has(target.name.toLowerCase())).toBe(false);
    expect((await restoreTeam(backupId, target.id)).status).toBe(200);
  });

  it('refuses when the team is no longer in the state the console showed, writing nothing', async () => {
    // The dialog explains one case: keeping today's password, or bringing the
    // archived one back. A team deleted (or recreated) since the list was read
    // must not silently get the other.
    const { target } = await seedTeams();
    const backupId = await takeBackup();
    const backupsBefore = (await server.backupService.listBackups()).length;
    const recordBefore = await dataStore.loadTeamRaw(target.id);

    const wasDeleted = await restoreTeam(backupId, target.id, { expected: 'deleted' });
    expect([wasDeleted.status, wasDeleted.body]).toEqual([409, { error: 'team_changed' }]);
    expect((await dataStore.loadTeamRaw(target.id))._rev).toBe(recordBefore._rev);

    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);
    const stillThere = await restoreTeam(backupId, target.id, { expected: 'existing' });
    expect([stillThere.status, stillThere.body]).toEqual([409, { error: 'team_changed' }]);
    expect(await dataStore.loadTeam(target.id)).toBeNull();
    expect((await server.backupService.listBackups()).length).toBe(backupsBefore);

    expect((await restoreTeam(backupId, target.id, { expected: 'deleted' })).status).toBe(200);
  });

  it('lists the teams of a backup with what became of each since', async () => {
    const { target, other } = await seedTeams();
    const backupId = await takeBackup();
    expect((await server.post('/api/super-admin/rename-team', admin({ teamId: other.id, newName: `${other.name} v2` }))).status).toBe(200);
    expect((await server.post(`/api/team/${target.id}/delete`, { password: OLD_PASSWORD })).status).toBe(200);

    const unauthorized = await server.post('/api/super-admin/backups/teams', { password: 'wrong', backupId });
    expect(unauthorized.status).toBe(401);

    const response = await server.post('/api/super-admin/backups/teams', admin({ backupId }));
    expect(response.status).toBe(200);
    const byId = new Map(response.body.teams.map((team: Json) => [team.id, team]));
    expect(byId.get(target.id)).toMatchObject({ name: target.name, status: 'deleted', nameTaken: false, counts: { retrospectives: 2 } });
    expect(byId.get(other.id)).toMatchObject({ name: other.name, status: 'renamed', currentName: `${other.name} v2` });
  });
});

/**
 * A backup file is restored by importing it first: the upload becomes one row
 * of the shared `backups` table, and every backup route reads it unchanged.
 *
 * Played on two pods: P1 over the suite's store, P2 over a **second connection**
 * to the same SQLite file, as a second pod is. One shared object would let a
 * cache living inside the data store pass; two connections cannot share one,
 * so a row that only existed in P1's memory would not be listed on P2.
 */
describe('importing a backup file', () => {
  let p1: Awaited<ReturnType<typeof buildApp>>;
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(async () => {
    consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined)
    ];
    p1 = await buildApp();
  });

  afterEach(async () => {
    await p1.close();
    for (const spy of consoleSpies) spy.mockRestore();
  });

  const openSecondPod = async () => {
    const store = createDataStore({ rootDir: dir });
    await store.initDatabase();
    const pod = await buildApp(store);
    return {
      pod,
      close: async () => {
        await pod.close();
        await store.closeDatabase?.();
      }
    };
  };

  const importBytes = (pod: typeof p1, bytes: Buffer, label = 'retro.json.gz') =>
    pod.raw('/api/super-admin/backups/import', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-super-admin-password': SUPER_ADMIN_PASSWORD,
        'x-backup-label': encodeURIComponent(label)
      },
      body: new Uint8Array(bytes)
    });

  /** A backup of the store as it is now, as the console downloads it, and no row left for it. */
  const downloadedBackup = async () => {
    const backup = await p1.backupService.createBackup('manual', 'To be downloaded');
    const { data } = (await dataStore.getBackupData(backup!.id))!;
    await dataStore.deleteBackup(backup!.id);
    return Buffer.from(data);
  };

  const deleteFromConsole = async (pod: typeof p1, team: Json) => {
    const response = await pod.post('/api/super-admin/delete-team', admin({ teamId: team.id, confirmName: team.name }));
    expect(response.status).toBe(200);
    expect(await dataStore.loadTeam(team.id)).toBeNull();
  };

  const teamSecretKeys = () =>
    (dataStore.getSqliteDb().prepare("SELECT key FROM kv_store WHERE key LIKE 'team-secret:%'").all() as { key: string }[])
      .map((row) => row.key)
      .sort();

  it('imports on one pod, then lists, restores two teams, downloads, restores everything and deletes from either', async () => {
    const { target: teamA, other: teamB } = await seedTeams();
    const bytes = await downloadedBackup();
    const archive = JSON.parse(gunzipSync(bytes).toString('utf8'));
    await deleteFromConsole(p1, teamA);
    await deleteFromConsole(p1, teamB);

    const second = await openSecondPod();
    try {
      const p2 = second.pod;

      // Imported on P1.
      const imported = await importBytes(p1, bytes);
      expect(imported.status).toBe(200);
      const { backup } = await imported.json();
      expect(backup).toMatchObject({ type: 'imported', label: 'retro.json.gz', teamCount: archive.teams.length, protected: false });

      // Listed on P2, from the shared table.
      const list = await p2.post('/api/super-admin/backups/list', admin({}));
      expect(list.body.backups).toContainEqual(expect.objectContaining({ id: backup.id, type: 'imported', teamCount: archive.teams.length }));

      // Its teams, read on P2: both deleted since.
      const teams = await p2.post('/api/super-admin/backups/teams', admin({ backupId: backup.id }));
      expect(teams.status).toBe(200);
      const byId = new Map(teams.body.teams.map((team: Json) => [team.id, team]));
      expect(byId.get(teamA.id)).toMatchObject({ status: 'deleted' });
      expect(byId.get(teamB.id)).toMatchObject({ status: 'deleted' });

      // Several teams from one import, on two pods.
      const restoredA = await p1.post('/api/super-admin/backups/restore-team', admin({ backupId: backup.id, teamId: teamA.id, expected: 'deleted' }));
      expect(restoredA.status).toBe(200);
      const restoredB = await p2.post('/api/super-admin/backups/restore-team', admin({ backupId: backup.id, teamId: teamB.id, expected: 'deleted' }));
      expect(restoredB.status).toBe(200);
      expect((await p2.post('/api/team/login', { teamName: teamA.name, password: OLD_PASSWORD })).status).toBe(200);
      expect((await p1.post('/api/team/login', { teamName: teamB.name, password: OTHER_PASSWORD })).status).toBe(200);
      const restoreEvent = p1.recorded.find((event) => event.action === SECURITY_ACTIONS.TEAM_RESTORE);
      expect(restoreEvent?.detail).toMatchObject({ backupId: backup.id, backup: expect.stringMatching(/^retrogemini-import-.*\.json\.gz$/) });

      // The download is the very file that was imported.
      const download = await p2.raw('/api/super-admin/backups/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(admin({ backupId: backup.id }))
      });
      expect(download.status).toBe(200);
      expect(Buffer.compare(Buffer.from(await download.arrayBuffer()), bytes)).toBe(0);

      // The whole store, from the imported row: the teams are the archive's.
      const whole = await p1.post('/api/super-admin/backups/restore', admin({ backupId: backup.id }));
      expect(whole.status).toBe(200);
      const ids = (await dataStore.loadPersistedData()).teams.map((team: Json) => team.id).sort();
      expect(ids).toEqual(archive.teams.map((team: Json) => team.id).sort());

      // A restore never touches the backups table: the imported row is still there.
      const after = await p2.post('/api/super-admin/backups/list', admin({}));
      expect(after.body.backups.map((entry: Json) => entry.id)).toContain(backup.id);

      // Deleted when done, from the other pod.
      expect((await p2.post('/api/super-admin/backups/delete', admin({ backupId: backup.id }))).status).toBe(200);
      const gone = await p1.post('/api/super-admin/backups/teams', admin({ backupId: backup.id }));
      expect([gone.status, gone.body]).toEqual([404, { error: 'backup_not_found' }]);
    } finally {
      await second.close();
    }
  });

  it('imports a plain JSON archive too, and restores a team from it', async () => {
    const { target } = await seedTeams();
    const archive = JSON.parse(gunzipSync(await downloadedBackup()).toString('utf8'));
    await deleteFromConsole(p1, target);

    const imported = await importBytes(p1, Buffer.from(JSON.stringify(archive), 'utf8'), 'retro.json');
    expect(imported.status).toBe(200);
    const { backup } = await imported.json();

    const teams = await p1.post('/api/super-admin/backups/teams', admin({ backupId: backup.id }));
    expect(teams.body.teams.find((team: Json) => team.id === target.id)).toMatchObject({ status: 'deleted' });
    const restored = await p1.post('/api/super-admin/backups/restore-team', admin({ backupId: backup.id, teamId: target.id }));
    expect(restored.status).toBe(200);
    expect((await p1.post('/api/team/login', { teamName: target.name, password: OLD_PASSWORD })).status).toBe(200);
    await dataStore.deleteBackup(backup.id);
  });

  it('keeps extra keys of a file inert: settings, the Jira connection and team secrets are never taken from it', async () => {
    await seedTeams();
    await dataStore.updateGlobalSettings((settings: Json) => ({ ...settings, adminEmail: 'ops@example.ch' }));
    const settingsBefore = await dataStore.loadGlobalSettings();
    const jiraBefore = await dataStore.loadJiraSettings();
    const secretsBefore = teamSecretKeys();

    const archive = JSON.parse(gunzipSync(await downloadedBackup()).toString('utf8'));
    const someTeam = archive.teams[0];
    const tampered = {
      ...archive,
      globalSettings: { adminEmail: 'x@evil.example' },
      jiraSettings: { enabled: true, baseUrl: 'https://jira.evil.example', allowSelfSignedCerts: true },
      teamSecrets: [{ teamId: someTeam.id, jira: { v: 1, iv: 'aXY', tag: 'dGFn', ct: 'planted' } }]
    };
    const imported = await importBytes(p1, gzipSync(Buffer.from(JSON.stringify(tampered), 'utf8')), 'tampered.json.gz');
    expect(imported.status).toBe(200);
    const { backup } = await imported.json();

    expect((await p1.post('/api/super-admin/backups/restore', admin({ backupId: backup.id }))).status).toBe(200);

    expect(await dataStore.loadGlobalSettings()).toEqual(settingsBefore);
    expect(await dataStore.loadJiraSettings()).toEqual(jiraBefore);
    // Nothing added: a replace may remove the secret of a team absent from the
    // archive, but it never writes one, and never the file's.
    const secretsAfter = teamSecretKeys();
    expect(secretsAfter.filter((key) => !secretsBefore.includes(key))).toEqual([]);
    expect(await dataStore.loadTeamSecret(someTeam.id)).not.toMatchObject({ jira: { ct: 'planted' } });
    await dataStore.deleteBackup(backup.id);
  });
});
