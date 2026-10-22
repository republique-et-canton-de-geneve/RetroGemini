// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { createDataStore } from '../server/services/dataStore.js';
import { createBackupService } from '../server/services/backupService.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';

/**
 * A backup that cannot read every team record is a failed backup — never an
 * archive that silently misses teams.
 *
 * Every archive used to be read through `loadPersistedData`, which answered
 * `{ teams: [] }` on any read error. One unreadable team row was enough for
 * every backup to store an EMPTY archive and report success: the manual
 * checkpoint said "created", the download sent an empty file, and each
 * pre-restore snapshot was a recovery point holding nothing — right before a
 * destructive replace. Worse, an automatic backup that "succeeds" runs
 * retention, so each failed run purged one good backup.
 *
 * Real SQLite store, real backup service, real routes. One good backup is
 * taken first, then `team:t2` is corrupted by hand.
 */

const PG_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_HOST',
  'POSTGRESQL_SERVICE_HOST',
  'POSTGRES_USER',
  'POSTGRESQL_USER',
  'POSTGRES_PASSWORD',
  'POSTGRESQL_PASSWORD',
  'POSTGRES_DB',
  'POSTGRESQL_DATABASE',
  'DATA_STORE_PATH'
];

const SUPER_ADMIN_PASSWORD = 'strict-backup-reads-test';
// Content that must never reach a log line: it would be a team's data.
const SECRET_CONTENT = 'confidential-retro-text';

type Json = Record<string, any>;

const CORRUPTIONS: [string, string][] = [
  ['truncated JSON', `{"id":"t2","name":"${SECRET_CONTENT}`],
  ['JSON null', 'null'],
  ['a JSON array', '[]'],
  ['an empty value', '']
];

