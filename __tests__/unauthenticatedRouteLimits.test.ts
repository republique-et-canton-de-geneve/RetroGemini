import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerPasswordResetRoutes } from '../server/routes/passwordResetRoutes.js';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { hashResetToken, pruneResetTokens } from '../server/services/security.js';
import { postJson, withServer } from './helpers/routeTestServer';

/**
 * Audit H5 — the endpoints an anonymous caller can reach do real data-store
 * work per request, so without a limiter one client can drive unbounded reads
 * and, on `/api/password-reset/confirm`, unbounded contention on the *meta
 * write lock* that real reset-token writes have to queue behind.
 *
 * Two guarantees are pinned per endpoint:
 *  1. a limiter rejects past the cap *before* the handler runs, so the refused
 *     request never reaches the store;
 *  2. a request that cannot possibly succeed — a token that is not even the
 *     right shape — is refused before it costs a store round trip or the lock.
 *
 * Caps are injected small so the tests stay fast. The production defaults are
 * asserted separately, because a default low enough for real traffic to reach
 * would be an outage rather than a safeguard: these deployments put a whole
 * office behind a single NAT egress IP.
 */

const VALID_TOKEN = 'a'.repeat(64);

const createResetDataStore = () => {
  const team = { id: 'team-1', name: 'Team One', passwordHash: 'scrypt$…' };
  const meta = {
    resetTokens: [{
      tokenHash: hashResetToken(VALID_TOKEN),
      teamId: team.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000
    }]
  };

  return {
    loadTeamIndex: vi.fn(async () => new Map([[team.name.toLowerCase(), team.id]])),
    loadTeam: vi.fn(async () => ({ ...team })),
    loadMetaData: vi.fn(async () => ({ resetTokens: [...meta.resetTokens] })),
    atomicMetaUpdate: vi.fn(async (updater: (m: typeof meta) => typeof meta | null) => {
      const draft = { resetTokens: [...meta.resetTokens] };
      const next = updater(draft);
      if (next) {
        meta.resetTokens = next.resetTokens;
      }
      return { success: true };
    }),
    atomicTeamUpdate: vi.fn(async (_teamId: string, updater: (t: typeof team) => typeof team) => {
      updater({ ...team });
      return { success: true };
    })
  };
};

const buildResetApp = (overrides: Record<string, unknown> = {}) => {
  const app = express();
  app.use(express.json());
  const dataStore = createResetDataStore();

  registerPasswordResetRoutes({
    app,
    dataStore,
    mailerService: { smtpEnabled: true, mailer: { sendMail: vi.fn() } },
    escapeHtml: (value: string) => value,
    sanitizeEmailLink: (value: string) => value,
    hashResetToken,
    pruneResetTokens,
    ...overrides
  });

  return { app, dataStore };
};

const buildPublicApp = (overrides: Record<string, unknown> = {}) => {
  const app = express();
  app.use(express.json());
  const loadGlobalSettings = vi.fn(async () => ({
    infoMessage: 'hello',
    ai: { enabled: true, apiUrl: 'http://ai.internal' }
  }));

  registerPublicRoutes({
    app,
    dataStore: { loadGlobalSettings },
    teamService: { authenticateTeam: vi.fn() },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value,
    sanitizeEmailLink: (value: string) => value,
    ...overrides
  });

  return { app, loadGlobalSettings };
};

const buildTeamApp = (overrides: Record<string, unknown> = {}) => {
  const app = express();
  app.use(express.json());
  const loadTeamIndex = vi.fn(async () => new Map([['team one', 'team-1']]));

  registerTeamRoutes({
    app,
    dataStore: {
      loadTeamIndex,
      loadTeam: vi.fn(),
      loadTeamSummaries: vi.fn(async () => []),
      atomicTeamUpdate: vi.fn()
    },
    teamService: {
      sanitizeTeamForClient: vi.fn(),
      authenticateTeam: vi.fn(),
      atomicUpdateTeam: vi.fn()
    },
    tokenService: { issueTeamToken: vi.fn(), verifyTeamToken: vi.fn() },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value,
    ...overrides
  });

  return { app, loadTeamIndex };
};

