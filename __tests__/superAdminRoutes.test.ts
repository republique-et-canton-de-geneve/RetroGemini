import express from 'express';
import { gunzipSync } from 'zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { verifyPassword } from '../server/services/passwordHashing.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * Behavioural coverage for the super-admin surface — the largest and least
 * covered backend file. Every route here is a privileged operation (reading
 * every team, rewriting passwords, deleting feedback, restoring backups), so
 * the guards worth pinning are: authentication on *every* route, the failure
 * paths that must not report success (audit H2), and the notification side
 * effects.
 *
 * The uploaded-archive restore path (`/api/super-admin/restore`) is covered by
 * `routeHardening.test.ts` and deliberately not repeated here.
 */

const VALID_TOKEN = 'super-admin-token';
const VALID_PASSWORD = 'super-secret';

const createTokenService = () => ({
  validateSuperAdminAuth: vi.fn((body: { password?: string; sessionToken?: string } | undefined) =>
    body?.sessionToken === VALID_TOKEN || body?.password === VALID_PASSWORD),
  createSuperAdminToken: vi.fn(() => VALID_TOKEN),
  validateSuperAdminToken: vi.fn((token: string) => token === VALID_TOKEN)
});

type Team = Record<string, unknown> & { id: string; name: string };

const createDataStore = ({
  teams = [] as Team[],
  meta = { orphanedFeedbacks: [] as Record<string, unknown>[] },
  globalSettings = {} as Record<string, unknown>,
  teamUpdateResult = { success: true } as { success: boolean; error?: string }
} = {}) => {
  const teamsById = new Map(teams.map((team) => [team.id, structuredClone(team)]));
  const state = { meta: structuredClone(meta), settings: structuredClone(globalSettings) };

  return {
    state,
    teamsById,
    loadTeamSummaries: vi.fn(async () => [...teamsById.values()]),
    loadAllTeamFeedbacks: vi.fn(async () => [...teamsById.values()].map((t) => ({
      id: t.id,
      name: t.name,
      teamFeedbacks: t.teamFeedbacks
    }))),
    loadTeam: vi.fn(async (teamId: string) => {
      const team = teamsById.get(teamId);
      return team ? structuredClone(team) : null;
    }),
    loadMetaData: vi.fn(async () => structuredClone(state.meta)),
    loadGlobalSettings: vi.fn(async () => structuredClone(state.settings)),
    saveGlobalSettings: vi.fn(async (settings: Record<string, unknown>) => {
      state.settings = structuredClone(settings);
    }),
    loadPersistedData: vi.fn(async () => ({ teams: [...teamsById.values()] })),
    loadSessionState: vi.fn(async (_sessionId: string): Promise<Record<string, unknown> | null> => null),
    atomicMetaUpdate: vi.fn(async (updater: (m: typeof state.meta) => typeof state.meta | null) => {
      const draft = structuredClone(state.meta);
      const next = updater(draft);
      if (next) state.meta = next;
      return { success: true };
    }),
    atomicTeamIndexUpdate: vi.fn(
      async (_updater: (index: Map<string, string>) => Map<string, string> | null) => ({ success: true })
    ),
    atomicTeamUpdate: vi.fn(async (teamId: string, updater: (team: Team) => Team | null) => {
      const team = teamsById.get(teamId);
      if (!team) return { success: false, error: 'not_found' };
      const next = updater(structuredClone(team));
      if (next && teamUpdateResult.success) teamsById.set(teamId, next);
      return teamUpdateResult;
    })
  };
};

const createBackupService = () => ({
  createBackup: vi.fn(async () => ({ id: 'backup-1', type: 'manual' })),
  listBackups: vi.fn(async () => [{ id: 'backup-1' }]),
  getBackupConfig: vi.fn(() => ({ enabled: true, maxCount: 7 })),
  getBackupData: vi.fn(async () => ({ filename: 'backup-1.json.gz', data: Buffer.from('gz') })),
  restoreFromBackup: vi.fn(async () => ({ id: 'backup-1' })),
  deleteBackup: vi.fn(async () => true),
  updateBackup: vi.fn(async (id: string, updates: Record<string, unknown>) => ({ id, ...updates }))
});

const buildApp = (overrides: Record<string, unknown> = {}) => {
  const app = express();
  app.use(express.json());

  const dataStore = (overrides.dataStore as ReturnType<typeof createDataStore>) ?? createDataStore();
  const backupService = (overrides.backupService as ReturnType<typeof createBackupService>) ?? createBackupService();
  const tokenService = (overrides.tokenService as ReturnType<typeof createTokenService>) ?? createTokenService();
  const sendMail = vi.fn(async (_mail: Record<string, unknown>) => undefined);
  const logService = { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() };
  const sessionCache = new Map<string, unknown>();
  const io = { fetchSockets: vi.fn(async () => []), serverSideEmit: vi.fn() };
  const aiService = { suggestGroupTitle: vi.fn(async () => 'A suggested title') };

  registerSuperAdminRoutes({
    app,
    io,
    dataStore,
    tokenService,
    mailerService: { smtpEnabled: true, mailer: { sendMail } },
    logService,
    escapeHtml: (value: string) => String(value ?? ''),
    superAdminPassword: VALID_PASSWORD,
    sessionCache,
    backupService,
    aiService,
    serverRuntime: { multiPodAdapter: false },
    ...overrides
  });

  return { app, dataStore, backupService, tokenService, sendMail, logService, sessionCache, io, aiService };
};

const auth = (body: Record<string, unknown> = {}) => ({ sessionToken: VALID_TOKEN, ...body });

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleInfo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  return () => {
    consoleError.mockRestore();
    consoleInfo.mockRestore();
  };
});

// The two endpoints that *issue* or *check* a credential are the only public
// ones, and they answer with their own error shapes (`invalid_password` /
// `invalid_or_expired_token`), so they are asserted separately below.
const CREDENTIAL_ENDPOINTS = [
  '/api/super-admin/verify',
  '/api/super-admin/validate-session'
];

