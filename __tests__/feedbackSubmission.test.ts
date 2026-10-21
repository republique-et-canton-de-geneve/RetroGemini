import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  newFeedbackSubmissionId,
  submitTeamFeedback,
  type FeedbackSubmission
} from '../services/feedbackSubmission';

/**
 * The form keeps its draft unless the server stored it, so this mapping
 * decides whether what a user typed survives. Every refusal used to read
 * "Check your connection", a 401 included — a draft that can never be stored
 * that way was resent again and again — and nothing pinned the mapping: turning
 * a failure into 'sent' passed the whole suite and lost the draft once more.
 */

type Call = { url: string; body: Record<string, unknown> };

const response = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

const notJson = (status: number) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON');
  }
});

const storedFeedback = { id: 'feedback_stored', title: 'Stored title', type: 'bug' };

// A fetch that answers the create with `createAnswer` and the notification
// with `notifyAnswer`, recording both calls.
const fakeFetch = (
  createAnswer: () => unknown,
  notifyAnswer: () => unknown = () => Promise.resolve(response(200))
) => {
  const calls: Call[] = [];
  const impl = vi.fn((url: string, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return String(url).includes('/api/notify-new-feedback') ? notifyAnswer() : createAnswer();
  });
  return { impl: impl as unknown as typeof fetch, calls };
};

const submission = (overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission => ({
  teamId: 'team-1',
  password: 'team-password',
  sessionToken: 'rg1.session-token',
  feedback: {
    teamId: 'team-1',
    teamName: 'Team One',
    type: 'bug',
    title: 'Typed title',
    description: 'Typed description',
    submittedBy: 'user-1',
    submittedByName: 'User One',
    submissionId: 'abcdefgh12345678'
  },
  ...overrides
});

const notifyCalls = (calls: Call[]) => calls.filter((call) => call.url.includes('/api/notify-new-feedback'));

// Lets a fire-and-forget call settle, and whatever it chains after.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('newFeedbackSubmissionId', () => {
  it('matches the pattern the server accepts, and differs each time', () => {
    const ids = Array.from({ length: 20 }, () => newFeedbackSubmissionId());
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('submitTeamFeedback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the feedback with the team credential and answers sent once it is stored', async () => {
    const { impl, calls } = fakeFetch(async () => response(200, { success: true, feedback: storedFeedback }));

    await expect(submitTeamFeedback(submission(), impl)).resolves.toBe('sent');

    const create = calls.find((call) => call.url === '/api/feedbacks/create')!;
    expect(create.body).toEqual({
      teamId: 'team-1',
      password: 'team-password',
      sessionToken: 'rg1.session-token',
      feedback: submission().feedback
    });
  });

  // H29: the notification mails caller-supplied content through the
  // deployment's SMTP identity, so it is authenticated, with the same team
  // credential as the create it follows. It names the feedback as stored —
  // its id and its trimmed text — not as typed.
  it('notifies the admin with the same credential and the feedback the server answered with', async () => {
    const { impl, calls } = fakeFetch(async () => response(200, { success: true, feedback: storedFeedback }));

    await submitTeamFeedback(submission(), impl);

    expect(notifyCalls(calls)).toHaveLength(1);
    expect(notifyCalls(calls)[0].body).toEqual({
      teamId: 'team-1',
      password: 'team-password',
      sessionToken: 'rg1.session-token',
      feedback: storedFeedback
    });
  });

  it('leaves out a credential the client does not hold, on both calls', async () => {
    const { impl, calls } = fakeFetch(async () => response(200, { success: true, feedback: storedFeedback }));

    await submitTeamFeedback(submission({ password: null, sessionToken: 'rg1.session-token' }), impl);

    for (const call of calls) {
      expect(call.body).not.toHaveProperty('password');
      expect(call.body.sessionToken).toBe('rg1.session-token');
    }
  });

  // A duplicate means the first attempt was stored and its answer lost, so it
  // never notified either.
  it('answers sent, and notifies, when the server recognises a retry', async () => {
    const { impl, calls } = fakeFetch(async () =>
      response(200, { success: true, feedback: storedFeedback, duplicate: true }));

    await expect(submitTeamFeedback(submission(), impl)).resolves.toBe('sent');

    expect(notifyCalls(calls)).toHaveLength(1);
    expect(notifyCalls(calls)[0].body.feedback).toEqual(storedFeedback);
  });

  it.each([
    [413, 'too_large'],
    [401, 'session_expired'],
    [400, 'not_saved'],
    [403, 'not_saved'],
    [404, 'not_saved'],
    [429, 'not_saved'],
    [500, 'not_saved'],
    [503, 'not_saved']
  ] as const)('answers a %i with %s, and notifies nobody', async (status, expected) => {
    const { impl, calls } = fakeFetch(async () => response(status, { error: 'refused' }));

    await expect(submitTeamFeedback(submission(), impl)).resolves.toBe(expected);
    await settle();

    expect(notifyCalls(calls)).toHaveLength(0);
  });

  it('answers offline when the request never got an answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { impl, calls } = fakeFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(submitTeamFeedback(submission(), impl)).resolves.toBe('offline');
    expect(notifyCalls(calls)).toHaveLength(0);
  });

  // A 2xx that is not the route's JSON — a proxy or a captive portal answering
  // in its place — says nothing about whether the feedback was stored.
  it('answers offline for a success whose body is not JSON, and notifies nobody', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { impl, calls } = fakeFetch(async () => notJson(200));

    await expect(submitTeamFeedback(submission(), impl)).resolves.toBe('offline');
    await settle();
    expect(notifyCalls(calls)).toHaveLength(0);
  });

  it('never rejects, even when fetch throws before returning a promise', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const impl = vi.fn(() => {
      throw new Error('fetch is broken');
    }) as unknown as typeof fetch;

    await expect(submitTeamFeedback(submission(), impl)).resolves.toBe('offline');
  });

  it.each([
    ['rejects', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['throws', () => {
      throw new Error('fetch is broken');
    }]
  ])('answers sent and leaks nothing when the notification %s', async (_label, notifyAnswer) => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      // A plain function, not fakeFetch: a vi.fn spy attaches its own handler
      // to every promise it returns, which marks the rejection handled and
      // would hide a dropped `.catch` from this test.
      const impl = ((url: string) => String(url).includes('/api/notify-new-feedback')
        ? notifyAnswer()
        : Promise.resolve(response(200, { success: true, feedback: storedFeedback }))) as unknown as typeof fetch;

      await expect(submitTeamFeedback(submission(), impl)).resolves.toBe('sent');
      await settle();
      await settle();

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
