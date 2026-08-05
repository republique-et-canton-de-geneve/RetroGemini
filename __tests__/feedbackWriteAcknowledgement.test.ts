import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * Audit H22, extended to the sibling routes it was never applied to.
 *
 * The rule H22 established for `/api/feedbacks/comment` is that **success must
 * follow the write, never the preliminary read**: the route looks the feedback
 * up once to decide where to write, then re-checks it inside the
 * compare-and-swap, and an updater that aborts is reported by
 * `atomicTeamUpdate`/`atomicMetaUpdate` as "nothing to change" — indistinguishable
 * from a successful write unless the handler tracks it. A feedback may be
 * deleted by its author at any moment while someone else is acting on it, so the
 * gap between those two reads is ordinary use, not a crafted request.
 *
 * That fix landed on exactly one of the five routes built this way. The three
 * covered here still trusted the first read:
 *
 *  - `/api/super-admin/feedbacks/comment` — the worst of them. It answered
 *    `{ success: true, comment }` for a comment stored nowhere; `SuperAdmin.tsx`
 *    reads `response.ok`, closes the composer (`setSelectedFeedback(null)`) and
 *    reports "Comment added successfully", so the admin's typed reply is gone.
 *    It also mailed the team — "The administrator has added a comment on your
 *    Bug Report" — about a comment that is not on the board, using a title and
 *    address captured from the stale read.
 *  - `/api/super-admin/feedbacks/update` — reported a status change that was
 *    never applied.
 *  - `/api/feedbacks/comment/delete` — reported a deletion that never happened,
 *    including when the comment belongs to another team and the updater refuses
 *    it on purpose.
 *
 * `/api/super-admin/feedbacks/delete` is deliberately **not** in this list: its
 * updater filters unconditionally and never aborts, so its success is honest.
 * It is left alone rather than restructured to match a pattern.
 *
 * `atomicUpdateFailureHandling.test.ts` pins the other half of the contract — a
 * store-level no-op stays a success. What must not stay a success is a write
 * that had no target at all.
 */

const VALID_TOKEN = 'super-admin-token';

type Feedback = {
  id: string;
  teamId?: string;
  title: string;
  type: string;
  status?: string;
  comments?: { id: string; teamId: string }[];
};

/**
 * Store double whose write step can be made to observe a *different* state
 * from the one the route read a moment earlier — which is the race itself, not
 * a simulation of it. `vanishBeforeWrite` drops the feedback from the team
 * record between the two, exactly as a concurrent `/api/feedbacks/delete`
 * would.
 */
const createStore = ({
  teamFeedbacks = [] as Feedback[],
  orphanedFeedbacks = [] as Feedback[],
  vanishBeforeWrite = false,
  teamFeedbacksMissing = false
} = {}) => {
  const team = {
    id: 'team-2',
    name: 'Team Two',
    facilitatorEmail: 'facilitator@example.com',
    teamFeedbacks
  };
  const requestingTeam = { id: 'team-1', name: 'Team One', teamFeedbacks: [] as Feedback[] };
  const state = { meta: { orphanedFeedbacks } };

  const atWriteTime = () => {
    if (teamFeedbacksMissing) {
      const { teamFeedbacks: _dropped, ...withoutList } = team;
      return withoutList;
    }
    return vanishBeforeWrite ? { ...team, teamFeedbacks: [] } : team;
  };

  return {
    state,
    team,
    loadTeam: vi.fn(async (teamId: string) => (teamId === 'team-2' ? team : requestingTeam)),
    loadTeamSummaries: vi.fn(async () => [team]),
    loadAllTeamFeedbacks: vi.fn(async () => [team]),
    loadMetaData: vi.fn(async () => state.meta),
    loadGlobalSettings: vi.fn(async () => ({ adminEmail: 'admin@example.com' })),
    saveGlobalSettings: vi.fn(async () => {}),
    loadSessionState: vi.fn(async () => null),
    atomicTeamIndexUpdate: vi.fn(async () => ({ success: true })),
    atomicTeamUpdate: vi.fn(async (teamId: string, updater: (t: unknown) => unknown) => {
      const current = teamId === 'team-2' ? atWriteTime() : requestingTeam;
      const next = updater(current);
      return next ? { success: true, team: next } : { success: true, team: current };
    }),
    atomicMetaUpdate: vi.fn(async (updater: (m: typeof state.meta) => typeof state.meta | null) => {
      const next = updater(state.meta);
      if (next) state.meta = next;
      return state.meta;
    })
  };
};

const buildFeedbackApp = (storeOptions?: Parameters<typeof createStore>[0]) => {
  const dataStore = createStore(storeOptions);
  const sendMail = vi.fn(async () => ({}));
  const app = express();
  app.use(express.json());

  registerFeedbackRoutes({
    app,
    dataStore,
    teamService: {
      authenticateTeam: vi.fn(async () => ({ team: { id: 'team-1', name: 'Team One' }, error: null }))
    },
    mailerService: { smtpEnabled: true, mailer: { sendMail } },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => String(value ?? '')
  });

  return { app, dataStore, sendMail };
};