// Read the POST routes actually registered by `registerSuperAdminRoutes` out of
// the Express router, rather than restating them by hand: a hand-maintained
// list cannot fail when someone adds a new route *without* an auth check, which
// is precisely the regression this suite exists to catch.
const listRegisteredPostRoutes = (): string[] => {
  const app = express();
  registerSuperAdminRoutes({
    app,
    io: { fetchSockets: async () => [], serverSideEmit: vi.fn() },
    dataStore: createDataStore(),
    tokenService: createTokenService(),
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() },
    escapeHtml: (v: string) => v,
    superAdminPassword: VALID_PASSWORD,
    sessionCache: new Map(),
    backupService: createBackupService(),
    aiService: { suggestGroupTitle: vi.fn() },
    serverRuntime: { multiPodAdapter: false }
  });

  const router = (app as unknown as {
    router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  }).router;

  return (router?.stack ?? [])
    .map((layer) => layer.route)
    .filter((route): route is { path: string; methods: Record<string, boolean> } =>
      Boolean(route?.methods?.post))
    .map((route) => route.path);
};

const REGISTERED_ROUTES = listRegisteredPostRoutes();
const PRIVILEGED_ROUTES = REGISTERED_ROUTES.filter((path) => !CREDENTIAL_ENDPOINTS.includes(path));

describe('super-admin authentication', () => {
  it('derives the route inventory from the router, and every public endpoint is accounted for', () => {
    // Guards the derivation itself: if the router shape changes (or a
    // credential endpoint is renamed) the enumeration must not silently
    // collapse to an empty list that makes every assertion below vacuous.
    expect(REGISTERED_ROUTES.length).toBeGreaterThan(20);
    for (const endpoint of CREDENTIAL_ENDPOINTS) {
      expect(REGISTERED_ROUTES).toContain(endpoint);
    }
    expect(PRIVILEGED_ROUTES).toHaveLength(REGISTERED_ROUTES.length - CREDENTIAL_ENDPOINTS.length);
  });

  it.each(PRIVILEGED_ROUTES)('rejects an unauthenticated call to %s', async (path) => {
    const { app, dataStore, backupService, sendMail } = buildApp();

    const response = await request(app, path, postJson({ sessionToken: 'forged' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
    expect(dataStore.saveGlobalSettings).not.toHaveBeenCalled();
    expect(backupService.createBackup).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('issues a session token for the right password and refuses the wrong one', async () => {
    const { app } = buildApp();

    const accepted = await request(app, '/api/super-admin/verify', postJson({ password: VALID_PASSWORD }));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ success: true, sessionToken: VALID_TOKEN });

    const refused = await request(app, '/api/super-admin/verify', postJson({ password: 'wrong' }));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: 'invalid_password' });
  });

  it.each([
    ['/api/super-admin/verify', { password: VALID_PASSWORD }],
    ['/api/super-admin/validate-session', { sessionToken: VALID_TOKEN }]
  ])('answers 503 on %s when no super-admin password is configured', async (path, body) => {
    const { app } = buildApp({ superAdminPassword: '' });

    const response = await request(app, path, postJson(body));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'super_admin_not_configured' });
  });

  it('validates a live session token and rejects a missing or forged one', async () => {
    const { app } = buildApp();

    const ok = await request(app, '/api/super-admin/validate-session', postJson({ sessionToken: VALID_TOKEN }));
    expect(await ok.json()).toEqual({ success: true });

    for (const body of [{}, { sessionToken: 'forged' }]) {
      const refused = await request(app, '/api/super-admin/validate-session', postJson(body));
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ error: 'invalid_or_expired_token' });
    }
  });
});

