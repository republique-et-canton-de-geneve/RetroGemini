import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { createPublicOriginResolver } from '../server/services/publicOrigin.js';
import { hashPassword } from '../server/services/passwordHashing.js';
import { hashResetToken, pruneResetTokens } from '../server/services/security.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { registerPasswordResetRoutes } from '../server/routes/passwordResetRoutes.js';
import { SECURITY_ACTIONS } from '../server/services/securityEvents.js';

/**
 * Audit H45, the wiring half — **every privileged route records what it did.**
 *
 * `securityEventLog.test.ts` proves the row survives a restart. This proves the
 * routes actually write one, which is the half that rots: a new privileged
 * endpoint added next year will not audit itself, and nothing but a test that
 * enumerates the actions will notice.
 *
 * The recorder here is a spy rather than the real log. The service is covered
 * on a real database next door, and what is at risk in *this* file is the call
 * site: whether the route records at all, whether it records the right outcome,
 * and whether it records the failure paths as well as the successes.
 *
 * The last test is the one to keep: it asserts that every action in
 * `SECURITY_ACTIONS` is reached by some route in this suite. A declared action
 * nobody emits is a hole in the trail that reads, from the constant list, like
 * coverage.
 */

const SUPER_ADMIN_PASSWORD = 'super-admin-secret';
const TEAM_PASSWORD = 'team-password-1';
const NEW_PASSWORD = 'team-password-2';
const TEAM_ID = 'team-1';
// The route rejects a token that is not 64 hex characters before it touches the
// store, so a made-up string never reaches the path under test.
const RESET_TOKEN = Buffer.from('audit-reset-token', 'utf8').toString('hex').padEnd(64, '0').slice(0, 64);

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };
type Recorded = { action: string; actor: string; outcome: string; target?: string | null; ip?: string };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let teamPasswordHash = '';

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  let meta: Record<string, unknown> = { resetTokens: [], orphanedFeedbacks: [] };
  let settings: Record<string, unknown> = {};

  return {
    seed: (team: Team) => {
      teams.set(team.id, clone(team));
      indexMap.set(team.name.toLowerCase(), team.id);
    },
    seedResetToken: (entry: Record<string, unknown>) => {
      meta = { ...meta, resetTokens: [entry] };
    },
    readTeam: (id: string) => teams.get(id),

    loadTeam: async (teamId: string) => {
      const team = teams.get(teamId);
      return team ? clone(team) : null;
    },
    loadAllTeams: async () => [...teams.values()].map(clone),
    loadAllTeamFeedbacks: async () => [],
    loadTeamSummaries: async () => [...teams.values()].map((t) => ({ id: t.id, name: t.name, members: [] })),
    loadPersistedData: async () => ({ teams: [...teams.values()].map(clone) }),
    savePersistedData: async () => undefined,
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamUpdate: async (teamId: string, updater: (team: Team) => Team | null) => {
      const existing = teams.get(teamId);
      if (!existing) return { success: false, error: 'team_not_found' };
      const updated = updater(clone(existing));
      if (!updated) return { success: true, team: clone(existing) };
      teams.set(teamId, clone(updated));
      return { success: true, team: clone(updated) };
    },
    loadTeamIndex: async () => new Map(indexMap),
    atomicTeamIndexUpdate: async (updater: (index: Map<string, string>) => Map<string, string> | null) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [key, value] of next) indexMap.set(key, value);
      return new Map(indexMap);
    },
    loadMetaData: async () => clone(meta),
    atomicMetaUpdate: async (updater: (m: Record<string, unknown>) => Record<string, unknown> | null) => {
      const updated = updater(clone(meta));
      if (updated) meta = clone(updated);
      return { success: true };
    },
    loadGlobalSettings: async () => clone(settings),
    saveGlobalSettings: async (next: Record<string, unknown>) => {
      settings = clone(next);
    },
    loadSessionState: async () => null
  };
};

