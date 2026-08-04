import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';
import { verifyPassword, isHashedPassword } from '../server/services/passwordHashing.js';

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
    loadAllTeamFeedbacks: async () =>
      Array.from(teams.values()).map((t) => ({
        id: t.id,
        name: t.name,
        teamFeedbacks: t.teamFeedbacks || []
      })),
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

    it('rejects a token-only request on /api/team/:teamId/password (stage 7c: rotating the credential requires the current credential)', async () => {
      const before = dataStore._teams.get(teamId)?.passwordHash as string;
      const res = await post(`/api/team/${teamId}/password`, {
        sessionToken: validToken(),
        newPassword: 'new-secret'
      });
      expect(res.status).toBe(401);
      expect(dataStore._teams.get(teamId)?.passwordHash).toBe(before);
    });

    it('rejects a stale password on /api/team/:teamId/password even with a valid session token', async () => {
      const res = await post(`/api/team/${teamId}/password`, {
        password: 'stale-password',
        sessionToken: validToken(),
        newPassword: 'new-secret'
      });
      expect(res.status).toBe(401);
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
      // The credential passed — that is what this suite is about. The 404 is
      // about the deliberately missing target (audit H22, extended): before it,
      // this route answered 200 for a deletion that never happened, which made
      // an authentication test indistinguishable from a no-op test.
      expect(res.status).not.toBe(401);
      expect(res.status).toBe(404);
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

  describe('Stage 7c: passwords are hashed at rest with dual-verify', () => {
    it('stores a hash, not the plaintext, on team creation', async () => {
      const stored = dataStore._teams.get(teamId)?.passwordHash as string;
      expect(stored).not.toBe('secret');
      expect(isHashedPassword(stored)).toBe(true);
      expect(await verifyPassword('secret', stored)).toBe(true);
    });

    it('logs in against a hashed record with the original password', async () => {
      const res = await post('/api/team/login', { teamName: 'Alpha', password: 'secret' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.team.id).toBe(teamId);
      expect(body.team.passwordHash).toBeUndefined();
      expect(typeof body.sessionToken).toBe('string');
    });

    it('rejects a wrong password against a hashed record', async () => {
      const res = await post('/api/team/login', { teamName: 'Alpha', password: 'wrong' });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('invalid_password');
    });

    it('upgrades a legacy plaintext record on successful login, and login keeps working (migration)', async () => {
      // Simulate a pre-7c record persisted before hashing shipped.
      const team = dataStore._teams.get(teamId) as Team;
      dataStore._teams.set(teamId, { ...team, passwordHash: 'legacy-plain' });

      const first = await post('/api/team/login', { teamName: 'Alpha', password: 'legacy-plain' });
      expect(first.status).toBe(200);

      const upgraded = dataStore._teams.get(teamId)?.passwordHash as string;
      expect(upgraded).not.toBe('legacy-plain');
      expect(isHashedPassword(upgraded)).toBe(true);

      const second = await post('/api/team/login', { teamName: 'Alpha', password: 'legacy-plain' });
      expect(second.status).toBe(200);

      const wrong = await post('/api/team/login', { teamName: 'Alpha', password: 'other' });
      expect(wrong.status).toBe(401);
    });

    it('upgrades a legacy plaintext record on successful password auth against a team endpoint', async () => {
      const team = dataStore._teams.get(teamId) as Team;
      dataStore._teams.set(teamId, { ...team, passwordHash: 'legacy-plain' });

      const res = await post(`/api/team/${teamId}`, { password: 'legacy-plain' });
      expect(res.status).toBe(200);

      const upgraded = dataStore._teams.get(teamId)?.passwordHash as string;
      expect(isHashedPassword(upgraded)).toBe(true);
      expect(await verifyPassword('legacy-plain', upgraded)).toBe(true);
    });

    it('upgrades a legacy plaintext record even when the token authenticates first (review finding)', async () => {
      // A restored pre-hashing session sends both a valid token and the
      // echoed plaintext password; the token wins, but the legacy record
      // must still be upgraded opportunistically.
      const team = dataStore._teams.get(teamId) as Team;
      dataStore._teams.set(teamId, { ...team, passwordHash: 'legacy-plain' });

      const res = await post(`/api/team/${teamId}`, {
        password: 'legacy-plain',
        sessionToken: validToken()
      });
      expect(res.status).toBe(200);

      const upgraded = dataStore._teams.get(teamId)?.passwordHash as string;
      expect(isHashedPassword(upgraded)).toBe(true);
      expect(await verifyPassword('legacy-plain', upgraded)).toBe(true);
    });

    it('does not upgrade a legacy record from a token-authenticated call carrying a wrong password', async () => {
      const team = dataStore._teams.get(teamId) as Team;
      dataStore._teams.set(teamId, { ...team, passwordHash: 'legacy-plain' });

      const res = await post(`/api/team/${teamId}`, {
        password: 'stale-or-wrong',
        sessionToken: validToken()
      });
      expect(res.status).toBe(200);
      expect(dataStore._teams.get(teamId)?.passwordHash).toBe('legacy-plain');
    });

    it('does not upgrade the record on a failed password attempt', async () => {
      const team = dataStore._teams.get(teamId) as Team;
      dataStore._teams.set(teamId, { ...team, passwordHash: 'legacy-plain' });

      const res = await post(`/api/team/${teamId}`, { password: 'wrong' });
      expect(res.status).toBe(401);
      expect(dataStore._teams.get(teamId)?.passwordHash).toBe('legacy-plain');
    });

    it('authenticates team endpoints by password against a hashed record (old invite links keep working)', async () => {
      // Invite links embed the plain team secret; joining calls login and
      // routine calls may carry only the password. Both must verify against
      // the hashed record at every stage of the migration.
      const res = await post(`/api/team/${teamId}`, { password: 'secret' });
      expect(res.status).toBe(200);
    });

    it('restore-session never echoes a password, even for a legacy plaintext record (stage 7e)', async () => {
      // Pre-7e the echo kept restored sessions minting invite links; invite
      // links now embed a server-derived credential, so the plaintext never
      // leaves the store again.
      const team = dataStore._teams.get(teamId) as Team;
      dataStore._teams.set(teamId, { ...team, passwordHash: 'legacy-plain' });

      const res = await post('/api/team/restore-session', { sessionToken: validToken() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.password).toBeUndefined();
      expect(body.team.id).toBe(teamId);
    });

    it('restore-session omits the password for a hashed record', async () => {
      const res = await post('/api/team/restore-session', { sessionToken: validToken() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.password).toBeUndefined();
      expect(body.team.id).toBe(teamId);
      expect(body.team.passwordHash).toBeUndefined();
    });

    it('stores a hash on password change via the team password route', async () => {
      const res = await post(`/api/team/${teamId}/password`, {
        password: 'secret',
        newPassword: 'rotated-secret'
      });
      expect(res.status).toBe(200);

      const stored = dataStore._teams.get(teamId)?.passwordHash as string;
      expect(isHashedPassword(stored)).toBe(true);
      expect(await verifyPassword('rotated-secret', stored)).toBe(true);
      expect(await verifyPassword('secret', stored)).toBe(false);

      const login = await post('/api/team/login', { teamName: 'Alpha', password: 'rotated-secret' });
      expect(login.status).toBe(200);
    });
  });

  describe('Stage 7e: invite credentials replace the plaintext password in invite links', () => {
    const mintCredential = async (auth: Record<string, unknown>) => {
      const res = await post(`/api/team/${teamId}/invite-credential`, auth);
      return res;
    };

    it('mints an invite credential for a token-authenticated session', async () => {
      const res = await mintCredential({ sessionToken: validToken() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.inviteCredential).toBe('string');
      expect(body.inviteCredential.length).toBeGreaterThan(0);
    });

    it('mints an invite credential for a password-authenticated session', async () => {
      const res = await mintCredential({ password: 'secret' });
      expect(res.status).toBe(200);
      expect(typeof (await res.json()).inviteCredential).toBe('string');
    });

    it('refuses to mint without credentials or with a foreign token', async () => {
      const anonymous = await mintCredential({});
      expect(anonymous.status).toBe(401);

      const foreign = await mintCredential({ sessionToken: foreignToken() });
      expect(foreign.status).toBe(401);
    });

    it('is deterministic: the same team and epoch derive the same credential', async () => {
      const first = await (await mintCredential({ sessionToken: validToken() })).json();
      const second = await (await mintCredential({ sessionToken: validToken() })).json();
      expect(first.inviteCredential).toBe(second.inviteCredential);
    });

    it('never embeds the plaintext password in the credential', async () => {
      const { inviteCredential } = await (await mintCredential({ password: 'secret' })).json();
      const payload = JSON.parse(
        Buffer.from(inviteCredential.split('.')[1], 'base64url').toString('utf8')
      );
      expect(JSON.stringify(payload)).not.toContain('secret');
      expect(payload.type).toBe('team-invite');
      expect(payload.teamId).toBe(teamId);
      expect(typeof payload.epoch).toBe('number');
    });

    it('logs in (joins) with a valid invite credential and receives a session token', async () => {
      const { inviteCredential } = await (await mintCredential({ sessionToken: validToken() })).json();

      const res = await post('/api/team/login', { teamName: 'Alpha', inviteCredential });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.team.id).toBe(teamId);
      expect(body.team.passwordHash).toBeUndefined();
      expect(typeof body.sessionToken).toBe('string');
    });

    it('rejects an invite credential minted for another team', async () => {
      const otherCredential = await post(`/api/team/${otherTeamId}/invite-credential`, {
        sessionToken: tokenService.createSessionToken(otherTeamId, null)
      });
      const { inviteCredential } = await otherCredential.json();

      const res = await post('/api/team/login', { teamName: 'Alpha', inviteCredential });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('invalid_invite_credential');
    });

    it('rejects a garbage invite credential and a session token replayed as one', async () => {
      const garbage = await post('/api/team/login', { teamName: 'Alpha', inviteCredential: 'nonsense' });
      expect(garbage.status).toBe(401);

      // Token families are sealed: a team-session token must never join as
      // an invite credential (and validateSessionToken already rejects the
      // reverse by type).
      const replayed = await post('/api/team/login', { teamName: 'Alpha', inviteCredential: validToken() });
      expect(replayed.status).toBe(401);
    });

    it('rejects an invite credential signed with a different secret', async () => {
      const rogueService = createTokenService({
        secureCompare: (a: string, b: string) => a === b,
        superAdminPassword: null,
        tokenSecret: 'a-different-secret'
      });
      const res = await post('/api/team/login', {
        teamName: 'Alpha',
        inviteCredential: rogueService.createInviteCredential(teamId, 0)
      });
      expect(res.status).toBe(401);
    });

    it('revokes outstanding invite credentials when the team password rotates (epoch bump)', async () => {
      const { inviteCredential } = await (await mintCredential({ sessionToken: validToken() })).json();

      const rotate = await post(`/api/team/${teamId}/password`, {
        password: 'secret',
        newPassword: 'rotated-secret'
      });
      expect(rotate.status).toBe(200);

      // The pre-rotation credential is dead...
      const stale = await post('/api/team/login', { teamName: 'Alpha', inviteCredential });
      expect(stale.status).toBe(401);
      expect((await stale.json()).error).toBe('invalid_invite_credential');

      // ...and a freshly minted one works again.
      const fresh = await (await mintCredential({ password: 'rotated-secret' })).json();
      expect(fresh.inviteCredential).not.toBe(inviteCredential);
      const rejoin = await post('/api/team/login', { teamName: 'Alpha', inviteCredential: fresh.inviteCredential });
      expect(rejoin.status).toBe(200);
    });

    it('ignores inviteEpoch smuggled through the team update route', async () => {
      const { inviteCredential } = await (await mintCredential({ sessionToken: validToken() })).json();

      // Rotate to epoch 1, then try to reset the epoch back through /update.
      await post(`/api/team/${teamId}/password`, { password: 'secret', newPassword: 'rotated-secret' });
      const update = await post(`/api/team/${teamId}/update`, {
        sessionToken: validToken(),
        updates: { inviteEpoch: 0, facilitatorEmail: 'x@example.com' }
      });
      expect(update.status).toBe(200);

      // The revoked pre-rotation credential must stay revoked.
      const res = await post('/api/team/login', { teamName: 'Alpha', inviteCredential });
      expect(res.status).toBe(401);
      expect(dataStore._teams.get(teamId)?.inviteEpoch).toBe(1);
    });

    it('never exposes inviteEpoch to clients', async () => {
      await post(`/api/team/${teamId}/password`, { password: 'secret', newPassword: 'rotated-secret' });
      const res = await post(`/api/team/${teamId}`, { sessionToken: validToken() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.team.inviteEpoch).toBeUndefined();
    });

    it('missing_credentials only when neither password nor invite credential is supplied', async () => {
      const res = await post('/api/team/login', { teamName: 'Alpha' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('missing_credentials');
    });
  });
});
