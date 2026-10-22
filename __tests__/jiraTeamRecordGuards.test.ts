import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * The Jira fields of a team record, as the existing team routes must treat
 * them before any Jira route exists.
 *
 *  - `action.jira` is written by the Jira route alone. The retrospective and
 *    health-check persists carry a whole session blob from any participant's
 *    client, and `actions` is not a protected session field, so those two
 *    handlers keep the stored link and drop any link the store does not hold —
 *    on a new action and on a new session too. The whole-action route takes
 *    the link from the team record, never from the caller.
 *  - `jiraTarget` (a team setting, written by `/jira/target`) and `jiraClaims`
 *    (server-only bookkeeping of issues being created) are not `/update`'s to
 *    write, like `mergedFrom`.
 *  - `jiraClaims` never reaches a browser.
 */

type Json = Record<string, any>;
type Team = Json & { id: string; name: string };

const LINK = { key: 'RETRO-12', createdAt: '2026-10-20T09:00:00.000Z' };
const UNCERTAIN = { uncertainSince: '2026-10-20T09:30:00.000Z' };
const PLANTED = { key: 'EVIL-1', createdAt: '2026-10-20T09:00:00.000Z' };
const TARGET = { mode: 'project', projectKey: 'RETRO', issueTypeId: '10001', labels: ['retrospective'] };
const CLAIMS = { a1: { at: '2026-10-20T09:00:00.000Z', requestId: 'req-1' } };
// sessionParent mode (F2): each session's parent issue, and the claims on
// parents being created. Written by `/jira/issues` alone.
const PARENTS = { 'retro:r1': { key: 'RETRO-5', createdAt: '2026-10-20T08:00:00.000Z', subtaskTypeId: '10005' }, backlog: { uncertainSince: '2026-10-20T08:30:00.000Z' } };
const PARENT_CLAIMS = { 'healthcheck:h1': { at: '2026-10-20T09:00:00.000Z', requestId: 'req-parent-1' } };

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();

  return {
    loadTeam: async (teamId: string) => structuredClone(teams.get(teamId) ?? null),
    loadTeamRaw: async (teamId: string) => structuredClone(teams.get(teamId) ?? null),
    teamExists: async (teamId: string) => teams.has(teamId),
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, structuredClone(teamData));
    },
    loadAllTeams: async () => Array.from(teams.values()).map((team) => structuredClone(team)),
    loadTeamSummaries: async () => Array.from(teams.values()).map((team) => ({ id: team.id, name: team.name })),
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamUpdate: async (teamId: string, updater: (team: Team) => Team | null) => {
      const existing = teams.get(teamId);
      if (!existing) return { success: false, error: 'team_not_found' };
      const updated = updater(structuredClone(existing));
      if (!updated) return { success: true, team: structuredClone(existing) };
      teams.set(teamId, structuredClone(updated));
      return { success: true, team: structuredClone(updated) };
    },
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

const action = (id: string, extra: Json = {}): Json => ({
  id,
  text: `Action ${id}`,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...extra
});

