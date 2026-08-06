import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * `teamRoutes.js` is the lowest-covered route in the gate (75.9% statements,
 * 66.8% branches), and H24–H27 and H33 all came out of that gap. What is
 * uncovered there is not the feature paths but the **failure** paths: the
 * `if (!result.success)` arms that never run because a mock store never fails,
 * and the rev guards that never fire because no test sends a stale blob.
 *
 * This suite drives both, on the four granular persist routes the Dashboard and
 * the session components write through. It asserts *state*, not status text
 * alone: a route that answers 500 while having written half the record would
 * pass a status-only assertion.
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };

/**
 * Store double whose `atomicTeamUpdate` can be made to fail on demand, the way
 * the real one does after five lost compare-and-swap races
 * (`max_retries_exceeded`). `failNextUpdates` is a countdown rather than a flag
 * so a test can let the setup writes through and fail only the write under
 * test.
 */
const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  const control = { failNextUpdates: 0, updateError: 'max_retries_exceeded' };

  const atomicTeamUpdate = async (
    teamId: string,
    updater: (team: Team) => Team | null
  ): Promise<{ success: boolean; team?: Team; error?: string }> => {
    if (control.failNextUpdates > 0) {
      control.failNextUpdates -= 1;
      return { success: false, error: control.updateError };
    }
    const existing = teams.get(teamId);
    if (!existing) return { success: false, error: 'team_not_found' };
    const updated = updater(structuredClone(existing));
    if (!updated) return { success: true, team: existing };
    teams.set(teamId, structuredClone(updated));
    return { success: true, team: updated };
  };

  return {
    control,
    loadTeam: async (teamId: string) => teams.get(teamId) || null,
    loadTeamRaw: async (teamId: string) => teams.get(teamId) || null,
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, { ...teamData });
    },
    loadAllTeams: async () => Array.from(teams.values()),
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamSave: async (teamId: string, teamData: Team) => {
      teams.set(teamId, { ...teamData });
      return { success: true };
    },
    atomicTeamUpdate,
    loadTeamIndex: async () => new Map(indexMap),
    saveTeamIndex: async (map: Map<string, string>) => {
      indexMap.clear();
      for (const [k, v] of map) indexMap.set(k, v);
    },
    atomicTeamIndexUpdate: async (
      updater: (index: Map<string, string>) => Map<string, string> | null
    ) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [k, v] of next) indexMap.set(k, v);
      return new Map(indexMap);
    },
    loadMetaData: async () => ({ resetTokens: [], orphanedFeedbacks: [] }),
    atomicMetaUpdate: async (updater: (meta: Record<string, unknown[]>) => unknown) => {
      const meta = { resetTokens: [], orphanedFeedbacks: [] };
      updater(meta);
      return meta;
    },
    loadGlobalSettings: async () => ({}),
    _teams: teams
  };
};

const createMockTokenService = () => ({
  createSessionToken: (teamId: string) => `session-${teamId}`,
  validateSessionToken: (token: string) => {
    if (!token?.startsWith('session-')) return null;
    return { teamId: token.slice('session-'.length), visitorId: null };
  },
  invalidateSessionToken: () => {},
  createInviteCredential: (teamId: string, epoch: number) => `invite-${teamId}-${epoch}`,
  validateInviteCredential: () => null,
  validateSuperAdminAuth: () => false
});

const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const dataStore = createMockDataStore();
  const tokenService = createMockTokenService();
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

  return { app, dataStore };
};

const listen = async (app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> =>
  new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });

