// @vitest-environment node
import express from 'express';
import http from 'http';
import { EventEmitter } from 'events';
import type { AddressInfo } from 'net';
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { createImportGateMiddleware } from '../server/routes/superAdminBackupImportRoutes.js';
import { createBackupService } from '../server/services/backupService.js';
import { createRestoreGate } from '../server/services/restoreGate.js';
import { SECURITY_ACTIONS } from '../server/services/securityEvents.js';

/**
 * `POST /api/super-admin/backups/import` — a backup file uploaded from the
 * console becomes one row of the shared `backups` table, of type `imported`,
 * that every backup route then reads unchanged (list, teams, restore-team,
 * restore, download, delete).
 *
 * The app is wired the way `server.js` wires it: the global
 * `express.json({ limit: '1mb' })` comes first. The backup service is the real
 * one over an in-memory backups table, so what is stored is what a download
 * returns; the cases that need to hold an import open replace `importBackup`
 * with a deferred promise.
 *
 * The order of the route's middleware is load-bearing and pinned here: the
 * credential is checked before one byte of the body is read, the per-pod
 * import gate is entered before the body is buffered (so a refused second
 * upload costs no memory), and the gate is held until the handler settles —
 * not until the client leaves, which a gateway 504 makes happen while the
 * server is still parsing.
 */

const SESSION_TOKEN = 'super-admin-token';

type Row = { id: string; filename: string; type: string; label?: string; createdAt: string; sizeBytes: number; teamCount: number; protected: boolean; data: Buffer };

const createBackupTable = () => {
  const rows: Row[] = [];
  return {
    rows,
    saveBackup: vi.fn(async (entry: Omit<Row, 'data'>, data: Buffer) => {
      rows.push({ ...entry, protected: !!entry.protected, data });
    }),
    listBackups: vi.fn(async () => rows.map(({ data: _data, ...rest }) => rest)),
    getBackupData: vi.fn(async (id: string) => {
      const row = rows.find((entry) => entry.id === id);
      return row ? { data: row.data, filename: row.filename } : null;
    }),
    deleteBackup: vi.fn(async (id: string) => {
      const index = rows.findIndex((entry) => entry.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    }),
    updateBackup: vi.fn(async () => null),
    purgeOldBackups: vi.fn(async () => 0),
    getRecentBackupByType: vi.fn(async () => null)
  };
};

const ARCHIVE = {
  teams: [
    { id: 'team-a', name: 'Alpha', members: [] },
    { id: 'team-b', name: 'Beta', members: [] }
  ],
  meta: { revision: 1, updatedAt: '2026-10-01T08:00:00.000Z' },
  resetTokens: [],
  orphanedFeedbacks: []
};
const archiveJson = (data: unknown = ARCHIVE) => Buffer.from(JSON.stringify(data), 'utf8');
const archiveGzip = (data: unknown = ARCHIVE) => gzipSync(archiveJson(data));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const buildApp = ({
  restoreMaxBodyBytes,
  restoreMaxDecompressedBytes
}: { restoreMaxBodyBytes?: number; restoreMaxDecompressedBytes?: number } = {}) => {
  const app = express();
  // Exactly what server.js does, first.
  app.use(express.json({ limit: '1mb' }));

  const table = createBackupTable();
  let releasePersistedRead: (() => void) | null = null;
  // The readers every snapshot is built from (backupArchive.js).
  const noTeams = async function* (): AsyncGenerator<Record<string, unknown>> {
    yield* []; // an empty store
  };
  const dataStore = {
    ...table,
    iterateArchiveTeams: vi.fn(noTeams),
    readArchiveMeta: vi.fn(async () => ({ resetTokens: [], orphanedFeedbacks: [] })),
    savePersistedData: vi.fn(async () => undefined),
    loadTeamSummaries: vi.fn(async () => []),
    holdPersistedRead: () => {
      const released = new Promise<void>((resolve) => {
        releasePersistedRead = resolve;
      });
      dataStore.iterateArchiveTeams.mockImplementationOnce(async function* () {
        await released;
        yield* [];
      });
    },
    releasePersistedRead: () => releasePersistedRead?.()
  };
  const backupService = createBackupService({ dataStore, logService: { addServerLog: vi.fn() } });
  const tokenService = {
    validateSuperAdminAuth: vi.fn((credential: { password?: string; sessionToken?: string } | undefined) =>
      credential?.sessionToken === SESSION_TOKEN),
    validateSuperAdminToken: vi.fn((token: string) => token === SESSION_TOKEN),
    createSuperAdminToken: vi.fn(() => SESSION_TOKEN)
  };
  const recorded: Record<string, unknown>[] = [];
  const securityEvents = {
    record: vi.fn(async (_req: unknown, event: Record<string, unknown>) => {
      recorded.push(event);
    })
  };

  registerSuperAdminRoutes({
    app,
    io: { fetchSockets: vi.fn(async () => []), serverSideEmit: vi.fn() },
    dataStore,
    tokenService,
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() },
    escapeHtml: (value: string) => String(value ?? ''),
    superAdminPassword: 'configured',
    sessionCache: new Map(),
    backupService,
    aiService: {},
    serverRuntime: { multiPodAdapter: false },
    securityEvents,
    restoreMaxBodyBytes,
    restoreMaxDecompressedBytes
  });

  return { app, table, dataStore, backupService, tokenService, recorded, securityEvents };
};

