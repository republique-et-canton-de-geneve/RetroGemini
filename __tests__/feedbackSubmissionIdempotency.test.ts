import express from 'express';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFeedbackRoutes } from '../server/routes/feedbackRoutes.js';

/**
 * A feedback whose create landed but whose answer was lost — the connection
 * dropped after the write, the request timed out — reads as "not sent" on the
 * form, so the user sends it again. Without anything to recognise the retry,
 * the server stored a second copy, a duplicate on a board every team reads.
 *
 * The form now sends one `submissionId` per draft, and the route refuses to
 * store a second feedback carrying an id the team already holds. The decision
 * is taken inside `atomicTeamUpdate`'s updater, which runs once under the row
 * lock, so two retries racing each other cannot both append.
 */

type Feedback = Record<string, unknown> & { id: string; submissionId?: string };
type Team = { id: string; name: string; teamFeedbacks?: Feedback[] };

// A store that behaves like the real one where it matters here: a team's
// updates run one at a time, each updater once, against the record as it is
// when its turn comes. `hold()` keeps every update waiting, so a test can let
// two requests pass authentication before either writes.
const createStore = () => {
  const teams = new Map<string, Team>([
    ['team-1', { id: 'team-1', name: 'Team One', teamFeedbacks: [] }],
    ['team-2', { id: 'team-2', name: 'Team Two', teamFeedbacks: [] }]
  ]);
  let writes = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let gate: Promise<void> = Promise.resolve();

  const atomicTeamUpdate = vi.fn((teamId: string, updater: (team: Team) => Team | null) => {
    const run = queue.then(async () => {
      await gate;
      const stored = teams.get(teamId);
      if (!stored) return { success: false, error: 'team_not_found' };
      const updated = updater(structuredClone(stored));
      if (!updated) return { success: true, team: stored };
      writes += 1;
      teams.set(teamId, structuredClone(updated));
      return { success: true, team: updated };
    });
    queue = run.catch(() => undefined);
    return run;
  });

  return {
    teams,
    atomicTeamUpdate,
    writes: () => writes,
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((resolve) => { release = resolve; });
      return release;
    }
  };
};

type Store = ReturnType<typeof createStore>;

const buildApp = (store: Store) => {
  const app = express();
  app.use(express.json());
  registerFeedbackRoutes({
    app,
    dataStore: {
      atomicTeamUpdate: store.atomicTeamUpdate,
      loadTeam: async (teamId: string) => store.teams.get(teamId) ?? null,
      atomicMetaUpdate: async () => ({ success: true }),
      loadGlobalSettings: async () => ({})
    },
    // Authentication reads the record before the update, as the real one does:
    // a check made against this copy would miss a retry still in the queue.
    teamService: {
      authenticateTeam: async (teamId: string, _password: unknown, sessionToken: unknown) => {
        const team = store.teams.get(teamId);
        if (!team || sessionToken !== `token-${teamId}`) return { team: null, error: 'unauthorized' };
        return { team: structuredClone(team), error: null };
      }
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value
  });
  return app;
};

const SUBMISSION_ID = 'abcdefgh1234567890ab';

const draft = (overrides: Record<string, unknown> = {}) => ({
  type: 'bug',
  title: 'Broken export',
  description: 'The export button does nothing.',
  submittedBy: 'user-1',
  submittedByName: 'User One',
  ...overrides
});

describe('POST /api/feedbacks/create with a submissionId', () => {
  let store: Store;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    store = createStore();
    const server = buildApp(store).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    await close();
  });

  const create = async (feedback: Record<string, unknown>, teamId = 'team-1') => {
    const response = await fetch(`${baseUrl}/api/feedbacks/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId, sessionToken: `token-${teamId}`, feedback })
    });
    return { status: response.status, json: await response.json() as Record<string, any> };
  };

  const stored = (teamId = 'team-1') => store.teams.get(teamId)?.teamFeedbacks ?? [];

  it('stores a retry carrying the same id once, and answers it with the stored feedback', async () => {
    const first = await create(draft({ submissionId: SUBMISSION_ID }));
    const retry = await create(draft({ submissionId: SUBMISSION_ID }));

    expect(first.status).toBe(200);
    expect(first.json.duplicate).toBeUndefined();
    expect(retry.status).toBe(200);
    expect(retry.json).toMatchObject({ success: true, duplicate: true });
    expect(retry.json.feedback.id).toBe(first.json.feedback.id);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ id: first.json.feedback.id, submissionId: SUBMISSION_ID });
  });

  it('writes nothing for a duplicate, and answers with what was stored rather than what was resent', async () => {
    const first = await create(draft({ submissionId: SUBMISSION_ID }));
    const writesAfterFirst = store.writes();

    const retry = await create(draft({ submissionId: SUBMISSION_ID, title: 'Edited title' }));

    expect(store.writes()).toBe(writesAfterFirst);
    expect(retry.json.feedback).toEqual(first.json.feedback);
    expect(stored()[0].title).toBe('Broken export');
  });

  it('stores two concurrent posts carrying one id once', async () => {
    const release = store.hold();

    const pending = Promise.all([
      create(draft({ submissionId: SUBMISSION_ID })),
      create(draft({ submissionId: SUBMISSION_ID }))
    ]);
    // Both requests are past authentication and waiting on the row lock.
    await vi.waitFor(() => expect(store.atomicTeamUpdate).toHaveBeenCalledTimes(2));
    release();
    const answers = await pending;

    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(answers.filter((a) => a.json.duplicate === true)).toHaveLength(1);
    expect(answers[0].json.feedback.id).toBe(answers[1].json.feedback.id);
    expect(stored()).toHaveLength(1);
  });

  it.each([
    ['no id', undefined],
    ['an id too short', 'abc1234'],
    ['an id too long', 'a'.repeat(65)],
    ['an id with characters outside the pattern', 'abcd efgh/1234'],
    ['an id that is not a string', 12345678],
    ['an id that is an object', { $ne: null }]
  ])('stores every post when it carries %s, and keeps no submissionId', async (_label, submissionId) => {
    await create(draft({ submissionId }));
    const second = await create(draft({ submissionId }));

    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBeUndefined();
    expect(stored()).toHaveLength(2);
    expect(stored().every((feedback) => !('submissionId' in feedback))).toBe(true);
  });

  it('looks for a duplicate in the posting team only', async () => {
    const one = await create(draft({ submissionId: SUBMISSION_ID }), 'team-1');
    const two = await create(draft({ submissionId: SUBMISSION_ID }), 'team-2');

    expect(two.json.duplicate).toBeUndefined();
    expect(two.json.feedback.id).not.toBe(one.json.feedback.id);
    expect(stored('team-1')).toHaveLength(1);
    expect(stored('team-2')).toHaveLength(1);
    expect(stored('team-2')[0].teamId).toBe('team-2');
  });
});
