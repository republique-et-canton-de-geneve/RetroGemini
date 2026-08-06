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
type Feedback = { id: string; title: string; status?: string; teamId?: string; teamName?: string };
type Meta = { resetTokens: unknown[]; orphanedFeedbacks: Feedback[] };

/** Operations a test can make fail exactly the way a store outage would. */
type Faults = {
  saveTeam?: boolean;
  deleteTeamRecord?: boolean;
  teamIndexUpdate?: boolean;
  /**
   * Runs once, inside the next `deleteTeamRecord` call, which then throws.
   * That is how an interleaving of two in-flight requests is made
   * deterministic: the hook is the *other* request, running to completion at
   * the exact point this one is about to fail.
   */
  onDeleteTeamRecord?: (() => Promise<void>) | null;
  /**
   * The same two devices for `atomicTeamUpdate`, which is what a rename writes
   * the *record* half through. A rename touches the index first, so its window
   * is the one between that write and this one.
   */
  atomicTeamUpdate?: boolean;
  onAtomicTeamUpdate?: (() => Promise<void>) | null;
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
    if (faults.onDeleteTeamRecord) {
      const hook = faults.onDeleteTeamRecord;
      faults.onDeleteTeamRecord = null;
      await hook();
      throw new Error('store unavailable');
    }
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
    if (faults.onAtomicTeamUpdate) {
      const hook = faults.onAtomicTeamUpdate;
      faults.onAtomicTeamUpdate = null;
      await hook();
      return { success: false, error: 'store_unavailable' };
    }
    if (faults.atomicTeamUpdate) return { success: false, error: 'store_unavailable' };
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

  const createTeam = (name: string, password = 'secret-passphrase') =>
    post('/api/team/create', { name, password });

  const login = (teamName: string, password = 'secret-passphrase') =>
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
      const first = await createTeam('Alpha', 'first-pass-phrase');
      expect(first.status).toBe(201);
      const firstId = (await first.json()).team.id;

      dataStore._faults.saveTeam = true;
      const colliding = await createTeam('Alpha', 'second-pass-phrase');
      // The name is taken, so this never reaches the record write at all.
      expect(colliding.status).toBe(409);
      dataStore._faults.saveTeam = false;

      // The rollback must key on the id it claimed: releasing the name
      // unconditionally would evict the *existing* team from the index.
      expect(dataStore._indexMap.get('alpha')).toBe(firstId);
      expect((await login('Alpha', 'first-pass-phrase')).status).toBe(200);
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

    it('leaves a failed record delete retryable, with the record intact', async () => {
      const { teamId, sessionToken } = await seedTeamWithFeedback();

      dataStore._faults.deleteTeamRecord = true;
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(500);
      dataStore._faults.deleteTeamRecord = false;

      // Nothing was destroyed: the record survives, which is what lets the
      // retry authenticate. The index entry is deliberately *not* restored —
      // see the concurrency case below — so the name is simply free.
      expect(dataStore._teams.has(teamId)).toBe(true);
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(200);
      expect(await (await exists('Alpha')).json()).toEqual({ exists: false });
    });

    it('never restores a mapping to a record a concurrent deletion removed', async () => {
      // Codex, PR #407. Two overlapping deletions of the same team: request A
      // clears the index entry and then fails its record delete; request B,
      // running inside that window, finds no entry to clear and deletes the
      // record successfully. A rollback in A would now point the name at a
      // record that no longer exists — the terminal state this whole ordering
      // exists to prevent, reached from the one direction the ordering does
      // not cover.
      const { teamId, sessionToken } = await seedTeamWithFeedback();

      dataStore._faults.onDeleteTeamRecord = async () => {
        const concurrent = await post(`/api/team/${teamId}/delete`, { sessionToken });
        expect(concurrent.status).toBe(200);
      };

      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(500);

      expect(dataStore._teams.has(teamId)).toBe(false);
      expect(dataStore._indexMap.has('alpha')).toBe(false);
      expect(await (await exists('Alpha')).json()).toEqual({ exists: false });
      expect((await createTeam('Alpha')).status).toBe(201);
    });

    it('refreshes an already-preserved feedback instead of keeping the stale copy', async () => {
      // Codex, PR #407. Every feedback writer — the comment routes and the
      // super-admin status/comment/delete routes — resolves the team record
      // first and only falls back to `orphanedFeedbacks`. So while the team is
      // still live after a failed attempt, changes land on the *live* copy;
      // skipping an already-preserved id would freeze the first attempt's
      // snapshot and lose them when the record finally goes.
      const { teamId, sessionToken } = await seedTeamWithFeedback();

      dataStore._faults.deleteTeamRecord = true;
      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(500);
      dataStore._faults.deleteTeamRecord = false;

      const live = dataStore._teams.get(teamId) as Team & { teamFeedbacks: Feedback[] };
      live.teamFeedbacks = [{ id: 'fb-1', title: 'Something is broken', status: 'resolved' }];

      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(200);

      expect(dataStore._meta.orphanedFeedbacks).toEqual([
        { id: 'fb-1', title: 'Something is broken', status: 'resolved', teamId, teamName: 'Alpha' }
      ]);
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

    it('clears every index entry pointing at the deleted team', async () => {
      const { teamId, sessionToken } = await seedTeamWithFeedback();
      // A rename holds two keys for one team between claiming the new name and
      // releasing the old one, so "the entry" is not always singular. The scan
      // stopped at the first match, which left the other one pointing at a
      // record about to be deleted — the ghost mapping again, reached from a
      // different direction.
      dataStore._indexMap.set('beta', teamId);

      expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(200);

      expect([...dataStore._indexMap.entries()]).toEqual([]);
      expect((await createTeam('Beta')).status).toBe(201);
    });
  });

  describe('rename', () => {
    const seedTeam = async (name: string, password = 'secret-passphrase') => {
      const res = await createTeam(name, password);
      const { team, sessionToken } = await res.json();
      return { teamId: team.id as string, sessionToken: sessionToken as string };
    };

    const rename = (teamId: string, sessionToken: string, name: string) =>
      post(`/api/team/${teamId}/update`, { sessionToken, updates: { name } });

    /**
     * The property both defects below break, stated once: every team record is
     * reachable by logging in with the name it displays, and no index entry
     * points at a record that is not there.
     *
     * A leftover *extra* key for a live team is deliberately not an error here —
     * that is the benign residual of a rename whose final release failed, and it
     * resolves to the right team.
     */
    const expectIndexAgreesWithRecords = () => {
      for (const team of dataStore._teams.values()) {
        expect(
          dataStore._indexMap.get(String(team.name).toLowerCase()),
          `team ${team.id} ("${team.name}") is not reachable under its own name`,
        ).toBe(team.id);
      }
      for (const [key, id] of dataStore._indexMap.entries()) {
        expect(
          dataStore._teams.has(id),
          `index key "${key}" points at team ${id}, which has no record — that name is bricked`,
        ).toBe(true);
      }
    };

    it('never takes the freed name away from a team that claimed it', async () => {
      // The old order released the old name *before* the record was written, so
      // for the width of the record write the name was free for anyone to take —
      // and the rollback then took it back unconditionally, evicting whoever had
      // legitimately claimed it. That team keeps its record and loses its name:
      // login resolves the other team, and no UI reaches the state.
      const { teamId, sessionToken } = await seedTeam('Alpha', 'first-pass-phrase');

      let collidingStatus = 0;
      dataStore._faults.onAtomicTeamUpdate = async () => {
        collidingStatus = (await createTeam('Alpha', 'second-pass-phrase')).status;
      };

      expect((await rename(teamId, sessionToken, 'Beta')).status).toBe(500);

      // Either outcome for the concurrent creation is defensible — the name is
      // still Alpha's until the rename lands (409), or it is genuinely free
      // (201). What is not defensible is a winner that cannot log in.
      expect([201, 409]).toContain(collidingStatus);
      expectIndexAgreesWithRecords();
    });

    it('never restores the old name for a team a concurrent request deleted', async () => {
      // Same shape as the deletion case above (Codex, PR #407): the rollback
      // widens the index, and a deletion that lands inside the window leaves the
      // restored mapping pointing at nothing.
      const { teamId, sessionToken } = await seedTeam('Alpha');

      dataStore._faults.onAtomicTeamUpdate = async () => {
        expect((await post(`/api/team/${teamId}/delete`, { sessionToken })).status).toBe(200);
      };

      expect((await rename(teamId, sessionToken, 'Beta')).status).toBe(500);

      expect(dataStore._teams.has(teamId)).toBe(false);
      expect(await (await exists('Alpha')).json()).toEqual({ exists: false });
      expect((await createTeam('Alpha')).status).toBe(201);
      expectIndexAgreesWithRecords();
    });

    it('leaves the team reachable under its old name when the record write fails', async () => {
      const { teamId, sessionToken } = await seedTeam('Alpha');

      dataStore._faults.atomicTeamUpdate = true;
      expect((await rename(teamId, sessionToken, 'Beta')).status).toBe(500);
      dataStore._faults.atomicTeamUpdate = false;

      // Nothing half-done: the old name still works and the new one was not
      // left claimed by a rename that never happened.
      expect((await login('Alpha')).status).toBe(200);
      expect(await (await exists('Beta')).json()).toEqual({ exists: false });
      expectIndexAgreesWithRecords();

      expect((await rename(teamId, sessionToken, 'Beta')).status).toBe(200);
      expect((await login('Beta')).status).toBe(200);
    });

    it('frees the old name and claims the new one on a successful rename', async () => {
      const { teamId, sessionToken } = await seedTeam('Alpha');

      expect((await rename(teamId, sessionToken, 'Beta')).status).toBe(200);

      expect((await login('Beta')).status).toBe(200);
      expect((await login('Alpha')).status).toBe(401);
      expect(await (await exists('Alpha')).json()).toEqual({ exists: false });
      expect((await createTeam('Alpha', 'somebody-else-pass')).status).toBe(201);
      expectIndexAgreesWithRecords();
    });

    it('refuses a rename onto a name another team holds, and changes nothing', async () => {
      const alpha = await seedTeam('Alpha', 'a-pass-phrase');
      await seedTeam('Beta', 'b-pass-phrase');

      expect((await rename(alpha.teamId, alpha.sessionToken, 'Beta')).status).toBe(409);

      expect((await login('Alpha', 'a-pass-phrase')).status).toBe(200);
      expect((await login('Beta', 'b-pass-phrase')).status).toBe(200);
      expectIndexAgreesWithRecords();
    });

    it('sweeps the aliases a previously lost release left behind', async () => {
      // Codex, PR #413. The residual of a lost release is that the team holds
      // two keys. Releasing only the record's *current* old name left the other
      // one claimed for good: nobody else could ever take that name, and it kept
      // resolving to the team, so "the next rename clears it" — which is what
      // this file used to claim — was simply not true.
      const { teamId, sessionToken } = await seedTeam('Alpha');
      expect((await rename(teamId, sessionToken, 'Beta')).status).toBe(200);
      dataStore._indexMap.set('alpha', teamId); // the release that got lost

      expect((await rename(teamId, sessionToken, 'Gamma')).status).toBe(200);

      expect([...dataStore._indexMap.keys()]).toEqual(['gamma']);
      expect((await createTeam('Alpha', 'somebody-else-pass')).status).toBe(201);
      expect((await login('Gamma')).status).toBe(200);
    });

    it('keeps a name it did not claim when the record write fails', async () => {
      // Renaming *back* onto a stale alias: the name is already the team's, so
      // the claim writes nothing — and the failure path must not release it,
      // because that mapping predates the request. Releasing what it never added
      // would take the team's own name away on a failed rename.
      const { teamId, sessionToken } = await seedTeam('Alpha');
      expect((await rename(teamId, sessionToken, 'Beta')).status).toBe(200);
      dataStore._indexMap.set('alpha', teamId);

      dataStore._faults.atomicTeamUpdate = true;
      expect((await rename(teamId, sessionToken, 'Alpha')).status).toBe(500);
      dataStore._faults.atomicTeamUpdate = false;

      expect(dataStore._indexMap.get('alpha')).toBe(teamId);
      expect(dataStore._indexMap.get('beta')).toBe(teamId);
      expect((await login('Beta')).status).toBe(200);
    });

    it('leaves the team reachable when two renames of it overlap', async () => {
      // Two renames of the same team in flight. The sweep must not delete the
      // other request's claim and leave the team with no name at all, which is
      // why it only ever releases keys observed *before* its own claim.
      const { teamId, sessionToken } = await seedTeam('Alpha');

      dataStore._faults.onAtomicTeamUpdate = async () => {
        expect((await rename(teamId, sessionToken, 'Gamma')).status).toBe(200);
      };

      // This one loses its record write to the fault; the nested one landed.
      expect((await rename(teamId, sessionToken, 'Beta')).status).toBe(500);

      expect([...dataStore._indexMap.values()]).toContain(teamId);
      expectIndexAgreesWithRecords();
      expect((await login('Gamma')).status).toBe(200);
    });

    it('renames a team that only changes the casing of its own name', async () => {
      // Old and new key are equal here, so there is no claim to make and — the
      // part that bites — no old key to release afterwards. Releasing it would
      // delete the team's only mapping.
      const { teamId, sessionToken } = await seedTeam('Alpha');

      expect((await rename(teamId, sessionToken, 'ALPHA')).status).toBe(200);

      expect((dataStore._teams.get(teamId) as Team).name).toBe('ALPHA');
      expect((await login('alpha')).status).toBe(200);
      expectIndexAgreesWithRecords();
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