describe('super-admin dashboard reads', () => {
  it('projects team summaries without leaking secrets or session history', async () => {
    const dataStore = createDataStore({
      teams: [{
        id: 'team-1',
        name: 'Platform',
        facilitatorEmail: 'lead@example.test',
        passwordHash: 'scrypt$secret',
        inviteEpoch: 4,
        lastConnectionDate: '2026-07-01T00:00:00.000Z',
        members: [{ id: 'm1', name: 'Ada', color: '#fff', role: 'facilitator', secretNote: 'nope' }],
        retrospectives: [{ id: 'retro-1' }]
      }]
    });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/teams', postJson(auth()));
    const body = await response.json();

    expect(body.teams).toEqual([{
      id: 'team-1',
      name: 'Platform',
      facilitatorEmail: 'lead@example.test',
      members: [{ id: 'm1', name: 'Ada', color: '#fff', role: 'facilitator' }],
      lastConnectionDate: '2026-07-01T00:00:00.000Z'
    }]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('scrypt$secret');
    expect(serialized).not.toContain('inviteEpoch');
    expect(serialized).not.toContain('retro-1');
    expect(serialized).not.toContain('secretNote');
  });

  it('answers 500 when the team projection fails', async () => {
    const dataStore = createDataStore();
    dataStore.loadTeamSummaries = vi.fn(async () => { throw new Error('store down'); });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/teams', postJson(auth()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_load' });
  });

  it('merges team and orphaned feedbacks, newest first, with defaults filled in', async () => {
    const dataStore = createDataStore({
      teams: [{
        id: 'team-1',
        name: 'Platform',
        teamFeedbacks: [{ id: 'fb-old', title: 'Old', submittedAt: '2026-01-01T00:00:00.000Z' }]
      }],
      meta: {
        orphanedFeedbacks: [{
          id: 'fb-orphan',
          title: 'From a deleted team',
          teamName: 'Deleted Team',
          submittedAt: '2026-06-01T00:00:00.000Z'
        }]
      }
    });
    const { app } = buildApp({ dataStore });

    const { feedbacks } = await (await request(app, '/api/super-admin/feedbacks', postJson(auth()))).json();

    expect(feedbacks.map((f: { id: string }) => f.id)).toEqual(['fb-orphan', 'fb-old']);
    // Feedbacks from a deleted team are never lost.
    expect(feedbacks[0]).toMatchObject({ teamName: 'Deleted Team', isRead: false, status: 'pending' });
    // A team feedback inherits its team's identity when it does not carry one.
    expect(feedbacks[1]).toMatchObject({ teamId: 'team-1', teamName: 'Platform', isRead: false, status: 'pending' });
  });

  it('answers 500 when the feedback projection fails', async () => {
    const dataStore = createDataStore();
    dataStore.loadAllTeamFeedbacks = vi.fn(async () => { throw new Error('store down'); });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/feedbacks', postJson(auth()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_load' });
  });

  it('returns the filtered server log, newest first', async () => {
    const logService = {
      addServerLog: vi.fn(),
      clearServerLogs: vi.fn(),
      getServerLogs: vi.fn(() => [
        { level: 'info', source: 'server', message: 'first' },
        { level: 'error', source: 'email', message: 'second' },
        { level: 'error', source: 'server', message: 'third' }
      ])
    };
    const { app } = buildApp({ logService });

    const all = await (await request(app, '/api/super-admin/logs', postJson(auth()))).json();
    expect(all.logs.map((l: { message: string }) => l.message)).toEqual(['third', 'second', 'first']);

    const errors = await (await request(app, '/api/super-admin/logs', postJson(auth({ filter: { level: 'error' } })))).json();
    expect(errors.logs.map((l: { message: string }) => l.message)).toEqual(['third', 'second']);

    const bySource = await (await request(app, '/api/super-admin/logs', postJson(auth({ filter: { source: 'server' } })))).json();
    expect(bySource.logs.map((l: { message: string }) => l.message)).toEqual(['third', 'first']);
  });

  it('answers 500 when the log store throws', async () => {
    const logService = {
      addServerLog: vi.fn(),
      clearServerLogs: vi.fn(),
      getServerLogs: vi.fn(() => { throw new Error('logs gone'); })
    };
    const { app } = buildApp({ logService });

    const response = await request(app, '/api/super-admin/logs', postJson(auth()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_load' });
  });

  it('clears the log and records who did it', async () => {
    const { app, logService } = buildApp();

    const response = await request(app, '/api/super-admin/clear-logs', postJson(auth()));

    expect(await response.json()).toEqual({ success: true });
    expect(logService.clearServerLogs).toHaveBeenCalledTimes(1);
    expect(logService.addServerLog).toHaveBeenCalledWith('info', 'server', 'Server logs cleared by admin');
  });

  it('describes the live sessions held by connected sockets', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Platform' }] });
    dataStore.loadSessionState = vi.fn(async (sessionId: string) => (
      sessionId === 'session-db'
        ? { teamId: 'team-1', name: 'From the database', phase: 'GROUP', status: 'IN_PROGRESS' }
        : null
    ));
    const io = {
      fetchSockets: vi.fn(async () => [
        { id: 'sock-1', data: { userId: 'u1', userName: 'Ada' }, rooms: new Set(['sock-1', 'session-cached']) },
        { id: 'sock-2', data: { userId: 'u2', userName: 'Bob' }, rooms: new Set(['sock-2', 'session-cached']) },
        { id: 'sock-3', data: { userId: 'u3', userName: 'Cy' }, rooms: new Set(['sock-3', 'session-db']) },
        // A socket that never identified itself is not a participant.
        { id: 'sock-4', data: {}, rooms: new Set(['sock-4', 'session-cached']) }
      ]),
      serverSideEmit: vi.fn()
    };
    const sessionCache = new Map<string, unknown>([
      ['session-cached', { teamId: 'team-1', name: 'Sprint 12', phase: 'BRAINSTORM', status: 'IN_PROGRESS', dimensions: [] }]
    ]);
    const { app } = buildApp({ dataStore, io, sessionCache });

    const { sessions } = await (await request(app, '/api/super-admin/active-sessions', postJson(auth()))).json();

    const cached = sessions.find((s: { sessionId: string }) => s.sessionId === 'session-cached');
    expect(cached).toMatchObject({
      // `dimensions` marks it as a health check rather than a retrospective.
      type: 'healthcheck',
      teamName: 'Platform',
      sessionName: 'Sprint 12',
      phase: 'BRAINSTORM',
      connectedCount: 2
    });
    expect(cached.participants.map((p: { name: string }) => p.name)).toEqual(['Ada', 'Bob']);

    const fromDb = sessions.find((s: { sessionId: string }) => s.sessionId === 'session-db');
    expect(fromDb).toMatchObject({ type: 'retrospective', teamName: 'Platform', connectedCount: 1 });
    // The cache is consulted before the database.
    expect(dataStore.loadSessionState).toHaveBeenCalledTimes(1);
    expect(dataStore.loadSessionState).toHaveBeenCalledWith('session-db');
  });

  it('falls back to placeholders for a session with no persisted state', async () => {
    const io = {
      fetchSockets: vi.fn(async () => [
        { id: 'sock-1', data: { userId: 'u1', userName: 'Ada' }, rooms: new Set(['sock-1', 'ghost-session']) }
      ]),
      serverSideEmit: vi.fn()
    };
    const { app } = buildApp({ io });

    const { sessions } = await (await request(app, '/api/super-admin/active-sessions', postJson(auth()))).json();

    expect(sessions).toEqual([{
      sessionId: 'ghost-session',
      type: 'retrospective',
      teamId: '',
      teamName: 'Unknown',
      sessionName: 'Unknown Session',
      phase: 'Unknown',
      status: 'IN_PROGRESS',
      participants: [{ id: 'u1', name: 'Ada' }],
      connectedCount: 1
    }]);
  });

  it('answers 500 when the socket registry cannot be read', async () => {
    const io = { fetchSockets: vi.fn(async () => { throw new Error('adapter down'); }), serverSideEmit: vi.fn() };
    const { app } = buildApp({ io });

    const response = await request(app, '/api/super-admin/active-sessions', postJson(auth()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_load' });
  });
});

describe('super-admin team administration', () => {
  it('sets and clears a facilitator email', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Platform' }] });
    const { app } = buildApp({ dataStore });

    await request(app, '/api/super-admin/update-email', postJson(auth({ teamId: 'team-1', facilitatorEmail: 'lead@example.test' })));
    expect(dataStore.teamsById.get('team-1')!.facilitatorEmail).toBe('lead@example.test');

    await request(app, '/api/super-admin/update-email', postJson(auth({ teamId: 'team-1', facilitatorEmail: '' })));
    expect(dataStore.teamsById.get('team-1')!.facilitatorEmail).toBeUndefined();
  });

  it('rejects an email update with no team id', async () => {
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/super-admin/update-email', postJson(auth({ facilitatorEmail: 'x@y.test' })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_team_id' });
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
  });

  it('reports a missing team on an email update', async () => {
    const { app } = buildApp();

    const response = await request(app, '/api/super-admin/update-email', postJson(auth({ teamId: 'ghost' })));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'team_not_found' });
  });

  it('answers 500 when the email update throws', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Platform' }] });
    dataStore.atomicTeamUpdate = vi.fn(async () => { throw new Error('store down'); });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/update-email', postJson(auth({ teamId: 'team-1' })));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_save' });
  });

  it('stores a new team password hashed and revokes outstanding invite links', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Platform', passwordHash: 'old', inviteEpoch: 2 }] });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/update-password', postJson(auth({
      teamId: 'team-1',
      newPassword: 'a-new-password'
    })));

    expect(await response.json()).toEqual({ success: true });
    const stored = dataStore.teamsById.get('team-1')!;
    expect(stored.passwordHash).not.toContain('a-new-password');
    expect(await verifyPassword('a-new-password', stored.passwordHash as string)).toBe(true);
    expect(stored.inviteEpoch).toBe(3);
  });

  it.each([
    ['no team id', { newPassword: 'a-new-password' }, 'missing_team_id'],
    ['a short password', { teamId: 'team-1', newPassword: 'abc' }, 'password_too_short'],
    ['no password', { teamId: 'team-1' }, 'password_too_short']
  ])('rejects a password update with %s', async (_label, body, error) => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Platform' }] });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/update-password', postJson(auth(body)));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
  });

  it('reports a missing team on a password update', async () => {
    const { app } = buildApp();

    const response = await request(app, '/api/super-admin/update-password', postJson(auth({
      teamId: 'ghost',
      newPassword: 'a-new-password'
    })));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'team_not_found' });
  });

  it('renames a team in both the index and the record', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Old Name' }] });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/rename-team', postJson(auth({
      teamId: 'team-1',
      newName: '  New Name  '
    })));

    expect(await response.json()).toEqual({ success: true });
    expect(dataStore.teamsById.get('team-1')!.name).toBe('New Name');

    // The index is rewritten from the old key to the trimmed new one.
    const indexUpdater = dataStore.atomicTeamIndexUpdate.mock.calls[0][0];
    const index = indexUpdater(new Map([['old name', 'team-1']]));
    expect(index).toEqual(new Map([['new name', 'team-1']]));
  });

  it('refuses a rename onto a name another team already holds', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Old Name' }] });
    const { app } = buildApp({ dataStore });

    await request(app, '/api/super-admin/rename-team', postJson(auth({ teamId: 'team-1', newName: 'Taken' })));

    const indexUpdater = dataStore.atomicTeamIndexUpdate.mock.calls[0][0];
    expect(indexUpdater(new Map([['taken', 'team-2']]))).toBeNull();
  });

  it.each([
    ['no team id', { newName: 'New' }, 'missing_team_id'],
    ['a blank name', { teamId: 'team-1', newName: '   ' }, 'team_name_empty'],
    ['no name', { teamId: 'team-1' }, 'team_name_empty']
  ])('rejects a rename with %s', async (_label, body, error) => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Platform' }] });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/rename-team', postJson(auth(body)));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(dataStore.atomicTeamIndexUpdate).not.toHaveBeenCalled();
  });

  it('reports a missing team on a rename before touching the index', async () => {
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/super-admin/rename-team', postJson(auth({ teamId: 'ghost', newName: 'New' })));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'team_not_found' });
    expect(dataStore.atomicTeamIndexUpdate).not.toHaveBeenCalled();
  });

  it('never reports success when the renamed record write is lost (audit H2)', async () => {
    // The index has already been rewritten at this point, so a lost record
    // write leaves index and record disagreeing — it must surface as an error.
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Old Name' }],
      teamUpdateResult: { success: false, error: 'conflict' }
    });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/rename-team', postJson(auth({ teamId: 'team-1', newName: 'New Name' })));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'failed_to_save' });
    expect(dataStore.teamsById.get('team-1')!.name).toBe('Old Name');
  });

  it('answers 500 when a rename throws', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Old Name' }] });
    dataStore.atomicTeamIndexUpdate = vi.fn(async () => { throw new Error('store down'); });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/rename-team', postJson(auth({ teamId: 'team-1', newName: 'New' })));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed_to_save' });
  });
});

