import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createPublicOriginResolver } from '../server/services/publicOrigin.js';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';
import { registerPasswordResetRoutes } from '../server/routes/passwordResetRoutes.js';

/**
 * Audit H4 / decision D3 — a mailed link may only point at this deployment.
 *
 * Both mail routes took the whole link from the request body and checked its
 * *protocol* only, so a caller could name any host. On `/api/send-password-reset`
 * that is account takeover: the attacker names their own host, the server appends
 * a **live reset token** and mails the result to the real facilitator from the
 * deployment's own SMTP identity. `/api/send-invite` is authenticated (H3) but
 * still let any team session mail a foreign-host phishing link.
 *
 * The origin now comes from the server — `PUBLIC_BASE_URL` when configured,
 * otherwise the request's own protocol + Host — and only the path/query survive
 * from the caller. That reproduces today's result for every legitimate caller
 * (the client sends `window.location.origin`, which *is* the request Host) and
 * changes only what an attacker can do.
 */

// Assembled rather than written as a literal, following the precedent in
// `serverSecurity.test.ts`: ESLint's `no-script-url` rejects a literal
// `javascript:` URL, and a suppression comment reads worse in a security test.
const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

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

type MailCall = { to: string; text: string; html: string };

// Typed with its argument so `sendMail.mock.calls[0][0]` is a MailCall rather
// than an element of an empty tuple, which `tsc` rejects outright.
const mailSpy = () => vi.fn(async (_mail: MailCall): Promise<void> => undefined);
type MailSpy = ReturnType<typeof mailSpy>;

const resetApp = (sendMail: MailSpy, env: Record<string, string> = {}) => {
  const app = express();
  app.use(express.json());
  registerPasswordResetRoutes({
    app,
    dataStore: {
      loadTeamIndex: vi.fn(async () => new Map([['team', 'team-1']])),
      loadTeam: vi.fn(async () => ({ id: 'team-1', name: 'Team', facilitatorEmail: 'lead@example.test' })),
      atomicMetaUpdate: vi.fn(async (updater: (meta: Record<string, unknown>) => unknown) => {
        updater({ resetTokens: [] });
        return { success: true };
      }),
    },
    mailerService: { smtpEnabled: true, mailer: { sendMail } },
    escapeHtml: (value: string) => value,
    sanitizeEmailLink: (value: string) => value,
    hashResetToken: (token: string) => `hash:${token}`,
    pruneResetTokens: (tokens: unknown[]) => tokens ?? [],
    publicOrigin: createPublicOriginResolver({ env }),
  });
  return app;
};

const inviteApp = (sendMail: MailSpy, env: Record<string, string> = {}) => {
  const app = express();
  app.use(express.json());
  registerPublicRoutes({
    app,
    dataStore: { loadGlobalSettings: vi.fn() },
    teamService: {
      authenticateTeam: vi.fn(async (teamId: string) => ({ team: { id: teamId, name: 'Team' }, error: null })),
    },
    mailerService: { smtpEnabled: true, mailer: { sendMail } },
    logService: { addServerLog: vi.fn() },
    escapeHtml: (value: string) => value,
    sanitizeEmailLink: (value: string) => value,
    resolveEmailLink: createPublicOriginResolver({ env }).resolveEmailLink,
  });
  return app;
};

const sendReset = (app: express.Express, resetBaseUrl: string) =>
  request(app, '/api/send-password-reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'lead@example.test', teamName: 'Team', resetBaseUrl }),
  });

const sendInvite = (app: express.Express, link: string) =>
  request(app, '/api/send-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: 'team-1', sessionToken: 'rg1.valid', email: 'guest@example.test', link }),
  });

