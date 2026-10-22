import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

/**
 * `loadAllTeamFeedbacks` feeds the Feedback Hub (`/api/feedbacks/all`, on
 * every open and after every create, comment and delete) and the console's
 * feedback tab. It projected every team row on every call: 233 to 331 ms on
 * PostgreSQL at 25 MB, and 55 to 80 ms of blocked event loop on SQLite.
 *
 * It now keeps each team's feedbacks per pod under the fingerprint
 * discipline of the summary cache (`teamSummaryCache.test.ts`): a write is
 * visible on the next read whoever made it, even one that keeps the record's
 * length; a deletion disappears; a warm read parses nothing. Three rules are
 * its own: the SQLite marker of another connection's commit is per cache, the
 * arrays it hands out are shared and frozen, and a character budget, decided
 * again on every read, bounds what it keeps.
 *
 * SQLite always runs. The same suite runs against a real PostgreSQL when
 * `TEST_DATABASE_URL` is set (`--no-file-parallelism` when several such
 * suites share one database).
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
type FeedbackRow = { id: string; name: string; teamFeedbacks: Json[] };

const heavyHistory = () =>
  Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, tickets: Array.from({ length: 20 }, (_, k) => ({ id: `k${k}`, text: 'x'.repeat(40) })) }));

const feedback = (id: string, extra: Json = {}) => ({
  id,
  type: 'bug',
  title: `Broken ${id}`,
  description: 'The timer keeps counting.',
  images: ['data:image/png;base64,AAAA'],
  status: 'pending',
  comments: [{ id: `${id}-c1`, content: 'Still broken' }],
  ...extra
});

const team = (id: string, name: string, feedbacks: Json[] = [feedback(`${id}-f1`)], extra: Json = {}) => ({
  id,
  name,
  members: [],
  retrospectives: heavyHistory(),
  teamFeedbacks: feedbacks,
  ...extra
});

const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-feedback-cache-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-feedback-cache-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`team feedback cache (${engine.name})`, () => {
    let store: Store;
    let other: Store;
    let dir: string;
    const opened: Store[] = [];
    const savedEnv: Record<string, string | undefined> = {};
    const prefix = `fc${Date.now().toString(36)}`;
    const created = new Set<string>();
    const tid = (n: string) => {
      const id = `${prefix}-${n}`;
      created.add(id);
      return id;
    };
    const isPg = engine.name === 'PostgreSQL';

    const openStore = async (options: Json = {}) => {
      const opened_ = createDataStore({ rootDir: dir, ...options });
      await opened_.initDatabase();
      opened.push(opened_);
      return opened_;
    };

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
    // A raw same-length rewrite on ANOTHER connection, the way a pod from an
    // older release writes the shared store mid-rollout.
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
    const sqlDuring = async (s: Store, run: () => Promise<unknown>): Promise<string[]> => {
      const spy = isPg ? vi.spyOn(s.getPgPool(), 'query') : vi.spyOn(s.getSqliteDb(), 'prepare');
      try {
        await run();
        return spy.mock.calls.map((call: unknown[]) => String(call[0]));
      } finally {
        spy.mockRestore();
      }
    };
    const projects = (sql: string[]) => sql.some((text) => /json_extract|::jsonb/.test(text));
    // The team keys a read projects (parses), read from the projection
    // query's own parameters.
    const projectedKeysDuring = async (s: Store, run: () => Promise<unknown>): Promise<string[]> => {
      const keys: string[] = [];
      if (isPg) {
        const pool = s.getPgPool();
        const original = pool.query.bind(pool);
        const spy = vi.spyOn(pool, 'query').mockImplementation(((text: string, params?: unknown[]) => {
          if (/teamFeedbacks/.test(String(text)) && Array.isArray(params?.[0])) keys.push(...(params[0] as string[]));
          return original(text, params);
        }) as never);
        try { await run(); } finally { spy.mockRestore(); }
      } else {
        const db = s.getSqliteDb();
        const original = db.prepare.bind(db);
        const spy = vi.spyOn(db, 'prepare').mockImplementation(((text: string) => {
          const statement = original(text);
          if (/teamFeedbacks/.test(text)) {
            const all = statement.all.bind(statement);
            statement.all = (...args: unknown[]) => {
              keys.push(...JSON.parse(String(args[0])));
              return all(...args);
            };
          }
          return statement;
        }) as never);
        try { await run(); } finally { spy.mockRestore(); }
      }
      return keys.filter((key) => key.startsWith(`team:${prefix}`));
    };
    // The keys of ours that a budget of `budget` characters leaves out of the
    // cache, decided as the store must decide it: every team row in storage
    // order, each costing the length of its feedbacks' JSON text, kept while
    // the running sum stays within the budget.
    const refusedUnder = async (budget: number): Promise<string[]> => {
      const rows: { key: string; chars: number | null }[] = isPg
        ? (await store.getPgPool().query(
          `SELECT key, length((value::jsonb->'teamFeedbacks')::text) AS chars FROM kv_store WHERE key LIKE $1`,
          ['team:%']
        )).rows
        : store.getSqliteDb().prepare(
          `SELECT key, length(json_extract(value, '$.teamFeedbacks')) AS chars FROM kv_store WHERE key LIKE ?`
        ).all('team:%');
      let kept = 0;
      const refused: string[] = [];
      for (const row of rows) {
        const chars = Number(row.chars ?? 0);
        if (kept + chars <= budget) kept += chars;
        else refused.push(row.key);
      }
      return refused.filter((key) => key.startsWith(`team:${prefix}`));
    };
    const ours = async (s: Store = store): Promise<Record<string, FeedbackRow>> =>
      Object.fromEntries(
        ((await s.loadAllTeamFeedbacks()) as FeedbackRow[])
          .filter((row) => String(row.id).startsWith(prefix))
          .map((row) => [row.id, row])
      );

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      store = await openStore();
      other = await openStore();
    });

    afterAll(async () => {
      for (const id of created) {
        await store.deleteTeamRecord(id).catch(() => {});
      }
      for (const s of opened.reverse()) await s.closeDatabase();
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

    it('parses nothing on a warm read', async () => {
      const id = tid('a');
      await store.saveTeam(id, team(id, 'Alpha'));
      await ours();

      const sql = await sqlDuring(store, () => ours());
      expect(sql.length).toBeGreaterThan(0);
      expect(projects(sql)).toBe(false);
      if (!isPg) expect(sql.filter((text) => /updated_at AS stamp/.test(text))).toEqual([]);
    });

    it('sees its own same-length change, through atomicTeamUpdate and through saveTeam', async () => {
      const id = tid('b');
      await store.saveTeam(id, team(id, 'Beta'));
      expect((await ours())[id].teamFeedbacks[0].status).toBe('pending');
      const stamp = await readStamp(id);

      await store.atomicTeamUpdate(id, (current: Json) => ({
        ...current,
        teamFeedbacks: [{ ...(current.teamFeedbacks as Json[])[0], status: 'ignore!' }]
      }));
      await pinStamp(id, stamp);
      expect((await ours())[id].teamFeedbacks[0].status).toBe('ignore!');

      await store.saveTeam(id, team(id, 'Beta', [feedback(`${id}-f1`, { status: 'resolve' })]));
      await pinStamp(id, stamp);
      expect((await ours())[id].teamFeedbacks[0].status).toBe('resolve');
    });

    it('sees a same-length write another process made behind its back', async () => {
      const id = tid('c');
      await store.saveTeam(id, team(id, 'Gamma'));
      expect((await ours())[id].teamFeedbacks[0].status).toBe('pending');

      await foreignRewrite(id, (stored) => stored.replace('"status":"pending"', '"status":"ignore!"'));
      expect((await ours())[id].teamFeedbacks[0].status).toBe('ignore!');
    });

    // On SQLite, `data_version` says that ANOTHER connection committed. If the
    // summary cache and this one shared the marker, a summary read would mark
    // the commit as seen, and the next feedback read would judge on length
    // alone and miss this same-length edit.
    it('keeps its own marker of another connection\'s commit, apart from the summary cache\'s', async () => {
      const id = tid('d');
      await store.saveTeam(id, team(id, 'Delta'));
      await ours();
      await store.loadTeamSummaries();

      await foreignRewrite(id, (stored) => stored.replace('"status":"pending"', '"status":"ignore!"'));
      await store.loadTeamSummaries();
      expect((await ours())[id].teamFeedbacks[0].status).toBe('ignore!');
    });

    it('drops a team another pod deleted, and adds one another pod created', async () => {
      const gone = tid('e');
      await store.saveTeam(gone, team(gone, 'Epsilon'));
      expect((await ours())[gone]).toBeDefined();

      await other.deleteTeamRecord(gone);
      const born = tid('f');
      await other.saveTeam(born, team(born, 'Zeta'));

      const seen = await ours();
      expect(seen[gone]).toBeUndefined();
      expect(seen[born].name).toBe('Zeta');
    });

    it('hands out frozen arrays: an edit throws and the next answer is unchanged', async () => {
      const id = tid('g');
      await store.saveTeam(id, team(id, 'Eta'));
      const first = (await ours())[id];

      expect(() => { first.teamFeedbacks[0].title = 'x'; }).toThrow(TypeError);
      expect(() => { (first.teamFeedbacks[0].comments as Json[]).push({}); }).toThrow(TypeError);
      expect(() => { first.teamFeedbacks.length = 0; }).toThrow(TypeError);

      const second = (await ours())[id];
      expect(second.teamFeedbacks[0].title).toBe(`Broken ${id}-f1`);
      expect(second.teamFeedbacks[0].comments).toHaveLength(1);
    });

    it('serves a team over the budget from the database, correctly, on every read', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const tiny = await openStore({ teamFeedbackCacheMaxChars: 1 });
        const id = tid('h');
        await tiny.saveTeam(id, team(id, 'Theta'));
        expect((await ours(tiny))[id].teamFeedbacks[0].status).toBe('pending');
        expect(projects(await sqlDuring(tiny, () => ours(tiny)))).toBe(true);

        await tiny.atomicTeamUpdate(id, (current: Json) => ({ ...current, teamFeedbacks: [feedback(`${id}-f2`)] }));
        expect((await ours(tiny))[id].teamFeedbacks.map((f) => f.id)).toEqual([`${id}-f2`]);
        expect(warn.mock.calls.filter((call) => String(call[0]).includes('Feedback cache'))).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });

    // The budget is decided again at the end of every read, in storage
    // order. After any read, the next warm one must project exactly the teams
    // that read left out: a cache that kept an entry it had refused, or lost
    // one it had admitted, projects fewer or more.
    it('keeps within its budget over time, and takes a team back once there is room', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const size = 40_000;
        const budget = Math.round(size * 2.6);
        const big = (id: string, n = 1) => team(id, id, [feedback(`${id}-f1`, { description: 'd'.repeat(size * n) })]);
        const budgeted = await openStore({ teamFeedbackCacheMaxChars: budget });
        const [a, b, c] = [tid('i'), tid('j'), tid('k')];
        for (const id of [a, b, c]) await budgeted.saveTeam(id, big(id));
        const warmReadMatchesTheBudget = async () => {
          await ours(budgeted);
          const expected = (await refusedUnder(budget)).sort();
          expect((await projectedKeysDuring(budgeted, () => ours(budgeted))).sort()).toEqual(expected);
          return expected;
        };

        // Two of the three fit.
        expect(await warmReadMatchesTheBudget()).toHaveLength(1);

        // One of them grows past what is left, then shrinks back.
        await budgeted.saveTeam(a, big(a, 2));
        await warmReadMatchesTheBudget();
        await budgeted.saveTeam(a, big(a));
        expect(await warmReadMatchesTheBudget()).toHaveLength(1);

        // Once one is gone, the other two fit: nothing of ours is projected.
        await other.deleteTeamRecord(b);
        expect(await warmReadMatchesTheBudget()).toEqual([]);
        expect(Object.keys(await ours(budgeted)).filter((id) => [a, b, c].includes(id)).sort()).toEqual([a, c].sort());
      } finally {
        warn.mockRestore();
      }
    });

    it('answers what a full loadAllTeams scan would, across a write', async () => {
      const id = tid('l');
      await store.saveTeam(id, team(id, 'Lambda', [feedback(`${id}-f1`), feedback(`${id}-f2`, { type: 'feature' })]));
      const none = tid('m');
      await store.saveTeam(none, { id: none, name: 'Mu' });
      await ours();
      await store.atomicTeamUpdate(id, (current: Json) => ({
        ...current,
        teamFeedbacks: [...(current.teamFeedbacks as Json[]), feedback(`${id}-f3`)]
      }));

      const flatten = (teams: Array<{ id: string; teamFeedbacks?: unknown[] }>) =>
        teams
          .filter((t) => String(t.id).startsWith(prefix))
          .flatMap((t) => (t.teamFeedbacks || []).map((f) => ({ ownerTeam: t.id, feedback: f })))
          .sort((x, y) => (x.feedback as { id: string }).id.localeCompare((y.feedback as { id: string }).id));

      expect(flatten(await store.loadAllTeamFeedbacks())).toEqual(flatten(await store.loadAllTeams()));
      expect((await ours())[none].teamFeedbacks).toEqual([]);
    });
  });
}
