import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createTeamService } from '../server/services/teamService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { hashPassword } from '../server/services/passwordHashing.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';

/**
 * Feedback preservation on team deletion.
 *
 * Invariant (AGENTS.md, "Data Persistence Structure"): deleting a team never
 * destroys its bug reports / feature requests. They are moved into
 * `orphanedFeedbacks` in the `retro-meta` record, keeping their teamId/teamName
 * stamp, and every feedback endpoint keeps finding them there afterwards.
 *
 * These tests register the real Express routes against an in-memory fake data
 * store and the real team/token services, then drive the real HTTP endpoints.
 */

type FeedbackComment = {
  id: string;
  feedbackId: string;
  teamId: string;
  teamName?: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
};

type Feedback = {
  id: string;
  teamId?: string;
  teamName?: string;
  type: string;
  title: string;
  description: string;
  submittedAt: string;
  isRead?: boolean;
  status?: string;
  comments?: FeedbackComment[];
};

type Team = {
  id: string;
  name: string;
  passwordHash: string;
  facilitatorEmail?: string;
  members?: unknown[];
  teamFeedbacks?: Feedback[];
};

type Meta = { resetTokens: unknown[]; orphanedFeedbacks: Feedback[] };

type FeedbackListResponse = { feedbacks: Feedback[] };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Mirrors the parts of `server/services/dataStore.js` these routes use,
 * including the semantics that matter here: an atomic updater that returns
 * `null` writes nothing, and every read hands back a detached copy.
 */
const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  let meta: Meta = { resetTokens: [], orphanedFeedbacks: [] };

  return {
    // --- test helpers (not part of the real dataStore contract) ---
    seedTeam: (team: Team) => {
      teams.set(team.id, clone(team));
      indexMap.set(team.name.toLowerCase(), team.id);
    },
    hasTeam: (teamId: string) => teams.has(teamId),
    readMeta: (): Meta => clone(meta),
    readIndex: () => new Map(indexMap),

    // --- dataStore contract ---
    loadTeam: async (teamId: string) => {
      const team = teams.get(teamId);
      return team ? clone(team) : null;
    },
    loadAllTeams: async () => Array.from(teams.values()).map((team) => clone(team)),
    loadAllTeamFeedbacks: async () =>
      Array.from(teams.values()).map((team) => ({
        id: team.id,
        name: team.name,
        teamFeedbacks: clone(team.teamFeedbacks || [])
      })),
    loadTeamSummaries: async () =>
      Array.from(teams.values()).map((team) => ({ id: team.id, name: team.name, members: [] })),
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamUpdate: async (teamId: string, updater: (team: Team) => Team | null) => {
      const existing = teams.get(teamId);
      if (!existing) return { success: false, error: 'team_not_found' };
      const updated = updater(clone(existing));
      if (!updated) return { success: true, team: clone(existing) };
      teams.set(teamId, clone(updated));
      return { success: true, team: clone(updated) };
    },
    loadTeamIndex: async () => new Map(indexMap),
    atomicTeamIndexUpdate: async (updater: (index: Map<string, string>) => Map<string, string> | null) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [key, value] of next) indexMap.set(key, value);
      return new Map(indexMap);
    },
    loadMetaData: async (): Promise<Meta> => clone(meta),
    atomicMetaUpdate: async (updater: (current: Meta) => Meta | null) => {
      const updated = updater(clone(meta));
      if (!updated) return clone(meta);
      meta = clone(updated);
      return clone(meta);
    },
    loadGlobalSettings: async () => ({})
  };
};

const SUPER_ADMIN_PASSWORD = 'super-admin-secret';
const TEAM_PASSWORD = 'team-password';
const DOOMED_TEAM_ID = 'team-doomed';
const LIVE_TEAM_ID = 'team-live';

let teamPasswordHash = '';