const buildSuperAdminApp = (storeOptions?: Parameters<typeof createStore>[0]) => {
  const dataStore = createStore(storeOptions);
  const sendMail = vi.fn(async () => ({}));
  const app = express();
  app.use(express.json());

  registerSuperAdminRoutes({
    app,
    io: { fetchSockets: async () => [], serverSideEmit: vi.fn() },
    dataStore,
    tokenService: {
      validateSuperAdminAuth: vi.fn((body?: { sessionToken?: string }) => body?.sessionToken === VALID_TOKEN),
      createSuperAdminToken: vi.fn(() => VALID_TOKEN),
      validateSuperAdminToken: vi.fn((token: string) => token === VALID_TOKEN)
    },
    mailerService: { smtpEnabled: true, mailer: { sendMail } },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => String(value ?? ''),
    superAdminPassword: 'super-secret',
    sessionCache: { clear: vi.fn(), delete: vi.fn(), get: vi.fn(), set: vi.fn() },
    backupService: {},
    aiService: {},
    serverRuntime: { multiPodAdapter: false }
  });

  return { app, dataStore, sendMail };
};

const liveFeedback = (): Feedback => ({
  id: 'fb-1',
  teamId: 'team-2',
  title: 'Something is broken',
  type: 'bug',
  status: 'pending',
  comments: []
});

