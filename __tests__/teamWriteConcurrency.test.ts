import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

/**
 * Many people write to one team record at the same moment in a live retro:
 * votes, ROTI, the facilitator's persists, impact ratings. `atomicTeamUpdate`
 * used to read the record, run the updater, and compare-and-swap the write,
 * retrying a lost race five times. With every writer racing at once, one of
 * them won each round: measured on PostgreSQL, 9 to 10 of 16 simultaneous
 * writers on a 1 MB team got `max_retries_exceeded`, which the routes answer
 * with a 500 and the client only logs. The Dashboard and the backlog then
 * missed what those writes carried.
 *
 * Each team's writes now wait their turn on this pod, and each one reads,
 * updates and writes inside one transaction holding the row, so a write from
 * another pod waits on the row lock instead of failing.
 *
 * SQLite always runs (the engine CI uses). The same suite runs against a real
 * PostgreSQL when `TEST_DATABASE_URL` is set, e.g.
 * `TEST_DATABASE_URL=postgres://user:pass@localhost/db npx vitest run __tests__/teamWriteConcurrency.test.ts`.
 * The two-pod case is only meaningful there: SQLite writes are synchronous, so
 * two connections in one process never interleave.
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

// About 100 kB of history, so a record parse is easy to tell from the small
// JSON the store parses for other reasons.
const heavyHistory = () =>
  Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, tickets: Array.from({ length: 20 }, (_, k) => ({ id: `k${k}`, text: 'x'.repeat(100) })) }));

const team = (id: string) => ({
  id,
  name: `Team ${id}`,
  members: [{ id: `${id}-m1`, name: 'Ann', color: 'bg-indigo-500', role: 'facilitator' }],
  retrospectives: heavyHistory(),
  marks: [] as number[]
});

const addMark = (mark: number) => (current: Json) => ({ ...current, marks: [...((current.marks as number[]) ?? []), mark] });

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-write-queue-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-write-queue-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`team writes under concurrency (${engine.name})`, () => {
    let store: Store;
    let other: Store;
    let dir: string;
    const savedEnv: Record<string, string | undefined> = {};
    const prefix = `wq${Date.now().toString(36)}`;
    // Every id a test creates, so the cleanup cannot fall out of step with the
    // tests (the PostgreSQL run writes into a shared database).
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
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
      vi.restoreAllMocks();
    });

    it('lands all 16 updates started in the same tick', async () => {
      const id = tid('burst');
      await store.saveTeam(id, team(id));
      const before = Number((await store.loadTeamRaw(id))._rev);

      const results = await Promise.all(range(16).map((i) => store.atomicTeamUpdate(id, addMark(i))));

      expect(results.filter((r: Json) => !r.success)).toEqual([]);
      const after = await store.loadTeamRaw(id);
      expect(after._rev).toBe(before + 16);
      expect(sorted(after.marks)).toEqual(range(16));
    });

    it('runs each updater exactly once', async () => {
      const id = tid('once');
      await store.saveTeam(id, team(id));
      const updaters = range(8).map((i) => vi.fn(addMark(i)));

      await Promise.all(updaters.map((updater) => store.atomicTeamUpdate(id, updater)));

      expect(updaters.map((updater) => updater.mock.calls.length)).toEqual(range(8).map(() => 1));
    });

    it('lets a failing updater fail alone', async () => {
      const id = tid('throws');
      await store.saveTeam(id, team(id));

      const results = await Promise.allSettled(range(6).map((i) =>
        store.atomicTeamUpdate(id, i === 2
          ? () => {
            throw new Error('updater failed');
          }
          : addMark(i))
      ));

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
      expect(sorted((await store.loadTeam(id)).marks)).toEqual([0, 1, 3, 4, 5]);
    });

    it('answers team_not_found to every update queued for a missing team', async () => {
      const id = tid('ghost');
      const updater = vi.fn(addMark(0));

      const results = await Promise.all(range(3).map(() => store.atomicTeamUpdate(id, updater)));

      expect(results).toEqual(range(3).map(() => ({ success: false, error: 'team_not_found' })));
      expect(updater).not.toHaveBeenCalled();
    });

    it('leaves the record and its revision alone when an updater declines', async () => {
      const id = tid('declines');
      await store.saveTeam(id, team(id));
      const before = await store.loadTeamRaw(id);

      const result = await store.atomicTeamUpdate(id, () => null);

      expect(result.success).toBe(true);
      expect((result.team as Json).name).toBe(`Team ${id}`);
      expect(result.team).not.toHaveProperty('_rev');
      expect((await store.loadTeamRaw(id))._rev).toBe(before._rev);
    });

    it('loses no write when two pods update the same team at once', async () => {
      const id = tid('two-pods');
      await store.saveTeam(id, team(id));
      const before = Number((await store.loadTeamRaw(id))._rev);

      const results = await Promise.all(range(16).map((i) =>
        (i % 2 === 0 ? store : other).atomicTeamUpdate(id, addMark(i))
      ));

      expect(results.filter((r: Json) => !r.success)).toEqual([]);
      const after = await store.loadTeamRaw(id);
      expect(after._rev).toBe(before + 16);
      expect(sorted(after.marks)).toEqual(range(16));
    });

    // The update used to parse the record twice — once to run the updater, and
    // once more inside the compare-and-swap just to read `_rev` — and once more
    // per lost race. At 60 ms per MB on PostgreSQL that parse is the cost.
    it('parses the team record once per update', async () => {
      const id = tid('parses');
      await store.saveTeam(id, team(id));
      const recordLength = JSON.stringify(team(id)).length;
      const parse = vi.spyOn(JSON, 'parse');
      try {
        await store.atomicTeamUpdate(id, addMark(1));
        const recordParses = parse.mock.calls.filter(([text]) => typeof text === 'string' && text.length > recordLength / 2);
        expect(recordParses).toHaveLength(1);
      } finally {
        parse.mockRestore();
      }
    });
  });
}
