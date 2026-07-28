import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';

/**
 * Audit H3 — `/api/send-invite` was an unauthenticated mail relay.
 *
 * Recipient, link, name, team name and session name were all caller-controlled
 * and mail went out through the deployment's SMTP identity with no credential
 * of any kind. Anyone who could reach the server could pump phishing mail that
 * passes the organisation's SPF/DKIM.
 *
 * The fix keeps the product constraint that made the endpoint open in the first
 * place — facilitators must be able to invite a whole group in one batch — by
 * requiring the team credential the client already holds and metering per team
 * instead of per IP.
 */

const request = async (app: express.Express, path: string, init: Parameters<typeof fetch>[1] = {}) => {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
};

const VALID_TOKEN = 'rg1.valid-team-session-token';

type Harness = {
  app: express.Express;
  sendMail: ReturnType<typeof vi.fn>;
  authenticateTeam: ReturnType<typeof vi.fn>;
  addServerLog: ReturnType<typeof vi.fn>;
};

const buildApp = (options: { inviteQuotaMax?: number } = {}): Harness => {
  const app = express();
  const sendMail = vi.fn(async () => undefined);
  const addServerLog = vi.fn();

  // Mirrors `teamService.authenticateTeam`: either credential authenticates,
  // and the token must be minted for the exact team being addressed.
  const authenticateTeam = vi.fn(async (teamId: string, password?: string, sessionToken?: string) => {
    if (teamId !== 'team-1' && teamId !== 'team-2') {
      return { team: null, error: 'team_not_found' };
    }
    if (sessionToken === `${VALID_TOKEN}.${teamId}` || password === 'correct-horse') {
      return { team: { id: teamId, name: `Team ${teamId}` }, error: null };
    }
    return { team: null, error: 'invalid_password' };
  });

  app.use(express.json());
  registerPublicRoutes({
    app,
    dataStore: { loadGlobalSettings: vi.fn() },
    teamService: { authenticateTeam },
    mailerService: { smtpEnabled: true, mailer: { sendMail } },
    logService: { addServerLog },
    escapeHtml: (value: string) => value,
    sanitizeEmailLink: (value: string) => value,
    ...options
  });

  return { app, sendMail, authenticateTeam, addServerLog };
};