describe('POST /api/password-reset/verify — anonymous read amplification', () => {
  it('stops calling the store once the per-IP cap is reached', async () => {
    const { app, dataStore } = buildResetApp({ resetTokenLimiterMax: 3 });

    await withServer(app, async (call) => {
      for (let i = 0; i < 3; i += 1) {
        const allowed = await call('/api/password-reset/verify', postJson({ token: VALID_TOKEN }));
        expect(allowed.status).toBe(200);
      }

      const limited = await call('/api/password-reset/verify', postJson({ token: VALID_TOKEN }));

      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: 'too_many_attempts', retryAfter: '15 minutes' });
    });

    // The limiter is middleware, so the refused call never reached the store.
    expect(dataStore.loadMetaData).toHaveBeenCalledTimes(3);
  });

  it('answers a token that is not even the right shape without a store round trip', async () => {
    const { app, dataStore } = buildResetApp({ resetTokenLimiterMax: 50 });

    await withServer(app, async (call) => {
      for (const token of ['not-a-token', VALID_TOKEN.slice(0, 63), `${VALID_TOKEN}f`, 'Z'.repeat(64)]) {
        const response = await call('/api/password-reset/verify', postJson({ token }));

        // Exactly the answer the store would have produced — only cheaper.
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ valid: false });
      }
    });

    expect(dataStore.loadMetaData).not.toHaveBeenCalled();
  });

  it('still verifies a well-formed live token', async () => {
    const { app } = buildResetApp();

    await withServer(app, async (call) => {
      const response = await call('/api/password-reset/verify', postJson({ token: VALID_TOKEN }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ valid: true, teamName: 'Team One' });
    });
  });
});

