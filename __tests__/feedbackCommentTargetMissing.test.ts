import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';

/**
 * Audit H22: `/api/feedbacks/comment` stores a comment in one of two places —
 * the owning team's record, or `retro-meta.orphanedFeedbacks` when the team has
 * since been deleted. When the target feedback is in *neither*, both writes are
 * no-ops (the meta updater returns `null`, which `atomicMetaUpdate` maps to
 * "nothing to change") and the route still answered
 * `{ success: true, comment }` with the comment it had built but never stored.
 *
 * `TeamFeedback.tsx:161` treats `response.ok` as proof and clears the textarea,
 * so the user's typed comment is gone from the screen and was never persisted.
 * The board is shared across teams and its author may delete a feedback at any
 * time, so the race is ordinary use, not a crafted request.
 *
 * This is distinct from audit H2, which pinned *lost writes* (an exhausted
 * compare-and-swap). `atomicUpdateFailureHandling.test.ts` deliberately asserts
 * that a store-level no-op stays a success — that contract is unchanged here.
 * What must not stay a success is a write that had no target at all.
 */

const listen = async (
  app: express.Express,
  path: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> => {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, json: await response.json().catch(() => ({})) };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
};

type Feedback = {
  id: string;
  teamId: string;
  title: string;
  type: string;
  comments?: unknown[];
};

const buildApp = ({
  teamFeedbacks = [] as Feedback[],
  orphanedFeedbacks = [] as Feedback[]
} = {}) => {
  const requestingTeam = { id: 'team-1', name: 'Team One', teamFeedbacks: [] as Feedback[] };
  const targetTeam = { id: 'team-2', name: 'Team Two', teamFeedbacks };
  const meta = { orphanedFeedbacks };

  const app = express();
  app.use(express.json());

  const atomicTeamUpdate = vi.fn(async (teamId: string, updater: (team: unknown) => unknown) => {
    const team = teamId === 'team-2' ? targetTeam : requestingTeam;
    const updated = updater(team);
    return updated ? { success: true, team: updated } : { success: true, team };
  });

  // A faithful stand-in for the real store: it runs the updater, and maps a
  // falsy return to "nothing changed" exactly as `atomicMetaUpdate` does.
  const atomicMetaUpdate = vi.fn(async (updater: (meta: unknown) => unknown) => {
    const updated = updater(meta);
    return updated || meta;
  });

  registerFeedbackRoutes({
    app,
    dataStore: {
      atomicTeamUpdate,
      atomicMetaUpdate,
      loadTeam: vi.fn(async (id: string) => (id === 'team-2' ? targetTeam : requestingTeam)),
      loadGlobalSettings: vi.fn(async () => ({}))
    },
    teamService: { authenticateTeam: vi.fn(async () => ({ team: requestingTeam, error: null })) },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value
  });

  return { app, meta, targetTeam };
};

const credentials = { teamId: 'team-1', sessionToken: 'token' };

const comment = {
  feedbackTeamId: 'team-2',
  authorId: 'user-1',
  authorName: 'User One',
  content: 'a comment the user typed'
};

describe('POST /api/feedbacks/comment reports whether the comment was stored', () => {
  it('does not claim success when the feedback exists in neither the team record nor the orphan list', async () => {
    const { app } = buildApp();

    const { status, json } = await listen(app, '/api/feedbacks/comment', {
      ...credentials,
      ...comment,
      feedbackId: 'feedback-deleted-a-moment-ago'
    });

    expect(status).toBe(404);
    expect(json.success).not.toBe(true);
    expect(json.comment).toBeUndefined();
  });

  it('does not claim success when the store holds no orphan list at all', async () => {
    // `atomicMetaUpdate`'s updater bails on a meta record whose
    // `orphanedFeedbacks` is missing — a fresh install, or a restored archive.
    const { app } = buildApp({ orphanedFeedbacks: undefined as unknown as Feedback[] });

    const { status, json } = await listen(app, '/api/feedbacks/comment', {
      ...credentials,
      ...comment,
      feedbackId: 'feedback-1'
    });

    expect(status).toBe(404);
    expect(json.success).not.toBe(true);
  });

  it('still stores a comment on a feedback owned by a live team', async () => {
    const { app, targetTeam } = buildApp({
      teamFeedbacks: [{ id: 'feedback-1', teamId: 'team-2', title: 'Live', type: 'bug' }]
    });

    const { status, json } = await listen(app, '/api/feedbacks/comment', {
      ...credentials,
      ...comment,
      feedbackId: 'feedback-1'
    });

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(targetTeam.teamFeedbacks[0].comments).toHaveLength(1);
  });

  it('still stores a comment on an orphaned feedback whose team was deleted', async () => {
    const { app, meta } = buildApp({
      orphanedFeedbacks: [{ id: 'feedback-9', teamId: 'gone', title: 'Orphan', type: 'feature' }]
    });

    const { status, json } = await listen(app, '/api/feedbacks/comment', {
      ...credentials,
      ...comment,
      feedbackId: 'feedback-9'
    });

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(meta.orphanedFeedbacks[0].comments).toHaveLength(1);
  });
});