describe('a feedback write that found no target is never reported as success', () => {
  describe('POST /api/super-admin/feedbacks/comment', () => {
    const body = {
      sessionToken: VALID_TOKEN,
      teamId: 'team-2',
      feedbackId: 'fb-1',
      content: 'the reply the admin typed'
    };

    it('answers 404 when the feedback is deleted between the read and the write', async () => {
      const { app, sendMail } = buildSuperAdminApp({
        teamFeedbacks: [liveFeedback()],
        vanishBeforeWrite: true
      });

      const res = await request(app, '/api/super-admin/feedbacks/comment', postJson(body));

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'feedback_not_found' });
      // The mail is built from values captured before the write. Sending it
      // would tell the team about a comment that is not on their board.
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('answers 404 when the feedback exists nowhere at all', async () => {
      const { app, sendMail } = buildSuperAdminApp();

      const res = await request(app, '/api/super-admin/feedbacks/comment', postJson(body));

      expect(res.status).toBe(404);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('still stores a comment on a live feedback and notifies the team', async () => {
      const { app, dataStore, sendMail } = buildSuperAdminApp({ teamFeedbacks: [liveFeedback()] });

      const res = await request(app, '/api/super-admin/feedbacks/comment', postJson(body));

      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
      expect(dataStore.team.teamFeedbacks[0].comments).toHaveLength(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('still stores a comment on an orphaned feedback', async () => {
      const orphan = { ...liveFeedback(), teamId: undefined };
      const { app, dataStore } = buildSuperAdminApp({ orphanedFeedbacks: [orphan] });

      const res = await request(app, '/api/super-admin/feedbacks/comment', postJson(body));

      expect(res.status).toBe(200);
      expect(dataStore.state.meta.orphanedFeedbacks[0].comments).toHaveLength(1);
    });
  });

  describe('POST /api/super-admin/feedbacks/update', () => {
    const body = {
      sessionToken: VALID_TOKEN,
      teamId: 'team-2',
      feedbackId: 'fb-1',
      updates: { status: 'resolved' }
    };

    it('answers 404 when the feedback is deleted between the read and the write', async () => {
      const { app, sendMail } = buildSuperAdminApp({
        teamFeedbacks: [liveFeedback()],
        vanishBeforeWrite: true
      });

      const res = await request(app, '/api/super-admin/feedbacks/update', postJson(body));

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'feedback_not_found' });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('still applies a status change to a live feedback', async () => {
      const { app, dataStore } = buildSuperAdminApp({ teamFeedbacks: [liveFeedback()] });

      const res = await request(app, '/api/super-admin/feedbacks/update', postJson(body));

      expect(res.status).toBe(200);
      expect(dataStore.team.teamFeedbacks[0].status).toBe('resolved');
    });
  });

  describe('POST /api/feedbacks/comment/delete', () => {
    const withComment = (commentTeamId: string): Feedback => ({
      ...liveFeedback(),
      comments: [{ id: 'comment-1', teamId: commentTeamId }]
    });

    const body = {
      teamId: 'team-1',
      sessionToken: 'token',
      feedbackTeamId: 'team-2',
      feedbackId: 'fb-1',
      commentId: 'comment-1'
    };

    it('answers 404 when the feedback is deleted between the read and the write', async () => {
      const { app } = buildFeedbackApp({
        teamFeedbacks: [withComment('team-1')],
        vanishBeforeWrite: true
      });

      const res = await request(app, '/api/feedbacks/comment/delete', postJson(body));

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'comment_not_found' });
    });

    it('answers 404 when the comment belongs to another team', async () => {
      // The updater refuses this on purpose; reporting success told the caller
      // their delete had worked, and the comment simply came back on reload.
      const { app, dataStore } = buildFeedbackApp({ teamFeedbacks: [withComment('team-3')] });

      const res = await request(app, '/api/feedbacks/comment/delete', postJson(body));

      expect(res.status).toBe(404);
      expect(dataStore.team.teamFeedbacks[0].comments).toHaveLength(1);
    });

    it('answers 404 when the comment id does not exist', async () => {
      const { app } = buildFeedbackApp({ teamFeedbacks: [liveFeedback()] });

      const res = await request(app, '/api/feedbacks/comment/delete', postJson(body));

      expect(res.status).toBe(404);
    });

    it('still deletes the caller’s own comment', async () => {
      const { app, dataStore } = buildFeedbackApp({ teamFeedbacks: [withComment('team-1')] });

      const res = await request(app, '/api/feedbacks/comment/delete', postJson(body));

      expect(res.status).toBe(200);
      expect(dataStore.team.teamFeedbacks[0].comments).toHaveLength(0);
    });

    it('still deletes a comment on an orphaned feedback', async () => {
      const orphan = { ...withComment('team-1'), teamId: undefined };
      const { app, dataStore } = buildFeedbackApp({ orphanedFeedbacks: [orphan] });

      const res = await request(app, '/api/feedbacks/comment/delete', postJson(body));

      expect(res.status).toBe(200);
      expect(dataStore.state.meta.orphanedFeedbacks[0].comments).toHaveLength(0);
    });
  });

  /**
   * The sixth sibling, which H28's enumeration of "all five" missed. Its
   * updater aborts on three conditions — the team record carries no
   * `teamFeedbacks` at all, the feedback is not in it, or the feedback belongs
   * to another team — and the route answered `{ success: true }` for every one
   * of them. `TeamFeedback.tsx` reloads the board only on `response.ok`, so a
   * refused delete left the entry on screen with the UI having reported no
   * problem; the caller cannot tell "deleted" from "I was not allowed to".
   */
  describe('POST /api/feedbacks/delete', () => {
    const body = {
      teamId: 'team-2',
      sessionToken: 'token',
      feedbackId: 'fb-1'
    };

    it('answers 404 when the feedback is gone by the time the write runs', async () => {
      const { app, sendMail } = buildFeedbackApp({
        teamFeedbacks: [liveFeedback()],
        vanishBeforeWrite: true
      });

      const res = await request(app, '/api/feedbacks/delete', postJson(body));

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'feedback_not_found' });
      // The admin notification is built from values the updater captures. A
      // deletion that did not happen must not be announced.
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('answers 404 when the feedback belongs to another team, and leaves it alone', async () => {
      const foreign = { ...liveFeedback(), teamId: 'team-9' };
      const { app, dataStore, sendMail } = buildFeedbackApp({ teamFeedbacks: [foreign] });

      const res = await request(app, '/api/feedbacks/delete', postJson(body));

      expect(res.status).toBe(404);
      expect(dataStore.team.teamFeedbacks).toHaveLength(1);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('answers 404 when the team record carries no feedback list at all', async () => {
      const { app } = buildFeedbackApp({ teamFeedbacksMissing: true });

      const res = await request(app, '/api/feedbacks/delete', postJson(body));

      expect(res.status).toBe(404);
    });

    it('gives all three refusals the same answer, so it cannot probe feedback ids', async () => {
      // One opaque `404`, as `/api/feedbacks/comment/delete` already does:
      // "this feedback does not exist", "it is not yours" and "you have no
      // feedbacks" must be indistinguishable from outside.
      const cases = [
        buildFeedbackApp({ teamFeedbacks: [liveFeedback()], vanishBeforeWrite: true }),
        buildFeedbackApp({ teamFeedbacks: [{ ...liveFeedback(), teamId: 'team-9' }] }),
        buildFeedbackApp({ teamFeedbacksMissing: true })
      ];

      const answers = await Promise.all(
        cases.map(async ({ app }) => {
          const res = await request(app, '/api/feedbacks/delete', postJson(body));
          return { status: res.status, json: await res.json() };
        })
      );

      expect(answers).toEqual([
        { status: 404, json: { error: 'feedback_not_found' } },
        { status: 404, json: { error: 'feedback_not_found' } },
        { status: 404, json: { error: 'feedback_not_found' } }
      ]);
    });

    it('still deletes the team’s own feedback and notifies the admin', async () => {
      const { app, dataStore, sendMail } = buildFeedbackApp({ teamFeedbacks: [liveFeedback()] });

      const res = await request(app, '/api/feedbacks/delete', postJson(body));

      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
      expect(dataStore.team.teamFeedbacks).toHaveLength(0);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  });
});
