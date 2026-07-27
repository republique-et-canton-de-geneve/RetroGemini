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

  it('faithfully replaces, snapshots and invalidates session caches on a successful restore', async () => {
    const app = express();
    const savePersistedData = vi.fn(async () => undefined);
    const clear = vi.fn();
    const createBackup = vi.fn(async () => ({ id: 'pre-restore', protected: true }));
    const serverSideEmit = vi.fn();

    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn(), serverSideEmit },
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
      sessionCache: { clear },
      backupService: { createBackup },
      aiService: {},
      serverRuntime: { multiPodAdapter: true }
    });

    const response = await request(app, '/api/super-admin/restore', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-super-admin-password': 'secret'
      },
      body: JSON.stringify({ teams: [{ id: 't1', name: 'Alpha', members: [] }] })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, teamsRestored: 1 });
    // Faithful replace, not a merge.
    expect(savePersistedData).toHaveBeenCalledWith(
      expect.objectContaining({ teams: expect.any(Array) }),
      { mode: 'replace' }
    );
    // A protected pre-restore snapshot is taken before the destructive replace.
    expect(createBackup).toHaveBeenCalledWith('auto', 'Pre-restore snapshot', { protected: true });
    // Local cache cleared and cross-pod invalidation broadcast (multi-pod).
    expect(clear).toHaveBeenCalledTimes(1);
    expect(serverSideEmit).toHaveBeenCalledWith('sessions-invalidated');
  });

  it('does not broadcast cross-pod invalidation on a single-pod restore', async () => {
    const app = express();
    const savePersistedData = vi.fn(async () => undefined);
    const clear = vi.fn();
    const serverSideEmit = vi.fn();

    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn(), serverSideEmit },
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
      sessionCache: { clear },
      backupService: { createBackup: vi.fn(async () => ({ id: 'pre-restore' })) },
      aiService: {},
      serverRuntime: { multiPodAdapter: false }
    });

    const response = await request(app, '/api/super-admin/restore', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-super-admin-password': 'secret'
      },
      body: JSON.stringify({ teams: [] })
    });

    expect(response.status).toBe(200);
    // The local cache is still cleared, but no cross-pod broadcast is emitted
    // (the in-memory adapter does not support serverSideEmit).
    expect(clear).toHaveBeenCalledTimes(1);
    expect(serverSideEmit).not.toHaveBeenCalled();
  });

  it('rejects a malformed restore payload before the destructive replace', async () => {
    const app = express();
    const savePersistedData = vi.fn(async () => undefined);
    const createBackup = vi.fn(async () => ({ id: 'pre-restore' }));
    const clear = vi.fn();

    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn(), serverSideEmit: vi.fn() },
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
      sessionCache: { clear },
      backupService: { createBackup },
      aiService: {}
    });

    // An object that is not a real backup: `teams` is missing / not an array.
    // It must not be coerced to an empty archive that wipes every team.
    const response = await request(app, '/api/super-admin/restore', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-super-admin-password': 'secret'
      },
      body: JSON.stringify({ teams: { bogus: true } })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_backup_data' });
    expect(savePersistedData).not.toHaveBeenCalled();
    expect(createBackup).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('aborts the restore when the protected pre-restore snapshot cannot be created', async () => {
    const app = express();
    const savePersistedData = vi.fn(async () => undefined);
    // createBackup returns null (another backup in progress / snapshot write failed).
    const createBackup = vi.fn(async () => null);
    const clear = vi.fn();

    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn(), serverSideEmit: vi.fn() },
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
      sessionCache: { clear },
      backupService: { createBackup },
      aiService: {}
    });

    const response = await request(app, '/api/super-admin/restore', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-super-admin-password': 'secret'
      },
      body: JSON.stringify({ teams: [{ id: 't1', name: 'Alpha', members: [] }] })
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'pre_restore_snapshot_failed' });
    // The destructive replace never ran and no caches were invalidated.
    expect(savePersistedData).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
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

  it('does not let repeated super-admin dashboard refreshes exhaust action attempts', async () => {
    const app = express();
    const validateSuperAdminAuth = vi.fn(() => true);
    const settings = { adminEmail: '', notifyNewTeam: false, ai: { enabled: false, apiUrl: '' } };
    const loadGlobalSettings = vi.fn(async () => ({ ...settings, ai: { ...settings.ai } }));
    const saveGlobalSettings = vi.fn(async (nextSettings) => {
      Object.assign(settings, nextSettings);
    });
    app.use(express.json());
    registerSuperAdminRoutes({
      app,
      io: { emit: vi.fn() },
      dataStore: {
        loadTeamSummaries: vi.fn(async () => []),
        loadAllTeams: vi.fn(async () => []),
        loadAllTeamFeedbacks: vi.fn(async () => []),
        loadMetaData: vi.fn(async () => ({ orphanedFeedbacks: [] })),
        loadGlobalSettings,
        saveGlobalSettings
      },
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

    const dashboardReadPaths = [
      '/api/super-admin/teams',
      '/api/super-admin/feedbacks',
      '/api/super-admin/admin-email',
      '/api/super-admin/ai-settings'
    ];

    for (let refresh = 0; refresh < 20; refresh += 1) {
      for (const path of dashboardReadPaths) {
        const response = await request(app, path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionToken: 'valid-super-admin-token' })
        });

        expect(response.status).toBe(200);
      }
    }

    const actionResponse = await request(app, '/api/super-admin/update-notify-new-team', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken: 'valid-super-admin-token', notifyNewTeam: true })
    });

    expect(actionResponse.status).toBe(200);
    expect(await actionResponse.json()).toEqual({ success: true });
  });

});