describe('Jira fields on the team record, through the existing team routes', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;
  let teamId: string;
  let sessionToken: string;

  const post = async (path: string, body: Json) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };

  const stored = () => dataStore._teams.get(teamId) as Team;

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    dataStore = createMockDataStore();
    const tokenService = createTokenService({
      secureCompare: (a: string, b: string) => a === b,
      superAdminPassword: null,
      tokenSecret: 'jira-team-record-guards-secret'
    });
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
    const server = await listen(app);
    baseUrl = server.baseUrl;
    close = server.close;

    const created = await post('/api/team/create', { name: 'Alpha', password: 'secret-passphrase', facilitatorEmail: 'fac@example.com' });
    expect(created.status).toBe(201);
    teamId = created.body.team.id;
    sessionToken = created.body.sessionToken;

    // The state the Jira route leaves behind: a link on every copy of a1, the
    // team's target, and a claim on an issue being created.
    stored().globalActions = [action('a1', { jira: LINK })];
    stored().retrospectives = [{ id: 'r1', teamId, name: 'Sprint 1', _rev: 3, actions: [action('a1', { jira: LINK }), action('a2')] }];
    stored().healthChecks = [{ id: 'h1', teamId, name: 'Health', _rev: 2, actions: [action('a1', { jira: LINK }), action('a3')] }];
    stored().jiraTarget = structuredClone(TARGET);
    stored().jiraClaims = structuredClone(CLAIMS);
    stored().jiraParents = structuredClone(PARENTS);
    stored().jiraParentClaims = structuredClone(PARENT_CLAIMS);
  });

  afterEach(async () => {
    await close();
    vi.restoreAllMocks();
  });

  describe('the retrospective persist', () => {
    it('keeps the stored link when the blob omits it, and drops a link the store does not have', async () => {
      const res = await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: {
          id: 'r1',
          _rev: 4,
          actions: [action('a1'), action('a2', { jira: PLANTED }), action('a-new', { jira: PLANTED })]
        }
      });

      expect(res.status).toBe(200);
      const actions = stored().retrospectives[0].actions;
      expect(actions[0].jira).toEqual(LINK);
      expect(actions[1]).not.toHaveProperty('jira');
      expect(actions[2]).not.toHaveProperty('jira');
    });

    it('lets the stored link win over another one the blob carries', async () => {
      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: { id: 'r1', _rev: 4, actions: [action('a1', { jira: PLANTED })] }
      });

      expect(stored().retrospectives[0].actions[0].jira).toEqual(LINK);
    });

    // A part of the stored link is not the stored link: kept, `{}` would make
    // the action read as unlinked and the next click would create it again.
    it('lets the stored link win over an empty or partial link the blob carries', async () => {
      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: { id: 'r1', _rev: 4, actions: [action('a1', { jira: {} })] }
      });
      expect(stored().retrospectives[0].actions[0].jira).toEqual(LINK);

      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: { id: 'r1', _rev: 5, actions: [action('a1', { jira: { key: LINK.key } })] }
      });
      expect(stored().retrospectives[0].actions[0].jira).toEqual(LINK);
    });

    // The closed-action guards skip proposals, so a blob that turned a linked
    // action back into one used to carry its own link past both guards — and
    // a second persist turning it back into an action left the planted key
    // stored. Without a link, the same flip erased the stored one.
    it('keeps the stored link through a blob that flips the action to a proposal and back', async () => {
      const persist = async (rev: number, a1: Json) => {
        const res = await post(`/api/team/${teamId}/retrospective/r1`, {
          sessionToken,
          retrospective: { id: 'r1', _rev: rev, actions: [a1, action('a2')] }
        });
        expect(res.status).toBe(200);
        return stored().retrospectives[0].actions[0];
      };

      expect(await persist(4, action('a1', { type: 'proposal', jira: PLANTED }))).toMatchObject({ type: 'proposal', jira: LINK });
      expect(await persist(5, action('a1', { jira: PLANTED }))).toMatchObject({ type: 'new', jira: LINK });
      expect(await persist(6, action('a1', { type: 'proposal' }))).toMatchObject({ type: 'proposal', jira: LINK });
      expect(await persist(7, action('a1'))).toMatchObject({ type: 'new', jira: LINK });
    });

    // A retro the store does not hold yet has no stored actions to compare
    // with: every link on it was planted.
    it('drops every link of a retrospective the store does not hold yet', async () => {
      await post(`/api/team/${teamId}/retrospective/r-new`, {
        sessionToken,
        retrospective: { id: 'r-new', actions: [action('a9', { jira: PLANTED }), action('a1', { jira: LINK })] }
      });

      const created = stored().retrospectives.find((r: Json) => r.id === 'r-new');
      expect(created.actions.map((a: Json) => a.jira)).toEqual([undefined, undefined]);
    });
  });

  // The marker says an issue may already exist (a creation whose answer was
  // lost). A persist that dropped it would make the action read as unlinked,
  // and the next click would create the issue again without the "May already
  // be in Jira" check.
  it('keeps a stored uncertain marker through both persists when the blob omits it', async () => {
    stored().retrospectives[0].actions[1].jira = structuredClone(UNCERTAIN);
    stored().healthChecks[0].actions[1].jira = structuredClone(UNCERTAIN);

    await post(`/api/team/${teamId}/retrospective/r1`, {
      sessionToken,
      retrospective: { id: 'r1', _rev: 4, actions: [action('a1'), action('a2')] }
    });
    await post(`/api/team/${teamId}/healthcheck/h1`, {
      sessionToken,
      healthCheck: { id: 'h1', _rev: 3, actions: [action('a1'), action('a3')] }
    });

    expect(stored().retrospectives[0].actions[1].jira).toEqual(UNCERTAIN);
    expect(stored().healthChecks[0].actions[1].jira).toEqual(UNCERTAIN);
  });

  describe('the health-check persist', () => {
    it('keeps the stored link and drops a planted one, on a stored and on a new health check', async () => {
      await post(`/api/team/${teamId}/healthcheck/h1`, {
        sessionToken,
        healthCheck: { id: 'h1', _rev: 3, actions: [action('a1'), action('a3', { jira: PLANTED })] }
      });
      await post(`/api/team/${teamId}/healthcheck/h-new`, {
        sessionToken,
        healthCheck: { id: 'h-new', actions: [action('a8', { jira: PLANTED })] }
      });

      const [created, h1] = stored().healthChecks;
      expect(h1.actions[0].jira).toEqual(LINK);
      expect(h1.actions[1]).not.toHaveProperty('jira');
      expect(created.id).toBe('h-new');
      expect(created.actions[0]).not.toHaveProperty('jira');
    });

    it('keeps the stored link through a blob that turns the action into a proposal, with a planted link or none', async () => {
      await post(`/api/team/${teamId}/healthcheck/h1`, {
        sessionToken,
        healthCheck: { id: 'h1', _rev: 3, actions: [action('a1', { type: 'proposal', jira: PLANTED }), action('a3')] }
      });
      expect(stored().healthChecks[0].actions[0].jira).toEqual(LINK);

      await post(`/api/team/${teamId}/healthcheck/h1`, {
        sessionToken,
        healthCheck: { id: 'h1', _rev: 4, actions: [action('a1', { type: 'proposal' }), action('a3')] }
      });
      expect(stored().healthChecks[0].actions[0].jira).toEqual(LINK);
    });
  });

  // A session's parent lives on the team record, never on the session entry
  // or row: a persist carries a whole session blob from any participant, and
  // must not be a way to re-point, drop or plant a parent.
  describe('the session parents', () => {
    it('cannot be changed by a retrospective or health-check persist, whatever the blob says', async () => {
      await post(`/api/team/${teamId}/retrospective/r1`, {
        sessionToken,
        retrospective: { id: 'r1', _rev: 4, actions: [action('a1'), action('a2')], jiraParents: {}, jiraParent: { key: 'EVIL-1' } }
      });
      await post(`/api/team/${teamId}/healthcheck/h1`, {
        sessionToken,
        healthCheck: { id: 'h1', _rev: 3, actions: [action('a1'), action('a3')], jiraParentClaims: {} }
      });
      await post(`/api/team/${teamId}/retrospective/r-new`, {
        sessionToken,
        retrospective: { id: 'r-new', _rev: 1, actions: [], jiraParents: { 'retro:r-new': { key: 'EVIL-2', createdAt: 'now' } } }
      });
      expect(stored().jiraParents).toEqual(PARENTS);
      expect(stored().jiraParentClaims).toEqual(PARENT_CLAIMS);
    });
  });

  describe('/update', () => {
    // `jiraTarget` belongs to `/jira/target`, which validates it; `jiraClaims`
    // is the server's record of issues being created, and a client that could
    // clear it could create the same issue twice.
    it('ignores jiraTarget and jiraClaims, keeps the stored ones, and says so', async () => {
      const warn = vi.mocked(console.warn);
      warn.mockClear();

      const res = await post(`/api/team/${teamId}/update`, {
        sessionToken,
        updates: { jiraTarget: { mode: 'project', projectKey: 'EVIL', issueTypeId: '1', labels: [] }, jiraClaims: {}, actionImpactRatingEnabled: false }
      });

      expect(res.status).toBe(200);
      expect(stored().jiraTarget).toEqual(TARGET);
      expect(stored().jiraClaims).toEqual(CLAIMS);
      expect(stored().actionImpactRatingEnabled).toBe(false);
      const line = warn.mock.calls.map((call) => String(call[0])).find((text) => text.includes('/api/team/:teamId/update'));
      expect(line).toContain('jiraTarget');
      expect(line).toContain('jiraClaims');
    });

    // A stale tab must not put a session's parent back, and a client that
    // could clear the claims on parents could have one created twice.
    it('ignores jiraParents and jiraParentClaims, keeps the stored ones, and says so', async () => {
      const warn = vi.mocked(console.warn);
      warn.mockClear();

      const res = await post(`/api/team/${teamId}/update`, {
        sessionToken,
        updates: { jiraParents: { 'retro:r1': { key: 'EVIL-1', createdAt: 'now' } }, jiraParentClaims: null, actionImpactRatingEnabled: false }
      });

      expect(res.status).toBe(200);
      expect(stored().jiraParents).toEqual(PARENTS);
      expect(stored().jiraParentClaims).toEqual(PARENT_CLAIMS);
      expect(stored().actionImpactRatingEnabled).toBe(false);
      const line = warn.mock.calls.map((call) => String(call[0])).find((text) => text.includes('/api/team/:teamId/update'));
      expect(line).toContain('jiraParents');
      expect(line).toContain('jiraParentClaims');
    });

    // `null` is how `/update` clears a field (`facilitatorEmail`), so it is
    // the removal a client would send.
    it('cannot remove them either: null leaves both stored values, and the line says so', async () => {
      const warn = vi.mocked(console.warn);
      warn.mockClear();

      const res = await post(`/api/team/${teamId}/update`, { sessionToken, updates: { jiraTarget: null, jiraClaims: null } });

      expect(res.status).toBe(200);
      expect(stored().jiraTarget).toEqual(TARGET);
      expect(stored().jiraClaims).toEqual(CLAIMS);
      const line = warn.mock.calls.map((call) => String(call[0])).find((text) => text.includes('/api/team/:teamId/update'));
      expect(line).toContain('jiraTarget');
      expect(line).toContain('jiraClaims');
    });
  });

  // `/action` folds the caller's action through `mergeActionImpactState`,
  // which keeps the caller's link when the stored copy has none. Without a
  // guard any team session could write a link onto the team record, where the
  // Jira route decides "already linked": the action's Create button would be
  // gone for good, and both restores would carry the planted link.
  describe('the whole-action route', () => {
    it('drops a planted link on a stored unlinked action, in every home, and on a new action', async () => {
      await post(`/api/team/${teamId}/action`, { sessionToken, action: action('a2', { jira: PLANTED }), retroId: 'r1' });
      await post(`/api/team/${teamId}/action`, { sessionToken, action: action('a3', { jira: PLANTED }), healthCheckId: 'h1' });
      const res = await post(`/api/team/${teamId}/action`, { sessionToken, action: action('a-new', { jira: PLANTED }) });

      expect(res.status).toBe(200);
      expect(stored().retrospectives[0].actions[1]).not.toHaveProperty('jira');
      expect(stored().healthChecks[0].actions[1]).not.toHaveProperty('jira');
      const created = stored().globalActions.find((a: Json) => a.id === 'a-new');
      expect(created.text).toBe('Action a-new');
      expect(created).not.toHaveProperty('jira');
    });

    it('lets the stored link win over the caller\'s, and keeps it when the caller omits it', async () => {
      await post(`/api/team/${teamId}/action`, { sessionToken, action: action('a1', { jira: PLANTED, text: 'Edited' }) });
      expect(stored().globalActions[0]).toMatchObject({ text: 'Edited', jira: LINK });

      await post(`/api/team/${teamId}/action`, { sessionToken, action: action('a1', { text: 'Edited again' }) });
      expect(stored().globalActions[0]).toMatchObject({ text: 'Edited again', jira: LINK });
    });

    // Without a retroId the route adds a backlog copy of an action only a
    // retrospective held; the link that retrospective holds is the action's.
    it('gives a new backlog copy the link another home of the same action holds', async () => {
      stored().retrospectives[0].actions.push(action('a4', { jira: structuredClone(LINK) }));

      await post(`/api/team/${teamId}/action`, { sessionToken, action: action('a4', { jira: PLANTED }) });

      expect(stored().globalActions.find((a: Json) => a.id === 'a4').jira).toEqual(LINK);
    });
  });

  describe('what a client receives', () => {
    it('never carries jiraClaims, on any route that returns the team; the target is a setting and stays', async () => {
      const responses = [
        await post('/api/team/login', { teamName: 'Alpha', password: 'secret-passphrase' }),
        await post('/api/team/restore-session', { sessionToken }),
        await post(`/api/team/${teamId}`, { sessionToken }),
        await post(`/api/team/${teamId}/update`, { sessionToken, updates: { actionImpactRatingEnabled: true } }),
        await post(`/api/team/${teamId}/members`, { sessionToken, members: [] })
      ];

      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.team).toBeTruthy();
        expect(res.body.team).not.toHaveProperty('jiraClaims');
        expect(res.body.team.jiraTarget).toEqual(TARGET);
        expect(JSON.stringify(res.body)).not.toContain('req-1');
        // The parents are keys the screens show; the claims on them are not.
        expect(res.body.team.jiraParents).toEqual(PARENTS);
        expect(res.body.team).not.toHaveProperty('jiraParentClaims');
        expect(JSON.stringify(res.body)).not.toContain('req-parent-1');
      }
    });
  });
});