describe('super-admin feedback administration', () => {
  const teamWithFeedback = () => createDataStore({
    teams: [{
      id: 'team-1',
      name: 'Platform',
      facilitatorEmail: 'lead@example.test',
      teamFeedbacks: [{ id: 'fb-1', title: 'Timer drifts', type: 'bug', status: 'pending' }]
    }]
  });

  it.each([
    ['/api/super-admin/feedbacks/update', { teamId: 'team-1', feedbackId: 'fb-1' }, 'missing_feedback_data'],
    ['/api/super-admin/feedbacks/delete', { teamId: 'team-1' }, 'missing_feedback_data'],
    ['/api/super-admin/feedbacks/comment', { teamId: 'team-1', feedbackId: 'fb-1' }, 'missing_comment_data']
  ])('rejects an incomplete request to %s', async (path, body, error) => {
    const { app, dataStore } = buildApp();

    const response = await request(app, path, postJson(auth(body)));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(dataStore.loadTeam).not.toHaveBeenCalled();
  });

  it('applies a status change and notifies the facilitator', async () => {
    const dataStore = teamWithFeedback();
    const { app, sendMail, logService } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/feedbacks/update', postJson(auth({
      teamId: 'team-1',
      feedbackId: 'fb-1',
      updates: { status: 'resolved' }
    })));

    expect(await response.json()).toEqual({ success: true });
    const stored = (dataStore.teamsById.get('team-1')!.teamFeedbacks as Record<string, unknown>[])[0];
    expect(stored).toMatchObject({ status: 'resolved', teamId: 'team-1', teamName: 'Platform' });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(mail.to).toBe('lead@example.test');
    expect(mail.subject).toContain('Timer drifts');
    expect(mail.text).toContain('Previous Status: Pending');
    expect(mail.text).toContain('New Status: Resolved');
    expect(logService.addServerLog).toHaveBeenCalledWith('info', 'email', expect.stringContaining('lead@example.test'));
  });

  it('does not mail when the update leaves the status unchanged', async () => {
    const dataStore = teamWithFeedback();
    const { app, sendMail } = buildApp({ dataStore });

    await request(app, '/api/super-admin/feedbacks/update', postJson(auth({
      teamId: 'team-1',
      feedbackId: 'fb-1',
      updates: { status: 'pending', isRead: true }
    })));

    expect(sendMail).not.toHaveBeenCalled();
    expect((dataStore.teamsById.get('team-1')!.teamFeedbacks as Record<string, unknown>[])[0].isRead).toBe(true);
  });

  it('still applies the update when the notification email fails', async () => {
    const dataStore = teamWithFeedback();
    const sendMail = vi.fn(async (_mail: Record<string, unknown>) => { throw new Error('smtp down'); });
    const logService = { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() };
    const { app } = buildApp({
      dataStore,
      logService,
      mailerService: { smtpEnabled: true, mailer: { sendMail } }
    });

    const response = await request(app, '/api/super-admin/feedbacks/update', postJson(auth({
      teamId: 'team-1',
      feedbackId: 'fb-1',
      updates: { status: 'resolved' }
    })));

    expect(await response.json()).toEqual({ success: true });
    expect((dataStore.teamsById.get('team-1')!.teamFeedbacks as Record<string, unknown>[])[0].status).toBe('resolved');
    expect(logService.addServerLog).toHaveBeenCalledWith('warn', 'email', expect.stringContaining('Failed to send'));
  });

  it('never reports success when the feedback write is lost (audit H2)', async () => {
    const dataStore = createDataStore({
      teams: [{
        id: 'team-1',
        name: 'Platform',
        teamFeedbacks: [{ id: 'fb-1', title: 'Timer drifts', type: 'bug', status: 'pending' }]
      }],
      teamUpdateResult: { success: false, error: 'conflict' }
    });
    const { app } = buildApp({ dataStore });

    for (const [path, body] of [
      ['/api/super-admin/feedbacks/update', { feedbackId: 'fb-1', updates: { status: 'resolved' } }],
      ['/api/super-admin/feedbacks/delete', { feedbackId: 'fb-1' }],
      ['/api/super-admin/feedbacks/comment', { feedbackId: 'fb-1', content: 'On it' }]
    ] as const) {
      const response = await request(app, path, postJson(auth({ teamId: 'team-1', ...body })));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'failed_to_save' });
    }

    expect((dataStore.teamsById.get('team-1')!.teamFeedbacks as Record<string, unknown>[])[0].status).toBe('pending');
  });

  it('updates an orphaned feedback from a deleted team', async () => {
    const dataStore = createDataStore({
      meta: { orphanedFeedbacks: [{ id: 'fb-orphan', title: 'Lost', type: 'bug', status: 'pending' }] }
    });
    const { app, sendMail } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/feedbacks/update', postJson(auth({
      teamId: 'deleted-team',
      feedbackId: 'fb-orphan',
      updates: { status: 'resolved' }
    })));

    expect(await response.json()).toEqual({ success: true });
    expect(dataStore.state.meta.orphanedFeedbacks[0]).toMatchObject({
      status: 'resolved',
      teamName: 'Deleted Team',
      teamId: 'deleted-team'
    });
    // There is no facilitator to notify once the team is gone.
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('deletes a team feedback and tells the facilitator', async () => {
    const dataStore = teamWithFeedback();
    const { app, sendMail } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/feedbacks/delete', postJson(auth({
      teamId: 'team-1',
      feedbackId: 'fb-1'
    })));

    expect(await response.json()).toEqual({ success: true });
    expect(dataStore.teamsById.get('team-1')!.teamFeedbacks).toEqual([]);
    expect((sendMail.mock.calls[0][0] as { subject: string }).subject).toContain('Feedback Deleted');
  });

  it('deletes an orphaned feedback', async () => {
    const dataStore = createDataStore({
      meta: { orphanedFeedbacks: [{ id: 'fb-orphan', title: 'Lost', type: 'bug' }] }
    });
    const { app } = buildApp({ dataStore });

    await request(app, '/api/super-admin/feedbacks/delete', postJson(auth({
      teamId: 'deleted-team',
      feedbackId: 'fb-orphan'
    })));

    expect(dataStore.state.meta.orphanedFeedbacks).toEqual([]);
  });

  it('appends an admin comment, truncates it and notifies the facilitator', async () => {
    const dataStore = teamWithFeedback();
    const { app, sendMail } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/feedbacks/comment', postJson(auth({
      teamId: 'team-1',
      feedbackId: 'fb-1',
      content: `  ${'x'.repeat(1200)}  `
    })));

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.comment).toMatchObject({
      feedbackId: 'fb-1',
      authorName: 'Super Admin',
      teamId: 'super-admin',
      isAdmin: true
    });
    expect(body.comment.content).toHaveLength(1000);

    const comments = (dataStore.teamsById.get('team-1')!.teamFeedbacks as { comments: unknown[] }[])[0].comments;
    expect(comments).toHaveLength(1);
    expect((sendMail.mock.calls[0][0] as { subject: string }).subject).toContain('Admin Comment');
  });

  it('appends an admin comment to an orphaned feedback', async () => {
    const dataStore = createDataStore({
      meta: { orphanedFeedbacks: [{ id: 'fb-orphan', title: 'Lost', type: 'feature' }] }
    });
    const { app } = buildApp({ dataStore });

    await request(app, '/api/super-admin/feedbacks/comment', postJson(auth({
      teamId: 'deleted-team',
      feedbackId: 'fb-orphan',
      content: 'Noted'
    })));

    expect((dataStore.state.meta.orphanedFeedbacks[0] as { comments: unknown[] }).comments).toHaveLength(1);
  });

  it('answers 500 when a feedback operation throws', async () => {
    const dataStore = createDataStore();
    dataStore.loadTeam = vi.fn(async () => { throw new Error('store down'); });
    const { app } = buildApp({ dataStore });

    for (const [path, body] of [
      ['/api/super-admin/feedbacks/update', { updates: { status: 'resolved' } }],
      ['/api/super-admin/feedbacks/delete', {}],
      ['/api/super-admin/feedbacks/comment', { content: 'hi' }]
    ] as const) {
      const response = await request(app, path, postJson(auth({ teamId: 'team-1', feedbackId: 'fb-1', ...body })));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'failed_to_save' });
    }
  });
});

