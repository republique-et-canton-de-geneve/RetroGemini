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
    // A raw rewrite on ANOTHER connection, the way a pod from an older release
    // writes the shared store mid-rollout: it sets `updated_at` and nothing in
    // this store hears about it. The new text must keep the byte length, so
    // only the row's version (xmin, or updated_at on SQLite) can reveal it.
    const foreignRewrite = async (teamId: string, edit: (stored: string) => string) => {
      const key = `team:${teamId}`;
      const stored: string = isPg
        ? (await other.getPgPool().query('SELECT value FROM kv_store WHERE key = $1', [key])).rows[0].value
        : other.getSqliteDb().prepare('SELECT value FROM kv_store WHERE key = ?').get(key).value;
      const next = edit(stored);
      expect(next).not.toBe(stored);
      expect(Buffer.byteLength(next)).toBe(Buffer.byteLength(stored));
      if (isPg) await other.getPgPool().query('UPDATE kv_store SET value = $2, updated_at = NOW() WHERE key = $1', [key, next]);
      else other.getSqliteDb().prepare("UPDATE kv_store SET value = ?, updated_at = '2099-01-01 00:00:00' WHERE key = ?").run(next, key);
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

      await foreignRewrite(id, (stored) => stored.replace('"name":"Delta"', '"name":"Dolta"'));
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
      expect(plain).not.toHaveProperty('jiraTarget');
      expect(full).not.toHaveProperty('jiraTarget');
    });

    // `/jira/status` is read by every participant's screen on Review entry and
    // on every reconnect; loading the record for one small field would parse
    // the team's whole history each time. It reads one summary instead.
    const TARGET = { mode: 'project', projectKey: 'PROJ', issueTypeId: '10001', labels: ['retrospective'] };

    it('carries the Jira target, as an object on both engines, only when asked', async () => {
      const id = tid('j');
      await store.saveTeam(id, team(id, 'Kappa', { jiraTarget: TARGET }));
      expect((await ours())[id]).not.toHaveProperty('jiraTarget');
      expect((await ours(store, { withJiraTarget: true }))[id].jiraTarget).toEqual(TARGET);

      const without = tid('k');
      await store.saveTeam(without, team(without, 'Lambda'));
      expect((await ours(store, { withJiraTarget: true }))[without].jiraTarget).toBeNull();
    });

    it('reads one team summary through the same cache, a write by another pod included', async () => {
      const id = tid('l');
      await store.saveTeam(id, team(id, 'Mu', { jiraTarget: TARGET }));
      expect(await store.loadTeamSummary(id, { withJiraTarget: true })).toMatchObject({ id, name: 'Mu', jiraTarget: TARGET });

      await other.atomicTeamUpdate(id, (current: Json) => ({ ...current, jiraTarget: { ...TARGET, projectKey: 'OPS' } }));
      expect((await store.loadTeamSummary(id, { withJiraTarget: true }) as Json).jiraTarget).toMatchObject({ projectKey: 'OPS' });

      // A warm read parses nothing, as for the whole list.
      const sql = await sqlDuring(() => store.loadTeamSummary(id, { withJiraTarget: true }));
      expect(sql.filter((text) => /json_extract|::jsonb/.test(text))).toEqual([]);

      expect(await store.loadTeamSummary(`${prefix}-missing`)).toBeNull();
    });

    // A socket join reads one team's roster from this, on every reconnect.
    // Reading every team's fingerprint there re-projected every team written
    // since the previous read — during a live retrospective, the active teams'
    // records change several times a second.
    it('reads one team summary from that team\'s row alone', async () => {
      const id = tid('n');
      const neighbour = tid('n2');
      await store.saveTeam(id, team(id, 'Xi'));
      await store.saveTeam(neighbour, team(neighbour, 'Omicron'));

      const cold = await sqlDuring(() => store.loadTeamSummary(id));
      expect(cold.length).toBeGreaterThan(0);
      expect(cold.filter((text) => /\bLIKE\b/i.test(text))).toEqual([]);

      await store.loadTeamSummary(id);
      const warm = await sqlDuring(() => store.loadTeamSummary(id));
      expect(warm.filter((text) => /\bLIKE\b|json_extract|::jsonb/i.test(text))).toEqual([]);
    });

    it('sees a same-length rewrite another process made, through the single-team read', async () => {
      const id = tid('o');
      await store.saveTeam(id, team(id, 'Pi'));
      expect((await store.loadTeamSummary(id) as Json).name).toBe('Pi');

      await foreignRewrite(id, (stored) => stored.replace('"name":"Pi"', '"name":"Po"'));
      expect((await store.loadTeamSummary(id) as Json).name).toBe('Po');
    });

    // The single-team read must not mark the whole list as re-stamped: the
    // next list read would then judge a team another process rewrote at the
    // same length by its length alone, and keep serving the old summary.
    it('leaves the whole list able to see a foreign rewrite after reading another team', async () => {
      const a = tid('p');
      const b = tid('p2');
      await store.saveTeam(a, team(a, 'Rho'));
      await store.saveTeam(b, team(b, 'Sigma'));
      expect((await ours())[a].name).toBe('Rho');

      await foreignRewrite(a, (stored) => stored.replace('"name":"Rho"', '"name":"Rha"'));
      expect((await store.loadTeamSummary(b) as Json).name).toBe('Sigma');
      expect((await ours())[a].name).toBe('Rha');
    });

    it('answers null for a team deleted since it was cached, and the list forgets it', async () => {
      const id = tid('q');
      await store.saveTeam(id, team(id, 'Tau'));
      expect(await store.loadTeamSummary(id)).not.toBeNull();
      await other.deleteTeamRecord(id);
      expect(await store.loadTeamSummary(id)).toBeNull();
      expect((await ours())[id]).toBeUndefined();
    });

    // An empty value is "no team" for kvGet and teamExists; projecting it
    // throws, and a join would then read the role as unknown.
    it('answers null, as loadTeam does, for a row whose value is empty', async () => {
      const id = tid('r');
      await store.saveTeam(id, team(id, 'Upsilon'));
      expect(await store.loadTeamSummary(id)).not.toBeNull();
      if (isPg) await store.getPgPool().query("UPDATE kv_store SET value = '' WHERE key = $1", [`team:${id}`]);
      else store.getSqliteDb().prepare("UPDATE kv_store SET value = '' WHERE key = ?").run(`team:${id}`);
      expect(await store.loadTeam(id)).toBeNull();
      expect(await store.loadTeamSummary(id)).toBeNull();
      // The list projection cannot read such a row: leave none behind.
      await store.deleteTeamRecord(id);
    });

    // A reconnect wave is one join per participant: readers of one stale team
    // share one projection instead of casting the record once each.
    it.skipIf(!isPg)('shares one projection between concurrent reads of one stale team', async () => {
      const id = tid('s');
      await store.saveTeam(id, team(id, 'Phi'));
      await store.loadTeamSummary(id);
      await foreignRewrite(id, (stored) => stored.replace('"name":"Phi"', '"name":"Pho"'));
      // Eight live connections, so the eight fingerprint reads really overlap:
      // with a cold pool they wait for connections one by one, and the first
      // projection lands before the others look — sharing or not.
      await Promise.all(Array.from({ length: 8 }, () => store.getPgPool().query('SELECT pg_sleep(0.05)')));

      let answers: unknown[] = [];
      const sql = await sqlDuring(async () => {
        answers = await Promise.all(Array.from({ length: 8 }, () => store.loadTeamSummary(id)));
      });
      expect(sql.filter((text) => text.includes('::jsonb'))).toHaveLength(1);
      expect(answers.map((answer) => (answer as Json).name)).toEqual(Array(8).fill('Pho'));
      expect(new Set(answers).size).toBe(8);
    });

    it('hands out a copy of the Jira target', async () => {
      const id = tid('m');
      await store.saveTeam(id, team(id, 'Nu', { jiraTarget: TARGET }));
      const first = await store.loadTeamSummary(id, { withJiraTarget: true }) as Json;
      ((first.jiraTarget as Json).labels as string[]).push('mutated');
      expect((await store.loadTeamSummary(id, { withJiraTarget: true }) as Json).jiraTarget).toEqual(TARGET);
    });
  });
}