describe('publicOrigin resolver (audit H4 / decision D3)', () => {
  const req = (host = 'retro.example.test', protocol = 'https') =>
    ({ protocol, get: (header: string) => (header.toLowerCase() === 'host' ? host : undefined) });

  it('keeps a link that already points at the request host untouched', () => {
    const { resolveEmailLink } = createPublicOriginResolver({ env: {} });

    expect(resolveEmailLink(req(), 'https://retro.example.test/?join=abc')).toBe(
      'https://retro.example.test/?join=abc',
    );
  });

  it('rewrites a foreign host onto the request origin, keeping path and query', () => {
    const { resolveEmailLink } = createPublicOriginResolver({ env: {} });

    expect(resolveEmailLink(req(), 'https://evil.example/steal?join=abc')).toBe(
      'https://retro.example.test/steal?join=abc',
    );
  });

  it('prefers PUBLIC_BASE_URL over the request Host, so a spoofed Host cannot redirect a link', () => {
    const { resolveEmailLink } = createPublicOriginResolver({
      env: { PUBLIC_BASE_URL: 'https://retro.example.test/' },
    });

    expect(resolveEmailLink(req('evil.example'), 'https://evil.example/?join=abc')).toBe(
      'https://retro.example.test/?join=abc',
    );
  });

  it('keeps a configured sub-path prefix and takes only the query from the caller', () => {
    // An operator who configures `https://host/app/` has declared the canonical
    // location: the caller's path must not be able to move the link out of it.
    const { resolveEmailLink } = createPublicOriginResolver({
      env: { PUBLIC_BASE_URL: 'https://retro.example.test/app/' },
    });

    expect(resolveEmailLink(req(), 'https://retro.example.test/elsewhere?join=abc')).toBe(
      'https://retro.example.test/app/?join=abc',
    );
  });

  it('cannot be tricked into another host by a protocol-relative path', () => {
    // `new URL('//evil.example/x', base)` resolves to evil.example — so the path
    // must be *assigned* to a URL built from the trusted origin, never resolved
    // relative to it. The host is the security property; the path riding along
    // is harmless, but its leading slashes are collapsed so the mailed string
    // cannot *read* as a link to another host.
    const { resolveEmailLink } = createPublicOriginResolver({ env: {} });
    const resolved = resolveEmailLink(req(), 'https://evil.example//evil.example/x');

    expect(new URL(resolved).host).toBe('retro.example.test');
    expect(resolved).toBe('https://retro.example.test/evil.example/x');
  });

  it('refuses a non-http(s) link and a link it cannot parse', () => {
    const { resolveEmailLink } = createPublicOriginResolver({ env: {} });

    expect(resolveEmailLink(req(), SCRIPT_URL)).toBe('');
    expect(resolveEmailLink(req(), 'not a url')).toBe('');
    expect(resolveEmailLink(req(), '')).toBe('');
  });

  it('refuses everything when there is no configured base and no Host header', () => {
    const { resolveEmailLink } = createPublicOriginResolver({ env: {} });
    const hostless = { protocol: 'https', get: () => undefined };

    expect(resolveEmailLink(hostless, 'https://retro.example.test/?join=abc')).toBe('');
  });

  it('ignores a PUBLIC_BASE_URL that is not a usable http(s) URL', () => {
    const { resolveEmailLink } = createPublicOriginResolver({
      env: { PUBLIC_BASE_URL: SCRIPT_URL },
    });

    expect(resolveEmailLink(req(), 'https://evil.example/?join=abc')).toBe(
      'https://retro.example.test/?join=abc',
    );
  });
});

const CONFIGURED = { PUBLIC_BASE_URL: 'https://retro.example.test/' };

describe('/api/send-password-reset link host (audit H4)', () => {
  it('refuses to mail anything when no canonical origin is configured', async () => {
    // Raised by the Codex reviewer on PR #405, and correct: an anonymous caller
    // controls the `Host` header too, so an edge that forwards an arbitrary one
    // would put the live token back on a host the attacker picked. This route
    // mails a credential to someone who did not ask for it, so it is the one
    // place that must fail closed rather than trust the request.
    const sendMail = mailSpy();
    const response = await sendReset(resetApp(sendMail), 'https://evil.example/');

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'public_base_url_not_configured' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never mails a reset token to a foreign host', async () => {
    const sendMail = mailSpy();
    const response = await sendReset(resetApp(sendMail, CONFIGURED), 'https://evil.example/');

    expect(response.status).toBe(204);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.text).not.toContain('evil.example');
    expect(mail.html).not.toContain('evil.example');
    expect(mail.text).toContain('https://retro.example.test/');
  });

  it('ignores a spoofed Host entirely, because the configured origin wins', async () => {
    const sendMail = mailSpy();
    const app = resetApp(sendMail, CONFIGURED);

    const response = await request(app, '/api/send-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'attacker.example' },
      body: JSON.stringify({ email: 'lead@example.test', teamName: 'Team', resetBaseUrl: 'https://retro.example.test/' }),
    });

    expect(response.status).toBe(204);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.text).not.toContain('attacker.example');
    expect(mail.text).toContain('https://retro.example.test/?reset=');
  });

  it('mails the configured public base URL when one is set', async () => {
    const sendMail = mailSpy();
    const app = resetApp(sendMail, { PUBLIC_BASE_URL: 'https://retro.example.test/' });

    const response = await sendReset(app, 'https://evil.example/');

    expect(response.status).toBe(204);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.text).toContain('https://retro.example.test/?reset=');
    expect(mail.text).not.toContain('evil.example');
  });

  it('still carries a usable reset token after the rewrite', async () => {
    const sendMail = mailSpy();
    const app = resetApp(sendMail, { PUBLIC_BASE_URL: 'https://retro.example.test/' });

    await sendReset(app, 'https://retro.example.test/');

    const mail = sendMail.mock.calls[0][0];
    expect(mail.text).toMatch(/[?&]reset=[0-9a-f]{64}/);
  });
});

describe('/api/send-invite link host (audit H4, second half)', () => {
  it('never mails an invite pointing at a foreign host', async () => {
    const sendMail = mailSpy();
    const response = await sendInvite(inviteApp(sendMail), 'https://evil.example/?join=payload');

    expect(response.status).toBe(204);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.text).not.toContain('evil.example');
    expect(mail.html).not.toContain('evil.example');
  });

  it('preserves the join payload while replacing the host', async () => {
    const sendMail = mailSpy();
    const app = inviteApp(sendMail, { PUBLIC_BASE_URL: 'https://retro.example.test/' });

    await sendInvite(app, 'https://evil.example/?join=payload');

    const mail = sendMail.mock.calls[0][0];
    expect(mail.text).toContain('https://retro.example.test/?join=payload');
  });

  it('rejects an invite link that is not an http(s) URL before mailing anything', async () => {
    const sendMail = mailSpy();
    const response = await sendInvite(inviteApp(sendMail), SCRIPT_URL);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_link' });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
