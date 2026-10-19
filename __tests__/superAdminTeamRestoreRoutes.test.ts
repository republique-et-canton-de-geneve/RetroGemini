// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const tokenService = createTokenService({
    secureCompare: (x: string, y: string) => x === y,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    tokenSecret: 'team-restore-route-test-secret'
  });
  const logService = { addServerLog: () => {}, getServerLogs: () => [], clearServerLogs: () => {} };
  const backupService = createBackupService({ dataStore, logService });
  const recorded: Json[] = [];
  const broadcasts: { room: string; event: string; data: Json }[] = [];
  const cache = new Map<string, Json>();
  const securityEvents = { record: async (_req: unknown, event: Json) => { recorded.push(event); } };

  registerTeamRoutes({
    app,
    dataStore,
    teamService: createTeamService({ dataStore, tokenService }),
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
    dataStore,
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