describe('super-admin backups', () => {
  it('streams a gzipped snapshot of the whole store', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Platform' }] });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/backup', postJson(auth()));

    expect(response.headers.get('content-type')).toBe('application/gzip');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="retrogemini-backup-.*\.json\.gz"$/);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const payload = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'));
    expect(payload.teams).toHaveLength(1);
  });

  it('answers 500 when the snapshot cannot be built', async () => {
    const dataStore = createDataStore();
    dataStore.loadPersistedData = vi.fn(async () => { throw new Error('store down'); });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/backup', postJson(auth()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'backup_failed' });
  });

  it('lists backups together with the retention configuration', async () => {
    const { app } = buildApp();

    const response = await request(app, '/api/super-admin/backups/list', postJson(auth()));

    expect(await response.json()).toEqual({
      backups: [{ id: 'backup-1' }],
      config: { enabled: true, maxCount: 7 }
    });
  });

  it('creates a labelled manual checkpoint', async () => {
    const { app, backupService } = buildApp();

    const response = await request(app, '/api/super-admin/backups/create', postJson(auth({ label: 'before migration' })));

    expect(await response.json()).toEqual({ success: true, backup: { id: 'backup-1', type: 'manual' } });
    expect(backupService.createBackup).toHaveBeenCalledWith('manual', 'before migration');
  });

  it('reports a conflict when another backup is already running', async () => {
    const backupService = createBackupService();
    backupService.createBackup = vi.fn(async () => null);
    const { app } = buildApp({ backupService });

    const response = await request(app, '/api/super-admin/backups/create', postJson(auth()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'backup_in_progress' });
  });

  it('downloads a stored backup', async () => {
    const { app } = buildApp();

    const response = await request(app, '/api/super-admin/backups/download', postJson(auth({ backupId: 'backup-1' })));

    expect(response.headers.get('content-disposition')).toBe('attachment; filename="backup-1.json.gz"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('takes a protected pre-restore snapshot before restoring from a stored backup', async () => {
    const { app, backupService, sessionCache, io } = buildApp();
    sessionCache.set('live-session', { id: 'live-session' });

    const response = await request(app, '/api/super-admin/backups/restore', postJson(auth({ backupId: 'backup-1' })));

    expect(await response.json()).toEqual({ success: true, restored: { id: 'backup-1' } });
    expect(backupService.createBackup).toHaveBeenCalledWith('auto', 'Pre-restore snapshot', { protected: true });
    // The snapshot is taken before the destructive restore, never after.
    expect(backupService.createBackup.mock.invocationCallOrder[0])
      .toBeLessThan(backupService.restoreFromBackup.mock.invocationCallOrder[0]);
    // Pre-restore session state must not survive the restore.
    expect(sessionCache.size).toBe(0);
    // Single-pod deployments do not broadcast.
    expect(io.serverSideEmit).not.toHaveBeenCalled();
  });

  it('aborts a stored-backup restore when the pre-restore snapshot fails', async () => {
    const backupService = createBackupService();
    backupService.createBackup = vi.fn(async () => null);
    const { app } = buildApp({ backupService });

    const response = await request(app, '/api/super-admin/backups/restore', postJson(auth({ backupId: 'backup-1' })));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'pre_restore_snapshot_failed' });
    expect(backupService.restoreFromBackup).not.toHaveBeenCalled();
  });

  it('broadcasts cross-pod session invalidation on a multi-pod restore', async () => {
    const { app, io } = buildApp({ serverRuntime: { multiPodAdapter: true } });

    await request(app, '/api/super-admin/backups/restore', postJson(auth({ backupId: 'backup-1' })));

    expect(io.serverSideEmit).toHaveBeenCalledWith('sessions-invalidated');
  });

  it('completes the restore even if the cross-pod broadcast throws', async () => {
    const io = {
      fetchSockets: vi.fn(async () => []),
      serverSideEmit: vi.fn(() => { throw new Error('adapter down'); })
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { app } = buildApp({ io, serverRuntime: { multiPodAdapter: true } });

    const response = await request(app, '/api/super-admin/backups/restore', postJson(auth({ backupId: 'backup-1' })));

    expect(await response.json()).toEqual({ success: true, restored: { id: 'backup-1' } });
    warn.mockRestore();
  });

  it('deletes a backup and reports an unknown id', async () => {
    const { app } = buildApp();
    const ok = await request(app, '/api/super-admin/backups/delete', postJson(auth({ backupId: 'backup-1' })));
    expect(await ok.json()).toEqual({ success: true });

    const backupService = createBackupService();
    backupService.deleteBackup = vi.fn(async () => false);
    const missing = await request(buildApp({ backupService }).app, '/api/super-admin/backups/delete', postJson(auth({ backupId: 'ghost' })));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'backup_not_found' });
  });

  it('updates only the fields the caller supplied', async () => {
    const { app, backupService } = buildApp();

    await request(app, '/api/super-admin/backups/update', postJson(auth({ backupId: 'backup-1', label: 'keep' })));
    expect(backupService.updateBackup).toHaveBeenLastCalledWith('backup-1', { label: 'keep' });

    await request(app, '/api/super-admin/backups/update', postJson(auth({ backupId: 'backup-1', protected: true })));
    expect(backupService.updateBackup).toHaveBeenLastCalledWith('backup-1', { protected: true });

    await request(app, '/api/super-admin/backups/update', postJson(auth({ backupId: 'backup-1' })));
    expect(backupService.updateBackup).toHaveBeenLastCalledWith('backup-1', {});
  });

  it('reports an unknown backup on update', async () => {
    const backupService = createBackupService();
    backupService.updateBackup = vi.fn(async () => null);
    const { app } = buildApp({ backupService });

    const response = await request(app, '/api/super-admin/backups/update', postJson(auth({ backupId: 'ghost', label: 'x' })));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'backup_not_found' });
  });

  it.each([
    ['/api/super-admin/backups/download', 'missing_backup_id'],
    ['/api/super-admin/backups/restore', 'missing_backup_id'],
    ['/api/super-admin/backups/delete', 'missing_backup_id'],
    ['/api/super-admin/backups/update', 'missing_backup_id']
  ])('rejects %s without a backup id', async (path, error) => {
    const { app, backupService } = buildApp();

    const response = await request(app, path, postJson(auth()));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(backupService.createBackup).not.toHaveBeenCalled();
  });

  it('reports an unknown backup on download', async () => {
    const backupService = createBackupService();
    backupService.getBackupData = vi.fn(async () => null);
    const { app } = buildApp({ backupService });

    const response = await request(app, '/api/super-admin/backups/download', postJson(auth({ backupId: 'ghost' })));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'backup_not_found' });
  });

  it.each([
    ['/api/super-admin/backups/list', 'listBackups', {}, 'list_failed'],
    ['/api/super-admin/backups/create', 'createBackup', {}, 'create_failed'],
    ['/api/super-admin/backups/download', 'getBackupData', { backupId: 'backup-1' }, 'download_failed'],
    ['/api/super-admin/backups/restore', 'restoreFromBackup', { backupId: 'backup-1' }, 'restore_failed'],
    ['/api/super-admin/backups/delete', 'deleteBackup', { backupId: 'backup-1' }, 'delete_failed'],
    ['/api/super-admin/backups/update', 'updateBackup', { backupId: 'backup-1' }, 'update_failed']
  ])('answers 500 on %s when the backup service throws', async (path, method, body, error) => {
    const backupService = createBackupService();
    (backupService as Record<string, unknown>)[method] = vi.fn(async () => { throw new Error('disk full'); });
    const { app } = buildApp({ backupService });

    const response = await request(app, path, postJson(auth(body)));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error });
  });
});