type Harness = ReturnType<typeof buildApp>;

const listen = async (app: express.Express) =>
  new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise<void>((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        })
      });
    });
  });

let harness: Harness;
let port: number;
let close: () => Promise<void>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

const start = async (options: Parameters<typeof buildApp>[0] = {}) => {
  harness = buildApp(options);
  ({ port, close } = await listen(harness.app));
};

beforeEach(() => {
  consoleSpies = [
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  ];
});

afterEach(async () => {
  await close?.();
  for (const spy of consoleSpies) spy.mockRestore();
});

const importFile = (
  body: Buffer | string,
  {
    contentType = 'application/octet-stream',
    token = SESSION_TOKEN as string | null,
    label,
    signal
  }: { contentType?: string; token?: string | null; label?: string; signal?: AbortSignal } = {}
) => {
  const headers: Record<string, string> = { 'content-type': contentType };
  if (token !== null) headers['x-super-admin-session-token'] = token;
  if (label !== undefined) headers['x-backup-label'] = label;
  return fetch(`http://127.0.0.1:${port}/api/super-admin/backups/import`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : new Uint8Array(body),
    signal
  });
};

const postJson = (path: string, body: Record<string, unknown>) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionToken: SESSION_TOKEN, ...body })
  });

/**
 * A request whose body never finishes: it announces more bytes than it sends,
 * then its socket is destroyed. The raw parser is still waiting when the
 * client goes, so the handler never runs.
 */
const abortMidUpload = async () => {
  await new Promise<void>((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/api/super-admin/backups/import',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': '100000',
        'x-super-admin-session-token': SESSION_TOKEN
      }
    });
    req.on('error', () => resolve());
    req.on('close', () => resolve());
    req.write(Buffer.alloc(1000, 1), () => {
      setTimeout(() => req.destroy(), 50);
    });
  });
};

describe('authentication comes before the body', () => {
  it('answers 401, not 413, to an unauthenticated upload larger than the limit, and never reads it', async () => {
    await start({ restoreMaxBodyBytes: 1024 });
    const importSpy = vi.spyOn(harness.backupService, 'importBackup');

    const response = await importFile(Buffer.alloc(2 * 1024 * 1024, 7), { token: null });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(harness.tokenService.validateSuperAdminAuth).toHaveBeenCalledWith({ password: undefined, sessionToken: undefined });
    expect(importSpy).not.toHaveBeenCalled();
    expect(harness.table.saveBackup).not.toHaveBeenCalled();
  });

  it('refuses a wrong session token', async () => {
    await start();
    const response = await importFile(archiveGzip(), { token: 'forged' });
    expect(response.status).toBe(401);
    expect(harness.table.saveBackup).not.toHaveBeenCalled();
    expect(harness.recorded).toEqual([]);
  });

  // The route owns its limiter (the console's action settings: 60 per 15
  // minutes, every answer counted), as each super-admin route module does.
  it('limits the route to 60 attempts per 15 minutes, before the credential is checked', async () => {
    await start();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect((await importFile(archiveGzip(), { token: 'forged' })).status).toBe(401);
    }
    const limited = await importFile(archiveGzip());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'too_many_attempts', retryAfter: '15 minutes' });
    expect(harness.table.saveBackup).not.toHaveBeenCalled();
  });

  it('refuses a body another parser claimed, so only an upload is ever read', async () => {
    await start();
    // `application/json` is parsed by the global JSON parser into an array;
    // the raw parser then skips it, and the route must not read it as a file.
    const response = await importFile(JSON.stringify([1, 2, 3]), { contentType: 'application/json' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_archive' });
    expect(harness.table.saveBackup).not.toHaveBeenCalled();
  });
});