const invite = (
  app: express.Express,
  body: Record<string, unknown>
) => request(app, '/api/send-invite', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

const validInvite = (teamId = 'team-1', email = 'alice@corp') => ({
  teamId,
  sessionToken: `${VALID_TOKEN}.${teamId}`,
  email,
  name: 'Alice',
  link: 'https://retro.example/join/abc',
  teamName: `Team ${teamId}`
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/send-invite authentication', () => {
  it('rejects a request carrying no credential at all and sends no mail', async () => {
    const { app, sendMail, authenticateTeam } = buildApp();

    const response = await invite(app, {
      email: 'victim@corp',
      link: 'https://evil.example/phish',
      teamName: 'Finance'
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(sendMail).not.toHaveBeenCalled();
    // No credential means no reason to touch the data store at all.
    expect(authenticateTeam).not.toHaveBeenCalled();
  });

  it('rejects a request naming a team but holding no credential', async () => {
    const { app, sendMail, authenticateTeam } = buildApp();

    const response = await invite(app, {
      teamId: 'team-1',
      email: 'victim@corp',
      link: 'https://evil.example/phish'
    });

    expect(response.status).toBe(401);
    expect(sendMail).not.toHaveBeenCalled();
    expect(authenticateTeam).not.toHaveBeenCalled();
  });

  it('rejects a credential that does not authenticate for the named team', async () => {
    const { app, sendMail } = buildApp();

    const response = await invite(app, {
      ...validInvite('team-1'),
      sessionToken: 'rg1.forged-token'
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not distinguish an unknown team from a wrong credential', async () => {
    // Both answer 401 `unauthenticated`, so the endpoint cannot be used to
    // enumerate team ids.
    const { app } = buildApp();

    const unknownTeam = await invite(app, { ...validInvite('team-1'), teamId: 'team-nope' });
    const wrongCredential = await invite(app, { ...validInvite('team-1'), sessionToken: 'rg1.nope' });

    expect(unknownTeam.status).toBe(401);
    expect(wrongCredential.status).toBe(401);
    expect(await unknownTeam.json()).toEqual(await wrongCredential.json());
  });

  it('sends the invite for a valid team session token', async () => {
    const { app, sendMail, authenticateTeam } = buildApp();

    const response = await invite(app, validInvite('team-1'));

    expect(response.status).toBe(204);
    expect(authenticateTeam).toHaveBeenCalledWith('team-1', undefined, `${VALID_TOKEN}.team-1`);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@corp' }));
  });

  it('accepts the team password as an alternative credential', async () => {
    const { app, sendMail } = buildApp();

    const response = await invite(app, {
      teamId: 'team-1',
      password: 'correct-horse',
      email: 'alice@corp',
      link: 'https://retro.example/join/abc'
    });

    expect(response.status).toBe(204);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('validates the payload only after the caller is authenticated', async () => {
    // An anonymous caller must not be able to probe the endpoint's validation
    // behaviour — every unauthenticated request looks the same.
    const { app, sendMail } = buildApp();

    const response = await invite(app, { email: 'not-an-email', link: 'https://retro.example/x' });

    expect(response.status).toBe(401);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('mails the authenticated team name, not the caller-supplied one', async () => {
    // Otherwise an authenticated member of one team could send mail that
    // claims to come from another team.
    const { app, sendMail } = buildApp();

    await invite(app, { ...validInvite('team-1'), teamName: 'Executive Board' });

    const [[mail]] = sendMail.mock.calls as unknown as [[{ subject: string; html: string; text: string }]];
    expect(mail.subject).toContain('Team team-1');
    expect(mail.subject).not.toContain('Executive Board');
    expect(mail.html).not.toContain('Executive Board');
    expect(mail.text).not.toContain('Executive Board');
  });
});

describe('/api/send-invite per-team quota', () => {
  it('still allows a realistic facilitator bulk invite in one batch', async () => {
    const { app, sendMail } = buildApp();

    const responses = await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        invite(app, validInvite('team-1', `person-${index}@corp`)))
    );

    expect(responses.every((response) => response.status === 204)).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(101);
  });

  it('stops a team that blows past its quota', async () => {
    const { app, sendMail, addServerLog } = buildApp({ inviteQuotaMax: 3 });

    for (let i = 0; i < 3; i += 1) {
      const allowed = await invite(app, validInvite('team-1', `person-${i}@corp`));
      expect(allowed.status).toBe(204);
    }

    const blocked = await invite(app, validInvite('team-1', 'one-too-many@corp'));

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'invite_quota_exceeded', retryAfter: '1 hour' });
    expect(sendMail).toHaveBeenCalledTimes(3);
    // Operators need to see this: a team hitting the cap is either running a
    // very large session or has a leaked password being used as a relay.
    expect(addServerLog).toHaveBeenCalledWith('warn', 'email', expect.stringContaining('team-1'));
  });

  it('meters per team, so one team cannot lock out another', async () => {
    // This is the whole point of choosing a per-team quota over a per-IP
    // limiter: every facilitator shares the office egress IP.
    const { app, sendMail } = buildApp({ inviteQuotaMax: 2 });

    await invite(app, validInvite('team-1', 'a@corp'));
    await invite(app, validInvite('team-1', 'b@corp'));
    const exhausted = await invite(app, validInvite('team-1', 'c@corp'));

    const otherTeam = await invite(app, validInvite('team-2', 'd@corp'));

    expect(exhausted.status).toBe(429);
    expect(otherTeam.status).toBe(204);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('does not consume quota for a request that fails authentication', async () => {
    const { app, sendMail } = buildApp({ inviteQuotaMax: 2 });

    for (let i = 0; i < 5; i += 1) {
      await invite(app, { ...validInvite('team-1'), sessionToken: 'rg1.forged' });
    }

    const allowed = await invite(app, validInvite('team-1', 'real@corp'));

    expect(allowed.status).toBe(204);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
