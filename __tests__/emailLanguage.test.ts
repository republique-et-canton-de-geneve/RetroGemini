import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';
import { registerPasswordResetRoutes } from '../server/routes/passwordResetRoutes.js';
import { createPublicOriginResolver } from '../server/services/publicOrigin.js';
import { hashResetToken, pruneResetTokens } from '../server/services/security.js';
import {
  buildInviteEmail,
  buildPasswordResetEmail,
  resolveEmailLanguage
} from '../server/services/emailTemplates.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * The invitation is the first thing a French-speaking guest reads — before the
 * app, before any language detection — so it is written in the language of the
 * facilitator who sent it. The password-reset mail likewise follows the screen
 * it was requested from. The client sends its interface language; the server
 * honours only the codes it has text for.
 */

type Mail = { subject: string; text: string; html: string };

describe('emailTemplates', () => {
  it('reads anything but a supported code as English', () => {
    expect(resolveEmailLanguage('fr')).toBe('fr');
    expect(resolveEmailLanguage('en')).toBe('en');
    expect(resolveEmailLanguage('de')).toBe('en');
    expect(resolveEmailLanguage(undefined)).toBe('en');
    expect(resolveEmailLanguage('<script>')).toBe('en');
    expect(resolveEmailLanguage({ toString: () => 'fr' })).toBe('en');
  });

  it('keeps the English invitation exactly as it was written before translation existed', () => {
    const mail = buildInviteEmail({
      language: 'en',
      name: 'Alice',
      teamName: 'Platform',
      sessionName: 'Sprint 12',
      link: 'https://retro.example/?join=abc',
      htmlLink: 'https://retro.example/?join=abc'
    });

    expect(mail.subject).toBe('Invitation to join Platform');
    expect(mail.text).toBe(`Alice,

You have been invited to join Platform for the session "Sprint 12".
Use this link to join: https://retro.example/?join=abc
`);
    expect(mail.html).toBe(`<p>Alice,</p>
<p>You have been invited to join <strong>Platform</strong> for the session "Sprint 12".</p>
<p><a href="https://retro.example/?join=abc" target="_blank" rel="noreferrer">Join with this link</a></p>`);
  });

  it('greets an unnamed English invitee the way it always did', () => {
    const mail = buildInviteEmail({ teamName: 'Platform', link: 'https://x.test/', htmlLink: 'https://x.test/' });
    expect(mail.text.startsWith('You,\n')).toBe(true);
    expect(mail.text).toContain('You have been invited to join Platform.');
  });

  it('writes the invitation in French', () => {
    const mail = buildInviteEmail({
      language: 'fr',
      name: 'Alice',
      teamName: 'Plateforme',
      sessionName: 'Sprint 12',
      link: 'https://retro.example/?join=abc',
      htmlLink: 'https://retro.example/?join=abc'
    });

    expect(mail.subject).toBe('Invitation à rejoindre Plateforme');
    expect(mail.text).toContain('Vous êtes invité(e) à rejoindre Plateforme pour la session «\u00a0Sprint 12\u00a0».');
    expect(mail.text).toContain('https://retro.example/?join=abc');
    expect(mail.html).toContain('Rejoindre avec ce lien');
    expect(mail.html).not.toContain('Join with this link');
  });

  it('escapes every caller-supplied value in the HTML part, in both languages', () => {
    for (const language of ['en', 'fr']) {
      const mail: Mail = buildInviteEmail({
        language,
        name: '<b>Eve</b>',
        teamName: 'Team <img src=x>',
        sessionName: '"><script>alert(1)</script>',
        link: 'https://retro.example/',
        htmlLink: 'https://retro.example/?a="b"'
      });
      expect(mail.html).not.toContain('<b>Eve</b>');
      expect(mail.html).not.toContain('<img src=x>');
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('href="https://retro.example/?a=&quot;b&quot;"');
    }
  });

  it('keeps the English password-reset mail as it was, and writes the French one', () => {
    const en = buildPasswordResetEmail({ teamName: 'Platform', link: 'https://retro.example/?reset=t' });
    expect(en.subject).toBe('Password Reset - Platform');
    expect(en.text).toBe(`Hello,

You have requested a password reset for the team "Platform".

Click this link to reset your password: https://retro.example/?reset=t

This link is valid for 1 hour.

If you did not request this reset, please ignore this email.
`);

    expect(en.html).toBe(`<p>Hello,</p>
<p>You have requested a password reset for the team <strong>Platform</strong>.</p>
<p><a href="https://retro.example/?reset=t" target="_blank" rel="noreferrer">Click here to reset your password</a></p>
<p>This link is valid for 1 hour.</p>
<p><em>If you did not request this reset, please ignore this email.</em></p>`);

    const hostile = buildPasswordResetEmail({ teamName: 'Team <b>', link: 'https://retro.example/?reset=t&x="y"' });
    expect(hostile.html).toContain('<strong>Team &lt;b&gt;</strong>');
    expect(hostile.html).toContain('href="https://retro.example/?reset=t&amp;x=&quot;y&quot;"');

    const fr = buildPasswordResetEmail({ language: 'fr', teamName: 'Plateforme <x>', link: 'https://retro.example/?reset=t' });
    expect(fr.subject).toBe('Réinitialisation du mot de passe - Plateforme <x>');
    expect(fr.text).toContain('Ce lien est valable 1 heure.');
    expect(fr.html).toContain('<strong>Plateforme &lt;x&gt;</strong>');
  });

  it('keeps French punctuation attached to its word, as the screens do', () => {
    // A breaking space before ":" or inside « » lets a mail client wrap the
    // mark onto a line of its own; the dictionaries use U+00A0 for those.
    const invite = buildInviteEmail({
      language: 'fr',
      teamName: 'Plateforme',
      sessionName: 'Sprint 12',
      link: 'https://retro.example/?join=abc',
      htmlLink: 'https://retro.example/?join=abc'
    });
    const reset = buildPasswordResetEmail({ language: 'fr', teamName: 'Plateforme', link: 'https://retro.example/?reset=t' });
    for (const part of [invite.text, invite.html, reset.text, reset.html]) {
      expect(part).not.toMatch(/ [?!:;»]|« /);
    }
    expect(invite.text).toContain('pour la session «\u00a0Sprint 12\u00a0».');
    expect(reset.text).toContain('mot de passe\u00a0: https://retro.example/?reset=t');
  });
});

