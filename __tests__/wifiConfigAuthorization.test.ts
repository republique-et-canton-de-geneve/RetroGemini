import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';
import { postJson, request, withServer } from './helpers/routeTestServer';

/**
 * H31 — `/api/wifi-config` handed the Wi-Fi password to any anonymous caller.
 *
 * The route returned `{ ssid, password }` with no credential and no meter. Its
 * only consumer, `InviteModal`, is reachable only after team login, so the value
 * was never needed anonymously.
 *
 * The maintainer chose option (b): require a team credential. The argument that
 * settled it is that "already on the internal network" is not the same set of
 * people as "already on that Wi-Fi" — a wired or VPN user reaches the app
 * without it — so an open endpoint let anyone inside the perimeter harvest a
 * credential that is otherwise shared deliberately, in a room, on a QR code.
 *
 * It is a POST because that is this codebase's idiom for an authenticated read
 * (`/api/team/:teamId` fetches state the same way): the team credential travels
 * in the body, never in a URL that proxies and access logs would keep.
 *
 * Authenticating it also gives it a store read it did not have before — the team
 * lookup — so it is metered like the other team-credential routes, scoped to
 * 401s alone so no real facilitator can trip it.
 */

const VALID_TOKEN = 'rg1.valid-team-session-token';

const buildApp = (options: { ssid?: string; password?: string; limiterMax?: number } = {}) => {
  const { ssid = 'Office-Guest', password = 'hunter2-wifi', limiterMax } = options;
  const app = express();

  const authenticateTeam = vi.fn(async (teamId: string, teamPassword?: string, sessionToken?: string) => {
    if (teamId !== 'team-1') {
      return { team: null, error: 'team_not_found' };
    }
    if (sessionToken === VALID_TOKEN || teamPassword === 'correct-horse') {
      return { team: { id: teamId, name: 'Platform Team' }, error: null };
    }
    return { team: null, error: 'invalid_password' };
  });

  const previous = { ssid: process.env.WIFI_SSID, password: process.env.WIFI_PASSWORD };
  if (ssid === '') delete process.env.WIFI_SSID; else process.env.WIFI_SSID = ssid;
  if (password === '') delete process.env.WIFI_PASSWORD; else process.env.WIFI_PASSWORD = password;

  app.use(express.json());
  registerPublicRoutes({
    app,
    dataStore: { loadGlobalSettings: vi.fn() },
    teamService: { authenticateTeam },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => String(value ?? ''),
    sanitizeEmailLink: (value: string) => value,
    ...(limiterMax === undefined ? {} : { wifiConfigLimiterMax: limiterMax })
  });

  const restoreEnv = () => {
    if (previous.ssid === undefined) delete process.env.WIFI_SSID; else process.env.WIFI_SSID = previous.ssid;
    if (previous.password === undefined) delete process.env.WIFI_PASSWORD; else process.env.WIFI_PASSWORD = previous.password;
  };

  return { app, authenticateTeam, restoreEnv };
};

const withTeamAuth = (body: Record<string, unknown> = {}) => ({
  teamId: 'team-1',
  sessionToken: VALID_TOKEN,
  ...body
});

describe('POST /api/wifi-config authorization (H31)', () => {
  it('refuses an anonymous request and discloses no credential', async () => {
    const { app, restoreEnv } = buildApp();
    try {
      const response = await request(app, '/api/wifi-config', postJson({}));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
    } finally {
      restoreEnv();
    }
  });

  it('never puts the password in a refused response', async () => {
    const { app, restoreEnv } = buildApp();
    try {
      const refused = await request(app, '/api/wifi-config', postJson({ teamId: 'team-1', sessionToken: 'rg1.forged' }));
      const raw = await refused.text();

      expect(refused.status).toBe(401);
      expect(raw).not.toContain('hunter2-wifi');
      expect(raw).not.toContain('Office-Guest');
    } finally {
      restoreEnv();
    }
  });

  it('answers an unknown team exactly as it answers a wrong credential', async () => {
    const { app, restoreEnv } = buildApp();
    try {
      const wrongCredential = await request(app, '/api/wifi-config', postJson({ teamId: 'team-1', sessionToken: 'rg1.forged' }));
      const unknownTeam = await request(app, '/api/wifi-config', postJson({ teamId: 'nope', sessionToken: VALID_TOKEN }));

      expect(wrongCredential.status).toBe(401);
      expect(unknownTeam.status).toBe(401);
      expect(await wrongCredential.json()).toEqual(await unknownTeam.json());
    } finally {
      restoreEnv();
    }
  });

  it('still serves the configuration to an authenticated team', async () => {
    const { app, restoreEnv } = buildApp();
    try {
      const response = await request(app, '/api/wifi-config', postJson(withTeamAuth()));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ssid: 'Office-Guest', password: 'hunter2-wifi' });
    } finally {
      restoreEnv();
    }
  });

  it('accepts the team password as an alternative credential', async () => {
    const { app, restoreEnv } = buildApp();
    try {
      const response = await request(app, '/api/wifi-config', postJson({ teamId: 'team-1', password: 'correct-horse' }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ssid: 'Office-Guest' });
    } finally {
      restoreEnv();
    }
  });

  it('still answers 404 when the deployment configured no Wi-Fi', async () => {
    // The unconfigured answer must stay behind the credential too: otherwise the
    // route reports whether a Wi-Fi is configured to anyone who asks.
    const { app, restoreEnv } = buildApp({ ssid: '', password: '' });
    try {
      const authenticated = await request(app, '/api/wifi-config', postJson(withTeamAuth()));
      const anonymous = await request(app, '/api/wifi-config', postJson({}));

      expect(authenticated.status).toBe(404);
      expect(await authenticated.json()).toEqual({ error: 'wifi_not_configured' });
      expect(anonymous.status).toBe(401);
    } finally {
      restoreEnv();
    }
  });

  it('authenticates before reading the configuration, so an anonymous caller learns nothing', async () => {
    const { app, authenticateTeam, restoreEnv } = buildApp({ ssid: '', password: '' });
    try {
      const configured = await request(app, '/api/wifi-config', postJson({}));
      expect(configured.status).toBe(401);
      // The credential check is what answered, not the configuration check.
      expect(authenticateTeam).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });

  it('meters rejected credentials only, so a team reopening the invite modal is never blocked', async () => {
    const { app, restoreEnv } = buildApp({ limiterMax: 2 });
    try {
      const statuses = await withServer(app, async (call) => {
        const results: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          const response = await call('/api/wifi-config', postJson(withTeamAuth()));
          results.push(response.status);
        }
        return results;
      });

      expect(statuses).toEqual([200, 200, 200, 200, 200]);
    } finally {
      restoreEnv();
    }
  });

  it('bounds an anonymous prober', async () => {
    const { app, restoreEnv } = buildApp({ limiterMax: 2 });
    try {
      const statuses = await withServer(app, async (call) => {
        const results: number[] = [];
        for (let i = 0; i < 4; i += 1) {
          const response = await call('/api/wifi-config', postJson({ teamId: 'team-1', sessionToken: 'rg1.forged' }));
          results.push(response.status);
        }
        return results;
      });

      expect(statuses).toEqual([401, 401, 429, 429]);
    } finally {
      restoreEnv();
    }
  });
});
