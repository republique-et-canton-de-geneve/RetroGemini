import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * The `team-index` record and the `team:{id}` records must never disagree.
 *
 * Creation and deletion both touch the two records in sequence, with no
 * transaction spanning them, so a store failure between the two steps leaves a
 * state neither the product nor an operator can repair from the UI:
 *
 *  - **A ghost index entry** (name -> id, no record) makes the name
 *    permanently unusable. `/api/team/create` reads the index for its
 *    uniqueness check and answers `409 team_name_exists` forever;
 *    `/api/team/login` resolves the id and then finds nothing, answering
 *    `401 team_not_found`; `/api/team/list` scans `team:` records so the team
 *    is not even visible. Nothing short of editing the database frees the name.
 *  - **A duplicated orphan feedback** is what a *retried* deletion produces
 *    when the feedback-preservation step already ran: `/api/feedbacks/all`
 *    concatenates team feedbacks and orphaned ones, so every bug report of the
 *    deleted team appears twice, and once more per retry.
 *
 * These tests drive the real routes over real HTTP against an in-memory store
 * whose individual operations can be made to fail, which is the only way to
 * reach the window.
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };
type Feedback = { id: string; title: string };
type Meta = { resetTokens: unknown[]; orphanedFeedbacks: Feedback[] };

/** Operations a test can make fail exactly the way a store outage would. */
type Faults = {
  saveTeam?: boolean;
  deleteTeamRecord?: boolean;
  teamIndexUpdate?: boolean;
};

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  const meta: Meta = { resetTokens: [], orphanedFeedbacks: [] };
  const faults: Faults = {};

  const loadTeam = async (teamId: string) => teams.get(teamId) || null;
  const loadTeamRaw = loadTeam;
  const saveTeam = async (teamId: string, teamData: Team) => {
    if (faults.saveTeam) throw new Error('store unavailable');
    teams.set(teamId, { ...teamData });
  };
  const loadAllTeams = async () => Array.from(teams.values());
  const deleteTeamRecord = async (teamId: string) => {
    if (faults.deleteTeamRecord) throw new Error('store unavailable');
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
    if (faults.teamIndexUpdate) throw new Error('store unavailable');
    const next = updater(new Map(indexMap));
    if (!next) return new Map(indexMap);
    indexMap.clear();
    for (const [k, v] of next) indexMap.set(k, v);
    return new Map(indexMap);
  };

  const loadMetaData = async () => JSON.parse(JSON.stringify(meta)) as Meta;
  const atomicMetaUpdate = async (updater: (m: Meta) => Meta | null) => {
    const next = updater(JSON.parse(JSON.stringify(meta)) as Meta);
    if (!next) return meta;
    meta.resetTokens = next.resetTokens;
    meta.orphanedFeedbacks = next.orphanedFeedbacks;
    return meta;
  };
  const loadGlobalSettings = async () => ({});
  const loadTeamSummaries = async () =>
    Array.from(teams.values()).map((t) => ({ id: t.id, name: t.name, members: [] }));

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
    loadTeamSummaries,
    _faults: faults,
    _teams: teams,
    _indexMap: indexMap,
    _meta: meta
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