describe('/api/send-invite honours the sender language', () => {
  const VALID_TOKEN = 'rg1.valid-team-session-token';

  const buildApp = () => {
    const app = express();
    const sendMail = vi.fn(async (_mail: Mail) => undefined);
    app.use(express.json());
    registerPublicRoutes({
      app,
      dataStore: { loadGlobalSettings: vi.fn() },
      teamService: {
        authenticateTeam: vi.fn(async (teamId: string, _password?: string, sessionToken?: string) =>
          sessionToken === VALID_TOKEN
            ? { team: { id: teamId, name: 'Plateforme' }, error: null }
            : { team: null, error: 'invalid_password' })
      },
      mailerService: { smtpEnabled: true, mailer: { sendMail } },
      logService: { addServerLog: vi.fn() },
      escapeHtml: (value: string) => value,
      sanitizeEmailLink: (value: string) => value
    });
    return { app, sendMail };
  };

  const send = (app: express.Express, language?: unknown) =>
    request(app, '/api/send-invite', postJson({
      teamId: 'team-1',
      sessionToken: VALID_TOKEN,
      email: 'alice@corp.test',
      name: 'Alice',
      link: 'https://retro.example/join/abc',
      ...(language === undefined ? {} : { language })
    }));

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mails a French invitation when the facilitator works in French', async () => {
    const { app, sendMail } = buildApp();
    const response = await send(app, 'fr');
    expect(response.status).toBe(204);
    expect((sendMail.mock.calls[0][0] as Mail).subject).toBe('Invitation à rejoindre Plateforme');
  });

  it('keeps English for an older client that sends no language, and for an unknown one', async () => {
    const { app, sendMail } = buildApp();
    await send(app);
    await send(app, 'xx');
    expect((sendMail.mock.calls[0][0] as Mail).subject).toBe('Invitation to join Plateforme');
    expect((sendMail.mock.calls[1][0] as Mail).subject).toBe('Invitation to join Plateforme');
  });
});

describe('/api/send-password-reset honours the requester language', () => {
  it('mails the reset link in French, still carrying a live token', async () => {
    const app = express();
    app.use(express.json());
    const sendMail = vi.fn(async (_mail: Mail) => undefined);
    const meta = { resetTokens: [] as Array<{ tokenHash: string; teamId: string }> };
    registerPasswordResetRoutes({
      app,
      dataStore: {
        loadTeamIndex: vi.fn(async () => new Map([['plateforme', 'team-1']])),
        loadTeam: vi.fn(async () => ({ id: 'team-1', name: 'Plateforme', facilitatorEmail: 'lead@example.test' })),
        atomicMetaUpdate: vi.fn(async (updater: (m: typeof meta) => typeof meta) => {
          meta.resetTokens = updater({ resetTokens: [...meta.resetTokens] }).resetTokens;
          return { success: true };
        })
      },
      mailerService: { smtpEnabled: true, mailer: { sendMail } },
      escapeHtml: (value: string) => value,
      sanitizeEmailLink: (value: string) => value,
      hashResetToken,
      pruneResetTokens,
      publicOrigin: createPublicOriginResolver({ env: { PUBLIC_BASE_URL: 'https://retro.example.test/' } })
    });

    const response = await request(app, '/api/send-password-reset', postJson({
      email: 'lead@example.test',
      teamName: 'Plateforme',
      resetBaseUrl: 'https://retro.example.test/',
      language: 'fr'
    }));

    expect(response.status).toBe(204);
    const mail = sendMail.mock.calls[0][0] as Mail;
    expect(mail.subject).toBe('Réinitialisation du mot de passe - Plateforme');
    const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get('reset');
    expect(hashResetToken(token!)).toBe(meta.resetTokens[0].tokenHash);
  });
});
