import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * Regression test for the server-side "closed-action guard" on the
 * /api/team/:teamId/retrospective/:retroId persist.
 *
 * An action is closed through /api/team/:teamId/action, which does NOT advance
 * the retro `_rev`. A client that never saw that close can then persist a full
 * retro blob that still reports the action as open; its `_rev` is >= the stored
 * one, so it passes the rev guard and would silently re-open the action. The
 * guard keeps the stored `done: true` for any action the incoming blob still
 * reports as open, while leaving assignee/text (and proposals) to the blob.
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
    const updated = updater(structuredClone(existing));
    if (!updated) return { success: true, team: existing };
    teams.set(teamId, structuredClone(updated));
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
  const atomicMetaUpdate = async (
    updater: (meta: { resetTokens: unknown[]; orphanedFeedbacks: unknown[] }) => unknown
  ) => {
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
  validateInviteCredential: (credential: string) => {
    if (!credential?.startsWith('invite-')) return null;
    const rest = credential.slice('invite-'.length);
    const sep = rest.lastIndexOf('-');
    return { teamId: rest.slice(0, sep), epoch: Number(rest.slice(sep + 1)) };
  },
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

describe('/retrospective persist closed-action guard', () => {
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

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const setup = async () => {
    const res = await post('/api/team/create', {
      name: 'Guard Team',
      password: 'password123',
      facilitatorEmail: 'fac@example.com'
    });
    const created = await res.json();
    expect(res.status, JSON.stringify(created)).toBe(201);
    const { team, sessionToken } = created;
    const retro = {
      id: 'r1',
      teamId: team.id,
      name: 'Sprint 1',
      date: '2026-01-01',
      status: 'CLOSED',
      phase: 'CLOSE',
      columns: [],
      tickets: [],
      groups: [],
      actions: [{ id: 'a1', text: 'Ship it', assigneeId: null, done: false, type: 'new', proposalVotes: {} }],
      happiness: {},
      roti: {},
      finishedUsers: [],
      _rev: 1
    };
    const persistRes = await post(`/api/team/${team.id}/retrospective/r1`, { sessionToken, retrospective: retro });
    expect(persistRes.status, JSON.stringify(await persistRes.json())).toBe(200);
    return { teamId: team.id, sessionToken, retro };
  };

  const storedAction = (teamId: string) =>
    (dataStore._teams.get(teamId) as any).retrospectives[0].actions[0];

  it('does not let a stale full-retro persist re-open an action closed via /action', async () => {
    const { teamId, sessionToken, retro } = await setup();

    // Close the action through the granular endpoint (Dashboard / other retro).
    await post(`/api/team/${teamId}/action`, {
      sessionToken,
      retroId: 'r1',
      action: { id: 'a1', text: 'Ship it', assigneeId: null, done: true, type: 'new', proposalVotes: {} }
    });
    expect(storedAction(teamId).done).toBe(true);

    // A stale client (never saw the close) re-persists the whole retro with the
    // action still open, at a rev that clears the rev guard.
    const stale = { ...structuredClone(retro), _rev: 2 };
    stale.actions[0].done = false;
    stale.actions[0].assigneeId = 'bob'; // an unrelated change that must apply
    await post(`/api/team/${teamId}/retrospective/r1`, { sessionToken, retrospective: stale });

    const after = storedAction(teamId);
    expect(after.done).toBe(true); // guarded: not re-opened
    expect(after.assigneeId).toBe('bob'); // assignee still flows through

    await close();
  });

  it('still lets a legitimate re-open (via /action first) persist', async () => {
    const { teamId, sessionToken, retro } = await setup();

    await post(`/api/team/${teamId}/action`, {
      sessionToken,
      retroId: 'r1',
      action: { id: 'a1', text: 'Ship it', assigneeId: null, done: true, type: 'new', proposalVotes: {} }
    });
    // Legit re-open goes through /action first, so the stored record is open.
    await post(`/api/team/${teamId}/action`, {
      sessionToken,
      retroId: 'r1',
      action: { id: 'a1', text: 'Ship it', assigneeId: null, done: false, type: 'new', proposalVotes: {} }
    });
    expect(storedAction(teamId).done).toBe(false);

    const reopened = { ...structuredClone(retro), _rev: 3 };
    reopened.actions[0].done = false;
    await post(`/api/team/${teamId}/retrospective/r1`, { sessionToken, retrospective: reopened });

    expect(storedAction(teamId).done).toBe(false); // stays open
    await close();
  });
});