describe('strict backup reads', () => {
  let dir: string;
  let store: ReturnType<typeof createDataStore>;
  let backupService: ReturnType<typeof createBackupService>;
  let server: { post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: Json }>; close: () => Promise<void> };
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv: Record<string, string | undefined> = {};

  const team = (id: string, name: string) => ({
    id,
    name,
    passwordHash: 'x',
    members: [{ id: `${id}-f`, name: 'Ann', color: 'bg-indigo-500', role: 'facilitator' }],
    retrospectives: [{ id: `${id}-r1`, name: 'Sprint 1', tickets: [{ id: 'k1', text: SECRET_CONTENT }] }],
    healthChecks: [],
    globalActions: [],
    teamFeedbacks: []
  });

  const corrupt = (key: string, value: string) => {
    store.getSqliteDb().prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(value, key);
  };
  const setRaw = (key: string, value: string) => {
    store.getSqliteDb().prepare(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, value);
  };
  const backupCount = async () => (await store.listBackups()).length;
  const errorLines = () => errorSpy.mock.calls.map((args: unknown[]) => args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '));

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-strict-backup-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    store = createDataStore({ rootDir: dir });
    await store.initDatabase();
    for (const [id, name] of [['t1', 'Alpha'], ['t2', 'Beta'], ['t3', 'Gamma']]) {
      await store.saveTeam(id, team(id, name));
    }
    await store.saveTeamIndex(new Map([['alpha', 't1'], ['beta', 't2'], ['gamma', 't3']]));

    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    backupService = createBackupService({ dataStore: store, logService: { addServerLog: () => {} } });
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    registerSuperAdminRoutes({
      app,
      io: { emit: () => {}, serverSideEmit: () => {}, fetchSockets: async () => [], to: () => ({ emit: () => {} }) },
      dataStore: store,
      tokenService: createTokenService({
        secureCompare: (x: string, y: string) => x === y,
        superAdminPassword: SUPER_ADMIN_PASSWORD,
        tokenSecret: 'strict-backup-reads-secret'
      }),
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: () => {}, getServerLogs: () => [], clearServerLogs: () => {} },
      escapeHtml: (value: string) => value,
      superAdminPassword: SUPER_ADMIN_PASSWORD,
      sessionCache: new Map(),
      backupService,
      aiService: {},
      serverRuntime: { multiPodAdapter: false }
    });
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => {
        const { port } = listener.address() as AddressInfo;
        resolve({
          post: async (path, body, headers = { 'Content-Type': 'application/json' }) => {
            const response = await fetch(`http://127.0.0.1:${port}${path}`, {
              method: 'POST',
              headers,
              body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body)
            });
            const text = await response.text();
            const parse = (): Json => {
              try {
                return text ? JSON.parse(text) : {};
              } catch {
                return { raw: text };
              }
            };
            return { status: response.status, body: parse() };
          },
          close: () => new Promise((done) => listener.close(() => done()))
        });
      });
    });
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
    await store.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const admin = (body: Json = {}) => ({ password: SUPER_ADMIN_PASSWORD, ...body });

  describe.each(CORRUPTIONS)('with one team row holding %s', (_label, value) => {
    let goodBackupId: string;

    beforeEach(async () => {
      const good = await backupService.createBackup('manual', 'Before the incident');
      expect(good?.teamCount).toBe(3);
      goodBackupId = good!.id;
      corrupt('team:t2', value);
    });

    it('fails the backup instead of storing an archive without that team, and names the key only', async () => {
      const before = await store.listBackups();
      expect(await backupService.createBackup('manual')).toBeNull();
      expect(await store.listBackups()).toEqual(before);

      const lines = errorLines().filter((line) => line.includes('[Backup] Failed to create backup'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('team:t2');
      expect(lines[0]).not.toContain(SECRET_CONTENT);
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).not.toContain(SECRET_CONTENT);
    });

    it('reports a failed checkpoint as a failure, not as "a backup is already in progress"', async () => {
      const before = await backupCount();
      const response = await server.post('/api/super-admin/backups/create', admin({ label: 'checkpoint' }));
      expect(response).toEqual({ status: 500, body: { error: 'create_failed' } });
      expect(await backupCount()).toBe(before);
    });

    it('refuses to download an archive without that team', async () => {
      const response = await server.post('/api/super-admin/backup', admin());
      expect(response).toEqual({ status: 500, body: { error: 'backup_failed' } });
    });

    it('refuses a stored-backup restore, with nothing written, when its snapshot cannot read the store', async () => {
      const t1Rev = ((await store.loadTeamRaw('t1')) as Json)._rev;
      const before = await backupCount();
      const response = await server.post('/api/super-admin/backups/restore', admin({ backupId: goodBackupId }));
      expect(response).toEqual({ status: 503, body: { error: 'pre_restore_snapshot_failed' } });
      expect(((await store.loadTeamRaw('t1')) as Json)._rev).toBe(t1Rev);
      expect(await backupCount()).toBe(before);
    });

    it('refuses an uploaded restore, with nothing written, when its snapshot cannot read the store', async () => {
      const t1Rev = ((await store.loadTeamRaw('t1')) as Json)._rev;
      const before = await backupCount();
      const archive = { teams: [team('t9', 'Uploaded')], resetTokens: [], orphanedFeedbacks: [] };
      const response = await server.post('/api/super-admin/restore', gzipSync(JSON.stringify(archive)), {
        'content-type': 'application/gzip',
        'x-super-admin-password': SUPER_ADMIN_PASSWORD
      });
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'pre_restore_snapshot_failed' });
      expect(((await store.loadTeamRaw('t1')) as Json)._rev).toBe(t1Rev);
      expect(await store.loadTeam('t9')).toBeNull();
      expect(await backupCount()).toBe(before);
    });

    it('refuses a single-team restore, with nothing written, when its snapshot cannot read the store', async () => {
      const t1Rev = ((await store.loadTeamRaw('t1')) as Json)._rev;
      const before = await backupCount();
      const response = await server.post('/api/super-admin/backups/restore-team', admin({ backupId: goodBackupId, teamId: 't1', expected: 'existing' }));
      expect(response).toEqual({ status: 503, body: { error: 'pre_restore_snapshot_failed' } });
      expect(((await store.loadTeamRaw('t1')) as Json)._rev).toBe(t1Rev);
      expect(await backupCount()).toBe(before);
    });
  });

  it('keeps every good backup when a scheduled backup cannot read the store', async () => {
    // Retention runs only after a stored backup: a failed run must not purge
    // a good one, or after BACKUP_MAX_COUNT failed runs no recovery point is
    // left.
    const good = await backupService.createBackup('auto');
    expect(good).toBeTruthy();
    corrupt('team:t2', '');
    const purge = vi.spyOn(store, 'purgeOldBackups');
    expect(await backupService.runScheduledBackup()).toBeNull();
    expect(purge).not.toHaveBeenCalled();
    expect((await store.listBackups()).map((b: Json) => b.id)).toEqual([good!.id]);
  });

  // A whole-store restore refuses an archive holding such a record
  // (archiveShape.js), but failing the backup over it would also take away
  // the single-team restore of every other team in it.
  it('archives a readable team a whole-store restore would refuse, and warns once without naming content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setRaw('team:t4', JSON.stringify({ id: 't4', retrospectives: [{ id: 'r', name: SECRET_CONTENT }] }));
    setRaw('team:t5', JSON.stringify({ name: SECRET_CONTENT }));
    // A second record displaying another team's id (a hand-made copy).
    setRaw('team:t6', JSON.stringify({ id: 't1', name: 'Copy of Alpha', retrospectives: [{ id: 'r', name: SECRET_CONTENT }] }));

    const entry = await backupService.createBackup('manual');
    expect(entry?.teamCount).toBe(6);
    const lines = warn.mock.calls.map((args) => args.map(String).join(' ')).filter((line) => line.includes('[Backup]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(entry!.filename);
    expect(lines[0]).toContain('3 team record(s)');
    expect(lines[0]).toContain('id "t4"');
    expect(lines[0]).toContain('record #5 in key order (no id)');
    expect(lines[0]).toContain('id "t1" (held by another record)');
    expect(lines[0]).not.toContain(SECRET_CONTENT);
  });

  it('warns about nothing when every team record is restorable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await backupService.createBackup('manual')).toBeTruthy();
    expect(warn.mock.calls.flat().map(String).filter((line) => line.includes('[Backup]'))).toEqual([]);
  });

  describe('retro-meta', () => {
    it.each([
      ['not an object', '[]', 'not_an_object'],
      ['a feedback list that is not a list', '{"orphanedFeedbacks":{},"resetTokens":[]}', 'list_malformed'],
      ['unparsable', '{"orphanedFeedbacks":[', 'unparsable']
    ])('fails the backup when it is %s', async (_label, value, reason) => {
      setRaw('retro-meta', value);
      expect(await backupService.createBackup('manual')).toBeNull();
      const line = errorLines().find((l) => l.includes('[Backup] Failed to create backup'));
      expect(line).toContain(`Record "retro-meta" cannot be archived (${reason})`);
      // It is not a team record, and the line must not send an operator
      // looking for one (k8s/README.md, A backup that cannot read a team fails).
      expect(line).not.toContain('Team record');
    });

    it('backs up with empty lists when there is no retro-meta row at all', async () => {
      store.getSqliteDb().prepare("DELETE FROM kv_store WHERE key = 'retro-meta'").run();
      const entry = await backupService.createBackup('manual');
      expect(entry?.teamCount).toBe(3);
      const archive = await backupService.readBackupArchive(entry!.id);
      expect(archive!.data).toMatchObject({ resetTokens: [], orphanedFeedbacks: [] });
    });
  });

  it('skips a team deleted while the archive is being read (SQLite)', async () => {
    const teams = store.iterateArchiveTeams();
    const first = await teams.next();
    expect(first.value.id).toBe('t1');
    await store.deleteTeamRecord('t2');
    const rest: Json[] = [];
    for await (const next of { [Symbol.asyncIterator]: () => teams }) rest.push(next);
    expect(rest.map((t) => t.id)).toEqual(['t3']);
  });

  it('answers the teams in key order, whatever order they were written in', async () => {
    await store.saveTeam('t0', team('t0', 'Zero'));
    const ids: string[] = [];
    for await (const next of store.iterateArchiveTeams()) ids.push(next.id);
    expect(ids).toEqual(['t0', 't1', 't2', 't3']);
  });
});