const createBackupService = () => ({
  createBackup: vi.fn(async () => ({ id: 'backup-1', type: 'manual' })),
  listBackups: vi.fn(async () => [{ id: 'backup-1' }]),
  getBackupConfig: vi.fn(() => ({ enabled: true, maxCount: 7 })),
  getBackupData: vi.fn(async () => ({ filename: 'backup-1.json.gz', data: Buffer.from('gz') })),
  restoreFromBackup: vi.fn(async () => ({ id: 'backup-1' })),
  deleteBackup: vi.fn(async () => true),
  updateBackup: vi.fn(async (id: string) => ({ id }))
});

const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const recorded: Recorded[] = [];
  const securityEvents = {
    record: vi.fn(async (req: { ip?: string }, event: Omit<Recorded, 'ip'>) => {
      recorded.push({ ...event, ip: req?.ip });
    })
  };

  const dataStore = createMockDataStore();
  dataStore.seed({ id: TEAM_ID, name: 'Platform Team', passwordHash: teamPasswordHash, members: [] });

  const tokenService = createTokenService({
    secureCompare: (a: string, b: string) => a === b,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    tokenSecret: 'security-event-audit-test-secret'
  });
  const teamService = createTeamService({ dataStore, tokenService });
  const mailerService = { smtpEnabled: false, mailer: null };
  const logService = { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() };
  const escapeHtml = (value: string) => String(value ?? '');

  registerTeamRoutes({
    app, dataStore, teamService, tokenService, mailerService, logService, escapeHtml, securityEvents
  });
  registerPasswordResetRoutes({
    app,
    dataStore,
    mailerService,
    escapeHtml,
    sanitizeEmailLink: (v: string) => v,
    hashResetToken,
    pruneResetTokens,
    publicOrigin: createPublicOriginResolver({ env: { PUBLIC_BASE_URL: 'https://retro.example.test/' } }),
    securityEvents
  });
  registerSuperAdminRoutes({
    app,
    io: { emit: vi.fn(), serverSideEmit: vi.fn(), fetchSockets: async () => [] },
    dataStore,
    tokenService,
    mailerService,
    logService,
    escapeHtml,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    sessionCache: { clear: vi.fn() },
    backupService: createBackupService(),
    aiService: {},
    serverRuntime: { multiPodAdapter: false },
    securityEvents
  });

  return { app, dataStore, tokenService, recorded, securityEvents };
};

const listen = async (app: express.Express) =>
  new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done()))
      });
    });
  });

