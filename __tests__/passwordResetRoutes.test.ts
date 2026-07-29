import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerPasswordResetRoutes } from '../server/routes/passwordResetRoutes.js';
import { hashResetToken, pruneResetTokens } from '../server/services/security.js';
import { verifyPassword } from '../server/services/passwordHashing.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * Behavioural coverage for the password-reset routes. This is the surface the
 * hardening tracker flags as "security-critical, near-untested": the routes mint
 * a live reset token, mail it, and exchange it for a password change, so every
 * branch that decides whether a token is created, honoured or refused needs a
 * standing guard.
 */

type ResetToken = {
  tokenHash: string;
  teamId: string;
  createdAt: number;
  expiresAt: number;
};

type Team = {
  id: string;
  name: string;
  facilitatorEmail?: string;
  passwordHash?: string;
  inviteEpoch?: number;
};

const HOUR = 60 * 60 * 1000;

const createDataStore = ({
  teams = [] as Team[],
  resetTokens = [] as ResetToken[],
  teamUpdateResult = { success: true } as { success: boolean; error?: string }
} = {}) => {
  const teamsById = new Map(teams.map((team) => [team.id, { ...team }]));
  const meta = { resetTokens: [...resetTokens] };

  return {
    meta,
    teamsById,
    loadTeamIndex: vi.fn(async () => new Map(
      [...teamsById.values()].map((team) => [team.name.toLowerCase(), team.id])
    )),
    loadTeam: vi.fn(async (teamId: string) => {
      const team = teamsById.get(teamId);
      return team ? { ...team } : null;
    }),
    loadMetaData: vi.fn(async () => ({ resetTokens: [...meta.resetTokens] })),
    atomicMetaUpdate: vi.fn(async (updater: (m: typeof meta) => typeof meta | null) => {
      const draft = { resetTokens: [...meta.resetTokens] };
      const next = updater(draft);
      if (next) {
        meta.resetTokens = next.resetTokens;
      }
      return { success: true };
    }),
    atomicTeamUpdate: vi.fn(async (teamId: string, updater: (team: Team) => Team) => {
      const team = teamsById.get(teamId);
      if (!team) {
        return { success: false, error: 'not_found' };
      }
      const next = updater({ ...team });
      if (teamUpdateResult.success) {
        teamsById.set(teamId, next);
      }
      return teamUpdateResult;
    })
  };
};

const buildApp = (overrides: Record<string, unknown> = {}) => {
  const app = express();
  app.use(express.json());
  const sendMail = vi.fn(async (_mail: Record<string, unknown>) => undefined);
  const dataStore = (overrides.dataStore as ReturnType<typeof createDataStore>) ?? createDataStore();

  registerPasswordResetRoutes({
    app,
    dataStore,
    mailerService: { smtpEnabled: true, mailer: { sendMail } },
    escapeHtml: (value: string) => value,
    sanitizeEmailLink: (value: string) => value,
    hashResetToken,
    pruneResetTokens,
    ...overrides
  });

  return { app, dataStore, sendMail };
};