describe('content types', () => {
  it.each([
    ['application/gzip', archiveGzip],
    ['application/x-gzip', archiveGzip],
    ['application/octet-stream', archiveGzip],
    ['application/octet-stream', archiveJson]
  ])('imports a file sent as %s', async (contentType, body) => {
    await start();
    const response = await importFile(body(), { contentType });
    expect(response.status).toBe(200);
    const answer = await response.json();
    expect(answer).toMatchObject({ success: true, backup: { type: 'imported', teamCount: 2, protected: false } });
    expect(harness.table.rows).toHaveLength(1);
  });

  it('cannot take application/json: the global parser claims it first (H30)', async () => {
    await start();
    const importSpy = vi.spyOn(harness.backupService, 'importBackup');
    const response = await importFile(archiveJson(), { contentType: 'application/json' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_archive' });
    expect(importSpy).not.toHaveBeenCalled();
  });

  it('refuses an empty body', async () => {
    await start();
    const response = await importFile(Buffer.alloc(0));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_archive' });
  });
});

describe('size limits', () => {
  it('answers a body over RESTORE_MAX_BODY_MB with JSON, not Express’s HTML page', async () => {
    await start({ restoreMaxBodyBytes: 1024 });
    const response = await importFile(Buffer.alloc(4096, 1));
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(await response.json()).toEqual({ error: 'backup_file_too_large', maxBytes: 1024 });
    expect(harness.table.saveBackup).not.toHaveBeenCalled();
  });

  it('answers an archive that unpacks past the cap with its own code', async () => {
    await start({ restoreMaxDecompressedBytes: 64 });
    const response = await importFile(archiveGzip());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'restore_archive_too_large', maxBytes: 64 });
    expect(harness.table.saveBackup).not.toHaveBeenCalled();
  });
});

describe('bad content', () => {
  it.each([
    ['garbage bytes', () => Buffer.from('this is not a backup')],
    ['a truncated gzip', () => { const full = archiveGzip(); return full.subarray(0, full.length - 12); }],
    ['a corrupt gzip', () => Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08]), Buffer.from('junk junk junk')])]
  ])('answers 400 invalid_backup_format for %s', async (_label, body) => {
    await start();
    const response = await importFile(body());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_backup_format' });
    expect(harness.table.saveBackup).not.toHaveBeenCalled();
    expect(harness.recorded).toEqual([]);
  });

  it.each([
    ['an array', [ARCHIVE], { reason: 'not_an_object' }],
    ['no teams', { meta: {} }, { reason: 'teams_missing' }],
    ['nameless teams', { teams: [{ id: 'a', name: 'A' }, { id: 'b' }] }, { reason: 'team_malformed', count: 1, positions: [1] }],
    ['one team twice', { teams: [{ id: 'a', name: 'A' }, { id: 'a', name: 'A again' }] }, { reason: 'team_id_duplicated', ids: ['a'] }],
    ['orphaned feedbacks that are not a list', { teams: [], orphanedFeedbacks: 'none' }, { reason: 'list_malformed', field: 'orphanedFeedbacks' }]
  ])('answers 400 invalid_backup_data for %s, saying why', async (_label, data, details) => {
    await start();
    const response = await importFile(archiveGzip(data));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_backup_data', ...details });
    expect(harness.table.saveBackup).not.toHaveBeenCalled();
    expect(harness.recorded).toEqual([]);
  });
});

