import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { migrateLegacyPasswords } from '../server/services/passwordMigration.js';
import { hashPassword, isHashedPassword, verifyPassword } from '../server/services/passwordHashing.js';

/**
 * The legacy password pass runs at every boot and after both restore routes.
 * It used to read every team's full record into Node (`loadAllTeams`) to look
 * at one field — at 25 MB of team data, the read that took boot closest to the
 * pod's memory limit. It now reads each team's `id` and `passwordHash` through
 * one projection in SQL, and never the records.
 *
 * SQLite always runs (the engine CI uses). The same suite runs against a real
 * PostgreSQL when `TEST_DATABASE_URL` is set, e.g.
 * `TEST_DATABASE_URL=postgres://user:pass@localhost/db npx vitest run --no-file-parallelism __tests__/passwordMigrationProjection.test.ts`.
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

type Json = Record<string, unknown>;

const heavyHistory = () =>
  Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, tickets: Array.from({ length: 20 }, (_, k) => ({ id: `k${k}`, text: 'y'.repeat(60) })) }));

const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-pw-projection-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-pw-projection-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`legacy password pass reads two fields (${engine.name})`, () => {
    let store: ReturnType<typeof createDataStore>;
    let dir: string;
    const savedEnv: Record<string, string | undefined> = {};
    const prefix = `pw${Date.now().toString(36)}`;
    const created = new Set<string>();
    const tid = (n: string) => {
      const id = `${prefix}-${n}`;
      created.add(id);
      return id;
    };

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      store = createDataStore({ rootDir: dir });
      await store.initDatabase();
    });

    afterAll(async () => {
      for (const id of created) await store.deleteTeamRecord(id).catch(() => {});
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

    const ours = (rows: { id: string | null }[]) => rows.filter((row) => String(row.id).startsWith(prefix));

    it('hashes a legacy record without ever loading a full one', async () => {
      const legacy = tid('legacy');
      const hashed = tid('hashed');
      const realHash = await hashPassword('already-hashed');
      await store.saveTeam(legacy, { id: legacy, name: 'Legacy', passwordHash: 'open-sesame', retrospectives: heavyHistory() });
      await store.saveTeam(hashed, { id: hashed, name: 'Hashed', passwordHash: realHash, retrospectives: heavyHistory() });
      const hashedRevBefore = ((await store.loadTeamRaw(hashed)) as Json)._rev;

      const loadAllTeams = vi.spyOn(store, 'loadAllTeams');
      const loadTeam = vi.spyOn(store, 'loadTeam');
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        const result = await migrateLegacyPasswords({ dataStore: store });
        expect(result.error).toBe(false);
        expect(result.upgraded).toBeGreaterThanOrEqual(1);
        expect(result.failed).toBe(0);
        expect(loadAllTeams).not.toHaveBeenCalled();
        expect(loadTeam).not.toHaveBeenCalled();
      } finally {
        loadAllTeams.mockRestore();
        loadTeam.mockRestore();
        info.mockRestore();
      }

      const upgraded = (await store.loadTeamRaw(legacy)) as Json;
      expect(isHashedPassword(upgraded.passwordHash)).toBe(true);
      expect(await verifyPassword('open-sesame', upgraded.passwordHash as string)).toBe(true);
      expect(((await store.loadTeamRaw(hashed)) as Json)._rev).toBe(hashedRevBefore);
      // The rest of the record survives the write.
      expect(upgraded.retrospectives).toEqual(heavyHistory());
    });

    it('answers only the id and a string hash, null for anything else', async () => {
      const numeric = tid('numeric');
      const none = tid('none');
      const plain = tid('plain');
      await store.saveTeam(numeric, { id: numeric, name: 'Numeric', passwordHash: 1234 });
      await store.saveTeam(none, { id: none, name: 'None' });
      await store.saveTeam(plain, { id: plain, name: 'Plain', passwordHash: 'x', facilitatorEmail: 'a@example.org', retrospectives: heavyHistory() });

      const rows = ours(await store.loadTeamPasswordHashes());
      for (const row of rows) expect(Object.keys(row).sort()).toEqual(['id', 'passwordHash']);
      const byId = Object.fromEntries(rows.map((row: { id: string | null; passwordHash: string | null }) => [row.id, row.passwordHash]));
      expect(byId[numeric]).toBeNull();
      expect(byId[none]).toBeNull();
      expect(byId[plain]).toBe('x');
    });
  });
}