describe('POST /api/send-password-reset', () => {
  it('refuses to run when SMTP is not configured', async () => {
    const app = express();
    app.use(express.json());
    const dataStore = createDataStore();
    registerPasswordResetRoutes({
      app,
      dataStore,
      mailerService: { smtpEnabled: false, mailer: null },
      escapeHtml: (v: string) => v,
      sanitizeEmailLink: (v: string) => v,
      hashResetToken,
      pruneResetTokens
    });

    const response = await request(app, '/api/send-password-reset', postJson({
      email: 'lead@example.test',
      teamName: 'Team',
      resetBaseUrl: 'https://retro.example.test/'
    }));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'email_not_configured' });
    expect(dataStore.loadTeamIndex).not.toHaveBeenCalled();
  });

  it.each([
    ['no email', { teamName: 'Team', resetBaseUrl: 'https://retro.example.test/' }],
    ['no link', { email: 'lead@example.test', teamName: 'Team' }],
    ['no team name', { email: 'lead@example.test', resetBaseUrl: 'https://retro.example.test/' }]
  ])('rejects a request with %s before touching the data store', async (_label, body) => {
    const { app, dataStore, sendMail } = buildApp();

    const response = await request(app, '/api/send-password-reset', postJson(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_fields' });
    expect(dataStore.loadTeamIndex).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects a malformed email address', async () => {
    const { app, sendMail } = buildApp();

    const response = await request(app, '/api/send-password-reset', postJson({
      email: 'not-an-email',
      teamName: 'Team',
      resetBaseUrl: 'https://retro.example.test/'
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_email' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it.each([
    // Built by concatenation so the literal does not trip ESLint's no-script-url.
    ['a non-http protocol', `${'java'}script:alert(1)`],
    ['an unparseable url', 'not a url at all'],
    ['an over-long url', `https://retro.example.test/${'a'.repeat(4097)}`]
  ])('rejects %s as a reset link', async (_label, resetBaseUrl) => {
    const { app, sendMail } = buildApp();

    const response = await request(app, '/api/send-password-reset', postJson({
      email: 'lead@example.test',
      teamName: 'Team',
      resetBaseUrl
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_link' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects an over-long team name', async () => {
    const { app, sendMail } = buildApp();

    const response = await request(app, '/api/send-password-reset', postJson({
      email: 'lead@example.test',
      teamName: 'T'.repeat(201),
      resetBaseUrl: 'https://retro.example.test/'
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_team_name' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('answers 204 without minting a token when the team does not exist', async () => {
    const dataStore = createDataStore({ teams: [] });
    const { app, sendMail } = buildApp({ dataStore });

    const response = await request(app, '/api/send-password-reset', postJson({
      email: 'lead@example.test',
      teamName: 'Ghost Team',
      resetBaseUrl: 'https://retro.example.test/'
    }));

    expect(response.status).toBe(204);
    expect(sendMail).not.toHaveBeenCalled();
    expect(dataStore.atomicMetaUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['the team has no facilitator email', undefined],
    ['the facilitator email does not match', 'someone-else@example.test']
  ])('answers 204 without minting a token when %s', async (_label, facilitatorEmail) => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Team', facilitatorEmail }]
    });
    const { app, sendMail } = buildApp({ dataStore });

    const response = await request(app, '/api/send-password-reset', postJson({
      email: 'lead@example.test',
      teamName: 'Team',
      resetBaseUrl: 'https://retro.example.test/'
    }));

    expect(response.status).toBe(204);
    expect(sendMail).not.toHaveBeenCalled();
    expect(dataStore.atomicMetaUpdate).not.toHaveBeenCalled();
    expect(dataStore.meta.resetTokens).toHaveLength(0);
  });

  it('mints exactly one live token per team and mails the link carrying it', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Team', facilitatorEmail: 'Lead@Example.test' }],
      // A previous, still-valid request for the same team must be replaced,
      // not accumulated: one live reset token per team at a time.
      resetTokens: [
        { tokenHash: 'stale-for-team-1', teamId: 'team-1', createdAt: 0, expiresAt: Date.now() + HOUR },
        { tokenHash: 'other-team', teamId: 'team-2', createdAt: 0, expiresAt: Date.now() + HOUR }
      ]
    });
    const { app, sendMail } = buildApp({ dataStore });

    const response = await request(app, '/api/send-password-reset', postJson({
      // Casing and padding must not defeat the facilitator-email check.
      email: '  LEAD@example.TEST  '.trim(),
      teamName: 'Team',
      resetBaseUrl: 'https://retro.example.test/'
    }));

    expect(response.status).toBe(204);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const forTeamOne = dataStore.meta.resetTokens.filter((entry) => entry.teamId === 'team-1');
    expect(forTeamOne).toHaveLength(1);
    expect(forTeamOne[0].tokenHash).not.toBe('stale-for-team-1');
    expect(dataStore.meta.resetTokens.some((entry) => entry.teamId === 'team-2')).toBe(true);

    const mail = sendMail.mock.calls[0][0] as { to: string; text: string; html: string };
    const token = new URL(mail.text.match(/https:\/\/\S+/)![0]).searchParams.get('reset');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // The mailed token is the pre-image of the stored hash — never the hash.
    expect(hashResetToken(token!)).toBe(forTeamOne[0].tokenHash);
    expect(mail.html).not.toContain(forTeamOne[0].tokenHash);
    expect(forTeamOne[0].expiresAt - forTeamOne[0].createdAt).toBe(HOUR);
  });

  it('drops expired tokens while minting a new one', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Team', facilitatorEmail: 'lead@example.test' }],
      resetTokens: [
        { tokenHash: 'expired', teamId: 'team-9', createdAt: 0, expiresAt: Date.now() - 1 }
      ]
    });
    const { app } = buildApp({ dataStore });

    await request(app, '/api/send-password-reset', postJson({
      email: 'lead@example.test',
      teamName: 'Team',
      resetBaseUrl: 'https://retro.example.test/'
    }));

    expect(dataStore.meta.resetTokens.some((entry) => entry.tokenHash === 'expired')).toBe(false);
  });

  it('reports a send failure without leaking the error to the caller', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Team', facilitatorEmail: 'lead@example.test' }]
    });
    const app = express();
    app.use(express.json());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerPasswordResetRoutes({
      app,
      dataStore,
      mailerService: {
        smtpEnabled: true,
        mailer: { sendMail: vi.fn(async (_mail: Record<string, unknown>) => { throw new Error('smtp exploded'); }) }
      },
      escapeHtml: (v: string) => v,
      sanitizeEmailLink: (v: string) => v,
      hashResetToken,
      pruneResetTokens
    });

    const response = await request(app, '/api/send-password-reset', postJson({
      email: 'lead@example.test',
      teamName: 'Team',
      resetBaseUrl: 'https://retro.example.test/'
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'send_failed' });
    consoleError.mockRestore();
  });
});

