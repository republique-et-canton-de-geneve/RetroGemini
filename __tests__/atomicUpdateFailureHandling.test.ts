import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';

/**
 * Audit H2: `atomicTeamUpdate` gives up after 5 lost compare-and-swap races and
 * returns `{ success: false, error: 'max_retries_exceeded' }`. Routes that
 * `await` it without inspecting the result answer `{ success: true }` to the
 * client while nothing was persisted — silent loss of user-submitted content.
 *
 * `teamRoutes.js` checks the result at all 9 of its call sites; the feedback
 * routes checked it at none. These tests pin the contract: a failed atomic
 * update must surface as a non-2xx response, never as a success.
 *
 * The updater returning a falsy value is a *legitimate* no-op (the store maps
 * it to `{ success: true }`), so the guard must not turn "nothing to change"
 * into an error — covered by the last test here.
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

type StoreOverrides = Record<string, unknown>;

const buildApp = (atomicTeamUpdate: unknown, overrides: StoreOverrides = {}) => {
  const app = express();
  app.use(express.json());

  const team = {
    id: 'team-1',
    name: 'Team One',
    teamFeedbacks: [
      {
        id: 'feedback-1',
        teamId: 'team-1',
        title: 'Existing',
        type: 'bug',
        comments: [{ id: 'comment-1', teamId: 'team-1', content: 'hi' }]
      }
    ]
  };

  const dataStore = {
    atomicTeamUpdate,
    loadTeam: vi.fn(async () => team),
    atomicMetaUpdate: vi.fn(async () => ({ success: true })),
    loadGlobalSettings: vi.fn(async () => ({})),
    ...overrides
  };

  registerFeedbackRoutes({
    app,
    dataStore,
    teamService: { authenticateTeam: vi.fn(async () => ({ team, error: null })) },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value
  });

  return app;
};

const exhausted = async () => ({ success: false, error: 'max_retries_exceeded' });

const credentials = { teamId: 'team-1', sessionToken: 'token' };

describe('routes surface failed atomic team updates instead of reporting success', () => {
  it('POST /api/feedbacks/create does not claim success when the write was lost', async () => {
    const app = buildApp(vi.fn(exhausted));

    const { status, json } = await listen(app, '/api/feedbacks/create', {
      ...credentials,
      feedback: { type: 'bug', title: 'Lost report', description: 'never persisted' }
    });

    expect(status).toBeGreaterThanOrEqual(500);
    expect(json.success).not.toBe(true);
  });

  it('POST /api/feedbacks/comment does not claim success when the write was lost', async () => {
    const app = buildApp(vi.fn(exhausted));

    const { status, json } = await listen(app, '/api/feedbacks/comment', {
      ...credentials,
      feedbackTeamId: 'team-1',
      feedbackId: 'feedback-1',
      authorId: 'user-1',
      authorName: 'User One',
      content: 'a comment that was never stored'
    });

    expect(status).toBeGreaterThanOrEqual(500);
    expect(json.success).not.toBe(true);
  });

  it('POST /api/feedbacks/comment/delete does not claim success when the write was lost', async () => {
    const app = buildApp(vi.fn(exhausted));

    const { status, json } = await listen(app, '/api/feedbacks/comment/delete', {
      ...credentials,
      feedbackTeamId: 'team-1',
      feedbackId: 'feedback-1',
      commentId: 'comment-1'
    });

    expect(status).toBeGreaterThanOrEqual(500);
    expect(json.success).not.toBe(true);
  });

  it('POST /api/feedbacks/delete does not claim success when the write was lost', async () => {
    const app = buildApp(vi.fn(exhausted));

    const { status, json } = await listen(app, '/api/feedbacks/delete', {
      ...credentials,
      feedbackId: 'feedback-1'
    });

    expect(status).toBeGreaterThanOrEqual(500);
    expect(json.success).not.toBe(true);
  });

  it('still succeeds when the store accepts the write', async () => {
    const app = buildApp(vi.fn(async () => ({ success: true, team: {} })));

    const { status, json } = await listen(app, '/api/feedbacks/create', {
      ...credentials,
      feedback: { type: 'bug', title: 'Kept', description: 'persisted fine' }
    });

    expect(status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('treats a no-op updater as a missing target, not as a lost write', async () => {
    // The store maps a falsy updater return to `{ success: true }` with no
    // revision bump. That is "nothing to change", not a failure, and must not
    // be turned into a 5xx by the guard.
    //
    // This case used to assert `200` here, which conflated two different
    // things: the H2 guard is about `result.success`, but the *outcome* of a
    // write that reached no target is a 404 (audit H28, extended to this sixth
    // sibling). Both halves matter — a no-op is not a server error, and it is
    // not a success either.
    const app = buildApp(vi.fn(async () => ({ success: true, team: {} })));

    const { status, json } = await listen(app, '/api/feedbacks/delete', {
      ...credentials,
      feedbackId: 'feedback-1'
    });

    expect(status).toBe(404);
    expect(status).toBeLessThan(500);
    expect(json.success).not.toBe(true);
  });

  it('reports a missing target as 404, which is still not a lost write', async () => {
    // Audit H22 (extended): `/api/feedbacks/comment/delete` distinguishes "the
    // write found no target" from "the write was lost". That is a *different*
    // axis from the guard above, and the two must not be conflated — a missing
    // target is a 404, never a 5xx, because retrying cannot help and nothing
    // was lost. This case exists so a future change cannot satisfy H2 by
    // turning every no-op into a server error.
    const app = buildApp(vi.fn(async () => ({ success: true, team: {} })));

    const { status } = await listen(app, '/api/feedbacks/comment/delete', {
      ...credentials,
      feedbackTeamId: 'team-1',
      feedbackId: 'feedback-1',
      commentId: 'comment-1'
    });

    expect(status).toBe(404);
    expect(status).toBeLessThan(500);
  });
});