describe('the per-pod import gate', () => {
  it('refuses a second import while one is running, without handing its body to the service', async () => {
    await start();
    const pending = deferred<never>();
    const importSpy = vi.spyOn(harness.backupService, 'importBackup').mockImplementationOnce(() => pending.promise);

    const first = importFile(archiveGzip());
    await vi.waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1));

    const second = await importFile(archiveGzip());
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'import_in_progress' });
    expect(importSpy).toHaveBeenCalledTimes(1);

    pending.reject(new Error('store down'));
    expect((await first).status).toBe(500);

    // Released on the failure path too.
    const third = await importFile(archiveGzip());
    expect(third.status).toBe(200);
  });

  it('is released after a refused file and after a body over the limit', async () => {
    await start({ restoreMaxBodyBytes: 4096 });
    expect((await importFile(Buffer.from('not a backup'))).status).toBe(400);
    expect((await importFile(Buffer.alloc(8192, 1))).status).toBe(413);
    expect((await importFile(archiveGzip())).status).toBe(200);
  });

  it('stays held while the work runs after the client has gone (a gateway 504), and only then is released', async () => {
    await start();
    const pending = deferred<unknown>();
    const importSpy = vi.spyOn(harness.backupService, 'importBackup').mockImplementationOnce(() => pending.promise as never);

    const controller = new AbortController();
    const first = importFile(archiveGzip(), { signal: controller.signal }).catch((err: unknown) => err);
    await vi.waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await first).toBeInstanceOf(Error);

    // The first import is still parsing and inserting: a retry is refused.
    const retry = await importFile(archiveGzip());
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: 'import_in_progress' });

    pending.resolve({ entry: { id: 'late', type: 'imported', teamCount: 2, sizeBytes: 1 }, sha256: 'x', compressed: true });
    await vi.waitFor(async () => expect((await importFile(archiveGzip())).status).toBe(200));
  });

  it('is released when the client aborts mid-upload, before the handler ever runs', async () => {
    await start();
    const importSpy = vi.spyOn(harness.backupService, 'importBackup');

    await abortMidUpload();

    await vi.waitFor(async () => expect((await importFile(archiveGzip())).status).toBe(200));
    // Only the last import reached the service.
    expect(importSpy).toHaveBeenCalledTimes(1);
  });

  it('answers 500 import_failed, never "invalid file", when the service fails unexpectedly', async () => {
    await start();
    vi.spyOn(harness.backupService, 'importBackup').mockRejectedValueOnce(new Error('disk full'));
    const response = await importFile(archiveGzip());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'import_failed' });
  });

  it('does not wait for a restore: the import and restore gates are separate', async () => {
    await start();
    const firstImport = await (await importFile(archiveGzip())).json();
    // A whole-store restore holds the restore gate while its snapshot reads the store.
    harness.dataStore.holdPersistedRead();
    const restore = postJson('/api/super-admin/backups/restore', { backupId: firstImport.backup.id });
    await vi.waitFor(() => expect(harness.dataStore.iterateArchiveTeams).toHaveBeenCalled());

    const response = await importFile(archiveGzip());
    expect(response.status).toBe(200);

    harness.dataStore.releasePersistedRead();
    expect((await restore).status).toBe(200);
  });
});

