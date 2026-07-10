import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';

/**
 * Hardening stage 7a (audit PR-7): every team endpoint accepts a valid team
 * session token as an alternative credential to the plaintext password.
 *
 * This is additive: password auth must keep working exactly as before, and a
 * token minted for one team must never authenticate requests against another
 * team. This is the prerequisite for the client preferring token auth (7b)
 * and for hashing passwords at rest (7c).
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  const meta: { resetTokens: unknown[]; orphanedFeedbacks: Record<string, unknown>[] } = {
    resetTokens: [],
    orphanedFeedbacks: []
  };

  return {
    loadTeam: async (teamId: string) => teams.get(teamId) || null,
    loadTeamRaw: async (teamId: string) => teams.get(teamId) || null,
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, { ...teamData });
    },
    loadAllTeams: async () => Array.from(teams.values()),
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamUpdate: async (
      teamId: string,
      updater: (team: Team) => Team | null
    ): Promise<{ success: boolean; team?: Team; error?: string }> => {
      const existing = teams.get(teamId);
      if (!existing) return { success: false, error: 'team_not_found' };
      const updated = updater({ ...existing });
      if (!updated) return { success: true, team: existing };
      teams.set(teamId, { ...updated });
      return { success: true, team: updated };
    },
    loadTeamIndex: async () => new Map(indexMap),
    atomicTeamIndexUpdate: async (
      updater: (index: Map<string, string>) => Map<string, string> | null
    ) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [k, v] of next) indexMap.set(k, v);
      return new Map(indexMap);
    },
    loadMetaData: async () => meta,
    atomicMetaUpdate: async (updater: (m: typeof meta) => typeof meta | null) => {
      updater(meta);
      return meta;
    },
    loadGlobalSettings: async () => ({}),
    _teams: teams
  };
};

const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const dataStore = createMockDataStore();
  const tokenService = createTokenService({
    secureCompare: (a: string, b: string) => a === b,
    superAdminPassword: null,
    tokenSecret: 'team-token-auth-test-secret'
  });
  const teamService = createTeamService({ dataStore, tokenService });
  const mailerService = { smtpEnabled: false, mailer: null };
  const logService = { addServerLog: () => {} };
  const escapeHtml = (s: string) => s;

  registerTeamRoutes({ app, dataStore, teamService, tokenService, mailerService, logService, escapeHtml });
  registerFeedbackRoutes({ app, dataStore, teamService, mailerService, logService, escapeHtml });

  return { app, dataStore, tokenService };
};

const listen = async (app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
};

describe('Stage 7a: team endpoints accept a session token as an alternative credential', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;
  let tokenService: ReturnType<typeof createTokenService>;
  let teamId: string;
  let otherTeamId: string;

  const post = async (path: string, body: Record<string, unknown>) => {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  };

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    tokenService = built.tokenService;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;

    const createRes = await post('/api/team/create', { name: 'Alpha', password: 'secret' });
    expect(createRes.status).toBe(201);
    teamId = (await createRes.json()).team.id;

    const otherRes = await post('/api/team/create', { name: 'Bravo', password: 'other-secret' });
    expect(otherRes.status).toBe(201);
    otherTeamId = (await otherRes.json()).team.id;
  });

  afterEach(async () => {
    await close();
  });

  const validToken = () => tokenService.createSessionToken(teamId, null);
  const foreignToken = () => tokenService.createSessionToken(otherTeamId, null);

  describe('token acceptance on every password-protected team endpoint', () => {
    it('authenticates /api/team/:teamId with a valid session token and no password', async () => {
      const res = await post(`/api/team/${teamId}`, { sessionToken: validToken() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.team.id).toBe(teamId);
      expect(body.team.passwordHash).toBeUndefined();
    });

    it('authenticates /api/team/:teamId/update with a valid session token', async () => {
      const res = await post(`/api/team/${teamId}/update`, {
        sessionToken: validToken(),
        updates: { facilitatorEmail: 'new@example.com' }
      });
      expect(res.status).toBe(200);
      expect(dataStore._teams.get(teamId)?.facilitatorEmail).toBe('new@example.com');
    });

    it('authenticates /api/team/:teamId/retrospective/:retroId with a valid session token', async () => {
      const res = await post(`/api/team/${teamId}/retrospective/retro-1`, {
        sessionToken: validToken(),
        retrospective: { id: 'retro-1', name: 'Sprint 1' }
      });
      expect(res.status).toBe(200);
      const team = dataStore._teams.get(teamId) as Team & { retrospectives: { id: string }[] };
      expect(team.retrospectives.some((r) => r.id === 'retro-1')).toBe(true);
    });

    it('authenticates /api/team/:teamId/healthcheck/:hcId with a valid session token', async () => {
      const res = await post(`/api/team/${teamId}/healthcheck/hc-1`, {
        sessionToken: validToken(),
        healthCheck: { id: 'hc-1', name: 'Health 1' }
      });
      expect(res.status).toBe(200);
    });

    it('authenticates /api/team/:teamId/action with a valid session token', async () => {
      const res = await post(`/api/team/${teamId}/action`, {
        sessionToken: validToken(),
        action: { id: 'action-1', text: 'Do the thing' }
      });
      expect(res.status).toBe(200);
    });

    it('authenticates /api/team/:teamId/members with a valid session token', async () => {
      const res = await post(`/api/team/${teamId}/members`, {
        sessionToken: validToken(),
        members: [{ id: 'm1', name: 'Alice', color: 'bg-rose-500', role: 'member' }]
      });
      expect(res.status).toBe(200);
    });

    it('authenticates /api/team/:teamId/password with a valid session token', async () => {
      const res = await post(`/api/team/${teamId}/password`, {
        sessionToken: validToken(),
        newPassword: 'new-secret'
      });
      expect(res.status).toBe(200);
      expect(dataStore._teams.get(teamId)?.passwordHash).toBe('new-secret');
    });

    it('authenticates /api/team/:teamId/delete with a valid session token', async () => {
      const res = await post(`/api/team/${teamId}/delete`, { sessionToken: validToken() });
      expect(res.status).toBe(200);
      expect(dataStore._teams.has(teamId)).toBe(false);
    });
  });

  describe('token acceptance on feedback endpoints', () => {
    it('authenticates /api/feedbacks/create with a valid session token', async () => {
      const res = await post('/api/feedbacks/create', {
        teamId,
        sessionToken: validToken(),
        feedback: { type: 'bug', title: 'Broken thing', description: 'It broke', submittedBy: 'm1', submittedByName: 'Alice' }
      });
      expect(res.status).toBe(200);
    });

    it('authenticates /api/feedbacks/all with a valid session token', async () => {
      const res = await post('/api/feedbacks/all', { teamId, sessionToken: validToken() });
      expect(res.status).toBe(200);
    });

    it('authenticates /api/feedbacks/comment with a valid session token', async () => {
      await post('/api/feedbacks/create', {
        teamId,
        sessionToken: validToken(),
        feedback: { type: 'bug', title: 'Broken thing', description: 'It broke', submittedBy: 'm1', submittedByName: 'Alice' }
      });
      const team = dataStore._teams.get(teamId) as Team & { teamFeedbacks: { id: string }[] };
      const feedbackId = team.teamFeedbacks[0].id;

      const res = await post('/api/feedbacks/comment', {
        teamId,
        sessionToken: validToken(),
        feedbackTeamId: teamId,
        feedbackId,
        authorId: 'm1',
        authorName: 'Alice',
        content: 'Same here'
      });
      expect(res.status).toBe(200);
    });

    it('authenticates /api/feedbacks/comment/delete with a valid session token', async () => {
      const res = await post('/api/feedbacks/comment/delete', {
        teamId,
        sessionToken: validToken(),
        feedbackTeamId: teamId,
        feedbackId: 'missing-feedback',
        commentId: 'missing-comment'
      });
      expect(res.status).toBe(200);
    });

    it('authenticates /api/feedbacks/delete with a valid session token', async () => {
      const res = await post('/api/feedbacks/delete', {
        teamId,
        sessionToken: validToken(),
        feedbackId: 'missing-feedback'
      });
      expect(res.status).toBe(200);
    });
  });

  describe('token scoping and rejection', () => {
    it('rejects a token minted for another team', async () => {
      const res = await post(`/api/team/${teamId}`, { sessionToken: foreignToken() });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_token');
    });

    it('rejects a garbage token', async () => {
      const res = await post(`/api/team/${teamId}`, { sessionToken: 'not-a-real-token' });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_token');
    });

    it('rejects a token signed with a different secret', async () => {
      const rogueService = createTokenService({
        secureCompare: (a: string, b: string) => a === b,
        superAdminPassword: null,
        tokenSecret: 'a-different-secret'
      });
      const res = await post(`/api/team/${teamId}`, {
        sessionToken: rogueService.createSessionToken(teamId, null)
      });
      expect(res.status).toBe(401);
    });

    it('rejects an expired token', async () => {
      let clock = Date.now();
      const expiringService = createTokenService({
        secureCompare: (a: string, b: string) => a === b,
        superAdminPassword: null,
        tokenSecret: 'team-token-auth-test-secret',
        now: () => clock
      });
      const token = expiringService.createSessionToken(teamId, null);
      clock += 8 * 24 * 60 * 60 * 1000; // past the 7-day expiry

      // The app's token service shares the secret but uses the real clock, so
      // build the request against a service whose clock we control instead.
      const teamService = createTeamService({ dataStore, tokenService: expiringService });
      const result = await teamService.authenticateTeam(teamId, undefined, token);
      expect(result.team).toBeNull();
      expect(result.error).toBe('invalid_token');
    });

    it('a token does not authenticate a write against a different team even with matching signature', async () => {
      const res = await post(`/api/team/${otherTeamId}/update`, {
        sessionToken: validToken(),
        updates: { facilitatorEmail: 'attacker@example.com' }
      });
      expect(res.status).toBe(401);
      expect(dataStore._teams.get(otherTeamId)?.facilitatorEmail).toBeUndefined();
    });
  });

  describe('password auth is unchanged (additive change)', () => {
    it('still authenticates with a valid password and no token', async () => {
      const res = await post(`/api/team/${teamId}`, { password: 'secret' });
      expect(res.status).toBe(200);
    });

    it('still rejects a wrong password with invalid_password when no token is supplied', async () => {
      const res = await post(`/api/team/${teamId}`, { password: 'wrong' });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_password');
    });

    it('still rejects a credential-less request with invalid_password', async () => {
      const res = await post(`/api/team/${teamId}`, {});
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_password');
    });

    it('accepts a valid token even when an outdated password is also supplied', async () => {
      // A member whose team password was rotated mid-session keeps working
      // because the signed token remains a valid credential on its own.
      const res = await post(`/api/team/${teamId}`, {
        password: 'stale-password',
        sessionToken: validToken()
      });
      expect(res.status).toBe(200);
    });

    it('still returns team_not_found for an unknown team id', async () => {
      const res = await post('/api/team/does-not-exist', { sessionToken: validToken() });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('team_not_found');
    });
  });
});
