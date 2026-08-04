import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';
import { postJson, request, withServer } from './helpers/routeTestServer';

/**
 * H29 — `/api/notify-new-feedback` was the second unauthenticated mail relay.
 *
 * H3 closed `/api/send-invite` because it mailed caller-supplied content through
 * the deployment's SMTP identity with no credential. This route did exactly the
 * same thing and was not looked at: it takes a whole `feedback` object from the
 * request body — title, description, team name, submitter name, image count —
 * renders it into an HTML mail and sends it to the address the super admin
 * configured, signed by the organisation's own SPF/DKIM. No credential of any
 * kind was required, and the client that legitimately calls it (Dashboard.tsx,
 * fire-and-forget after `/api/feedbacks/create`) already holds one.
 *
 * Two distinct defects, both fixed here:
 *
 *  1. **Anonymous send.** Anyone able to reach the deployment could put chosen
 *     text in the administrator's inbox, from the administrator's own domain,
 *     under the subject line of a product they trust. `/api/feedbacks/create`
 *     right beside it authenticates; only the notification did not.
 *  2. **Spoofable attribution.** The mail's `Team:` line came from the body, so
 *     even a member of team A could file a report the admin reads as team B's.
 *     Same rule as H4/H3: the team name comes from the authenticated record.
 *
 * The meter is scoped to 401s alone (the H20 lesson, and the idiom already used
 * by `/api/send-invite`): a team that files many bug reports in an afternoon —
 * an entire office shares one egress address here — must never be metered, while
 * the anonymous prober driving data-store reads still is.
 */

const VALID_TOKEN = 'rg1.valid-team-session-token';

const buildApp = (options: { smtp?: boolean; adminEmail?: string | null; limiterMax?: number } = {}) => {
  const { smtp = true, adminEmail = 'admin@example.test', limiterMax } = options;
  const app = express();
  const sendMail = vi.fn(async (_mail: Record<string, unknown>) => undefined);
  const addServerLog = vi.fn();
  const loadGlobalSettings = vi.fn(async () => ({ adminEmail }));

  // Mirrors `teamService.authenticateTeam`: either credential authenticates and
  // the token must be minted for the exact team being addressed.
  const authenticateTeam = vi.fn(async (teamId: string, password?: string, sessionToken?: string) => {
    if (teamId !== 'team-1' && teamId !== 'team-2') {
      return { team: null, error: 'team_not_found' };
    }
    if (sessionToken === `${VALID_TOKEN}.${teamId}` || password === 'correct-horse') {
      return { team: { id: teamId, name: teamId === 'team-1' ? 'Platform Team' : 'Payments Team' }, error: null };
    }
    return { team: null, error: 'invalid_password' };
  });

  app.use(express.json());
  registerPublicRoutes({
    app,
    dataStore: { loadGlobalSettings },
    teamService: { authenticateTeam },
    mailerService: smtp ? { smtpEnabled: true, mailer: { sendMail } } : { smtpEnabled: false, mailer: null },
    logService: { addServerLog },
    escapeHtml: (value: string) => String(value ?? ''),
    sanitizeEmailLink: (value: string) => value,
    ...(limiterMax === undefined ? {} : { feedbackNotificationLimiterMax: limiterMax })
  });

  return { app, sendMail, addServerLog, loadGlobalSettings, authenticateTeam };
};

const feedback = (overrides: Record<string, unknown> = {}) => ({
  id: 'fb-1',
  title: 'Timer stops at 00:00',
  description: 'The retro timer freezes on the last second.',
  type: 'bug',
  teamName: 'Platform Team',
  submittedByName: 'Alex',
  submittedAt: '2026-08-04T09:00:00.000Z',
  ...overrides
});

const withTeamAuth = (body: Record<string, unknown>) => ({
  teamId: 'team-1',
  sessionToken: `${VALID_TOKEN}.team-1`,
  ...body
});