describe('team-index integrity across create and delete', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataStore: ReturnType<typeof createMockDataStore>;

  beforeEach(async () => {
    const built = buildApp();
    dataStore = built.dataStore;
    const server = await listen(built.app);
    baseUrl = server.baseUrl;
    close = server.close;
    return () => close();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const createTeam = (name: string, password = 'secret') =>
    post('/api/team/create', { name, password });

  const login = (teamName: string, password = 'secret') =>
    post('/api/team/login', { teamName, password });

  const exists = (name: string) =>
    fetch(`${baseUrl}/api/team/exists/${encodeURIComponent(name)}`);

  describe('creation', () => {
    it('frees the claimed name when the team record cannot be written', async () => {
      dataStore._faults.saveTeam = true;

      const failed = await createTeam('Alpha');
      expect(failed.status).toBe(500);

      // The name was claimed in the index before the record was written. If the
      // claim survives the failure, nothing can ever use that name again.
      expect(await (await exists('Alpha')).json()).toEqual({ exists: false });

      dataStore._faults.saveTeam = false;
      const retried = await createTeam('Alpha');
      expect(retried.status).toBe(201);
      expect((await login('Alpha')).status).toBe(200);
    });

    it('leaves an existing team untouched when a colliding creation fails', async () => {
      const first = await createTeam('Alpha', 'first-pass');
      expect(first.status).toBe(201);
      const firstId = (await first.json()).team.id;

      dataStore._faults.saveTeam = true;
      const colliding = await createTeam('Alpha', 'second-pass');
      // The name is taken, so this never reaches the record write at all.
      expect(colliding.status).toBe(409);
      dataStore._faults.saveTeam = false;

      // The rollback must key on the id it claimed: releasing the name
      // unconditionally would evict the *existing* team from the index.
      expect(dataStore._indexMap.get('alpha')).toBe(firstId);
      expect((await login('Alpha', 'first-pass')).status).toBe(200);
    });

    it('trims the team name so a trailing space cannot create a twin', async () => {
      const created = await createTeam('  Alpha  ');
      expect(created.status).toBe(201);
      expect((await created.json()).team.name).toBe('Alpha');

      // Without the trim the index holds "  alpha  " and "alpha" as two
      // distinct teams that render identically in the login picker.
      expect((await createTeam('Alpha')).status).toBe(409);
      expect((await login('Alpha')).status).toBe(200);
    });

    it('rejects a whitespace-only team name', async () => {
      const created = await createTeam('   ');
      expect(created.status).toBe(400);
      expect((await created.json()).error).toBe('missing_fields');
      expect(dataStore._teams.size).toBe(0);
    });
  });

  describe('deletion', () => {
    const seedTeamWithFeedback = async () => {
      const res = await createTeam('Alpha');
      const { team, sessionToken } = await res.json();
      dataStore._teams.set(team.id, {
        ...(dataStore._teams.get(team.id) as Team),
        teamFeedbacks: [{ id: 'fb-1', title: 'Something is broken' }]
      });
      return { teamId: team.id as string, sessionToken: sessionToken as string };
    };

    it('preserves each feedback once even when the deletion is retried', async () => {
      const { teamId, sessionToken } = await seedTeamWithFeedback();

      dataStore._faults.deleteTeamRecord = true;
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(500);

      dataStore._faults.deleteTeamRecord = false;
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(200);

      // The preservation step runs before the record delete, so a retry used to
      // append a second copy of every feedback — visible twice on the board.
      expect(dataStore._meta.orphanedFeedbacks.map((f) => f.id)).toEqual(['fb-1']);
    });

    it('keeps the team reachable when the record delete fails', async () => {
      const { teamId, sessionToken } = await seedTeamWithFeedback();

      dataStore._faults.deleteTeamRecord = true;
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(500);
      dataStore._faults.deleteTeamRecord = false;

      // Nothing was destroyed, so the name must still resolve to the team —
      // otherwise the index entry has been dropped for a team that still
      // exists, and the facilitator can neither log in nor retry the delete.
      expect((await login('Alpha')).status).toBe(200);
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(200);
    });

    it('does not brick the name when the index write fails', async () => {
      const { teamId, sessionToken } = await seedTeamWithFeedback();

      dataStore._faults.teamIndexUpdate = true;
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(500);
      dataStore._faults.teamIndexUpdate = false;

      // The failure must leave the team whole, so the facilitator can simply
      // retry. Deleting the record first and failing here removed the team
      // while leaving its index entry behind: the retry then 401s (no record to
      // authenticate against) and the name is taken forever.
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(200);
      expect(await (await exists('Alpha')).json()).toEqual({ exists: false });
      expect((await createTeam('Alpha')).status).toBe(201);
    });

    it('frees the name on a clean deletion', async () => {
      const { teamId, sessionToken } = await seedTeamWithFeedback();

      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(200);
      expect(await (await exists('Alpha')).json()).toEqual({ exists: false });
      expect(dataStore._meta.orphanedFeedbacks.map((f) => f.id)).toEqual(['fb-1']);
      expect((await createTeam('Alpha')).status).toBe(201);
    });
  });

  describe('GET /api/team/exists/:teamName', () => {
    // Express already percent-decodes route params, so the handler's own
    // `decodeURIComponent` was a *second* decode: it threw `URIError` on any
    // name containing a bare `%` (500 `check_failed`) and silently answered
    // about a different name whenever a decoded name still looked encoded.
    // `dataService.renameTeam` fails the rename when this check does not
    // answer, so a facilitator could never rename a team to "Sprint 50%".
    it('answers for a name containing a percent sign', async () => {
      expect((await createTeam('Sprint 50%')).status).toBe(201);

      const res = await exists('Sprint 50%');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ exists: true });
    });

    it('does not decode a name that merely looks percent-encoded', async () => {
      expect((await createTeam('a%20b')).status).toBe(201);

      expect(await (await exists('a%20b')).json()).toEqual({ exists: true });
      expect(await (await exists('a b')).json()).toEqual({ exists: false });
    });

    it('still resolves ordinary names case-insensitively', async () => {
      expect((await createTeam('Team One')).status).toBe(201);

      expect(await (await exists('Team One')).json()).toEqual({ exists: true });
      expect(await (await exists('team one')).json()).toEqual({ exists: true });
      expect(await (await exists('Team Two')).json()).toEqual({ exists: false });
    });
  });
});