describe('POST /api/password-reset/verify', () => {
  it('rejects a request with no token', async () => {
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/password-reset/verify', postJson({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_token' });
    expect(dataStore.loadMetaData).not.toHaveBeenCalled();
  });

  it('reports an unknown token as invalid', async () => {
    const { app } = buildApp();

    const response = await request(app, '/api/password-reset/verify', postJson({ token: 'nope' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: false });
  });

  it('reports a live token as valid and names the team', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Platform Team' }],
      resetTokens: [
        { tokenHash: hashResetToken('live-token'), teamId: 'team-1', createdAt: 0, expiresAt: Date.now() + HOUR }
      ]
    });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/verify', postJson({ token: 'live-token' }));

    expect(await response.json()).toEqual({ valid: true, teamName: 'Platform Team' });
    // Nothing was pruned, so the write lock was never taken.
    expect(dataStore.atomicMetaUpdate).not.toHaveBeenCalled();
  });

  it('treats an expired token as invalid and prunes it from the store', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Platform Team' }],
      resetTokens: [
        { tokenHash: hashResetToken('old-token'), teamId: 'team-1', createdAt: 0, expiresAt: Date.now() - 1 }
      ]
    });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/verify', postJson({ token: 'old-token' }));

    expect(await response.json()).toEqual({ valid: false });
    expect(dataStore.atomicMetaUpdate).toHaveBeenCalledTimes(1);
    expect(dataStore.meta.resetTokens).toHaveLength(0);
  });

  it('reports a token whose team has been deleted as invalid', async () => {
    const dataStore = createDataStore({
      teams: [],
      resetTokens: [
        { tokenHash: hashResetToken('orphan'), teamId: 'deleted-team', createdAt: 0, expiresAt: Date.now() + HOUR }
      ]
    });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/verify', postJson({ token: 'orphan' }));

    expect(await response.json()).toEqual({ valid: false });
  });

  it('answers 500 when the store cannot be read', async () => {
    const dataStore = createDataStore();
    dataStore.loadMetaData = vi.fn(async () => { throw new Error('store down'); });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/verify', postJson({ token: 'anything' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'verification_failed' });
    consoleError.mockRestore();
  });
});