describe('POST /api/notify-new-feedback authorization (H29)', () => {
  it('refuses an anonymous notification and mails nothing', async () => {
    const { app, sendMail, loadGlobalSettings } = buildApp();

    const response = await request(app, '/api/notify-new-feedback', postJson({ feedback: feedback() }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(sendMail).not.toHaveBeenCalled();
    // The credential check comes before the data-store read, so an anonymous
    // caller drives no work beyond one team lookup (audit H5).
    expect(loadGlobalSettings).not.toHaveBeenCalled();
  });

  it('refuses a wrong credential with the same opaque answer as an unknown team', async () => {
    const { app, sendMail } = buildApp();

    const wrongCredential = await request(app, '/api/notify-new-feedback', postJson({
      teamId: 'team-1',
      sessionToken: 'rg1.forged',
      feedback: feedback()
    }));
    const unknownTeam = await request(app, '/api/notify-new-feedback', postJson({
      teamId: 'team-does-not-exist',
      sessionToken: `${VALID_TOKEN}.team-does-not-exist`,
      feedback: feedback()
    }));

    expect(wrongCredential.status).toBe(401);
    expect(unknownTeam.status).toBe(401);
    // Identical bodies, so the route cannot be used to enumerate team ids.
    expect(await wrongCredential.json()).toEqual(await unknownTeam.json());
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('authenticates before disclosing whether the deployment can send mail', async () => {
    // With no SMTP the route answers 204 to an authenticated caller. An
    // anonymous one must not be able to tell that apart from a configured
    // deployment: both are 401 (the H3 ordering rule).
    const { app: withoutSmtp } = buildApp({ smtp: false });
    const { app: withSmtp } = buildApp({ smtp: true });

    const anonymousNoSmtp = await request(withoutSmtp, '/api/notify-new-feedback', postJson({ feedback: feedback() }));
    const anonymousSmtp = await request(withSmtp, '/api/notify-new-feedback', postJson({ feedback: feedback() }));

    expect(anonymousNoSmtp.status).toBe(401);
    expect(anonymousSmtp.status).toBe(401);
    expect(await anonymousNoSmtp.json()).toEqual(await anonymousSmtp.json());
  });

  it('attributes the report to the authenticated team, not the body', async () => {
    const { app, sendMail } = buildApp();

    const response = await request(app, '/api/notify-new-feedback', postJson(withTeamAuth({
      feedback: feedback({ teamName: 'Payments Team' })
    })));

    expect(response.status).toBe(204);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0] as { text: string; html: string };
    expect(mail.text).toContain('Team: Platform Team');
    expect(mail.text).not.toContain('Payments Team');
    expect(mail.html).toContain('Platform Team');
    expect(mail.html).not.toContain('Payments Team');
  });

  it('still notifies the admin for a legitimate authenticated report', async () => {
    const { app, sendMail, addServerLog } = buildApp();

    const response = await request(app, '/api/notify-new-feedback', postJson(withTeamAuth({
      feedback: feedback()
    })));

    expect(response.status).toBe(204);
    const mail = sendMail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(mail.to).toBe('admin@example.test');
    expect(mail.subject).toContain('Timer stops at 00:00');
    expect(mail.text).toContain('The retro timer freezes on the last second.');
    expect(addServerLog).toHaveBeenCalledWith('info', 'email', expect.stringContaining('admin@example.test'));
  });

  it('accepts the team password as an alternative credential', async () => {
    const { app, sendMail } = buildApp();

    const response = await request(app, '/api/notify-new-feedback', postJson({
      teamId: 'team-2',
      password: 'correct-horse',
      feedback: feedback()
    }));

    expect(response.status).toBe(204);
    const mail = sendMail.mock.calls[0][0] as { text: string };
    expect(mail.text).toContain('Team: Payments Team');
  });

  it('keeps rejecting a malformed feedback body once authenticated', async () => {
    const { app, sendMail, loadGlobalSettings } = buildApp();

    const badType = await request(app, '/api/notify-new-feedback', postJson(withTeamAuth({
      feedback: feedback({ type: 'unsupported' })
    })));

    expect(badType.status).toBe(400);
    expect(await badType.json()).toEqual({ error: 'invalid_feedback_data' });
    expect(loadGlobalSettings).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never meters a real team, however many reports it files', async () => {
    // H20's lesson: a limiter that counts successful work is an availability
    // bug. A whole office shares one egress address, and a bug-report burst
    // after a bad release is exactly when the admin most needs the mail.
    const { app, sendMail } = buildApp({ limiterMax: 2 });

    const statuses = await withServer(app, async (call) => {
      const results: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const response = await call('/api/notify-new-feedback', postJson(withTeamAuth({
          feedback: feedback({ id: `fb-${i}`, title: `Report ${i}` })
        })));
        results.push(response.status);
      }
      return results;
    });

    expect(statuses).toEqual([204, 204, 204, 204, 204, 204]);
    expect(sendMail).toHaveBeenCalledTimes(6);
  });

  it('still bounds an anonymous prober', async () => {
    const { app, sendMail } = buildApp({ limiterMax: 2 });

    const statuses = await withServer(app, async (call) => {
      const results: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const response = await call('/api/notify-new-feedback', postJson({
          teamId: `team-${i}`,
          sessionToken: 'rg1.forged',
          feedback: feedback()
        }));
        results.push(response.status);
      }
      return results;
    });

    expect(statuses).toEqual([401, 401, 429, 429]);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
