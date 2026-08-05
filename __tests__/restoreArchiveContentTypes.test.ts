import express from 'express';
import { gzipSync } from 'zlib';
import { describe, expect, it, vi } from 'vitest';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { request } from './helpers/routeTestServer';

/**
 * H30 — which content types the uploaded-restore route can actually accept.
 *
 * The route declares `express.raw({ type: [gzip, x-gzip, octet-stream, json] })`,
 * but `server.js:98` mounts `express.json({ limit: '1mb' })` **globally, before
 * any route**. Body-parser only claims a request whose content type it matches,
 * and marks it consumed — so the global parser silently takes one of the four
 * types away from the route, and the route's own handler then sees a plain
 * object instead of a Buffer and answers `400 missing_archive`.
 *
 * This suite is wired the way production is wired (global `express.json()` first)
 * precisely because a harness without it proves nothing: every one of these cases
 * passes trivially against an app that omits the global parser.
 *
 * The point of pinning all four is that the answer is *not* "uncompressed JSON is
 * unsupported" — it is supported, under `application/octet-stream`. Only the
 * `application/json` label is dead, which is why the fix is to stop advertising
 * that one type rather than to restructure the body parsing of every route.
 */

const VALID_PASSWORD = 'super-secret';

const buildApp = () => {
  const app = express();
  // Exactly what server.js does, in the order it does it.
  app.use(express.json({ limit: '1mb' }));

  const savePersistedData = vi.fn(async () => undefined);

  registerSuperAdminRoutes({
    app,
    io: { fetchSockets: vi.fn(async () => []), serverSideEmit: vi.fn() },
    dataStore: {
      savePersistedData,
      loadAllTeams: vi.fn(async () => []),
      atomicTeamUpdate: vi.fn(),
      loadPersistedData: vi.fn(async () => ({ teams: [] })),
      loadGlobalSettings: vi.fn(async () => ({})),
      loadSessionState: vi.fn(async () => null)
    },
    tokenService: {
      validateSuperAdminAuth: vi.fn((body: { password?: string } | undefined) => body?.password === VALID_PASSWORD),
      createSuperAdminToken: vi.fn(),
      validateSuperAdminToken: vi.fn(() => true)
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() },
    escapeHtml: (value: string) => String(value ?? ''),
    superAdminPassword: VALID_PASSWORD,
    sessionCache: new Map(),
    backupService: { createBackup: vi.fn(async () => ({ id: 'pre-restore' })) },
    aiService: {},
    serverRuntime: { multiPodAdapter: false }
  });

  return { app, savePersistedData };
};

const ARCHIVE = { teams: [{ id: 'team-1', name: 'Platform Team', members: [] }] };

const upload = (contentType: string, body: Buffer | string) => ({
  method: 'POST' as const,
  headers: { 'content-type': contentType, 'x-super-admin-password': VALID_PASSWORD },
  body: typeof body === 'string' ? body : new Uint8Array(body)
});

describe('uploaded restore archive content types (H30)', () => {
  it('accepts a gzipped archive under application/gzip', async () => {
    const { app, savePersistedData } = buildApp();

    const response = await request(
      app,
      '/api/super-admin/restore',
      upload('application/gzip', gzipSync(JSON.stringify(ARCHIVE)))
    );

    expect(response.status).toBe(200);
    expect(savePersistedData).toHaveBeenCalledWith(expect.objectContaining({ teams: expect.any(Array) }), { mode: 'replace' });
  });

  it('accepts an uncompressed JSON archive under application/octet-stream', async () => {
    // The capability exists and is reachable — the global json parser does not
    // claim octet-stream, so the route's raw parser gets its Buffer and
    // `parseRestoreArchiveBody` falls through to its JSON branch.
    const { app, savePersistedData } = buildApp();

    const response = await request(
      app,
      '/api/super-admin/restore',
      upload('application/octet-stream', JSON.stringify(ARCHIVE))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, teamsRestored: 1 });
    expect(savePersistedData).toHaveBeenCalled();
  });

  it('accepts a gzipped archive under application/octet-stream too', async () => {
    // Detected by magic bytes rather than by the declared type, so an operator
    // who gets the content type wrong on a real .gz file is still served.
    const { app } = buildApp();

    const response = await request(
      app,
      '/api/super-admin/restore',
      upload('application/octet-stream', gzipSync(JSON.stringify(ARCHIVE)))
    );

    expect(response.status).toBe(200);
  });

  it('cannot accept anything under application/json, because the global parser claims it first', async () => {
    // This is H30. The route lists `application/json` among its raw types, but
    // `express.json()` has already consumed the body and set `req.body` to a
    // plain object, so the handler's Buffer check fails and the caller is told
    // its archive is missing — for a request that carried one.
    const { app, savePersistedData } = buildApp();

    const response = await request(
      app,
      '/api/super-admin/restore',
      upload('application/json', JSON.stringify(ARCHIVE))
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_archive' });
    expect(savePersistedData).not.toHaveBeenCalled();
  });
});