describe('super-admin global settings', () => {
  it('stores and clears the info banner', async () => {
    const { app, dataStore } = buildApp();

    await request(app, '/api/super-admin/info-message', postJson(auth({ infoMessage: 'Maintenance at 18:00' })));
    expect(dataStore.state.settings.infoMessage).toBe('Maintenance at 18:00');

    await request(app, '/api/super-admin/info-message', postJson(auth({})));
    expect(dataStore.state.settings.infoMessage).toBe('');
  });

  it('reads and writes the admin email and the new-team notification flag', async () => {
    const dataStore = createDataStore({ globalSettings: { adminEmail: 'admin@example.test', notifyNewTeam: true } });
    const { app } = buildApp({ dataStore });

    const read = await request(app, '/api/super-admin/admin-email', postJson(auth()));
    expect(await read.json()).toEqual({ adminEmail: 'admin@example.test', notifyNewTeam: true });

    await request(app, '/api/super-admin/update-admin-email', postJson(auth({ adminEmail: 'new@example.test' })));
    expect(dataStore.state.settings.adminEmail).toBe('new@example.test');

    await request(app, '/api/super-admin/update-notify-new-team', postJson(auth({ notifyNewTeam: false })));
    expect(dataStore.state.settings.notifyNewTeam).toBe(false);
  });

  it('defaults the admin email read when nothing is configured', async () => {
    const { app } = buildApp();

    const response = await request(app, '/api/super-admin/admin-email', postJson(auth()));

    expect(await response.json()).toEqual({ adminEmail: '', notifyNewTeam: false });
  });

  it.each([
    ['/api/super-admin/info-message', 'failed_to_save'],
    ['/api/super-admin/admin-email', 'failed_to_load'],
    ['/api/super-admin/update-admin-email', 'failed_to_save'],
    ['/api/super-admin/update-notify-new-team', 'failed_to_save']
  ])('answers 500 on %s when the settings store throws', async (path, error) => {
    const dataStore = createDataStore();
    dataStore.loadGlobalSettings = vi.fn(async () => { throw new Error('store down'); });
    const { app } = buildApp({ dataStore });

    const response = await request(app, path, postJson(auth()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error });
  });
});

