import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDataStore } from '../server/services/dataStore.js';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * The console's Live tab names each room's team. Since 41.2 it reads the team
 * summaries for that, one statement over every team row, and one row that
 * statement cannot read fails it whole: on PostgreSQL a record `::jsonb`
 * refuses (a lone surrogate escape a 41.0 client wrote by cutting an emoji in
 * half, a NUL escape), on both engines a truncated one. The repair runbook
 * (k8s/README.md → *A team record PostgreSQL's jsonb refuses*) asks the admin
 * to check on this tab that none of the team's sessions is open, so the tab
 * must keep working in exactly that state.
 *
 * SQLite always runs; the same cases run against a real PostgreSQL when
 * `TEST_DATABASE_URL` is set (with `--no-file-parallelism`: that run shares
 * rows with the other suites reading the variable).
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

const TOKEN = 'live-tab-token';

const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-live-tab-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-live-tab-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`the Live tab with a team row the summaries cannot read (${engine.name})`, () => {
    let store: ReturnType<typeof createDataStore>;
    let dir: string;
    const savedEnv: Record<string, string | undefined> = {};
    const prefix = `lt${Date.now().toString(36)}`;
    const keys = new Set<string>();

    const writeRaw = async (key: string, text: string) => {
      keys.add(key);
      const pool = store.getPgPool();
      if (pool) {
        await pool.query(
          `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, text]
        );
        return;
      }
      store.getSqliteDb().prepare(
        `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      ).run(key, text);
    };

    const team = (id: string, name: string, extra: Record<string, unknown> = {}) =>
      ({ id, name, passwordHash: 'scrypt$1$1$1$salt$x', members: [], retrospectives: [], _rev: 1, ...extra });

    // Every open room, as the socket registry reports it, and its session.
    const liveApp = (rooms: Record<string, string>) => {
      const app = express();
      app.use(express.json());
      const sessionCache = new Map<string, unknown>(
        Object.entries(rooms).map(([room, teamId]) => [room, { id: room, teamId, name: `Retro ${room}`, phase: 'BRAINSTORM' }])
      );
      registerSuperAdminRoutes({
        app,
        io: {
          fetchSockets: async () => Object.keys(rooms).map((room, i) => (
            { id: `sock-${i}`, data: { userId: `u${i}`, userName: `User ${i}` }, rooms: new Set([`sock-${i}`, room]) }
          )),
          serverSideEmit: vi.fn()
        },
        dataStore: store,
        tokenService: {
          validateSuperAdminAuth: (body: { sessionToken?: string } | undefined) => body?.sessionToken === TOKEN,
          validateSuperAdminToken: (token: string) => token === TOKEN
        },
        mailerService: { smtpEnabled: false, mailer: null },
        logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() },
        escapeHtml: (value: string) => String(value ?? ''),
        superAdminPassword: 'unused',
        sessionCache,
        backupService: {},
        aiService: {},
        serverRuntime: { multiPodAdapter: false }
      });
      return app;
    };

    const namesOf = async (rooms: Record<string, string>) => {
      const response = await request(liveApp(rooms), '/api/super-admin/active-sessions', postJson({ sessionToken: TOKEN }));
      expect(response.status).toBe(200);
      const { sessions } = await response.json();
      return Object.fromEntries(sessions.map((s: { sessionId: string; teamName: string }) => [s.sessionId, s.teamName]));
    };

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      store = createDataStore({ rootDir: dir });
      await store.initDatabase();
    });

    afterAll(async () => {
      for (const key of keys) {
        const pool = store.getPgPool();
        if (pool) await pool.query('DELETE FROM kv_store WHERE key = $1', [key]);
      }
      await store.closeDatabase();
      rmSync(dir, { recursive: true, force: true });
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.restoreAllMocks();
    });

    it('names a live room while another team\'s row is truncated', async () => {
      const live = `${prefix}-live`;
      const broken = `${prefix}-broken`;
      await writeRaw(`team:${live}`, JSON.stringify(team(live, 'Platform')));
      await writeRaw(`team:${broken}`, '{"id":"broken","name":');
      // The premise: the list read fails whole on that row.
      await expect(store.loadTeamSummaries()).rejects.toThrow();

      expect(await namesOf({ 'room-live': live })).toEqual({ 'room-live': 'Platform' });

      await writeRaw(`team:${broken}`, JSON.stringify(team(broken, 'Repaired')));
    });

    it('names a live room whose own record holds a lone surrogate escape, and one Node cannot parse as Unknown', async () => {
      const escaped = `${prefix}-escaped`;
      const truncated = `${prefix}-truncated`;
      // What a 41.0 client's action excerpt cut through an emoji stores.
      await writeRaw(`team:${escaped}`, JSON.stringify(team(escaped, 'Mobile', { note: 'ship it \ud83d' })));
      await writeRaw(`team:${truncated}`, '{"id":"truncated","name":');

      expect(await namesOf({ 'room-escaped': escaped, 'room-truncated': truncated })).toEqual({
        'room-escaped': 'Mobile',
        'room-truncated': 'Unknown'
      });

      await writeRaw(`team:${truncated}`, JSON.stringify(team(truncated, 'Repaired')));
    });
  });
}
