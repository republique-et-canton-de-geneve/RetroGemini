import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * Regression test for the "Team not found" bug after a team rename.
 *
 * Steps to reproduce the bug:
 *  1. Create a team "Alpha".
 *  2. Rename it to "Beta" through /api/team/:teamId/update.
 *  3. Try to login with the new name "Beta".
 *
 * Before the fix, /api/team/:teamId/update would update the per-team
 * record but leave the team-index untouched. The login endpoint, which
 * resolves teamName -> teamId via the index, would then fail with
 * "team_not_found".
 *
 * The fix must keep the index in sync whenever a rename happens.
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();

  const loadTeam = async (teamId: string) => teams.get(teamId) || null;
  const loadTeamRaw = async (teamId: string) => teams.get(teamId) || null;
  const saveTeam = async (teamId: string, teamData: Team) => {
    teams.set(teamId, { ...teamData });
  };
  const loadAllTeams = async () => Array.from(teams.values());
  const deleteTeamRecord = async (teamId: string) => {
    teams.delete(teamId);
  };
  const atomicTeamSave = async (teamId: string, teamData: Team) => {
    teams.set(teamId, { ...teamData });
    return { success: true };
  };
  const atomicTeamUpdate = async (
    teamId: string,
    updater: (team: Team) => Team | null
  ): Promise<{ success: boolean; team?: Team; error?: string }> => {
    const existing = teams.get(teamId);
    if (!existing) return { success: false, error: 'team_not_found' };
    const updated = updater({ ...existing });
    if (!updated) return { success: true, team: existing };
    teams.set(teamId, { ...updated });
    return { success: true, team: updated };
  };

  const loadTeamIndex = async () => new Map(indexMap);
  const saveTeamIndex = async (map: Map<string, string>) => {
    indexMap.clear();
    for (const [k, v] of map) indexMap.set(k, v);
  };
  const atomicTeamIndexUpdate = async (
    updater: (index: Map<string, string>) => Map<string, string> | null
  ) => {
    const next = updater(new Map(indexMap));
    if (!next) return new Map(indexMap);
    indexMap.clear();
    for (const [k, v] of next) indexMap.set(k, v);
    return new Map(indexMap);
  };

  const loadMetaData = async () => ({ resetTokens: [], orphanedFeedbacks: [] });
  const atomicMetaUpdate = async (updater: (meta: { resetTokens: unknown[]; orphanedFeedbacks: unknown[] }) => unknown) => {
    const meta = { resetTokens: [], orphanedFeedbacks: [] };
    updater(meta);
    return meta;
  };
  const loadGlobalSettings = async () => ({});

  return {
    loadTeam,
    loadTeamRaw,
    saveTeam,
    loadAllTeams,
    deleteTeamRecord,
    atomicTeamSave,
    atomicTeamUpdate,
    loadTeamIndex,
    saveTeamIndex,
    atomicTeamIndexUpdate,
    loadMetaData,
    atomicMetaUpdate,
    loadGlobalSettings,
    _teams: teams,
    _indexMap: indexMap
  };
};

const createMockTokenService = () => ({
  createSessionToken: (teamId: string) => `session-${teamId}`,
  validateSessionToken: (token: string) => {
    if (!token?.startsWith('session-')) return null;
    return { teamId: token.slice('session-'.length), visitorId: null };
  },
  invalidateSessionToken: () => {},
  validateSuperAdminAuth: () => false
});

const createMockMailerService = () => ({
  smtpEnabled: false,
  mailer: null
});

const createMockLogService = () => ({
  addServerLog: () => {}
});

const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const dataStore = createMockDataStore();
  const teamService = createTeamService({ dataStore });

  registerTeamRoutes({
    app,
    dataStore,
    teamService,
    tokenService: createMockTokenService(),
    mailerService: createMockMailerService(),
    logService: createMockLogService(),
    escapeHtml: (s: string) => s
  });

  return { app, dataStore };
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

describe('Team rename keeps the team-index in sync', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;
  });

  const createTeam = async (name: string, password: string) => {
    const res = await fetch(`${baseUrl}/api/team/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password, facilitatorEmail: 'fac@example.com' })
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.team;
  };

  const login = async (teamName: string, password: string) => {
    const res = await fetch(`${baseUrl}/api/team/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName, password })
    });
    return res;
  };

  const renameViaUpdate = async (teamId: string, password: string, newName: string) => {
    const res = await fetch(`${baseUrl}/api/team/${teamId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, updates: { name: newName } })
    });
    return res;
  };

  it('logs in with the new name after a rename', async () => {
    const team = await createTeam('Alpha', 'secret');

    const renameRes = await renameViaUpdate(team.id, 'secret', 'Beta');
    expect(renameRes.status).toBe(200);

    const loginRes = await login('Beta', 'secret');
    expect(loginRes.status).toBe(200);
    const body = await loginRes.json();
    expect(body.team.id).toBe(team.id);
    expect(body.team.name).toBe('Beta');

    await close();
  });

  it('rejects login under the old name once the team has been renamed', async () => {
    const team = await createTeam('Alpha', 'secret');
    const renameRes = await renameViaUpdate(team.id, 'secret', 'Beta');
    expect(renameRes.status).toBe(200);

    const oldNameLogin = await login('Alpha', 'secret');
    expect(oldNameLogin.status).toBe(401);

    await close();
  });

  it('keeps the team-index entry pointing to the renamed team', async () => {
    const team = await createTeam('Alpha', 'secret');
    await renameViaUpdate(team.id, 'secret', 'Beta');

    const index = await dataStore.loadTeamIndex();
    expect(index.has('alpha')).toBe(false);
    expect(index.get('beta')).toBe(team.id);

    await close();
  });

  it('refuses to rename to a name already used by another team', async () => {
    const teamA = await createTeam('Alpha', 'secret');
    await createTeam('Beta', 'secret');

    const res = await renameViaUpdate(teamA.id, 'secret', 'Beta');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('team_name_exists');

    const index = await dataStore.loadTeamIndex();
    expect(index.get('alpha')).toBe(teamA.id);

    await close();
  });

  it('allows updating other fields without disturbing the index', async () => {
    const team = await createTeam('Alpha', 'secret');

    const res = await fetch(`${baseUrl}/api/team/${team.id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret', updates: { facilitatorEmail: 'new@example.com' } })
    });
    expect(res.status).toBe(200);

    const index = await dataStore.loadTeamIndex();
    expect(index.get('alpha')).toBe(team.id);

    await close();
  });
});

describe('Team creation issues a session token', () => {
  it('returns a session token bound to the new team so post-create AI calls are authenticated', async () => {
    const built = buildApp();
    const server = await listen(built.app);
    try {
      const res = await fetch(`${server.baseUrl}/api/team/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'TokenTeam', password: 'secret', facilitatorEmail: 'fac@example.com' })
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.sessionToken).toBe(`session-${body.team.id}`);
    } finally {
      await server.close();
    }
  });
});