const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const dataStore = createMockDataStore();
  const tokenService = createTokenService({
    secureCompare: (a: string, b: string) => a === b,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    tokenSecret: 'feedback-preservation-test-secret'
  });
  const teamService = createTeamService({ dataStore, tokenService });
  const mailerService = { smtpEnabled: false, mailer: null };
  const logService = { addServerLog: () => {}, getServerLogs: () => [] };
  const escapeHtml = (value: string) => value;

  registerTeamRoutes({ app, dataStore, teamService, tokenService, mailerService, logService, escapeHtml });
  registerFeedbackRoutes({ app, dataStore, teamService, mailerService, logService, escapeHtml });
  registerSuperAdminRoutes({
    app,
    io: { emit: () => {}, serverSideEmit: () => {} },
    dataStore,
    tokenService,
    mailerService,
    logService,
    escapeHtml,
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    sessionCache: { clear: () => {} },
    backupService: {},
    aiService: {}
  });

  return { app, dataStore, tokenService };
};

const listen = async (app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> =>
  new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });

describe('Feedback preservation on team deletion', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let store: ReturnType<typeof createMockDataStore>;
  let doomedToken: string;
  let liveToken: string;

  const post = async <T>(path: string, body: Record<string, unknown>): Promise<{ status: number; body: T }> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: (await response.json()) as T };
  };

  const listTeamFeedbacks = async () => {
    const { status, body } = await post<FeedbackListResponse>('/api/feedbacks/all', {
      teamId: LIVE_TEAM_ID,
      sessionToken: liveToken
    });
    expect(status).toBe(200);
    return body.feedbacks;
  };

  const listSuperAdminFeedbacks = async () => {
    const { status, body } = await post<FeedbackListResponse>('/api/super-admin/feedbacks', {
      password: SUPER_ADMIN_PASSWORD
    });
    expect(status).toBe(200);
    return body.feedbacks;
  };

  const deleteDoomedTeam = async () => {
    const { status, body } = await post<{ success?: boolean }>(`/api/team/${DOOMED_TEAM_ID}/delete`, {
      sessionToken: doomedToken
    });
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
  };

  const findFeedback = (feedbacks: Feedback[], id: string) => feedbacks.find((feedback) => feedback.id === id);

  beforeAll(async () => {
    teamPasswordHash = await hashPassword(TEAM_PASSWORD);
  });

  beforeEach(async () => {
    const app = buildApp();
    store = app.dataStore;

    store.seedTeam({
      id: DOOMED_TEAM_ID,
      name: 'Alpha',
      passwordHash: teamPasswordHash,
      members: [],
      teamFeedbacks: [
        // Legacy record: no teamId/teamName stamp, no isRead/status/comments.
        {
          id: 'fb-legacy',
          type: 'bug',
          title: 'Timer stops after a reconnect',
          description: 'The retro timer freezes when the pod restarts.',
          submittedAt: '2026-01-02T00:00:00.000Z'
        },
        // Submitted before the team was renamed: its own stamp is historical
        // and must survive the move to orphanedFeedbacks untouched.
        {
          id: 'fb-stamped',
          teamId: DOOMED_TEAM_ID,
          teamName: 'Alpha (previous name)',
          type: 'feature',
          title: 'Export the retro as PDF',
          description: 'We would like to archive retros as PDF.',
          submittedAt: '2026-01-04T00:00:00.000Z',
          isRead: true,
          status: 'in_progress',
          comments: []
        }
      ]
    });

    store.seedTeam({
      id: LIVE_TEAM_ID,
      name: 'Beta',
      passwordHash: teamPasswordHash,
      facilitatorEmail: 'beta@corp',
      members: [],
      teamFeedbacks: [
        {
          id: 'fb-live',
          teamId: LIVE_TEAM_ID,
          teamName: 'Beta',
          type: 'bug',
          title: 'Votes are not counted twice',
          description: 'Second vote is ignored.',
          submittedAt: '2026-01-03T00:00:00.000Z',
          status: 'pending',
          comments: []
        }
      ]
    });

    doomedToken = app.tokenService.createSessionToken(DOOMED_TEAM_ID);
    liveToken = app.tokenService.createSessionToken(LIVE_TEAM_ID);

    const started = await listen(app.app);
    baseUrl = started.baseUrl;
    close = started.close;
  });

  afterEach(async () => {
    await close();
  });

  describe('POST /api/team/:teamId/delete', () => {
    it('moves the deleted team feedbacks into orphanedFeedbacks and drops the team record', async () => {
      expect(store.readMeta().orphanedFeedbacks).toHaveLength(0);

      await deleteDoomedTeam();

      const orphaned = store.readMeta().orphanedFeedbacks;
      expect(orphaned.map((feedback) => feedback.id).sort()).toEqual(['fb-legacy', 'fb-stamped']);
      // The team record itself and its index entry are gone.
      expect(store.hasTeam(DOOMED_TEAM_ID)).toBe(false);
      expect(store.readIndex().has('alpha')).toBe(false);
    });

    it('stamps orphaned feedbacks with the deleted team identity, keeping any existing stamp', async () => {
      await deleteDoomedTeam();

      const orphaned = store.readMeta().orphanedFeedbacks;
      // Legacy record inherits the deleted team's identity...
      expect(findFeedback(orphaned, 'fb-legacy')).toMatchObject({
        teamId: DOOMED_TEAM_ID,
        teamName: 'Alpha',
        title: 'Timer stops after a reconnect'
      });
      // ...while an existing (historical) stamp is preserved as submitted.
      expect(findFeedback(orphaned, 'fb-stamped')).toMatchObject({
        teamId: DOOMED_TEAM_ID,
        teamName: 'Alpha (previous name)',
        status: 'in_progress'
      });
    });

    it('loses no feedback: every feedback reachable before the deletion is still reachable after', async () => {
      const before = await listTeamFeedbacks();
      expect(before.map((feedback) => feedback.id).sort()).toEqual(['fb-legacy', 'fb-live', 'fb-stamped']);

      await deleteDoomedTeam();

      const after = await listTeamFeedbacks();
      expect(after.map((feedback) => feedback.id).sort()).toEqual(before.map((feedback) => feedback.id).sort());
      expect(after).toHaveLength(before.length);
    });

    it('does not touch the feedbacks of other teams', async () => {
      await deleteDoomedTeam();

      const orphaned = store.readMeta().orphanedFeedbacks;
      expect(findFeedback(orphaned, 'fb-live')).toBeUndefined();
      const after = await listTeamFeedbacks();
      expect(findFeedback(after, 'fb-live')).toMatchObject({ teamId: LIVE_TEAM_ID, teamName: 'Beta' });
    });
  });

  describe('Feedback listings include orphaned feedbacks', () => {
    it('returns orphaned feedbacks alongside live ones from /api/feedbacks/all', async () => {
      await deleteDoomedTeam();

      const feedbacks = await listTeamFeedbacks();
      // Orphaned entries are merged with the live ones and sorted together by
      // submission date, newest first - not appended as a separate tail.
      expect(feedbacks.map((feedback) => feedback.id)).toEqual(['fb-stamped', 'fb-live', 'fb-legacy']);
      // Missing fields are defaulted on the way out.
      expect(findFeedback(feedbacks, 'fb-legacy')).toMatchObject({
        teamName: 'Alpha',
        isRead: false,
        status: 'pending',
        comments: []
      });
    });

    it('returns orphaned feedbacks alongside live ones from /api/super-admin/feedbacks', async () => {
      await deleteDoomedTeam();

      const feedbacks = await listSuperAdminFeedbacks();
      expect(feedbacks.map((feedback) => feedback.id)).toEqual(['fb-stamped', 'fb-live', 'fb-legacy']);
      expect(findFeedback(feedbacks, 'fb-stamped')).toMatchObject({
        teamId: DOOMED_TEAM_ID,
        teamName: 'Alpha (previous name)'
      });
    });
  });

  describe('Team feedback operations reach orphaned feedbacks', () => {
    it('adds a comment to a feedback that now lives in orphanedFeedbacks', async () => {
      await deleteDoomedTeam();

      const { status, body } = await post<{ success?: boolean; comment?: FeedbackComment }>('/api/feedbacks/comment', {
        teamId: LIVE_TEAM_ID,
        sessionToken: liveToken,
        feedbackTeamId: DOOMED_TEAM_ID,
        feedbackId: 'fb-legacy',
        authorId: 'member-1',
        authorName: 'Bea',
        content: 'We still see this.'
      });

      expect(status).toBe(200);
      expect(body.success).toBe(true);

      const stored = findFeedback(store.readMeta().orphanedFeedbacks, 'fb-legacy');
      expect(stored?.comments).toHaveLength(1);
      expect(stored?.comments?.[0]).toMatchObject({ authorName: 'Bea', content: 'We still see this.' });
      // ...and the comment is visible through the listing endpoint too.
      const listed = findFeedback(await listTeamFeedbacks(), 'fb-legacy');
      expect(listed?.comments).toHaveLength(1);
    });

    it('deletes a comment from a feedback that now lives in orphanedFeedbacks', async () => {
      await deleteDoomedTeam();

      const added = await post<{ comment: FeedbackComment }>('/api/feedbacks/comment', {
        teamId: LIVE_TEAM_ID,
        sessionToken: liveToken,
        feedbackTeamId: DOOMED_TEAM_ID,
        feedbackId: 'fb-stamped',
        authorId: 'member-1',
        authorName: 'Bea',
        content: 'Still relevant.'
      });
      expect(added.status).toBe(200);

      const { status } = await post<{ success?: boolean }>('/api/feedbacks/comment/delete', {
        teamId: LIVE_TEAM_ID,
        sessionToken: liveToken,
        feedbackTeamId: DOOMED_TEAM_ID,
        feedbackId: 'fb-stamped',
        commentId: added.body.comment.id
      });

      expect(status).toBe(200);
      const stored = findFeedback(store.readMeta().orphanedFeedbacks, 'fb-stamped');
      expect(stored?.comments).toHaveLength(0);
    });

    it('still comments on a live team feedback (the team record is searched first)', async () => {
      const { status } = await post<{ success?: boolean }>('/api/feedbacks/comment', {
        teamId: LIVE_TEAM_ID,
        sessionToken: liveToken,
        feedbackTeamId: LIVE_TEAM_ID,
        feedbackId: 'fb-live',
        authorId: 'member-1',
        authorName: 'Bea',
        content: 'Reproduced on mobile.'
      });

      expect(status).toBe(200);
      const listed = findFeedback(await listTeamFeedbacks(), 'fb-live');
      expect(listed?.comments).toHaveLength(1);
      expect(store.readMeta().orphanedFeedbacks).toHaveLength(0);
    });
  });

  describe('Super-admin feedback operations reach orphaned feedbacks', () => {
    it('updates the status of a feedback that now lives in orphanedFeedbacks', async () => {
      await deleteDoomedTeam();

      const { status, body } = await post<{ success?: boolean }>('/api/super-admin/feedbacks/update', {
        password: SUPER_ADMIN_PASSWORD,
        teamId: DOOMED_TEAM_ID,
        feedbackId: 'fb-legacy',
        updates: { status: 'resolved', isRead: true }
      });

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(findFeedback(await listSuperAdminFeedbacks(), 'fb-legacy')).toMatchObject({
        status: 'resolved',
        isRead: true
      });
    });

    it('adds an admin comment to a feedback that now lives in orphanedFeedbacks', async () => {
      await deleteDoomedTeam();

      const { status, body } = await post<{ success?: boolean; comment?: FeedbackComment }>(
        '/api/super-admin/feedbacks/comment',
        {
          password: SUPER_ADMIN_PASSWORD,
          teamId: DOOMED_TEAM_ID,
          feedbackId: 'fb-stamped',
          content: 'Shipped in the next release.'
        }
      );

      expect(status).toBe(200);
      expect(body.comment).toMatchObject({ authorName: 'Super Admin' });

      const stored = findFeedback(store.readMeta().orphanedFeedbacks, 'fb-stamped');
      expect(stored?.comments).toHaveLength(1);
      expect(stored?.comments?.[0]).toMatchObject({ content: 'Shipped in the next release.' });
    });

    it('still comments on a live team feedback (the team record is searched first)', async () => {
      const { status } = await post<{ success?: boolean }>('/api/super-admin/feedbacks/comment', {
        password: SUPER_ADMIN_PASSWORD,
        teamId: LIVE_TEAM_ID,
        feedbackId: 'fb-live',
        content: 'Looking into it.'
      });

      expect(status).toBe(200);
      const listed = findFeedback(await listSuperAdminFeedbacks(), 'fb-live');
      expect(listed?.comments).toHaveLength(1);
      expect(store.readMeta().orphanedFeedbacks).toHaveLength(0);
    });

    it('deletes a feedback that now lives in orphanedFeedbacks', async () => {
      await deleteDoomedTeam();

      const { status } = await post<{ success?: boolean }>('/api/super-admin/feedbacks/delete', {
        password: SUPER_ADMIN_PASSWORD,
        teamId: DOOMED_TEAM_ID,
        feedbackId: 'fb-legacy'
      });

      expect(status).toBe(200);
      expect(store.readMeta().orphanedFeedbacks.map((feedback) => feedback.id)).toEqual(['fb-stamped']);
      expect(findFeedback(await listSuperAdminFeedbacks(), 'fb-legacy')).toBeUndefined();
    });
  });
});

