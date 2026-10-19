import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

/**
 * `loadTeamSummaries` is what `/api/team/list` — the login screen — reads, and
 * the summary fields live inside each team's record beside its whole history.
 * Projecting them in SQL still had the database parse every record in full, on
 * PostgreSQL once per projected column: 1.7 s for 40 teams holding 25 MB of
 * retrospectives, and growing with every retro the teams ran.
 *
 * Each pod now keeps the projection of every team keyed by a fingerprint that
 * costs no parse (the row's byte length, plus `xmin` on PostgreSQL and, on
 * SQLite, `updated_at` once another connection has written), and projects only
 * the rows whose fingerprint moved. These tests pin the contract that makes
 * that safe: a write is visible on the next read whoever made it, even one that
 * keeps the record's length; a deletion disappears; and a warm read parses
 * nothing.
 *
 * SQLite always runs (the engine CI uses). The same suite runs against a real
 * PostgreSQL when `TEST_DATABASE_URL` is set, e.g.
 * `TEST_DATABASE_URL=postgres://user:pass@localhost/db npx vitest run __tests__/teamSummaryCache.test.ts`.
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

type Store = ReturnType<typeof createDataStore>;
type Json = Record<string, unknown>;

const heavyHistory = () =>
  Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, tickets: Array.from({ length: 20 }, (_, k) => ({ id: `k${k}`, text: 'x'.repeat(40) })) }));

const team = (id: string, name: string, extra: Json = {}) => ({
  id,
  name,
  facilitatorEmail: `${id}@example.org`,
  lastConnectionDate: '2026-10-01T00:00:00.000Z',
  members: [{ id: `${id}-m1`, name: 'Ann', color: 'bg-indigo-500', role: 'facilitator' }],
  archivedMembers: [{ id: `${id}-old`, name: 'Old', color: 'bg-slate-500', role: 'participant' }],
  mergedFrom: [],
  retrospectives: heavyHistory(),
  ...extra
});

const byId = (summaries: Json[]) => Object.fromEntries(summaries.map((s) => [s.id as string, s]));

const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-summary-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-summary-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`team summary cache (${engine.name})`, () => {
    let store: Store;
    let other: Store;
    let dir: string;
    const savedEnv: Record<string, string | undefined> = {};
    const prefix = `sc${Date.now().toString(36)}`;
    // Every id a test creates, so the cleanup cannot fall out of step with the
    // tests (the PostgreSQL run writes into a shared database).
    const created = new Set<string>();
    const tid = (n: string) => {
      const id = `${prefix}-${n}`;
      created.add(id);
      return id;
    };
    const isPg = engine.name === 'PostgreSQL';

    // The stored `updated_at`, read and written back through THIS store's own
    // connection: on SQLite that never moves `data_version`, so the timestamp
    // is pinned and only the store forgetting its own write can make a
    // same-length change visible.
    const readStamp = async (teamId: string): Promise<string> => {
      const key = `team:${teamId}`;
      if (isPg) return (await store.getPgPool().query('SELECT updated_at::text AS s FROM kv_store WHERE key = $1', [key])).rows[0].s;
      return store.getSqliteDb().prepare('SELECT updated_at AS s FROM kv_store WHERE key = ?').get(key).s;
    };
    const pinStamp = async (teamId: string, stamp: string) => {
      const key = `team:${teamId}`;
      if (isPg) await store.getPgPool().query('UPDATE kv_store SET updated_at = $2::timestamptz WHERE key = $1', [key, stamp]);
      else store.getSqliteDb().prepare('UPDATE kv_store SET updated_at = ? WHERE key = ?').run(stamp, key);
    };
    // A raw write on ANOTHER connection, the way a pod from an older release
    // writes the shared store mid-rollout: it sets `updated_at` and nothing
    // in this store hears about it.
    const foreignWrite = async (teamId: string, value: string) => {
      const key = `team:${teamId}`;
      if (isPg) await other.getPgPool().query('UPDATE kv_store SET value = $2, updated_at = NOW() WHERE key = $1', [key, value]);
      else other.getSqliteDb().prepare("UPDATE kv_store SET value = ?, updated_at = '2099-01-01 00:00:00' WHERE key = ?").run(value, key);
    };
    // Every SQL text this store sends while `run` executes (a spy calls
    // through to the real method).
    const sqlDuring = async (run: () => Promise<unknown>): Promise<string[]> => {
      const spy = isPg ? vi.spyOn(store.getPgPool(), 'query') : vi.spyOn(store.getSqliteDb(), 'prepare');
      try {
        await run();
        return spy.mock.calls.map((call: unknown[]) => String(call[0]));
      } finally {
        spy.mockRestore();
      }
    };
    const ours = async (s: Store = store, options?: Json) =>
      byId((await s.loadTeamSummaries(options)).filter((t: Json) => String(t.id).startsWith(prefix)));

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      store = createDataStore({ rootDir: dir });
      await store.initDatabase();
      // A second store on the same database stands in for a second pod.
      other = createDataStore({ rootDir: dir });
      await other.initDatabase();
    });

    afterAll(async () => {
      for (const id of created) {
        await store.deleteTeamRecord(id).catch(() => {});
      }
      await other.closeDatabase();
      await store.closeDatabase();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('sees its own rename on the very next read, even at the same length and the same timestamp', async () => {
      const id = tid('a');
      await store.saveTeam(id, team(id, 'Alpha'));
      expect((await ours())[id].name).toBe('Alpha');
      const stamp = await readStamp(id);

      // Same byte length, and the timestamp put back: only the store
      // forgetting its own write can make this visible.
      await store.saveTeam(id, team(id, 'Omega'));
      await pinStamp(id, stamp);
      expect((await ours())[id].name).toBe('Omega');
    });

    it('sees a same-length change made through atomicTeamUpdate', async () => {
      const id = tid('b');
      await store.saveTeam(id, team(id, 'Theta'));
      expect((await ours())[id].name).toBe('Theta');
      const stamp = await readStamp(id);

      await store.atomicTeamUpdate(id, (current: Json) => ({ ...current, name: 'Thota' }));
      await pinStamp(id, stamp);
      expect((await ours())[id].name).toBe('Thota');
    });

    it('sees a write made by another pod through the store', async () => {
      const id = tid('c');
      await store.saveTeam(id, team(id, 'Gamma'));
      expect((await ours())[id].name).toBe('Gamma');

      await other.saveTeam(id, team(id, 'Gamma renamed', { lastConnectionDate: '2026-10-19T08:00:00.000Z' }));
      const seen = (await ours())[id];
      expect(seen.name).toBe('Gamma renamed');
      expect(seen.lastConnectionDate).toBe('2026-10-19T08:00:00.000Z');
    });

    it('sees a same-length write another process made behind its back', async () => {
      const id = tid('d');
      await store.saveTeam(id, team(id, 'Delta'));
      expect((await ours())[id].name).toBe('Delta');

      await foreignWrite(id, JSON.stringify(team(id, 'Dolta')));
      expect((await ours())[id].name).toBe('Dolta');
    });

    it('drops a team another pod deleted', async () => {
      const id = tid('e');
      await store.saveTeam(id, team(id, 'Epsilon'));
      expect((await ours())[id]).toBeDefined();
      await other.deleteTeamRecord(id);
      expect((await ours())[id]).toBeUndefined();
    });

    // The point of the cache: a read with nothing new parses no team record.
    it('parses nothing on a warm read', async () => {
      const id = tid('f');
      await store.saveTeam(id, team(id, 'Zeta'));
      await ours();

      const sql = await sqlDuring(() => ours());
      expect(sql.length).toBeGreaterThan(0);
      expect(sql.filter((text) => /json_extract|::jsonb/.test(text))).toEqual([]);
      // SQLite reads `updated_at` only once another connection has written:
      // the column sits after the record, and reaching it walks every page.
      if (!isPg) expect(sql.filter((text) => /updated_at AS stamp/.test(text))).toEqual([]);
    });

    it('hands out copies, so a caller editing a summary cannot change the next one', async () => {
      const id = tid('g');
      await store.saveTeam(id, team(id, 'Eta'));
      const first = (await ours(store, { withArchivedMembers: true, withMergeProvenance: true }))[id];
      (first.members as Json[]).push({ id: 'intruder' });
      (first.members as Json[])[0].name = 'Renamed in place';
      (first.archivedMembers as Json[]).length = 0;
      (first.mergedFrom as Json[]).push({ teamId: 'x' });
      first.name = 'Mutated';

      const second = (await ours(store, { withArchivedMembers: true, withMergeProvenance: true }))[id];
      expect(second.name).toBe('Eta');
      expect(second.members).toHaveLength(1);
      expect((second.members as Json[])[0].name).toBe('Ann');
      expect(second.archivedMembers).toHaveLength(1);
      expect(second.mergedFrom).toEqual([]);
    });

    it('adds the optional fields only when they are asked for', async () => {
      const id = tid('h');
      await store.saveTeam(id, team(id, 'Iota'));
      const plain = (await ours())[id];
      expect(plain).not.toHaveProperty('archivedMembers');
      expect(plain).not.toHaveProperty('mergedFrom');
      expect(plain).not.toHaveProperty('retrospectives');
      expect(plain.facilitatorEmail).toBe(`${id}@example.org`);

      const full = (await ours(store, { withArchivedMembers: true, withMergeProvenance: true }))[id];
      expect(full.archivedMembers).toHaveLength(1);
      expect(full.mergedFrom).toEqual([]);
    });
  });
}
