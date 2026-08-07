import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { postJson, withServer } from './helpers/routeTestServer';

/**
 * `AUTH_RATE_LIMIT_MAX` guards `/api/team/restore-session`, `/api/team/create`
 * and `/api/super-admin/verify`. It used to count **every** request, which made
 * it a genuine availability risk rather than a safeguard:
 * `/api/team/restore-session` runs on *every page load* for a returning user
 * (`App.tsx:167-183`), so with the default of 5 a handful of reloads from one
 * egress IP locked real users out of the application for fifteen minutes — and
 * the limiter is per pod, so the ceiling was neither predictable nor generous.
 *
 * The meter is now scoped to `401` alone, matching `/api/send-invite`
 * (`publicRoutes.js:49-57`). That keeps the property the limiter exists for —
 * an anonymous prober cannot drive unbounded token/password guesses, each of
 * which costs a data-store read — while making it impossible for anything a
 * legitimate user does to consume the budget.
 *
 * These tests pin both halves, because a limiter that never fires is as wrong
 * as one that fires too eagerly.
 */

const TEAM = { id: 'team-1', name: 'Team One', members: [], retrospectives: [] };

const buildApp = (max: number, overrides: Record<string, unknown> = {}) => {
  process.env.AUTH_RATE_LIMIT_MAX = String(max);

  const app = express();
  app.use(express.json());

  registerTeamRoutes({
    app,
    dataStore: {
      loadTeamIndex: vi.fn(async () => new Map([['team one', TEAM.id]])),
      loadTeam: vi.fn(async () => ({ ...TEAM })),
      loadTeamSummaries: vi.fn(async () => []),
      atomicTeamUpdate: vi.fn(async () => ({ success: true }))
    },
    teamService: {
      sanitizeTeamForClient: (team: typeof TEAM) => team,
      authenticateTeam: vi.fn(),
      atomicUpdateTeam: vi.fn()
    },
    tokenService: {
      issueTeamToken: vi.fn(() => 'fresh-token'),
      verifyTeamToken: vi.fn(),
      // Only the literal string 'good-token' resolves to a session.
      validateSessionToken: vi.fn((token: string) =>
        (token === 'good-token' ? { teamId: TEAM.id } : null)),
      invalidateSessionToken: vi.fn()
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value,
    ...overrides
  });

  return app;
};

afterEach(() => {
  delete process.env.AUTH_RATE_LIMIT_MAX;
});

describe('the auth limiter counts rejected credentials only', () => {
  it('never blocks a returning user, however often the page is reloaded', async () => {
    const app = buildApp(2);

    await withServer(app, async (call) => {
      // Far more reloads than the cap. Every one of them must be served: this
      // is the exact call the app makes on load, and a 429 here is a user
      // locked out of a retrospective that is already running.
      for (let i = 0; i < 10; i += 1) {
        const response = await call('/api/team/restore-session', postJson({ sessionToken: 'good-token' }));
        expect(response.status, `reload ${i + 1} was refused`).toBe(200);
      }
    });
  });

  it('still stops a prober guessing session tokens', async () => {
    const app = buildApp(2);

    await withServer(app, async (call) => {
      for (let i = 0; i < 2; i += 1) {
        const rejected = await call('/api/team/restore-session', postJson({ sessionToken: `guess-${i}` }));
        expect(rejected.status).toBe(401);
      }

      const limited = await call('/api/team/restore-session', postJson({ sessionToken: 'guess-3' }));

      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: 'too_many_attempts', retryAfter: '15 minutes' });
    });
  });

  it('does not spend the budget on a facilitator retrying a taken team name', async () => {
    const app = buildApp(2);

    await withServer(app, async (call) => {
      // `team one` already exists, so each attempt is a 409. Setting up a batch
      // of teams and colliding on names a few times is ordinary work; it must
      // not cost the operator their next fifteen minutes.
      for (let i = 0; i < 5; i += 1) {
        const conflict = await call('/api/team/create', postJson({ name: 'Team One', password: 'hunter2!-longer' }));
        expect(conflict.status, `attempt ${i + 1} was refused by the limiter`).toBe(409);
      }
    });
  });

  it('does not spend the budget on a malformed request either', async () => {
    const app = buildApp(2);

    await withServer(app, async (call) => {
      for (let i = 0; i < 5; i += 1) {
        const badRequest = await call('/api/team/restore-session', postJson({}));
        expect(badRequest.status, `attempt ${i + 1} was refused by the limiter`).toBe(400);
      }
    });
  });
});