describe('H45 — every privileged route records a security event', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let harness: ReturnType<typeof buildApp>;
  let teamToken: string;
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeAll(async () => {
    teamPasswordHash = await hashPassword(TEAM_PASSWORD);
  });

  beforeEach(async () => {
    consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined)
    ];
    harness = buildApp();
    ({ baseUrl, close } = await listen(harness.app));
    teamToken = harness.tokenService.createSessionToken(TEAM_ID, null);
  });

  afterEach(async () => {
    await close();
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  const post = async (path: string, body: Record<string, unknown>, init: Parameters<typeof fetch>[1] = {}) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...init
    });

  const events = () => harness.recorded;
  const eventFor = (action: string) => events().find((e) => e.action === action);

  it('records a SUCCESSFUL super-admin authentication', async () => {
    const response = await post('/api/super-admin/verify', { password: SUPER_ADMIN_PASSWORD });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.SUPER_ADMIN_LOGIN)).toMatchObject({
      actor: 'super-admin',
      outcome: 'success'
    });
  });

  it('records a FAILED super-admin authentication — the one most likely to be forgotten', async () => {
    const response = await post('/api/super-admin/verify', { password: 'wrong' });
    expect(response.status).toBe(401);

    expect(eventFor(SECURITY_ACTIONS.SUPER_ADMIN_LOGIN)).toMatchObject({
      actor: 'anonymous',
      outcome: 'failure'
    });
  });

  it('records the source IP on the row', async () => {
    await post('/api/super-admin/verify', { password: SUPER_ADMIN_PASSWORD });
    // Loopback, since the suite drives a real socket. What matters is that the
    // route passed the request through rather than dropping the field.
    expect(eventFor(SECURITY_ACTIONS.SUPER_ADMIN_LOGIN)?.ip).toBeTruthy();
  });

  it('records a team deletion, naming the team', async () => {
    const response = await post(`/api/team/${TEAM_ID}/delete`, { sessionToken: teamToken });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.TEAM_DELETE)).toMatchObject({
      outcome: 'success',
      target: TEAM_ID
    });
  });

  it('records a team rename through the team route', async () => {
    const response = await post(`/api/team/${TEAM_ID}/update`, {
      sessionToken: teamToken,
      updates: { name: 'Renamed Team' }
    });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.TEAM_RENAME)).toMatchObject({
      outcome: 'success',
      target: TEAM_ID
    });
  });

  it('does NOT record a rename when the update leaves the name alone', async () => {
    // Every dashboard edit — a member added, an action closed — goes through
    // this route. Recording each as a rename would bury the real ones.
    const response = await post(`/api/team/${TEAM_ID}/update`, {
      sessionToken: teamToken,
      updates: { members: [{ id: 'm1', name: 'Ada' }] }
    });
    expect(response.status).toBe(200);
    expect(eventFor(SECURITY_ACTIONS.TEAM_RENAME)).toBeUndefined();
  });

  it('records a team rename through the super-admin route', async () => {
    const response = await post('/api/super-admin/rename-team', {
      password: SUPER_ADMIN_PASSWORD,
      teamId: TEAM_ID,
      newName: 'Admin Renamed'
    });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.TEAM_RENAME)).toMatchObject({
      actor: 'super-admin',
      outcome: 'success',
      target: TEAM_ID
    });
  });

  it('records a team-side password change', async () => {
    const response = await post(`/api/team/${TEAM_ID}/password`, {
      password: TEAM_PASSWORD,
      newPassword: NEW_PASSWORD
    });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.TEAM_PASSWORD_CHANGE)).toMatchObject({
      outcome: 'success',
      target: TEAM_ID
    });
  });

  it('records a super-admin password reset of a team', async () => {
    const response = await post('/api/super-admin/update-password', {
      password: SUPER_ADMIN_PASSWORD,
      teamId: TEAM_ID,
      newPassword: NEW_PASSWORD
    });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.TEAM_PASSWORD_CHANGE)).toMatchObject({
      actor: 'super-admin',
      outcome: 'success'
    });
  });

  it('records a password change made through a reset token', async () => {
    harness.dataStore.seedResetToken({
      teamId: TEAM_ID,
      tokenHash: hashResetToken(RESET_TOKEN),
      createdAt: 0,
      expiresAt: Date.now() + 60_000
    });

    const response = await post('/api/password-reset/confirm', {
      token: RESET_TOKEN,
      newPassword: NEW_PASSWORD
    });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.TEAM_PASSWORD_CHANGE)).toMatchObject({
      outcome: 'success',
      target: TEAM_ID
    });
  });

  it.each([
    ['/api/super-admin/backups/create', { label: 'checkpoint' }, SECURITY_ACTIONS.BACKUP_CREATE],
    ['/api/super-admin/backups/download', { backupId: 'backup-1' }, SECURITY_ACTIONS.BACKUP_DOWNLOAD],
    ['/api/super-admin/backups/restore', { backupId: 'backup-1' }, SECURITY_ACTIONS.BACKUP_RESTORE],
    ['/api/super-admin/backups/delete', { backupId: 'backup-1' }, SECURITY_ACTIONS.BACKUP_DELETE],
    ['/api/super-admin/backup', {}, SECURITY_ACTIONS.BACKUP_DOWNLOAD]
  ])('records %s as %s', async (path, body, action) => {
    const response = await post(path, { password: SUPER_ADMIN_PASSWORD, ...body });
    expect(response.status).toBe(200);

    expect(eventFor(action)).toMatchObject({ actor: 'super-admin', outcome: 'success' });
  });

  it('records an uploaded-archive restore', async () => {
    const archive = Buffer.from(JSON.stringify({ teams: [] }), 'utf8');
    const response = await fetch(`${baseUrl}/api/super-admin/restore`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-super-admin-password': SUPER_ADMIN_PASSWORD
      },
      body: archive
    });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.BACKUP_RESTORE)).toMatchObject({
      actor: 'super-admin',
      outcome: 'success'
    });
  });

  it('records an AI reconfiguration without putting the API key in the row', async () => {
    const response = await post('/api/super-admin/update-ai-settings', {
      password: SUPER_ADMIN_PASSWORD,
      enabled: true,
      apiUrl: 'https://llm.internal.example/v1',
      apiKey: 'sk-secret-key-value',
      model: 'gpt-4'
    });
    expect(response.status).toBe(200);

    const event = eventFor(SECURITY_ACTIONS.AI_SETTINGS_UPDATE);
    expect(event).toMatchObject({ actor: 'super-admin', outcome: 'success' });
    expect(JSON.stringify(event)).not.toContain('sk-secret-key-value');
  });

  it('records the log viewer being cleared — the one action meant to remove evidence', async () => {
    // Not in H45's own list of events, and the omission would have been the
    // first thing a reviewer noticed. The row lands in the database, which the
    // clear does not touch, so it is still there when someone asks why the log
    // viewer is empty.
    const response = await post('/api/super-admin/clear-logs', { password: SUPER_ADMIN_PASSWORD });
    expect(response.status).toBe(200);

    expect(eventFor(SECURITY_ACTIONS.LOGS_CLEAR)).toMatchObject({
      actor: 'super-admin',
      outcome: 'success'
    });
  });

  it('leaves no declared action unreachable', async () => {
    // A constant nobody emits reads, from the list, exactly like coverage.
    // Drive one route per action and assert the set is complete.
    await post('/api/super-admin/verify', { password: SUPER_ADMIN_PASSWORD });
    await post('/api/super-admin/rename-team', {
      password: SUPER_ADMIN_PASSWORD, teamId: TEAM_ID, newName: 'Another Name'
    });
    await post('/api/super-admin/update-password', {
      password: SUPER_ADMIN_PASSWORD, teamId: TEAM_ID, newPassword: NEW_PASSWORD
    });
    for (const [path, body] of [
      ['/api/super-admin/backups/create', {}],
      ['/api/super-admin/backups/download', { backupId: 'backup-1' }],
      ['/api/super-admin/backups/restore', { backupId: 'backup-1' }],
      ['/api/super-admin/backups/delete', { backupId: 'backup-1' }],
      ['/api/super-admin/update-ai-settings', { enabled: false }],
      ['/api/super-admin/clear-logs', {}]
    ] as [string, Record<string, unknown>][]) {
      await post(path, { password: SUPER_ADMIN_PASSWORD, ...body });
    }
    await post(`/api/team/${TEAM_ID}/delete`, { sessionToken: teamToken });

    const emitted = new Set(events().map((e) => e.action));
    const declared = Object.values(SECURITY_ACTIONS);
    expect([...declared].filter((action) => !emitted.has(action))).toEqual([]);
  });
});

describe('H45 — the recorder is wired into the real server', () => {
  it('passes securityEvents to every registrar that records one', () => {
    // The registrars default `securityEvents` to a no-op so the other 130 test
    // files need no change — which means forgetting to wire it in `server.js`
    // would leave every suite green and production recording nothing. This is a
    // source check, so it proves the argument is written, not that it runs;
    // that distinction is the same one H44 hit with its middleware, and the
    // honest version of the claim.
    const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
    const registrars = ['registerTeamRoutes', 'registerSuperAdminRoutes', 'registerPasswordResetRoutes'];

    for (const registrar of registrars) {
      const start = source.indexOf(`${registrar}({`);
      expect(start, `${registrar} is not called in server.js`).toBeGreaterThan(-1);
      const call = source.slice(start, source.indexOf('});', start));
      expect(call, `${registrar} does not receive securityEvents`).toContain('securityEvents');
    }

    expect(source).toContain('createSecurityEventLog');
  });
});
