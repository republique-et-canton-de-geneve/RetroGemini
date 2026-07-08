import express from 'express';
import { gzipSync } from 'zlib';
import { describe, expect, it, vi } from 'vitest';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';
import { registerPasswordResetRoutes } from '../server/routes/passwordResetRoutes.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';

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

describe('route hardening', () => {
  it('rejects malformed invite email requests before sending mail', async () => {
    const app = express();
    const sendMail = vi.fn();
    app.use(express.json());
    registerPublicRoutes({
      app,
      dataStore: { loadGlobalSettings: vi.fn() },
      mailerService: { smtpEnabled: true, mailer: { sendMail } },
      logService: { addServerLog: vi.fn() },
      escapeHtml: (value: string) => value,
      sanitizeEmailLink: (value: string) => value
    });

    const response = await request(app, '/api/send-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', link: 'https://example.test/invite' })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_email' });
    expect(sendMail).not.toHaveBeenCalled();
  });




  it('accepts internal single-label email domains for invite delivery', async () => {
    const app = express();
    const sendMail = vi.fn(async () => undefined);
    app.use(express.json());
    registerPublicRoutes({
      app,
      dataStore: { loadGlobalSettings: vi.fn() },
      mailerService: { smtpEnabled: true, mailer: { sendMail } },
      logService: { addServerLog: vi.fn() },
      escapeHtml: (value: string) => value,
      sanitizeEmailLink: (value: string) => value
    });

    const response = await request(app, '/api/send-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@corp', link: 'https://example.test/invite' })
    });

    expect(response.status).toBe(204);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@corp' }));
  });


  it('does not rate-limit large facilitator invite batches by recipient count', async () => {
    const app = express();
    const sendMail = vi.fn(async () => undefined);
    app.use(express.json());
    registerPublicRoutes({
      app,
      dataStore: { loadGlobalSettings: vi.fn() },
      mailerService: { smtpEnabled: true, mailer: { sendMail } },
      logService: { addServerLog: vi.fn() },
      escapeHtml: (value: string) => value,
      sanitizeEmailLink: (value: string) => value
    });

    const responses = await Promise.all(Array.from({ length: 101 }, (_, index) => request(app, '/api/send-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `person-${index}@corp`, link: 'https://example.test/invite' })
    })));

    expect(responses.every((response) => response.status === 204)).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(101);
  });

  it('rejects malformed password reset email requests before token work', async () => {
    const app = express();
    const sendMail = vi.fn();
    const loadTeamIndex = vi.fn();
    app.use(express.json());
    registerPasswordResetRoutes({
      app,
      dataStore: {
        loadTeamIndex,
        loadMetaData: vi.fn(),
        atomicMetaUpdate: vi.fn(),
        loadTeam: vi.fn(),
        atomicTeamUpdate: vi.fn()
      },
      mailerService: { smtpEnabled: true, mailer: { sendMail } },
      escapeHtml: (value: string) => value,
      sanitizeEmailLink: (value: string) => value,
      hashResetToken: (value: string) => value,
      pruneResetTokens: (tokens: unknown[]) => tokens
    });

    const response = await request(app, '/api/send-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid',
        teamName: 'Team',
        resetBaseUrl: 'https://example.test/reset'
      })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_email' });
    expect(loadTeamIndex).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });


  it('rejects malformed feedback notifications before loading global settings', async () => {
    const app = express();
    const loadGlobalSettings = vi.fn();
    const sendMail = vi.fn();
    app.use(express.json());
    registerPublicRoutes({
      app,
      dataStore: { loadGlobalSettings },
      mailerService: { smtpEnabled: true, mailer: { sendMail } },
      logService: { addServerLog: vi.fn() },
      escapeHtml: (value: string) => value,
      sanitizeEmailLink: (value: string) => value
    });

    const response = await request(app, '/api/notify-new-feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feedback: { title: 'Bug', type: 'unsupported', description: 'Bad type' } })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_feedback_data' });
    expect(loadGlobalSettings).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('authenticates backup restore requests before reading the archive body', async () => {
    const app = express();
    const validateSuperAdminAuth = vi.fn(() => false);
    const savePersistedData = vi.fn();
    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn() },
      dataStore: { savePersistedData },
      tokenService: {
        validateSuperAdminAuth,
        validateSuperAdminToken: vi.fn(),
        createSuperAdminToken: vi.fn()
      },
      mailerService: {},
      logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []) },
      escapeHtml: (value: string) => value,
      superAdminPassword: 'secret',
      sessionCache: { clear: vi.fn() },
      backupService: {},
      aiService: {}
    });

    const response = await request(app, '/api/super-admin/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teams: [] })
    });

    expect(response.status).toBe(401);
    expect(validateSuperAdminAuth).toHaveBeenCalledWith({ password: undefined, sessionToken: undefined });
    expect(savePersistedData).not.toHaveBeenCalled();
  });

  it('rejects gzip restore archives that exceed the decompressed-size cap', async () => {
    const app = express();
    const savePersistedData = vi.fn();
    const archive = gzipSync(Buffer.from(JSON.stringify({
      teams: [
        { id: 'team-1', name: 'Alpha', members: [], retrospectives: [{ notes: 'x'.repeat(200) }] }
      ]
    })));

    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn() },
      dataStore: { savePersistedData },
      tokenService: {
        validateSuperAdminAuth: vi.fn(() => true),
        validateSuperAdminToken: vi.fn(),
        createSuperAdminToken: vi.fn()
      },
      mailerService: {},
      logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []) },
      escapeHtml: (value: string) => value,
      superAdminPassword: 'secret',
      sessionCache: { clear: vi.fn() },
      backupService: {},
      aiService: {},
      restoreMaxDecompressedBytes: 64
    });

    const response = await request(app, '/api/super-admin/restore', {
      method: 'POST',
      headers: {
        'content-type': 'application/gzip',
        'x-super-admin-password': 'secret'
      },
      body: archive
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'restore_archive_too_large' });
    expect(savePersistedData).not.toHaveBeenCalled();
  });

  it('does not let stale super-admin session checks exhaust password login attempts', async () => {
    const app = express();
    const validateSuperAdminAuth = vi.fn(({ password }) => password === 'secret');
    const validateSuperAdminToken = vi.fn(() => false);
    const createSuperAdminToken = vi.fn(() => 'fresh-token');
    app.use(express.json());
    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn() },
      dataStore: {},
      tokenService: {
        validateSuperAdminAuth,
        validateSuperAdminToken,
        createSuperAdminToken
      },
      mailerService: {},
      logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []) },
      escapeHtml: (value: string) => value,
      superAdminPassword: 'secret',
      sessionCache: { clear: vi.fn() },
      backupService: {},
      aiService: {}
    });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const staleSessionResponse = await request(app, '/api/super-admin/validate-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionToken: 'stale-token-after-secret-rotation' })
      });

      expect(staleSessionResponse.status).toBe(401);
      expect(await staleSessionResponse.json()).toEqual({ error: 'invalid_or_expired_token' });
    }

    const loginResponse = await request(app, '/api/super-admin/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret' })
    });

    expect(loginResponse.status).toBe(200);
    expect(await loginResponse.json()).toEqual({ success: true, sessionToken: 'fresh-token' });
    expect(validateSuperAdminToken).toHaveBeenCalledTimes(6);
    expect(validateSuperAdminAuth).toHaveBeenCalledWith({ password: 'secret' });
    expect(createSuperAdminToken).toHaveBeenCalledTimes(1);
  });

  it('truncates release analysis prompt fields before calling the AI service', async () => {
    const app = express();
    const generateReleaseAnalysis = vi.fn(async () => 'analysis');
    app.use(express.json({ limit: '2mb' }));
    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn() },
      dataStore: {},
      tokenService: {
        validateSuperAdminAuth: vi.fn(),
        validateSuperAdminToken: vi.fn(),
        createSuperAdminToken: vi.fn()
      },
      mailerService: {},
      logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []) },
      escapeHtml: (value: string) => value,
      superAdminPassword: 'secret',
      sessionCache: { clear: vi.fn() },
      backupService: {},
      aiService: { generateReleaseAnalysis }
    });

    const retrospectives = Array.from({ length: 50 }, (_, index) => ({ id: `retro-${index}` }));
    const response = await request(app, '/api/ai/generate-release-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        retrospectives,
        customPrompt: 'x'.repeat(5000),
        additionalInstructions: 'y'.repeat(5000)
      })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analysis: 'analysis' });
    expect(generateReleaseAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      retrospectives,
      customPrompt: 'x'.repeat(4000),
      additionalInstructions: 'y'.repeat(4000)
    }));
  });

  it('rejects release analysis requests that would silently omit selected retrospectives', async () => {
    const app = express();
    const generateReleaseAnalysis = vi.fn(async () => 'analysis');
    app.use(express.json({ limit: '2mb' }));
    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn() },
      dataStore: {},
      tokenService: {
        validateSuperAdminAuth: vi.fn(),
        validateSuperAdminToken: vi.fn(),
        createSuperAdminToken: vi.fn()
      },
      mailerService: {},
      logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []) },
      escapeHtml: (value: string) => value,
      superAdminPassword: 'secret',
      sessionCache: { clear: vi.fn() },
      backupService: {},
      aiService: { generateReleaseAnalysis }
    });

    const response = await request(app, '/api/ai/generate-release-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retrospectives: Array.from({ length: 51 }, (_, index) => ({ id: `retro-${index}` })) })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'too_many_retrospectives', maxRetrospectives: 50 });
    expect(generateReleaseAnalysis).not.toHaveBeenCalled();
  });

});