describe('super-admin feedback notification', () => {
  const feedback = {
    title: 'Timer drifts',
    type: 'bug',
    teamName: 'Platform',
    submittedByName: 'Ada',
    description: 'It drifts by a second per minute',
    submittedAt: '2026-07-01T09:00:00.000Z'
  };

  it('mails the configured admin address', async () => {
    const dataStore = createDataStore({ globalSettings: { adminEmail: 'admin@example.test' } });
    const { app, sendMail, logService } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/notify-feedback', postJson(auth({ feedback })));

    expect(await response.json()).toEqual({ success: true });
    const mail = sendMail.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(mail.to).toBe('admin@example.test');
    expect(mail.subject).toBe('🐛 New Bug Report: Timer drifts');
    expect(mail.html).not.toContain('image(s) attached');
    expect(logService.addServerLog).toHaveBeenCalledWith('info', 'email', expect.stringContaining('Timer drifts'));
  });

  it('mentions attached images and labels a feature request', async () => {
    const dataStore = createDataStore({ globalSettings: { adminEmail: 'admin@example.test' } });
    const { app, sendMail } = buildApp({ dataStore });

    await request(app, '/api/super-admin/notify-feedback', postJson(auth({
      feedback: { ...feedback, type: 'feature', images: ['a', 'b'] }
    })));

    const mail = sendMail.mock.calls[0][0] as { subject: string; html: string };
    expect(mail.subject).toBe('✨ New Feature Request: Timer drifts');
    expect(mail.html).toContain('2 image(s) attached');
  });

  it('refuses when SMTP is not configured', async () => {
    const { app } = buildApp({ mailerService: { smtpEnabled: false, mailer: null } });

    const response = await request(app, '/api/super-admin/notify-feedback', postJson(auth({ feedback })));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'email_not_configured' });
  });

  it('refuses when no admin email is configured', async () => {
    const { app, sendMail } = buildApp();

    const response = await request(app, '/api/super-admin/notify-feedback', postJson(auth({ feedback })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'admin_email_not_configured' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it.each([
    ['no feedback', {}],
    ['no title', { feedback: { type: 'bug' } }],
    ['no type', { feedback: { title: 'Something' } }]
  ])('rejects a notification with %s', async (_label, body) => {
    const dataStore = createDataStore({ globalSettings: { adminEmail: 'admin@example.test' } });
    const { app, sendMail } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/notify-feedback', postJson(auth(body)));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_feedback_data' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('answers 500 when the mailer throws', async () => {
    const dataStore = createDataStore({ globalSettings: { adminEmail: 'admin@example.test' } });
    const { app } = buildApp({
      dataStore,
      mailerService: { smtpEnabled: true, mailer: { sendMail: vi.fn(async (_mail: Record<string, unknown>) => { throw new Error('smtp down'); }) } }
    });

    const response = await request(app, '/api/super-admin/notify-feedback', postJson(auth({ feedback })));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'send_failed' });
  });
});

describe('super-admin AI configuration', () => {
  it('reports a disabled default when nothing is configured', async () => {
    const { app } = buildApp();

    const response = await request(app, '/api/super-admin/ai-settings', postJson(auth()));

    expect(await response.json()).toEqual({ ai: { enabled: false, apiUrl: '' } });
  });

  it('returns the stored AI configuration', async () => {
    const dataStore = createDataStore({ globalSettings: { ai: { enabled: true, apiUrl: 'https://llm.internal/v1' } } });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/ai-settings', postJson(auth()));

    expect(await response.json()).toEqual({ ai: { enabled: true, apiUrl: 'https://llm.internal/v1' } });
  });

  it('normalizes the saved AI configuration', async () => {
    const { app, dataStore, logService } = buildApp();

    await request(app, '/api/super-admin/update-ai-settings', postJson(auth({
      enabled: 'yes',
      apiUrl: '  https://llm.internal/v1  ',
      apiKey: '   ',
      model: '  mistral  ',
      allowSelfSignedCerts: 1
    })));

    expect(dataStore.state.settings.ai).toEqual({
      enabled: true,
      apiUrl: 'https://llm.internal/v1',
      // A blank key/model is stored as absent, not as an empty string.
      model: 'mistral',
      allowSelfSignedCerts: true
    });
    expect(logService.addServerLog).toHaveBeenCalledWith('info', 'server', 'AI settings updated (enabled: true)');
  });

  it('saves the submitted configuration before testing it', async () => {
    const { app, dataStore, aiService } = buildApp();

    const response = await request(app, '/api/super-admin/test-ai', postJson(auth({
      apiUrl: 'https://llm.internal/v1',
      model: 'mistral'
    })));

    expect(await response.json()).toEqual({ success: true, response: 'A suggested title' });
    expect(dataStore.state.settings.ai).toMatchObject({ enabled: true, apiUrl: 'https://llm.internal/v1' });
    expect(aiService.suggestGroupTitle).toHaveBeenCalled();
  });

  it('tests without re-saving when no url is submitted', async () => {
    const { app, dataStore } = buildApp();

    await request(app, '/api/super-admin/test-ai', postJson(auth()));

    expect(dataStore.saveGlobalSettings).not.toHaveBeenCalled();
  });

  it('reports an unconfigured AI backend', async () => {
    const { app } = buildApp({ aiService: { suggestGroupTitle: vi.fn(async () => null) } });

    const response = await request(app, '/api/super-admin/test-ai', postJson(auth()));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'ai_not_configured' });
  });

  // `attachConsole()` mirrors console.error into the super-admin ring at the
  // same level and source, so the route must log the failure exactly once —
  // through the console alone. An explicit `addServerLog` beside it wrote every
  // failure twice, which is what PR #404 fixed in `aiRoutes` and flagged here.
  it('surfaces the AI failure message and logs it exactly once', async () => {
    const logService = { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = buildApp({
      logService,
      aiService: { suggestGroupTitle: vi.fn(async () => { throw new Error('connection refused'); }) }
    });

    const response = await request(app, '/api/super-admin/test-ai', postJson(auth()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'ai_test_failed', message: 'connection refused' });
    expect(error).toHaveBeenCalledWith('[Server] AI test failed:', 'connection refused');
    expect(logService.addServerLog).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('answers 500 when the AI settings cannot be read or written', async () => {
    const dataStore = createDataStore();
    dataStore.loadGlobalSettings = vi.fn(async () => { throw new Error('store down'); });
    const { app } = buildApp({ dataStore });

    const read = await request(app, '/api/super-admin/ai-settings', postJson(auth()));
    expect(read.status).toBe(500);
    expect(await read.json()).toEqual({ error: 'failed_to_load' });

    const write = await request(app, '/api/super-admin/update-ai-settings', postJson(auth({ enabled: true })));
    expect(write.status).toBe(500);
    expect(await write.json()).toEqual({ error: 'failed_to_save' });
  });
});