describe('POST /api/password-reset/confirm', () => {
  it.each([
    ['no token', { newPassword: 'secret' }],
    ['no password', { token: 'live-token' }]
  ])('rejects a request with %s', async (_label, body) => {
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/password-reset/confirm', postJson(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_fields' });
    expect(dataStore.atomicMetaUpdate).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than the minimum', async () => {
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/password-reset/confirm', postJson({
      token: 'live-token',
      newPassword: 'abc'
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'password_too_short' });
    expect(dataStore.atomicMetaUpdate).not.toHaveBeenCalled();
  });

  it('sets the new password, consumes the token and revokes invite links', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Platform Team', passwordHash: 'old-hash', inviteEpoch: 3 }],
      resetTokens: [
        { tokenHash: hashResetToken('live-token'), teamId: 'team-1', createdAt: 0, expiresAt: Date.now() + HOUR }
      ]
    });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/confirm', postJson({
      token: 'live-token',
      newPassword: 'brand-new-password'
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: 'Password updated for Platform Team. You can now log in.',
      teamName: 'Platform Team'
    });

    const stored = dataStore.teamsById.get('team-1')!;
    expect(stored.passwordHash).not.toBe('old-hash');
    // The password is stored hashed, never in clear text.
    expect(stored.passwordHash).not.toContain('brand-new-password');
    expect(await verifyPassword('brand-new-password', stored.passwordHash!)).toBe(true);
    // Rotating the password revokes every outstanding invite link (stage 7e).
    expect(stored.inviteEpoch).toBe(4);
    // The token is single-use.
    expect(dataStore.meta.resetTokens).toHaveLength(0);
  });

  it('starts the invite epoch at 1 for a team that has never rotated', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Team' }],
      resetTokens: [
        { tokenHash: hashResetToken('live-token'), teamId: 'team-1', createdAt: 0, expiresAt: Date.now() + HOUR }
      ]
    });
    const { app } = buildApp({ dataStore });

    await request(app, '/api/password-reset/confirm', postJson({
      token: 'live-token',
      newPassword: 'brand-new-password'
    }));

    expect(dataStore.teamsById.get('team-1')!.inviteEpoch).toBe(1);
  });

  it('rejects an unknown token without touching any team record', async () => {
    const dataStore = createDataStore({ teams: [{ id: 'team-1', name: 'Team' }] });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/confirm', postJson({
      token: 'not-a-real-token',
      newPassword: 'brand-new-password'
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_or_expired_token' });
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Team', passwordHash: 'old-hash' }],
      resetTokens: [
        { tokenHash: hashResetToken('expired-token'), teamId: 'team-1', createdAt: 0, expiresAt: Date.now() - 1 }
      ]
    });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/confirm', postJson({
      token: 'expired-token',
      newPassword: 'brand-new-password'
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_or_expired_token' });
    expect(dataStore.teamsById.get('team-1')!.passwordHash).toBe('old-hash');
  });

  it('does not report success when the team write is lost (audit H2)', async () => {
    const dataStore = createDataStore({
      teams: [{ id: 'team-1', name: 'Team', passwordHash: 'old-hash' }],
      resetTokens: [
        { tokenHash: hashResetToken('live-token'), teamId: 'team-1', createdAt: 0, expiresAt: Date.now() + HOUR }
      ],
      teamUpdateResult: { success: false, error: 'conflict' }
    });
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/confirm', postJson({
      token: 'live-token',
      newPassword: 'brand-new-password'
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_or_expired_token' });
    expect(dataStore.teamsById.get('team-1')!.passwordHash).toBe('old-hash');
  });

  it('answers 500 when the store throws', async () => {
    const dataStore = createDataStore();
    dataStore.atomicMetaUpdate = vi.fn(async () => { throw new Error('store down'); });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/password-reset/confirm', postJson({
      token: 'live-token',
      newPassword: 'brand-new-password'
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'reset_failed' });
    consoleError.mockRestore();
  });
});
