import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * H35, reported from the field: retrospectives renamed from the Dashboard went
 * back to their original title, with no error shown.
 *
 * The cause is the rev guard on `/api/team/:teamId/retrospective/:retroId`
 * doing its job on the wrong payload. A Dashboard rename went through
 * `dataService.updateSessionName`, which persists the **whole retro blob**
 * carrying whatever `_rev` the Dashboard's cached copy had. Once a session has
 * advanced the stored revision — the normal end state of any retro that was
 * actually run — that blob is stale by definition, so the guard dropped the
 * entire write. The route then answered `{ success: true }` (an aborted updater
 * reads as "nothing to change"), and `persistRetrospective` is fire-and-forget,
 * so nothing anywhere reported a problem. The name reverted on next load.
 *
 * The fix is the pattern this codebase already uses for closing an action: a
 * **granular endpoint** that owns one field and carries no `_rev`, so it cannot
 * be rev-guarded away. The full-blob persist and its guard are deliberately
 * untouched — the guard is correct, it was the payload that was wrong.
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  const control = { failNextUpdates: 0 };

  const atomicTeamUpdate = async (
    teamId: string,
    updater: (team: Team) => Team | null
  ): Promise<{ success: boolean; team?: Team; error?: string }> => {
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
  registerTeamRoutes({
    app,
    dataStore,
    teamService: createTeamService({ dataStore, tokenService }),
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

describe('renaming a retrospective or health check from the Dashboard', () => {
  let baseUrl: string;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    return async () => {
      await server.close();
    };
  });

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const setup = async () => {
    const res = await post('/api/team/create', {
      name: 'Rename Team',
      password: 'password123456',
      facilitatorEmail: 'fac@example.com'
    });
    const created = await res.json();
    expect(res.status, JSON.stringify(created)).toBe(201);
    const teamId = created.team.id as string;
    const sessionToken = created.sessionToken as string;

    // The retro reaches revision 7 the way a real one does: the live session
    // persisted it as people worked.
    await post(`/api/team/${teamId}/retrospective/r1`, {
      sessionToken,
      retrospective: {
        id: 'r1',
        teamId,
        name: 'Sprint 12',
        date: '2026-01-01',
        status: 'CLOSED',
        phase: 'CLOSE',
        columns: [],
        tickets: [],
        groups: [],
        actions: [],
        happiness: {},
        roti: {},
        finishedUsers: [],
        _rev: 7
      }
    });
    await post(`/api/team/${teamId}/healthcheck/h1`, {
      sessionToken,
      healthCheck: { id: 'h1', teamId, name: 'Q1 check', date: '2026-01-01', status: 'CLOSED', ratings: {}, actions: [], _rev: 7 }
    });

    return { teamId, sessionToken };
  };

  const storedRetro = (teamId: string) =>
    (dataStore._teams.get(teamId) as unknown as { retrospectives: { name: string; _rev?: number }[] })
      .retrospectives[0];
  const storedCheck = (teamId: string) =>
    (dataStore._teams.get(teamId) as unknown as { healthChecks: { name: string }[] }).healthChecks[0];

  it('renames a retrospective whose stored revision is ahead of the caller’s copy', async () => {
    // This is the reported bug. The Dashboard's cached copy is at _rev 3
    // because the session advanced the stored one to 7 after the page loaded.
    const { teamId, sessionToken } = await setup();

    const res = await post(`/api/team/${teamId}/retrospective/r1/name`, {
      sessionToken,
      name: 'Sprint 12 — retro'
    });

    expect(res.status).toBe(200);
    expect(storedRetro(teamId).name).toBe('Sprint 12 — retro');
  });

  it('renames a health check whose stored revision is ahead of the caller’s copy', async () => {
    const { teamId, sessionToken } = await setup();

    const res = await post(`/api/team/${teamId}/healthcheck/h1/name`, {
      sessionToken,
      name: 'Q1 team health'
    });

    expect(res.status).toBe(200);
    expect(storedCheck(teamId).name).toBe('Q1 team health');
  });

  it('does not disturb the stored revision, so the live session keeps syncing', async () => {
    // The rename must not look like a session write: bumping `_rev` here would
    // make every live client's next update lose the optimistic-concurrency
    // race and take a healing round-trip for a title change.
    const { teamId, sessionToken } = await setup();

    await post(`/api/team/${teamId}/retrospective/r1/name`, { sessionToken, name: 'New title' });

    expect(storedRetro(teamId)._rev).toBe(7);
  });

  it('trims the submitted name, as the team-name paths already do', async () => {
    const { teamId, sessionToken } = await setup();

    await post(`/api/team/${teamId}/retrospective/r1/name`, { sessionToken, name: '  Padded  ' });

    expect(storedRetro(teamId).name).toBe('Padded');
  });

  it('rejects an empty or whitespace-only name instead of blanking the title', async () => {
    const { teamId, sessionToken } = await setup();

    for (const name of ['', '   ', undefined, 42]) {
      const res = await post(`/api/team/${teamId}/retrospective/r1/name`, { sessionToken, name });
      expect(res.status, `name=${JSON.stringify(name)}`).toBe(400);
      expect((await res.json()).error).toBe('missing_name');
    }
    expect(storedRetro(teamId).name).toBe('Sprint 12');
  });

  it('answers 404 when the target does not exist, never a success', async () => {
    // Audit H34: success follows the write. The updater aborts when the id
    // matches nothing, and an aborted updater reads as "nothing to change".
    const { teamId, sessionToken } = await setup();

    const retro = await post(`/api/team/${teamId}/retrospective/nope/name`, { sessionToken, name: 'x' });
    expect(retro.status).toBe(404);
    expect(await retro.json()).toEqual({ error: 'retrospective_not_found' });

    const check = await post(`/api/team/${teamId}/healthcheck/nope/name`, { sessionToken, name: 'x' });
    expect(check.status).toBe(404);
    expect(await check.json()).toEqual({ error: 'healthcheck_not_found' });
  });

  it('answers 401 without a team credential', async () => {
    const { teamId } = await setup();

    const res = await post(`/api/team/${teamId}/retrospective/r1/name`, { name: 'Stolen rename' });

    expect(res.status).toBe(401);
    expect(storedRetro(teamId).name).toBe('Sprint 12');
  });

  it('answers 500 when the store loses the write, rather than reporting success', async () => {
    const { teamId, sessionToken } = await setup();

    dataStore.control.failNextUpdates = 1;
    const res = await post(`/api/team/${teamId}/retrospective/r1/name`, { sessionToken, name: 'Lost' });

    expect(res.status).toBe(500);
    expect(storedRetro(teamId).name).toBe('Sprint 12');
  });

  it('reports success for a rename to the name it already has', async () => {
    // A no-op is "nothing to change", not "no such retrospective": the write
    // found its target, so this must not be a 404.
    const { teamId, sessionToken } = await setup();

    const res = await post(`/api/team/${teamId}/retrospective/r1/name`, {
      sessionToken,
      name: 'Sprint 12'
    });

    expect(res.status).toBe(200);
    expect(storedRetro(teamId).name).toBe('Sprint 12');
  });

  it('leaves every other field of the retrospective alone', async () => {
    const { teamId, sessionToken } = await setup();
    const before = { ...storedRetro(teamId) } as unknown as Record<string, unknown>;

    await post(`/api/team/${teamId}/retrospective/r1/name`, { sessionToken, name: 'Only the title' });

    const after = storedRetro(teamId) as unknown as Record<string, unknown>;
    for (const key of Object.keys(before)) {
      if (key === 'name') continue;
      expect(after[key], `field ${key} must not change`).toEqual(before[key]);
    }
  });
});