/**
 * The orphaned-feedback container itself: whatever a caller reads, the
 * `orphanedFeedbacks` array always exists, and a backup archive round-trips it.
 * Exercised against a real SQLite store (the default engine in CI).
 */
describe('Orphaned feedback storage (SQLite)', () => {
  const PG_ENV_KEYS = [
    'DATABASE_URL',
    'POSTGRES_HOST',
    'POSTGRESQL_SERVICE_HOST',
    'POSTGRES_USER',
    'POSTGRESQL_USER',
    'POSTGRES_PASSWORD',
    'POSTGRESQL_PASSWORD',
    'POSTGRES_DB',
    'POSTGRESQL_DATABASE',
    'DATA_STORE_PATH'
  ];

  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-orphaned-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
  });

  afterEach(() => {
    try {
      dataStore.closeDatabase();
    } catch {
      /* already closed */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
    for (const key of PG_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('exposes an empty orphanedFeedbacks array on a store that never stored one', async () => {
    const meta = await dataStore.loadMetaData();
    expect(meta.orphanedFeedbacks).toEqual([]);
    expect(meta.resetTokens).toEqual([]);
  });

  it('round-trips orphaned feedbacks through a backup archive', async () => {
    const orphan = {
      id: 'fb-orphan',
      teamId: 'team-gone',
      teamName: 'Gone',
      type: 'bug',
      title: 'Kept after the team is gone',
      description: 'Preserved.',
      submittedAt: '2026-01-01T00:00:00.000Z'
    };

    await dataStore.savePersistedData({ teams: [], resetTokens: [], orphanedFeedbacks: [orphan] });

    const archive = await dataStore.loadPersistedData();
    expect(archive.orphanedFeedbacks).toEqual([orphan]);
    const meta = await dataStore.loadMetaData();
    expect(meta.orphanedFeedbacks).toEqual([orphan]);
  });

  it('still returns a well-formed archive when the store cannot be read', async () => {
    // Degraded read (database unavailable): callers such as the backup service
    // must never receive an archive whose orphanedFeedbacks key is missing.
    dataStore.closeDatabase();

    const archive = await dataStore.loadPersistedData();
    expect(archive.teams).toEqual([]);
    expect(archive.orphanedFeedbacks).toEqual([]);
    expect(archive.resetTokens).toEqual([]);
  });
});
