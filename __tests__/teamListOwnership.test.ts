import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * Incident ISS (2026-10-12), the HTTP half: how a live retro disappeared from
 * the team record, and how a placeholder took its place.
 *
 * 1. A facilitator's second tab, left on a stale Dashboard, deleted an old
 *    retro. `dataService` sent its whole cached `retrospectives` list (and
 *    `globalActions`, `healthChecks`) to `/api/team/:teamId/update`, which
 *    replaced the stored lists wholesale with no revision check — erasing the
 *    live retro the tab had never seen.
 * 2. A participant then joined by invite; finding no such retro, the client
 *    created a placeholder named "Retrospective" and persisted it. It carried
 *    no `_rev`, so the rev guard on the full-blob persist was skipped and the
 *    placeholder overwrote the real retro.
 *
 * The lists are now owned by granular routes (delete one retro, one health
 * check, one action), `/update` no longer accepts them, and the full-blob
 * persists keep the stored name and refuse a rev-less blob over a revised entry.
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };
type Entry = Record<string, unknown> & { id: string; name?: string; _rev?: number; actions?: { id: string }[] };

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  const control = { failNextUpdates: 0 };

  const atomicTeamUpdate = async (teamId: string, updater: (team: Team) => Team | null) => {
    if (control.failNextUpdates > 0) {
      control.failNextUpdates -= 1;
      return { success: false, error: 'max_retries_exceeded' };
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
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, { ...teamData });
    },
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamUpdate,
    loadTeamIndex: async () => new Map(indexMap),
    atomicTeamIndexUpdate: async (updater: (index: Map<string, string>) => Map<string, string> | null) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [k, v] of next) indexMap.set(k, v);
      return new Map(indexMap);
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

const listen = async (app: express.Express) =>
  new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });

const action = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `Action ${id}`, done: false, type: 'new', ...extra });

