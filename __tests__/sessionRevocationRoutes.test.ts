import express from 'express';
import { createHmac } from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';
import { registerPasswordResetRoutes } from '../server/routes/passwordResetRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { registerAiRoutes } from '../server/routes/aiRoutes.js';
import { createPublicOriginResolver } from '../server/services/publicOrigin.js';
import { hashResetToken, pruneResetTokens, secureCompare } from '../server/services/security.js';
import { SECURITY_ACTIONS } from '../server/services/securityEvents.js';

/**
 * Decision D3b — a password rotation invalidates the team's open sessions, on
 * every route, without cutting off the facilitator who changes the password.
 *
 * Real data store, real token service, real team service, and every
 * registrar that authenticates a team token on one app: a double of any of
 * them could keep a revoked token working without a test noticing.
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

const SECRET = 'session-revocation-routes-secret';
const OLD_PASSWORD = 'the-old-team-password';
const NEW_PASSWORD = 'the-new-team-password';
const SUPER_ADMIN_PASSWORD = 'super-admin-password-for-tests';

describe('a password rotation revokes the team\'s session tokens (decision D3b)', () => {
  let dir: string;
  let dataStore: ReturnType<typeof createDataStore>;
  let tokenService: ReturnType<typeof createTokenService>;
  let baseUrl: string;
  let close: () => Promise<void>;
  let revokeTeamSessions: Mock<(teamId: string) => void>;
  let record: Mock<(req: unknown, event: unknown) => void>;
  const savedEnv: Record<string, string | undefined> = {};

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const build = async () => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    tokenService = createTokenService({ secureCompare, superAdminPassword: SUPER_ADMIN_PASSWORD, tokenSecret: SECRET });
    const teamService = createTeamService({ dataStore, tokenService });
    revokeTeamSessions = vi.fn();
    const sessionRevocation = {
      revokeTeamSessions: async (teamId: string) => { revokeTeamSessions(teamId); },
      sweepAllLocal: async () => undefined,
      attachLocalSweeper: () => undefined
    };
    record = vi.fn();
    const securityEvents = { record: async (req: { ip?: string }, event: unknown) => { record(req, event); } };
    const mailerService = { smtpEnabled: false, mailer: null };
    const logService = { addServerLog: () => {}, getServerLogs: () => [], clearServerLogs: () => {} };
    const escapeHtml = (s: string) => String(s ?? '');

    registerTeamRoutes({ app, dataStore, teamService, tokenService, mailerService, logService, escapeHtml, securityEvents, sessionRevocation });
    registerFeedbackRoutes({ app, dataStore, teamService, mailerService, logService, escapeHtml });
    registerPasswordResetRoutes({
      app,
      dataStore,
      mailerService,
      escapeHtml,
      sanitizeEmailLink: (s: string) => s,
      hashResetToken,
      pruneResetTokens,
      publicOrigin: createPublicOriginResolver({ env: { PUBLIC_BASE_URL: 'https://retro.example.test/' } }),
      securityEvents,
      sessionRevocation
    });
    registerSuperAdminRoutes({
      app,
      io: { fetchSockets: async () => [], serverSideEmit: () => undefined },
      dataStore,
      tokenService,
      mailerService,
      logService,
      escapeHtml,
      superAdminPassword: SUPER_ADMIN_PASSWORD,
      sessionCache: new Map(),
      backupService: {},
      aiService: {},
      serverRuntime: { multiPodAdapter: false },
      securityEvents,
      sessionRevocation
    });
    registerAiRoutes({
      app,
      tokenService,
      teamService,
      aiService: { suggestGroupTitle: async () => 'A title' }
    });

    await new Promise<void>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        close = () => new Promise((res) => server.close(() => res()));
        resolve();
      });
    });
  };

  const createTeam = async (name: string) => {
    const res = await post('/api/team/create', { name, password: OLD_PASSWORD, facilitatorEmail: 'fac@example.com' });
    expect(res.status).toBe(201);
    return (await res.json()) as { team: { id: string }; sessionToken: string };
  };

  const login = async (name: string, password: string) => {
    const res = await post('/api/team/login', { teamName: name, password });
    expect(res.status).toBe(200);
    return ((await res.json()) as { sessionToken: string }).sessionToken;
  };

  // A token as 41.0 minted it: the same format, no epoch claim.
  const legacyToken = (teamId: string, iat: number) => {
    const encoded = Buffer.from(JSON.stringify({
      v: 1, type: 'team-session', iat, exp: iat + 60 * 60 * 1000, nonce: 'n', teamId, visitorId: null
    }), 'utf8').toString('base64url');
    return `rg1.${encoded}.${createHmac('sha256', SECRET).update(encoded).digest('base64url')}`;
  };

  // Every route family that authenticates a team token, with its answer to a
  // current token.
  const probes = (teamId: string) => [
    { label: 'a persist (needsTeam: false)', path: `/api/team/${teamId}/retrospective/r1`, body: { retrospective: { id: 'r1', name: 'Sprint', _rev: 1 } }, ok: 200 },
    { label: 'the team read (needsTeam: true)', path: `/api/team/${teamId}`, body: {}, ok: 200 },
    { label: 'a Jira route', path: `/api/team/${teamId}/jira/status`, body: {}, ok: 200 },
    { label: 'the feedback board', path: '/api/feedbacks/all', body: { teamId }, ok: 200 },
    { label: 'an AI route', path: '/api/ai/suggest-group-title', body: { ticketTexts: ['a', 'b'] }, ok: 200 },
    { label: 'the session restore', path: '/api/team/restore-session', body: {}, ok: 200 }
  ];

  beforeEach(async () => {
    for (const key of [...PG_ENV_KEYS, 'AUTH_RATE_LIMIT_MAX']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.AUTH_RATE_LIMIT_MAX = '50';
    dir = mkdtempSync(join(tmpdir(), 'retro-revocation-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
    await build();
  });

  afterEach(async () => {
    await close();
    await dataStore.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it('mints login and creation tokens with the team\'s epoch', async () => {
    const { team, sessionToken } = await createTeam('Alpha');
    expect(tokenService.validateSessionToken(sessionToken)?.sessionEpoch).toBe('0');

    const { sessionEpoch } = await dataStore.rotateTeamSessionEpoch(team.id);
    const loginToken = await login('Alpha', OLD_PASSWORD);

    expect(tokenService.validateSessionToken(loginToken)?.sessionEpoch).toBe(sessionEpoch);
  });

  it('refuses the old token on every route after /password, and the token it hands back works on all of them', async () => {
    const { team, sessionToken: oldToken } = await createTeam('Alpha');
    for (const probe of probes(team.id)) {
      const res = await post(probe.path, { ...probe.body, sessionToken: oldToken });
      expect([probe.label, res.status]).toEqual([probe.label, probe.ok]);
    }

    const rotation = await post(`/api/team/${team.id}/password`, { password: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(rotation.status).toBe(200);
    const { success, sessionToken: freshToken } = await rotation.json();
    expect(success).toBe(true);
    expect(typeof freshToken).toBe('string');
    expect(revokeTeamSessions).toHaveBeenCalledWith(team.id);

    for (const probe of probes(team.id)) {
      const refused = await post(probe.path, { ...probe.body, sessionToken: oldToken });
      expect([probe.label, refused.status, await refused.json()]).toEqual([probe.label, 401, { error: 'session_revoked' }]);
      const accepted = await post(probe.path, { ...probe.body, sessionToken: freshToken });
      expect([probe.label, accepted.status]).toEqual([probe.label, probe.ok]);
    }
  });

  it('refuses the old token beside the old password, and accepts it beside the new one', async () => {
    const { team, sessionToken: oldToken } = await createTeam('Alpha');
    await post(`/api/team/${team.id}/password`, { password: OLD_PASSWORD, newPassword: NEW_PASSWORD });

    const withOld = await post(`/api/team/${team.id}`, { sessionToken: oldToken, password: OLD_PASSWORD });
    expect(withOld.status).toBe(401);
    expect(await withOld.json()).toEqual({ error: 'session_revoked' });

    const withNew = await post(`/api/team/${team.id}`, { sessionToken: oldToken, password: NEW_PASSWORD });
    expect(withNew.status).toBe(200);
  });

  it('revokes on an emailed reset and on the console\'s password change, handing back no token', async () => {
    const { team, sessionToken: first } = await createTeam('Alpha');
    const resetToken = 'ab'.repeat(32);
    await dataStore.atomicMetaUpdate((meta: { resetTokens?: unknown[] }) => ({
      ...meta,
      resetTokens: [{ tokenHash: hashResetToken(resetToken), teamId: team.id, createdAt: Date.now(), expiresAt: Date.now() + 60_000 }]
    }));

    const reset = await post('/api/password-reset/confirm', { token: resetToken, newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect(await reset.json()).not.toHaveProperty('sessionToken');
    expect((await post(`/api/team/${team.id}`, { sessionToken: first })).status).toBe(401);
    expect(revokeTeamSessions).toHaveBeenLastCalledWith(team.id);

    const second = await login('Alpha', NEW_PASSWORD);
    expect((await post(`/api/team/${team.id}`, { sessionToken: second })).status).toBe(200);
    const admin = await post('/api/super-admin/update-password', { password: SUPER_ADMIN_PASSWORD, teamId: team.id, newPassword: OLD_PASSWORD });
    expect(admin.status).toBe(200);
    expect(await admin.json()).toEqual({ success: true });
    const refused = await post(`/api/team/${team.id}`, { sessionToken: second });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: 'session_revoked' });
    expect(revokeTeamSessions).toHaveBeenCalledTimes(2);
  });

  it('refuses a token from before the release minted before the rotation, and accepts one minted after it', async () => {
    const { team } = await createTeam('Alpha');
    const before = legacyToken(team.id, Date.now() - 1000);
    expect((await post(`/api/team/${team.id}`, { sessionToken: before })).status).toBe(200);

    await post(`/api/team/${team.id}/password`, { password: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    const after = legacyToken(team.id, Date.now() + 1000);

    expect((await post(`/api/team/${team.id}`, { sessionToken: before })).status).toBe(401);
    expect((await post(`/api/team/${team.id}`, { sessionToken: after })).status).toBe(200);
  });

  it('leaves another team\'s tokens alone', async () => {
    const alpha = await createTeam('Alpha');
    const beta = await createTeam('Beta');

    await post(`/api/team/${alpha.team.id}/password`, { password: OLD_PASSWORD, newPassword: NEW_PASSWORD });

    expect((await post(`/api/team/${beta.team.id}`, { sessionToken: beta.sessionToken })).status).toBe(200);
  });

  it('records that the rotation revoked the team\'s sessions', async () => {
    const { team } = await createTeam('Alpha');
    await post(`/api/team/${team.id}/password`, { password: OLD_PASSWORD, newPassword: NEW_PASSWORD });

    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: SECURITY_ACTIONS.TEAM_PASSWORD_CHANGE,
      target: team.id,
      detail: { sessionsRevoked: true }
    }));
  });

  it('reads the epoch before the record on login, so a rotation racing it yields a refused token', async () => {
    const { team } = await createTeam('Alpha');
    const order: string[] = [];
    const loadTeamAuthState = dataStore.loadTeamAuthState.bind(dataStore);
    const loadTeam = dataStore.loadTeam.bind(dataStore);
    let racing = true;
    vi.spyOn(dataStore, 'loadTeam').mockImplementation(async (id: string) => {
      order.push('loadTeam');
      return loadTeam(id);
    });
    vi.spyOn(dataStore, 'loadTeamAuthState').mockImplementation(async (id: string) => {
      order.push('loadTeamAuthState');
      const state = await loadTeamAuthState(id);
      // A rotation commits right after the login read the epoch.
      if (racing) {
        racing = false;
        await dataStore.rotateTeamSessionEpoch(id);
      }
      return state;
    });

    const token = await login('Alpha', OLD_PASSWORD);

    expect(order.slice(0, 2)).toEqual(['loadTeamAuthState', 'loadTeam']);
    const res = await post(`/api/team/${team.id}`, { sessionToken: token });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'session_revoked' });
  });
});

describe('the restore meter does not count revoked tokens (decision D3b)', () => {
  let dir: string;
  let dataStore: ReturnType<typeof createDataStore>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of [...PG_ENV_KEYS, 'AUTH_RATE_LIMIT_MAX']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-revocation-meter-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
  });

  afterEach(async () => {
    await dataStore.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('lets an office of revoked browsers reload without locking out a valid restore, and still meters forged tokens', async () => {
    // Without the exemption, six people reloading after a rotation spend the
    // per-IP budget, every valid restore from that office then gets 429 for
    // fifteen minutes, and the client deletes each saved session.
    process.env.AUTH_RATE_LIMIT_MAX = '2';
    const app = express();
    app.use(express.json());
    const tokenService = createTokenService({ secureCompare, superAdminPassword: null, tokenSecret: SECRET });
    const teamService = createTeamService({ dataStore, tokenService });
    registerTeamRoutes({
      app,
      dataStore,
      teamService,
      tokenService,
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: () => {} },
      escapeHtml: (s: string) => s
    });
    await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha', passwordHash: 'x', members: [], retrospectives: [] });
    const revoked = tokenService.createSessionToken('t1', null, { sessionEpoch: '0' });
    const { sessionEpoch } = await dataStore.rotateTeamSessionEpoch('t1');
    const valid = tokenService.createSessionToken('t1', null, { sessionEpoch });

    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/team/restore-session`;
    const restore = (sessionToken: string) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionToken }) });
    try {
      // One after another: the meter counts a request when it arrives and
      // refunds it when it ends.
      for (let i = 0; i < 6; i += 1) {
        const res = await restore(revoked);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'session_revoked' });
      }
      expect((await restore(valid)).status).toBe(200);

      expect((await restore('rg1.forged.token')).status).toBe(401);
      expect((await restore('rg1.forged.token')).status).toBe(401);
      expect((await restore('rg1.forged.token')).status).toBe(429);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