describe('teamRoutes granular persist: failure paths and rev guards', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;
    return async () => {
      await close();
    };
  });

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const retroBlob = (teamId: string, rev: number, name = 'Sprint 1') => ({
    id: 'r1',
    teamId,
    name,
    date: '2026-01-01',
    status: 'ACTIVE',
    phase: 'BRAINSTORM',
    columns: [],
    tickets: [],
    groups: [],
    actions: [],
    happiness: {},
    roti: {},
    finishedUsers: [],
    _rev: rev
  });

  const healthCheckBlob = (teamId: string, rev: number, name = 'Q1 check') => ({
    id: 'h1',
    teamId,
    name,
    date: '2026-01-01',
    status: 'ACTIVE',
    ratings: {},
    actions: [],
    _rev: rev
  });

  const setup = async () => {
    const res = await post('/api/team/create', {
      name: 'Persist Team',
      password: 'password123456',
      facilitatorEmail: 'fac@example.com'
    });
    const created = await res.json();
    expect(res.status, JSON.stringify(created)).toBe(201);
    return { teamId: created.team.id as string, sessionToken: created.sessionToken as string };
  };

  const stored = (teamId: string) => dataStore._teams.get(teamId) as Record<string, never[]>;

  describe('a lost store write is never reported as success', () => {
    it('answers 500 on /retrospective and leaves the stored retro untouched', async () => {
      const { teamId, sessionToken } = await setup();
      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: retroBlob(teamId, 1)
      });

      dataStore.control.failNextUpdates = 1;
      const res = await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: retroBlob(teamId, 2, 'Renamed by the lost write')
      });

      expect(res.status).toBe(500);
      expect((await res.json()).success).not.toBe(true);
      expect((stored(teamId).retrospectives[0] as unknown as { name: string }).name).toBe('Sprint 1');
    });

    it('answers 500 on /healthcheck and leaves the stored health check untouched', async () => {
      const { teamId, sessionToken } = await setup();
      await post(`/api/team/${teamId}/healthcheck/h1`, {
        sessionToken,
        healthCheck: healthCheckBlob(teamId, 1)
      });

      dataStore.control.failNextUpdates = 1;
      const res = await post(`/api/team/${teamId}/healthcheck/h1`, {
        sessionToken,
        healthCheck: healthCheckBlob(teamId, 2, 'Renamed by the lost write')
      });

      expect(res.status).toBe(500);
      expect((stored(teamId).healthChecks[0] as unknown as { name: string }).name).toBe('Q1 check');
    });

    it('answers 500 on /action rather than losing the toggle silently', async () => {
      const { teamId, sessionToken } = await setup();

      dataStore.control.failNextUpdates = 1;
      const res = await post(`/api/team/${teamId}/action`, {
        sessionToken,
        action: { id: 'a1', text: 'Ship it', done: true, type: 'new' }
      });

      expect(res.status).toBe(500);
      expect(stored(teamId).globalActions ?? []).toHaveLength(0);
    });

    it('answers 500 on /members rather than returning a team it did not save', async () => {
      const { teamId, sessionToken } = await setup();

      dataStore.control.failNextUpdates = 1;
      const res = await post(`/api/team/${teamId}/members`, {
        sessionToken,
        members: [{ id: 'm1', name: 'Ada' }]
      });

      expect(res.status).toBe(500);
      // The success shape of this route is `{ team }`, so a caller that only
      // checks `response.ok` would render a roster that was never persisted.
      expect((await res.json()).team).toBeUndefined();
      // Creation seeds the facilitator, so the roster is not empty to begin
      // with — what must be absent is the member this failed write carried.
      const names = (stored(teamId).members as unknown as { name: string }[]).map((m) => m.name);
      expect(names).not.toContain('Ada');
    });
  });

  describe('the rev guard drops a stale blob instead of letting it clobber newer state', () => {
    it('keeps the newer stored retrospective when an older revision is persisted', async () => {
      const { teamId, sessionToken } = await setup();
      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: retroBlob(teamId, 5, 'Current name')
      });

      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: retroBlob(teamId, 3, 'Stale name')
      });

      expect((stored(teamId).retrospectives[0] as unknown as { name: string }).name).toBe('Current name');
    });

    it('keeps the newer stored health check when an older revision is persisted', async () => {
      const { teamId, sessionToken } = await setup();
      await post(`/api/team/${teamId}/healthcheck/h1`, {
        sessionToken,
        healthCheck: healthCheckBlob(teamId, 5, 'Current name')
      });

      await post(`/api/team/${teamId}/healthcheck/h1`, {
        sessionToken,
        healthCheck: healthCheckBlob(teamId, 3, 'Stale name')
      });

      expect((stored(teamId).healthChecks[0] as unknown as { name: string }).name).toBe('Current name');
    });

    it('does not guard blobs that carry no revision, so non-session edits still apply', async () => {
      // The guard is deliberately scoped to two finite `_rev` values. A
      // retrospective that never went through a live session has none, and its
      // edits must not be dropped.
      const { teamId, sessionToken } = await setup();
      const withoutRev = { ...retroBlob(teamId, 0, 'First'), _rev: undefined };
      await post(`/api/team/${teamId}/retrospective/r1`, { sessionToken, retrospective: withoutRev });

      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: { ...withoutRev, name: 'Edited on the dashboard' }
      });

      expect((stored(teamId).retrospectives[0] as unknown as { name: string }).name).toBe(
        'Edited on the dashboard'
      );
    });

    it('applies an equal revision, so a client that is merely level is not blocked', async () => {
      const { teamId, sessionToken } = await setup();
      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: retroBlob(teamId, 4, 'First')
      });

      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: retroBlob(teamId, 4, 'Same revision, later write')
      });

      expect((stored(teamId).retrospectives[0] as unknown as { name: string }).name).toBe(
        'Same revision, later write'
      );
    });
  });

  describe('/action resolves the target across all three collections', () => {
    it('updates an action nested in a retrospective', async () => {
      const { teamId, sessionToken } = await setup();
      const retro = retroBlob(teamId, 1) as unknown as { actions: unknown[] };
      retro.actions = [{ id: 'a1', text: 'Ship it', done: false, type: 'new' }];
      await post(`/api/team/${teamId}/retrospective/r1`, { sessionToken, retrospective: retro });

      const res = await post(`/api/team/${teamId}/action`, {
        sessionToken,
        retroId: 'r1',
        action: { id: 'a1', text: 'Ship it', done: true, type: 'new' }
      });

      expect(res.status).toBe(200);
      const retros = stored(teamId).retrospectives as unknown as { actions: { done: boolean }[] }[];
      expect(retros[0].actions[0].done).toBe(true);
      // Resolving it in the retro must not also create a global duplicate.
      expect(stored(teamId).globalActions ?? []).toHaveLength(0);
    });

    it('updates an action nested in a health check', async () => {
      const { teamId, sessionToken } = await setup();
      const hc = healthCheckBlob(teamId, 1) as unknown as { actions: unknown[] };
      hc.actions = [{ id: 'a2', text: 'Fix the build', done: false, type: 'new' }];
      await post(`/api/team/${teamId}/healthcheck/h1`, { sessionToken, healthCheck: hc });

      const res = await post(`/api/team/${teamId}/action`, {
        sessionToken,
        healthCheckId: 'h1',
        action: { id: 'a2', text: 'Fix the build', done: true, type: 'new' }
      });

      expect(res.status).toBe(200);
      const checks = stored(teamId).healthChecks as unknown as { actions: { done: boolean }[] }[];
      expect(checks[0].actions[0].done).toBe(true);
      expect(stored(teamId).globalActions ?? []).toHaveLength(0);
    });

    it('creates a global action when the id matches nothing, and updates it in place afterwards', async () => {
      const { teamId, sessionToken } = await setup();

      await post(`/api/team/${teamId}/action`, {
        sessionToken,
        action: { id: 'g1', text: 'Book the room', done: false, type: 'new' }
      });
      expect(stored(teamId).globalActions).toHaveLength(1);

      // The second call must resolve the existing global action rather than
      // unshifting a second copy of it.
      await post(`/api/team/${teamId}/action`, {
        sessionToken,
        action: { id: 'g1', text: 'Book the room', done: true, type: 'new' }
      });

      const actions = stored(teamId).globalActions as unknown as { done: boolean }[];
      expect(actions).toHaveLength(1);
      expect(actions[0].done).toBe(true);
    });

    it('rejects a payload with no action id before touching the store', async () => {
      const { teamId, sessionToken } = await setup();

      const res = await post(`/api/team/${teamId}/action`, { sessionToken, action: { text: 'no id' } });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('missing_action');
      expect(stored(teamId).globalActions ?? []).toHaveLength(0);
    });
  });
});
