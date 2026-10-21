import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

/**
 * `updateGlobalSettings`: the only way to write the `global-settings` row.
 *
 * The row holds several independent settings — the admin email, the new-team
 * notification switch, the info banner, the whole AI configuration — each
 * written by its own console route. Those routes used to load the row, change
 * one key and save the whole blob back, and the load answers `{}` on a read
 * error: one database hiccup during an unrelated save erased every other
 * setting, and two saves on two pods lost each other's change. An update now
 * reads, changes and writes the row in one transaction holding it, and its read
 * is strict: anything it cannot read as one settings object throws, and
 * nothing is written.
 *
 * SQLite always runs (the engine CI uses). The same suite runs against a real
 * PostgreSQL when `TEST_DATABASE_URL` is set, e.g.
 * `TEST_DATABASE_URL=postgres://user:pass@localhost/db npx vitest run __tests__/globalSettingsUpdate.test.ts`.
 * The two-pod race is only meaningful there: SQLite transactions are
 * synchronous, so two stores in one process never interleave. The row is
 * shared by every suite on that database, so its value is put back afterwards.
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

const KEY = 'global-settings';

type Store = ReturnType<typeof createDataStore>;
type Json = Record<string, any>;

const SETTINGS = {
  adminEmail: 'admin@example.test',
  notifyNewTeam: true,
  infoMessage: 'Maintenance on Friday',
  ai: { enabled: true, apiUrl: 'https://llm.internal.example/v1', apiKey: 'sk-key', model: 'mistral' }
};

const engines: { name: string; postgres: boolean; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    postgres: false,
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-global-settings-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    postgres: true,
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-global-settings-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`updateGlobalSettings (${engine.name})`, () => {
    let store: Store;
    let other: Store;
    let dir: string;
    const savedEnv: Record<string, string | undefined> = {};
    let rowBefore: string | null = null;
    const restorers: (() => void)[] = [];

    const readRaw = async (): Promise<string | null> => {
      if (engine.postgres) {
        const result = await (store.getPgPool() as any).query('SELECT value FROM kv_store WHERE key = $1', [KEY]);
        return result.rows[0]?.value ?? null;
      }
      const row = store.getSqliteDb()!.prepare('SELECT value FROM kv_store WHERE key = ?').get(KEY) as { value: string } | undefined;
      return row?.value ?? null;
    };
    const writeRaw = async (value: string) => {
      if (engine.postgres) {
        await (store.getPgPool() as any).query(
          'INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          [KEY, value]
        );
        return;
      }
      store.getSqliteDb()!.prepare(
        'INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(KEY, value);
    };
    const deleteRaw = async () => {
      if (engine.postgres) {
        await (store.getPgPool() as any).query('DELETE FROM kv_store WHERE key = $1', [KEY]);
        return;
      }
      store.getSqliteDb()!.prepare('DELETE FROM kv_store WHERE key = ?').run(KEY);
    };

    // Makes every read of the settings row fail in the driver, as a dropped
    // connection or a disk error would, while writes still work: the case the
    // old load-then-save turned into an erase.
    const failSettingsReads = (target: Store) => {
      const isSettingsRead = (sql: unknown, params: unknown) => (
        typeof sql === 'string' && /^\s*SELECT/i.test(sql) && Array.isArray(params) && params.includes(KEY)
      );
      if (engine.postgres) {
        const pool = target.getPgPool() as any;
        const realQuery = pool.query;
        const realConnect = pool.connect;
        pool.query = function query(sql: unknown, params?: unknown) {
          if (isSettingsRead(sql, params)) return Promise.reject(new Error('connection reset'));
          return realQuery.call(this, sql, params);
        };
        pool.connect = async function connect() {
          const client = await realConnect.call(pool);
          const clientQuery = client.query;
          const clientRelease = client.release;
          client.query = function query(sql: unknown, params?: unknown) {
            if (isSettingsRead(sql, params)) return Promise.reject(new Error('connection reset'));
            return clientQuery.call(client, sql, params);
          };
          // Pooled clients are reused: put the real methods back on release.
          client.release = (...args: unknown[]) => {
            client.query = clientQuery;
            client.release = clientRelease;
            return clientRelease.apply(client, args);
          };
          return client;
        };
        restorers.push(() => {
          pool.query = realQuery;
          pool.connect = realConnect;
        });
        return;
      }
      const db = target.getSqliteDb()! as any;
      const realPrepare = db.prepare;
      db.prepare = function prepare(sql: string) {
        const statement = realPrepare.call(db, sql);
        const realGet = statement.get;
        statement.get = function get(...args: unknown[]) {
          if (isSettingsRead(sql, args)) throw new Error('disk I/O error');
          return realGet.apply(statement, args);
        };
        return statement;
      };
      restorers.push(() => {
        db.prepare = realPrepare;
      });
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
      // A second store on the same database stands in for a second pod.
      other = createDataStore({ rootDir: dir });
      await other.initDatabase();
      rowBefore = await readRaw();
    });

    afterEach(async () => {
      while (restorers.length > 0) restorers.pop()!();
      await deleteRaw();
    });

    afterAll(async () => {
      if (rowBefore !== null) await writeRaw(rowBefore);
      await other.closeDatabase();
      await store.closeDatabase();
      rmSync(dir, { recursive: true, force: true });
      for (const key of PG_ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      vi.restoreAllMocks();
    });

    it('changes only the key the updater sets, and answers what is stored', async () => {
      await writeRaw(JSON.stringify(SETTINGS));

      const result = await store.updateGlobalSettings((current: Json) => ({ ...current, infoMessage: 'New banner' }));

      expect(result).toEqual({ ...SETTINGS, infoMessage: 'New banner' });
      expect(JSON.parse((await readRaw())!)).toEqual({ ...SETTINGS, infoMessage: 'New banner' });
    });

    it('starts from an empty object when the row is missing or empty', async () => {
      const seen: Json[] = [];
      await store.updateGlobalSettings((current: Json) => {
        seen.push(structuredClone(current));
        return { ...current, adminEmail: 'first@example.test' };
      });
      await writeRaw('');
      await store.updateGlobalSettings((current: Json) => {
        seen.push(structuredClone(current));
        return { ...current, notifyNewTeam: true };
      });

      expect(seen).toEqual([{}, {}]);
      expect(JSON.parse((await readRaw())!)).toEqual({ notifyNewTeam: true });
    });

    it('throws and writes nothing when the read fails', async () => {
      await writeRaw(JSON.stringify(SETTINGS));
      const before = await readRaw();
      const updater = vi.fn((current: Json) => ({ ...current, infoMessage: 'New banner' }));
      failSettingsReads(store);

      await expect(store.updateGlobalSettings(updater)).rejects.toThrow();

      while (restorers.length > 0) restorers.pop()!();
      expect(updater).not.toHaveBeenCalled();
      expect(await readRaw()).toBe(before);
    });

    it.each([
      ['does not parse', '{"adminEmail":"admin@example.test",'],
      ['is an array', '["admin@example.test"]'],
      ['is a string', '"admin@example.test"'],
      ['is a number', '42'],
      ['is null', 'null']
    ])('throws and writes nothing when the stored value %s', async (_label, raw) => {
      await writeRaw(raw);
      const updater = vi.fn((current: Json) => ({ ...current, infoMessage: 'New banner' }));

      await expect(store.updateGlobalSettings(updater)).rejects.toThrow();

      expect(updater).not.toHaveBeenCalled();
      expect(await readRaw()).toBe(raw);
    });

    it('writes nothing when the updater answers null or undefined, even through a mutated argument', async () => {
      await writeRaw(JSON.stringify(SETTINGS));
      const before = await readRaw();

      const declined = await store.updateGlobalSettings((current: Json) => {
        current.adminEmail = 'mutated@example.test';
        return null;
      });
      await store.updateGlobalSettings(() => undefined);

      expect(declined).toEqual(SETTINGS);
      expect(await readRaw()).toBe(before);
    });

    it('creates no row when the updater declines on a missing one', async () => {
      // On PostgreSQL the update first inserts an empty row so that two first
      // writers lock the same one; declining must not leave it behind.
      await store.updateGlobalSettings(() => null);

      expect(await readRaw()).toBeNull();
    });

    it('refuses an updater that answers a promise, and writes nothing', async () => {
      // A promise serializes as `{}`: written, it would erase every setting.
      await writeRaw(JSON.stringify(SETTINGS));
      const before = await readRaw();

      await expect(store.updateGlobalSettings(async (current: Json) => ({ ...current, infoMessage: 'x' })))
        .rejects.toThrow(TypeError);

      expect(await readRaw()).toBe(before);
    });

    it.each([
      ['an array', () => ['admin@example.test']],
      ['a Map', () => new Map([['adminEmail', 'admin@example.test']])],
      ['a string', () => 'admin@example.test']
    ])('refuses an updater that answers %s, and writes nothing', async (_label, answer) => {
      // Stored, any of these would make every later strict read throw, which
      // is a lock-out of every settings write.
      await writeRaw(JSON.stringify(SETTINGS));
      const before = await readRaw();

      await expect(store.updateGlobalSettings(answer as never)).rejects.toThrow(TypeError);

      expect(await readRaw()).toBe(before);
    });

    it('keeps every one of concurrent updates of different keys, across two stores', async () => {
      // Each round starts from a missing row: two first writers must not both
      // insert it and lose one of their keys. A few rounds, because a race
      // that loses a key only sometimes would otherwise pass by luck.
      const keys = Array.from({ length: 16 }, (_, i) => `key${i}`);

      for (let round = 0; round < 3; round += 1) {
        await deleteRaw();
        await Promise.all(keys.map((key, i) => (i % 2 === 0 ? store : other)
          .updateGlobalSettings((current: Json) => ({ ...current, [key]: round }))));

        expect(JSON.parse((await readRaw())!)).toEqual(Object.fromEntries(keys.map((key) => [key, round])));
      }
    });

    it('leaves the lenient read lenient: a reader still sees "not configured" on an unreadable row', async () => {
      await writeRaw('{not json');

      expect(await store.loadGlobalSettings()).toEqual({});
    });
  });
}

describe('global-settings writers', () => {
  // A source guard, like the audit-trail wiring check: a new console route
  // that writes a setting by loading the row and saving it whole would pass
  // every route test that does not happen to make the read fail. Any file of
  // the backend calling `saveGlobalSettings(` reintroduces that, so none may.
  const root = join(__dirname, '..');
  const backendFiles = (): string[] => {
    const files = [join(root, 'server.js')];
    const walk = (dirPath: string) => {
      for (const name of readdirSync(dirPath)) {
        const path = join(dirPath, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(c|m)?js$/.test(name)) files.push(path);
      }
    };
    walk(join(root, 'server'));
    return files;
  };

  it('go through updateGlobalSettings: no backend file calls saveGlobalSettings', () => {
    const files = backendFiles();
    expect(files.length).toBeGreaterThan(20);
    const offenders = files
      .filter((path) => readFileSync(path, 'utf8').includes('saveGlobalSettings('))
      .map((path) => relative(root, path));

    expect(offenders).toEqual([]);
  });

  it('have no whole-blob save to call', () => {
    const store = createDataStore({ rootDir: tmpdir() }) as Record<string, unknown>;

    expect(store).not.toHaveProperty('saveGlobalSettings');
    expect(typeof store.updateGlobalSettings).toBe('function');
  });
});
