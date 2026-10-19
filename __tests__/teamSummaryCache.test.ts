import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
 * costs no parse (the row's `updated_at` and byte length), and projects only
 * the rows whose fingerprint moved. These tests pin the contract that makes
 * that safe: a write is visible on the next read whoever made it, a deletion
 * disappears, and an unchanged row is never parsed again.
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
    const tid = (n: string) => `${prefix}-${n}`;

    // Raw writes that bypass this pod, the way another pod (or a pod from an
    // older release, mid-rollout) writes the shared store.
    const rawUpdate = async (teamId: string, value: string, touchStamp: boolean) => {
      const key = `team:${teamId}`;
      if (engine.name === 'PostgreSQL') {
        const sql = touchStamp
          ? 'UPDATE kv_store SET value = $2, updated_at = NOW() WHERE key = $1'
          : 'UPDATE kv_store SET value = $2 WHERE key = $1';
        await store.getPgPool().query(sql, [key, value]);
      } else {
        const sql = touchStamp
          ? "UPDATE kv_store SET value = ?, updated_at = '2099-01-01 00:00:00' WHERE key = ?"
          : 'UPDATE kv_store SET value = ? WHERE key = ?';
        store.getSqliteDb().prepare(sql).run(value, key);
      }
    };
    const rawValue = async (teamId: string): Promise<string> => {
      const key = `team:${teamId}`;
      if (engine.name === 'PostgreSQL') {
        return (await store.getPgPool().query('SELECT value FROM kv_store WHERE key = $1', [key])).rows[0].value;
      }
      return store.getSqliteDb().prepare('SELECT value FROM kv_store WHERE key = ?').get(key).value;
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
      for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        await store.deleteTeamRecord(tid(id)).catch(() => {});
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

    it('sees its own rename on the very next read, even with the same length in the same second', async () => {
      await store.saveTeam(tid('a'), team(tid('a'), 'Alpha'));
      expect((await ours())[tid('a')].name).toBe('Alpha');

      // Same byte length, and on SQLite the same one-second `updated_at`: only
      // the pod forgetting its own write keeps this from reading as unchanged.
      await store.saveTeam(tid('a'), team(tid('a'), 'Omega'));
      expect((await ours())[tid('a')].name).toBe('Omega');
    });

    it('sees a roster change made through atomicTeamUpdate', async () => {
      await store.saveTeam(tid('b'), team(tid('b'), 'Beta'));
      await ours();
      await store.atomicTeamUpdate(tid('b'), (current: Json) => ({
        ...current,
        members: [...(current.members as Json[]), { id: 'm2', name: 'Bob', color: 'bg-rose-500', role: 'participant' }]
      }));
      expect((await ours())[tid('b')].members).toHaveLength(2);
    });

    it('sees a write made by another pod', async () => {
      await store.saveTeam(tid('c'), team(tid('c'), 'Gamma'));
      expect((await ours())[tid('c')].name).toBe('Gamma');

      await other.saveTeam(tid('c'), team(tid('c'), 'Gamma renamed', { lastConnectionDate: '2026-10-19T08:00:00.000Z' }));
      const seen = (await ours())[tid('c')];
      expect(seen.name).toBe('Gamma renamed');
      expect(seen.lastConnectionDate).toBe('2026-10-19T08:00:00.000Z');
    });

    it('sees a write that only moved updated_at, the way a pod from an older release writes', async () => {
      await store.saveTeam(tid('d'), team(tid('d'), 'Delta'));
      await ours();
      // Same byte length, so the timestamp is the only signal.
      await rawUpdate(tid('d'), JSON.stringify(team(tid('d'), 'Dolta')), true);
      expect((await ours())[tid('d')].name).toBe('Dolta');
    });

    it('drops a team another pod deleted', async () => {
      await store.saveTeam(tid('e'), team(tid('e'), 'Epsilon'));
      expect((await ours())[tid('e')]).toBeDefined();
      await other.deleteTeamRecord(tid('e'));
      expect((await ours())[tid('e')]).toBeUndefined();
    });

    it('never parses a row again while its fingerprint is unchanged', async () => {
      await store.saveTeam(tid('f'), team(tid('f'), 'Zeta'));
      expect((await ours())[tid('f')].name).toBe('Zeta');

      // Replace the record with text of the same byte length that is not even
      // JSON, without touching `updated_at`. Re-projecting it would throw (or
      // read garbage); serving the cached projection reads 'Zeta'.
      const stored = await rawValue(tid('f'));
      await rawUpdate(tid('f'), '#'.repeat(Buffer.byteLength(stored)), false);
      try {
        expect((await ours())[tid('f')].name).toBe('Zeta');
      } finally {
        // A valid record again, so a failure here does not break the tests after it.
        await store.saveTeam(tid('f'), team(tid('f'), 'Zeta'));
      }
    });

    it('hands out copies, so a caller editing a summary cannot change the next one', async () => {
      await store.saveTeam(tid('g'), team(tid('g'), 'Eta'));
      const first = (await ours(store, { withArchivedMembers: true, withMergeProvenance: true }))[tid('g')];
      (first.members as Json[]).push({ id: 'intruder' });
      (first.archivedMembers as Json[]).length = 0;
      (first.mergedFrom as Json[]).push({ teamId: 'x' });
      first.name = 'Mutated';

      const second = (await ours(store, { withArchivedMembers: true, withMergeProvenance: true }))[tid('g')];
      expect(second.name).toBe('Eta');
      expect(second.members).toHaveLength(1);
      expect(second.archivedMembers).toHaveLength(1);
      expect(second.mergedFrom).toEqual([]);
    });

    it('adds the optional fields only when they are asked for', async () => {
      const plain = (await ours())[tid('g')];
      expect(plain).not.toHaveProperty('archivedMembers');
      expect(plain).not.toHaveProperty('mergedFrom');
      expect(plain).not.toHaveProperty('retrospectives');
      expect(plain.facilitatorEmail).toBe(`${tid('g')}@example.org`);

      const full = (await ours(store, { withArchivedMembers: true, withMergeProvenance: true }))[tid('g')];
      expect(full.archivedMembers).toHaveLength(1);
      expect(full.mergedFrom).toEqual([]);
    });
  });
}