describe('team lists are owned by granular routes (incident ISS)', () => {
  let baseUrl: string;
  let dataStore: ReturnType<typeof createMockDataStore>;
  let teamId: string;
  let sessionToken: string;

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const stored = () => dataStore._teams.get(teamId) as unknown as {
    retrospectives: Entry[];
    healthChecks: Entry[];
    globalActions: { id: string; text?: string }[];
    facilitatorEmail?: string;
  };

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    dataStore = createMockDataStore();
    const tokenService = createMockTokenService();
    registerTeamRoutes({
      app,
      dataStore,
      teamService: createTeamService({ dataStore, tokenService }),
      tokenService,
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: () => {} },
      escapeHtml: (s: string) => s
    });
    const server = await listen(app);
    baseUrl = server.baseUrl;

    const res = await post('/api/team/create', { name: 'Owners', password: 'password123456' });
    const created = await res.json();
    teamId = created.team.id;
    sessionToken = created.sessionToken;

    // A team as a live one looks: two retros (the live one advanced by its
    // session), a health check, and a backlog.
    const team = dataStore._teams.get(teamId) as Team;
    team.retrospectives = [
      { id: 'live', name: 'Live retro', status: 'IN_PROGRESS', _rev: 12, actions: [action('a-live')] },
      { id: 'old', name: 'Old retro', status: 'CLOSED', _rev: 30, actions: [action('a1'), action('a2'), action('g1')] }
    ];
    team.healthChecks = [
      { id: 'hc1', name: 'Q3 check', status: 'CLOSED', _rev: 4, actions: [action('h1'), action('h2')] }
    ];
    team.globalActions = [action('g1', { text: 'Already in the backlog' }), action('g2')];

    return async () => {
      await server.close();
    };
  });

  describe('POST /api/team/:teamId/retrospective/:retroId/delete', () => {
    it('removes only that retrospective and promotes its actions to the backlog', async () => {
      const res = await post(`/api/team/${teamId}/retrospective/old/delete`, { sessionToken });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(stored().retrospectives.map((r) => r.id)).toEqual(['live']);
      // Same rule as the client's local delete: each action unshifted in
      // turn, skipping one already in the backlog — which keeps its own copy.
      expect(stored().globalActions.map((a) => a.id)).toEqual(['a2', 'a1', 'g1', 'g2']);
      expect(stored().globalActions.find((a) => a.id === 'g1')?.text).toBe('Already in the backlog');
    });

    it('answers 404 for a retrospective that is not there, and writes nothing', async () => {
      const before = structuredClone(stored());
      const res = await post(`/api/team/${teamId}/retrospective/nope/delete`, { sessionToken });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'retrospective_not_found' });
      expect(stored()).toEqual(before);
    });

    it('answers 500 when the store loses the write', async () => {
      dataStore.control.failNextUpdates = 1;
      const res = await post(`/api/team/${teamId}/retrospective/old/delete`, { sessionToken });
      expect(res.status).toBe(500);
      expect(stored().retrospectives).toHaveLength(2);
    });
  });

  describe('POST /api/team/:teamId/healthcheck/:hcId/delete', () => {
    it('removes only that health check and promotes its actions to the backlog', async () => {
      const res = await post(`/api/team/${teamId}/healthcheck/hc1/delete`, { sessionToken });

      expect(res.status).toBe(200);
      expect(stored().healthChecks).toEqual([]);
      expect(stored().globalActions.map((a) => a.id)).toEqual(['h2', 'h1', 'g1', 'g2']);
      expect(stored().retrospectives).toHaveLength(2);
    });

    it('answers 404 for a health check that is not there', async () => {
      const res = await post(`/api/team/${teamId}/healthcheck/nope/delete`, { sessionToken });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'healthcheck_not_found' });
    });
  });

  describe('POST /api/team/:teamId/action/delete', () => {
    it('removes the action wherever it lives', async () => {
      // An id can sit in the backlog and in its retro at once (promotion
      // copies it), so every home is cleared.
      const res = await post(`/api/team/${teamId}/action/delete`, { sessionToken, actionId: 'g1' });

      expect(res.status).toBe(200);
      expect(stored().globalActions.map((a) => a.id)).toEqual(['g2']);
      expect(stored().retrospectives[1].actions?.map((a) => a.id)).toEqual(['a1', 'a2']);
    });

    it('removes an action held by a health check', async () => {
      const res = await post(`/api/team/${teamId}/action/delete`, { sessionToken, actionId: 'h2' });

      expect(res.status).toBe(200);
      expect(stored().healthChecks[0].actions?.map((a) => a.id)).toEqual(['h1']);
    });

    it('answers 404 when no list holds the action, and 400 without an id', async () => {
      const missing = await post(`/api/team/${teamId}/action/delete`, { sessionToken, actionId: 'nope' });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'action_not_found' });

      const noId = await post(`/api/team/${teamId}/action/delete`, { sessionToken });
      expect(noId.status).toBe(400);
      expect(await noId.json()).toEqual({ error: 'missing_action' });
    });
  });

  describe('the delete routes refuse anyone who is not this team', () => {
    // Each route removes data for good, so each is pinned on its own: one
    // missing check is enough to let any holder of *a* team token — every
    // participant of every team, on a shared password — empty another team's
    // history. A token is valid only for the team it was minted for.
    const routes = [
      { name: 'retrospective/:id/delete', path: () => `/api/team/${teamId}/retrospective/old/delete`, body: {} },
      { name: 'healthcheck/:id/delete', path: () => `/api/team/${teamId}/healthcheck/hc1/delete`, body: {} },
      { name: 'action/delete', path: () => `/api/team/${teamId}/action/delete`, body: { actionId: 'g1' } }
    ];

    let otherTeamToken: string;
    beforeEach(async () => {
      const res = await post('/api/team/create', { name: 'Strangers', password: 'password654321' });
      const created = await res.json();
      otherTeamToken = created.sessionToken;
      expect(created.team.id).not.toBe(teamId);
    });

    for (const route of routes) {
      it(`${route.name} answers 401 without a credential and deletes nothing`, async () => {
        const before = structuredClone(stored());
        const res = await post(route.path(), route.body);

        expect(res.status).toBe(401);
        expect(stored()).toEqual(before);
      });

      it(`${route.name} answers 401 to a valid session token of another team and deletes nothing`, async () => {
        const before = structuredClone(stored());
        const res = await post(route.path(), { ...route.body, sessionToken: otherTeamToken });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'invalid_token' });
        expect(stored()).toEqual(before);
      });
    }
  });

  describe('POST /api/team/:teamId/update', () => {
    it('no longer replaces the retrospective, health-check or action lists', async () => {
      // The second path of the incident: a stale tab's whole-list write erased
      // a retro it had never seen.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const before = structuredClone(stored());

      const res = await post(`/api/team/${teamId}/update`, {
        sessionToken,
        updates: {
          facilitatorEmail: 'still-applied@example.com',
          retrospectives: [{ id: 'old', name: 'Old retro' }],
          healthChecks: [],
          globalActions: []
        }
      });

      expect(res.status).toBe(200);
      expect(stored().retrospectives).toEqual(before.retrospectives);
      expect(stored().healthChecks).toEqual(before.healthChecks);
      expect(stored().globalActions).toEqual(before.globalActions);
      // Everything else in the request still applies.
      expect(stored().facilitatorEmail).toBe('still-applied@example.com');
      const lines = warn.mock.calls.map((args) => args.map(String).join(' ')).filter((l) => l.includes('/update'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('retrospectives, healthChecks, globalActions');
      warn.mockRestore();
    });

    it('stays quiet for an update that carries none of the lists', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await post(`/api/team/${teamId}/update`, { sessionToken, updates: { facilitatorEmail: 'x@example.com' } });
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('full-blob persists', () => {
    it('keep the stored name of an existing retrospective', async () => {
      // A client's cached copy can hold the name from before a Dashboard
      // rename; only creation and the /name route set a name.
      const res = await post(`/api/team/${teamId}/retrospective/live`, {
        sessionToken,
        retrospective: { id: 'live', name: 'Name from before the rename', status: 'IN_PROGRESS', phase: 'GROUP', _rev: 13, actions: [] }
      });

      expect(res.status).toBe(200);
      expect(stored().retrospectives[0]).toMatchObject({ name: 'Live retro', phase: 'GROUP', _rev: 13 });
    });

    it('keep the stored name of an existing health check', async () => {
      await post(`/api/team/${teamId}/healthcheck/hc1`, {
        sessionToken,
        healthCheck: { id: 'hc1', name: 'Old title', status: 'CLOSED', phase: 'CLOSE', _rev: 5, actions: [] }
      });

      expect(stored().healthChecks[0]).toMatchObject({ name: 'Q3 check', phase: 'CLOSE', _rev: 5 });
    });

    it('take the name of a new entry from the blob', async () => {
      await post(`/api/team/${teamId}/retrospective/fresh`, {
        sessionToken,
        retrospective: { id: 'fresh', name: 'Sprint 13', status: 'IN_PROGRESS', actions: [] }
      });

      expect(stored().retrospectives[0]).toMatchObject({ id: 'fresh', name: 'Sprint 13' });
    });

    it('never let a blob with no revision overwrite a retrospective that has one', async () => {
      // The placeholder of the incident: built locally, named "Retrospective",
      // no _rev — and the rev guard used to need two revisions to act.
      await post(`/api/team/${teamId}/retrospective/live`, {
        sessionToken,
        retrospective: { id: 'live', name: 'Retrospective', status: 'IN_PROGRESS', phase: 'ICEBREAKER', actions: [] }
      });

      expect(stored().retrospectives[0]).toMatchObject({ name: 'Live retro', _rev: 12, actions: [action('a-live')] });
      expect(stored().retrospectives[0].phase).toBeUndefined();
    });

    it('never let a blob with no revision overwrite a health check that has one', async () => {
      await post(`/api/team/${teamId}/healthcheck/hc1`, {
        sessionToken,
        healthCheck: { id: 'hc1', name: 'Health Check', status: 'IN_PROGRESS', phase: 'SURVEY', actions: [] }
      });

      expect(stored().healthChecks[0]).toMatchObject({ name: 'Q3 check', status: 'CLOSED', _rev: 4 });
    });
  });
});
