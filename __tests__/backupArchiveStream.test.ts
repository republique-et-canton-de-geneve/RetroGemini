// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { createDataStore } from '../server/services/dataStore.js';
import { createBackupService } from '../server/services/backupService.js';
import { buildBackupArchive } from '../server/services/backupArchive.js';
import { archiveShapeProblem } from '../server/services/archiveShape.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';

/**
 * The whole-store archive is built one team at a time through gzip.
 *
 * Every backup, snapshot and the download used to load the whole store,
 * stringify it in one piece and gzip it synchronously: three copies of the
 * store at once on a pod serving live sessions. These pin what the streamed
 * builder must keep and what it must change:
 *
 *  - the same archive, byte for byte, as `JSON.stringify(loadPersistedData())`
 *    — which every reader of every release parses — and the same teams as an
 *    independent whole-store scan;
 *  - no single `JSON.stringify` larger than the largest team plus a little;
 *  - the download is the very same builder (compact, no newline);
 *  - archives restore both ways: a new one through the restore path, an old
 *    pretty-printed download through the import;
 *  - a failing read rejects the build and leaves nothing unhandled;
 *  - on PostgreSQL, every team comes from one snapshot.
 *
 * SQLite always runs. The same suite runs against PostgreSQL when
 * `TEST_DATABASE_URL` is set — point it at a TEST database: the archive is the
 * whole store, so this suite empties the database's team rows and
 * `retro-meta`.
 * `TEST_DATABASE_URL=postgres://… npx vitest run --no-file-parallelism __tests__/backupArchiveStream.test.ts`
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

const SUPER_ADMIN_PASSWORD = 'backup-archive-stream-test';
const PINNED = new Date('2026-10-22T08:30:00.000Z');

type Json = Record<string, any>;
type Store = ReturnType<typeof createDataStore>;

// Six teams of 90 to 150 KB, saved out of key order so that the order rows
// were written in (SQLite's rowid) is not the order an archive lists them in.
const WRITE_ORDER = ['t5', 't1', 't4', 't2', 't6', 't3'];
const teamOf = (id: string, index: number): Json => ({
  id,
  name: `Team ${id}`,
  passwordHash: `hash-${id}`,
  facilitatorEmail: `${id}@example.org`,
  members: [{ id: `${id}-f`, name: 'Ann', color: 'bg-indigo-500', role: 'facilitator' }],
  retrospectives: Array.from({ length: 6 + index * 2 }, (_, r) => ({
    id: `${id}-r${r}`,
    name: `Sprint ${r} — «${id}»`,
    tickets: Array.from({ length: 30 }, (_, k) => ({ id: `${id}-r${r}-k${k}`, text: `${'é'.repeat(20)} ${'x'.repeat(40)} "${k}"` }))
  })),
  healthChecks: [],
  globalActions: [{ id: `${id}-a1`, text: 'Fix the pipeline', done: false }],
  teamFeedbacks: []
});

const META = {
  resetTokens: [
    { tokenHash: 'h1', teamId: 't1', expiresAt: 1760000000000 },
    { tokenHash: 'h2', teamId: 't2', expiresAt: 1760000001000 }
  ],
  orphanedFeedbacks: [
    { id: 'of1', teamId: 'gone1', teamName: 'Gone 1', type: 'bug', title: 'One', comments: [] },
    { id: 'of2', teamId: 'gone1', teamName: 'Gone 1', type: 'feature', title: 'Two', comments: [{ id: 'c1', text: 'Reply' }] },
    { id: 'of3', teamId: 'gone2', teamName: 'Gone 2', type: 'bug', title: 'Three', comments: [] }
  ]
};

const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-archive-stream-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-archive-stream-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`streamed backup archive (${engine.name})`, () => {
    const isPg = engine.name === 'PostgreSQL';
    let dir: string;
    let store: Store;
    let other: Store;
    let backupService: ReturnType<typeof createBackupService>;
    const savedEnv: Record<string, string | undefined> = {};
    const createdBackups: string[] = [];

    const clearStore = async () => {
      const text = "DELETE FROM kv_store WHERE key LIKE 'team:%' OR key = 'retro-meta' OR key = 'team-index'";
      if (isPg) await store.getPgPool().query(text);
      else store.getSqliteDb().prepare(text).run();
    };
    const seed = async () => {
      await clearStore();
      for (const [index, id] of WRITE_ORDER.entries()) await store.saveTeam(id, teamOf(id, index));
      await store.saveMetaData(structuredClone(META));
    };
    const storedBytes = async (backupId: string) => (await store.getBackupData(backupId))!.data as Buffer;
    const track = <T extends { id: string } | null>(entry: T) => {
      if (entry) createdBackups.push(entry.id);
      return entry;
    };

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      store = createDataStore({ rootDir: dir });
      await store.initDatabase();
      other = createDataStore({ rootDir: dir });
      await other.initDatabase();
      backupService = createBackupService({ dataStore: store, logService: { addServerLog: () => {} } });
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    afterAll(async () => {
      for (const id of createdBackups) await store.deleteBackup(id).catch(() => {});
      await clearStore().catch(() => {});
      vi.restoreAllMocks();
      await other.closeDatabase();
      await store.closeDatabase();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('stores exactly the bytes of the whole-store archive, in key order', async () => {
      await seed();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(PINNED);

      const entry = track(await backupService.createBackup('manual', 'stream'))!;
      const saved = await storedBytes(entry.id);
      const text = gunzipSync(saved).toString('utf8');
      const reference = await store.loadPersistedData();

      expect(JSON.parse(text)).toEqual(reference);
      expect(text).toBe(JSON.stringify(reference));
      expect(entry.teamCount).toBe(6);
      expect(entry.sizeBytes).toBe(saved.length);
      expect(JSON.parse(text).teams.map((team: Json) => team.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
      expect(JSON.parse(text)).toMatchObject({ meta: { revision: 0, updatedAt: PINNED.toISOString() }, ...META });
    });

    // The reference above is read through the same readers as the archive,
    // so a reading bug would hide in both. The one-statement scan they
    // replaced is independent of them.
    it('holds the same teams as an independent whole-store scan', async () => {
      await seed();
      const entry = track(await backupService.createBackup('manual'))!;
      const archived = JSON.parse(gunzipSync(await storedBytes(entry.id)).toString('utf8'));
      const byId = (a: Json, b: Json) => String(a.id).localeCompare(String(b.id));
      expect([...archived.teams].sort(byId)).toEqual([...(await store.loadAllTeams())].sort(byId));
    });

    it('never stringifies more than one team at a time', async () => {
      await seed();
      const realStringify = JSON.stringify;
      const largest = Math.max(...(await store.loadAllTeams()).map((team: Json) => realStringify(team).length));
      const lengths: number[] = [];
      const spy = vi.spyOn(JSON, 'stringify').mockImplementation(function (this: unknown, ...args: Parameters<typeof JSON.stringify>) {
        const out = realStringify.apply(JSON, args);
        if (typeof out === 'string') lengths.push(out.length);
        return out;
      } as typeof JSON.stringify);
      let entry;
      try {
        entry = track(await backupService.createBackup('manual', 'bounded'));
      } finally {
        spy.mockRestore();
      }
      expect(entry).toBeTruthy();
      const archive = gunzipSync(await storedBytes(entry!.id)).toString('utf8');
      // The bound means something only if the store is much larger than one team.
      expect(archive.length).toBeGreaterThan(3 * largest);
      expect(Math.max(...lengths)).toBeLessThanOrEqual(largest + 1024);
    });

    it('sends the same compact archive from the download route', async () => {
      await seed();
      const app = express();
      app.use(express.json({ limit: '1mb' }));
      registerSuperAdminRoutes({
        app,
        io: { emit: () => {}, serverSideEmit: () => {}, fetchSockets: async () => [], to: () => ({ emit: () => {} }) },
        dataStore: store,
        tokenService: createTokenService({
          secureCompare: (x: string, y: string) => x === y,
          superAdminPassword: SUPER_ADMIN_PASSWORD,
          tokenSecret: 'backup-archive-stream-secret'
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
      const listener = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
        const started = app.listen(0, '127.0.0.1', () => resolve(started));
      });
      try {
        const { port } = listener.address() as AddressInfo;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(PINNED);
        const response = await fetch(`http://127.0.0.1:${port}/api/super-admin/backup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: SUPER_ADMIN_PASSWORD })
        });
        expect(response.status).toBe(200);
        const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
        expect(text).not.toContain('\n');
        expect(JSON.parse(text)).toEqual(await store.loadPersistedData());
      } finally {
        vi.useRealTimers();
        await new Promise<void>((done) => listener.close(() => done()));
      }
    });

    it('restores both ways: a new archive through the restore path, an old pretty-printed one through the import', async () => {
      await seed();
      const original = await store.loadPersistedData();
      const entry = track(await backupService.createBackup('manual', 'round trip'))!;

      const read = await backupService.readBackupArchive(entry.id);
      expect(archiveShapeProblem(read!.data)).toBeNull();
      expect(read!.data).toEqual(JSON.parse(gunzipSync(await storedBytes(entry.id)).toString('utf8')));

      const withoutClock = (data: Json) => ({ ...data, meta: { ...data.meta, updatedAt: null } });
      await clearStore();
      await backupService.restoreFromBackup(entry.id);
      expect(withoutClock(await store.loadPersistedData())).toEqual(withoutClock(original));

      // What a 41.0 download looked like: the same data, pretty-printed.
      const imported = await backupService.importBackup(Buffer.from(JSON.stringify(original, null, 2), 'utf8'));
      track(imported.entry);
      await clearStore();
      await backupService.restoreFromBackup(imported.entry.id);
      expect(withoutClock(await store.loadPersistedData())).toEqual(withoutClock(original));
    });

    it('rejects with the source\'s error, and leaves nothing unhandled, when a read fails part-way', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const failure = Object.assign(new Error('Team record "team:t3" cannot be archived (unparsable)'), { code: 'BACKUP_READ_FAILED' });
        const failing = {
          iterateArchiveTeams: async function* () {
            yield teamOf('t1', 0);
            yield teamOf('t2', 1);
            throw failure;
          },
          readArchiveMeta: async () => structuredClone(META)
        };
        await expect(buildBackupArchive({ dataStore: failing })).rejects.toBe(failure);
        await new Promise((r) => setTimeout(r, 50));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    // A console deletion of a merge source moves its feedbacks into the
    // merged team, then deletes the source. A backup reading the merged team
    // before the move and the source after the delete would hold those
    // feedbacks nowhere — unless every team comes from one snapshot.
    it.skipIf(!isPg)('reads every team from one snapshot, and gives its connection back', async () => {
      await clearStore();
      const feedback = { id: 'moved-1', teamId: 'm-source', teamName: 'Source', type: 'bug', title: 'Moved', comments: [] };
      await store.saveTeam('a-merged', { ...teamOf('a-merged', 0), teamFeedbacks: [] });
      await store.saveTeam('m-source', { ...teamOf('m-source', 1), teamFeedbacks: [feedback] });
      await store.saveTeam('z-other', teamOf('z-other', 2));

      const pool = store.getPgPool();
      const busyBefore = pool.totalCount - pool.idleCount;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let firstRead!: () => void;
      const firstTeamRead = new Promise<void>((resolve) => { firstRead = resolve; });
      const held = {
        readArchiveMeta: () => store.readArchiveMeta(),
        iterateArchiveTeams: async function* () {
          let first = true;
          for await (const team of store.iterateArchiveTeams()) {
            yield team;
            if (first) {
              first = false;
              firstRead();
              await gate;
            }
          }
        }
      };
      const building = buildBackupArchive({ dataStore: held });
      await firstTeamRead;

      // The move, from another pod, while the backup holds its snapshot.
      await other.atomicTeamUpdate('a-merged', (team: Json) => ({ ...team, teamFeedbacks: [{ ...feedback, movedFromTeamId: 'm-source' }] }));
      await other.deleteTeamRecord('m-source');
      release();

      const archive = JSON.parse(gunzipSync((await building).data).toString('utf8'));
      const holders = archive.teams.filter((team: Json) => (team.teamFeedbacks || []).some((f: Json) => f.id === 'moved-1'));
      expect(holders.map((team: Json) => team.id)).toEqual(['m-source']);
      expect(pool.totalCount - pool.idleCount).toBe(busyBefore);
    });
  });
}