describe('POST /api/password-reset/confirm — meta write-lock contention', () => {
  it('stops calling the store once the per-IP cap is reached', async () => {
    const { app, dataStore } = buildResetApp({ resetTokenLimiterMax: 3 });
    const unknownButWellFormed = { token: 'b'.repeat(64), newPassword: 'hunter2-longer' };

    await withServer(app, async (call) => {
      for (let i = 0; i < 3; i += 1) {
        const attempt = await call('/api/password-reset/confirm', postJson(unknownButWellFormed));
        expect(attempt.status).toBe(400);
      }

      const limited = await call('/api/password-reset/confirm', postJson(unknownButWellFormed));

      expect(limited.status).toBe(429);
    });

    expect(dataStore.atomicMetaUpdate).toHaveBeenCalledTimes(3);
  });

  it('refuses an unparseable token before taking the meta write lock', async () => {
    // This is the specific harm: `atomicMetaUpdate` serializes against the
    // reset-token writes of real users, so garbage must be rejected ahead of it.
    const { app, dataStore } = buildResetApp({ resetTokenLimiterMax: 50 });

    await withServer(app, async (call) => {
      for (const token of ['garbage', VALID_TOKEN.slice(0, 10), `${VALID_TOKEN}00`]) {
        const response = await call('/api/password-reset/confirm', postJson({
          token,
          newPassword: 'hunter2-longer'
        }));

        // Byte-for-byte the answer an unknown token already produced.
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'invalid_or_expired_token' });
      }
    });

    expect(dataStore.atomicMetaUpdate).not.toHaveBeenCalled();
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
  });

  it('still resets the password for a well-formed live token', async () => {
    const { app, dataStore } = buildResetApp();

    await withServer(app, async (call) => {
      const response = await call('/api/password-reset/confirm', postJson({
        token: VALID_TOKEN,
        newPassword: 'hunter2-longer'
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, teamName: 'Team One' });
    });

    expect(dataStore.atomicTeamUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/team/exists/:teamName — anonymous index reads', () => {
  it('stops calling the store once the per-IP cap is reached', async () => {
    const { app, loadTeamIndex } = buildTeamApp({ teamReadLimiterMax: 3 });

    await withServer(app, async (call) => {
      for (let i = 0; i < 3; i += 1) {
        const allowed = await call('/api/team/exists/Team%20One');
        expect(allowed.status).toBe(200);
        expect(await allowed.json()).toEqual({ exists: true });
      }

      expect((await call('/api/team/exists/Team%20One')).status).toBe(429);
    });

    expect(loadTeamIndex).toHaveBeenCalledTimes(3);
  });

  it('shares the read budget with the other anonymous team reads', async () => {
    // `/api/team/list` is the sibling this endpoint is now consistent with:
    // both are unauthenticated index reads, so they draw on one budget an
    // attacker cannot double by alternating.
    const { app } = buildTeamApp({ teamReadLimiterMax: 2 });

    await withServer(app, async (call) => {
      expect((await call('/api/team/exists/Team%20One')).status).toBe(200);
      expect((await call('/api/team/list')).status).toBe(200);

      expect((await call('/api/team/exists/Team%20One')).status).toBe(429);
    });
  });
});

// Derived from the router rather than restated by hand: a hand-written list
// cannot fail when someone adds a new store-backed public GET *without* a
// limiter, which is the regression this suite exists to catch.
const listPublicGetRoutes = (): string[] => {
  const { app } = buildPublicApp();
  const router = (app as unknown as {
    router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  }).router;

  return (router?.stack ?? [])
    .map((layer) => layer.route)
    .filter((route): route is { path: string; methods: Record<string, boolean> } =>
      Boolean(route?.methods?.get))
    .map((route) => route.path);
};

// The one public GET that touches no data store: `/api/data`, a constant 410.
// It cannot be amplified into database work, so metering it would only risk
// locking a shared office IP out.
//
// `/api/wifi-config` used to be the second entry here. H31 made it an
// authenticated POST, so it is no longer a public GET at all — and it is now
// metered, because authenticating gave it the store read it previously lacked.
// Its coverage lives in `wifiConfigAuthorization.test.ts`.
const UNMETERED_PUBLIC_GETS = ['/api/data'];
const PUBLIC_GET_ROUTES = listPublicGetRoutes();
const METERED_PUBLIC_GETS = PUBLIC_GET_ROUTES.filter((path) => !UNMETERED_PUBLIC_GETS.includes(path));

describe('public GETs — anonymous settings reads', () => {
  it('derives the inventory from the router, and accounts for every exception', () => {
    // Guards the derivation itself: if the router shape changes, the list must
    // not silently collapse and make the assertions below vacuous.
    expect(PUBLIC_GET_ROUTES.length).toBeGreaterThanOrEqual(3);
    // The Wi-Fi route must not drift back to an anonymous GET (H31).
    expect(PUBLIC_GET_ROUTES).not.toContain('/api/wifi-config');
    for (const path of UNMETERED_PUBLIC_GETS) {
      expect(PUBLIC_GET_ROUTES).toContain(path);
    }
    expect(METERED_PUBLIC_GETS).toHaveLength(PUBLIC_GET_ROUTES.length - UNMETERED_PUBLIC_GETS.length);
  });

  it.each(METERED_PUBLIC_GETS)('rate-limits %s before it reaches the store', async (path) => {
    const { app, loadGlobalSettings } = buildPublicApp({ publicReadLimiterMax: 2 });

    await withServer(app, async (call) => {
      expect((await call(path)).status).toBe(200);
      expect((await call(path)).status).toBe(200);

      expect((await call(path)).status).toBe(429);
    });

    expect(loadGlobalSettings).toHaveBeenCalledTimes(2);
  });

  it('shares one budget across the settings-backed GETs', async () => {
    // They read the same record, so an attacker must not be able to double the
    // budget by alternating between them.
    const { app, loadGlobalSettings } = buildPublicApp({ publicReadLimiterMax: 2 });

    await withServer(app, async (call) => {
      expect((await call('/api/info-message')).status).toBe(200);
      expect((await call('/api/ai-status')).status).toBe(200);

      expect((await call('/api/info-message')).status).toBe(429);
      expect((await call('/api/ai-status')).status).toBe(429);
    });

    expect(loadGlobalSettings).toHaveBeenCalledTimes(2);
  });

  it.each(UNMETERED_PUBLIC_GETS)('leaves %s unmetered — it does no store work', async (path) => {
    const { app } = buildPublicApp({ publicReadLimiterMax: 1 });

    await withServer(app, async (call) => {
      for (let i = 0; i < 6; i += 1) {
        expect((await call(path)).status).not.toBe(429);
      }
    });
  });
});

describe('production limiter defaults', () => {
  it('keeps the reset-token cap above a real reset flow but bounded', async () => {
    // A real user verifies once and confirms once. 20 per 15 minutes leaves
    // room for page reloads and a few colleagues sharing the egress IP, while
    // still bounding an anonymous prober.
    const { app } = buildResetApp();

    await withServer(app, async (call) => {
      for (let i = 0; i < 20; i += 1) {
        const response = await call('/api/password-reset/verify', postJson({ token: VALID_TOKEN }));
        expect(response.status).toBe(200);
      }

      expect((await call('/api/password-reset/verify', postJson({ token: VALID_TOKEN }))).status).toBe(429);
    });
  });

  it('keeps the public-read cap far above a login rush from one office', async () => {
    // These fire once per component mount, so a whole floor arriving at 09:00
    // behind one NAT address must not exhaust the budget. Asserting a floor
    // rather than the exact number: the guard is against a drift downwards
    // into range of real traffic.
    const { app } = buildPublicApp();

    await withServer(app, async (call) => {
      for (let i = 0; i < 200; i += 1) {
        expect((await call('/api/info-message')).status).toBe(200);
      }
    });
  });
});