describe('the gate middleware', () => {
  const fakeResponse = () => {
    const res = new EventEmitter() as EventEmitter & { locals: Record<string, any>; status: (code: number) => any; json: (body: unknown) => any; statusCode?: number; body?: unknown };
    res.locals = {};
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      return res;
    };
    return res;
  };

  it('never lets a request release a hold another request now has', () => {
    const gate = createRestoreGate();
    const enter = createImportGateMiddleware(gate);

    // A enters, its client aborts mid-upload: released by 'close'.
    const resA = fakeResponse();
    const nextA = vi.fn();
    enter({}, resA, nextA);
    expect(nextA).toHaveBeenCalledTimes(1);
    resA.emit('close');

    // B enters and starts its work.
    const resB = fakeResponse();
    const nextB = vi.fn();
    enter({}, resB, nextB);
    expect(nextB).toHaveBeenCalledTimes(1);
    resB.locals.importGate.handlerStarted = true;

    // A's late events (its body-error handler, a second close) release nothing.
    resA.locals.importGate.release();
    resA.emit('close');
    expect(gate.tryEnter()).toBe(false);

    // B's client leaving does not release it either: B's handler owns it now.
    resB.emit('close');
    expect(gate.tryEnter()).toBe(false);

    // B settles: released once, and a third request enters.
    resB.locals.importGate.release();
    resB.locals.importGate.release();
    const resC = fakeResponse();
    const nextC = vi.fn();
    enter({}, resC, nextC);
    expect(nextC).toHaveBeenCalledTimes(1);
  });

  it('answers 409 without calling next when the gate is held', () => {
    const gate = createRestoreGate();
    gate.tryEnter();
    const res = fakeResponse();
    const next = vi.fn();
    createImportGateMiddleware(gate)({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'import_in_progress' });
  });
});

describe('the label', () => {
  it('reaches the stored row decoded, and never the file name', async () => {
    await start();
    const name = 'Sauvegarde du 1er octobre.json.gz';
    const response = await importFile(archiveGzip(), { label: encodeURIComponent(name) });
    const { backup } = await response.json();
    expect(backup.label).toBe(name);
    expect(backup.filename).toMatch(/^retrogemini-import-[0-9T-]+Z\.json\.gz$/);
    expect(backup.filename).not.toContain('Sauvegarde');

    const download = await postJson('/api/super-admin/backups/download', { backupId: backup.id });
    expect(download.headers.get('content-disposition')).toBe(`attachment; filename="${backup.filename}"`);
  });

  it('is dropped when it does not decode', async () => {
    await start();
    const importSpy = vi.spyOn(harness.backupService, 'importBackup');
    const response = await importFile(archiveGzip(), { label: '%' });
    expect(response.status).toBe(200);
    expect(importSpy).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ label: null }));
    expect((await response.json()).backup.label).toBeUndefined();
  });
});

describe('the stored row', () => {
  it('downloads as the very bytes that were imported', async () => {
    await start();
    const upload = archiveGzip();
    const { backup } = await (await importFile(upload)).json();
    const download = await postJson('/api/super-admin/backups/download', { backupId: backup.id });
    expect(Buffer.compare(Buffer.from(await download.arrayBuffer()), upload)).toBe(0);
  });

  it('is listed, with the upload limits the console checks a file against', async () => {
    await start({ restoreMaxBodyBytes: 4096, restoreMaxDecompressedBytes: 8192 });
    await importFile(archiveGzip());
    const list = await (await postJson('/api/super-admin/backups/list', {})).json();
    expect(list.backups).toEqual([expect.objectContaining({ type: 'imported', teamCount: 2 })]);
    expect(list.limits).toEqual({ maxArchiveBytes: 4096, maxUnpackedBytes: 8192 });
  });
});

describe('the audit trail', () => {
  it('records exactly one backup.import row naming the file by its SHA-256', async () => {
    await start();
    const upload = archiveGzip();
    const { backup } = await (await importFile(upload, { label: encodeURIComponent('october.json.gz') })).json();

    const rows = harness.recorded.filter((event) => event.action === SECURITY_ACTIONS.BACKUP_IMPORT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      action: 'backup.import',
      actor: 'super-admin',
      outcome: 'success',
      target: backup.id,
      detail: {
        teamCount: 2,
        sizeBytes: upload.length,
        uploadedBytes: upload.length,
        compressed: true,
        sha256: createHash('sha256').update(upload).digest('hex'),
        label: 'october.json.gz'
      }
    });
  });

  it('records nothing for a refused file', async () => {
    await start();
    await importFile(archiveGzip({ teams: {} }));
    await importFile(Buffer.from('nope'));
    expect(harness.recorded).toEqual([]);
  });

  it('never fails an import because the audit write failed', async () => {
    await start();
    harness.securityEvents.record.mockRejectedValueOnce(new Error('audit table down'));
    const response = await importFile(archiveGzip());
    expect(response.status).toBe(200);
    expect(harness.table.rows).toHaveLength(1);
  });
});
