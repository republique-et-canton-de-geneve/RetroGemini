import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import {
  shouldRefreshLastConnection,
  refreshLastConnectionDate,
  createLastConnectionRefresher
} from '../server/services/socketHandlers.js';

const FIVE_MIN = 5 * 60 * 1000;

describe('shouldRefreshLastConnection', () => {
  it('refreshes when there is no prior timestamp', () => {
    expect(shouldRefreshLastConnection(undefined, Date.now(), FIVE_MIN)).toBe(true);
    expect(shouldRefreshLastConnection(null, Date.now(), FIVE_MIN)).toBe(true);
  });

  it('refreshes when the prior timestamp is older than the interval', () => {
    const now = Date.now();
    const old = new Date(now - FIVE_MIN - 1000).toISOString();
    expect(shouldRefreshLastConnection(old, now, FIVE_MIN)).toBe(true);
  });

  it('skips when the prior timestamp is within the interval', () => {
    const now = Date.now();
    const recent = new Date(now - 1000).toISOString();
    expect(shouldRefreshLastConnection(recent, now, FIVE_MIN)).toBe(false);
  });

  it('refreshes when the prior timestamp is unparseable', () => {
    expect(shouldRefreshLastConnection('not-a-date', Date.now(), FIVE_MIN)).toBe(true);
  });
});

// A whole session reconnects at once after a rolling update. Each join used to
// decide on a team read taken before the team's write queue, so every one of
// them saw the stale date and queued a rewrite of the whole team record: the
// queue made them all land where the old compare-and-swap had failed most of
// them. The decision is now taken again inside the update.
describe('refreshLastConnectionDate', () => {
  let dir: string;
  let dataStore: ReturnType<typeof createDataStore>;
  // Every variable that would point the store at PostgreSQL instead.
  const PG_ENV_KEYS = ['DATABASE_URL', 'POSTGRES_HOST', 'POSTGRESQL_SERVICE_HOST', 'POSTGRES_USER', 'POSTGRESQL_USER',
    'POSTGRES_PASSWORD', 'POSTGRESQL_PASSWORD', 'POSTGRES_DB', 'POSTGRESQL_DATABASE', 'DATA_STORE_PATH'];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-last-connection-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
  });

  afterEach(async () => {
    await dataStore.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    for (const key of PG_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('writes the team once when a whole session joins at the same moment', async () => {
    const stale = new Date(Date.now() - FIVE_MIN - 60_000).toISOString();
    await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha', lastConnectionDate: stale });
    const before = (await dataStore.loadTeamRaw('t1'))._rev;

    const results = await Promise.all(Array.from({ length: 10 }, () => refreshLastConnectionDate(dataStore, 't1')));

    const after = await dataStore.loadTeamRaw('t1');
    expect(after._rev).toBe(before + 1);
    expect(after.lastConnectionDate).not.toBe(stale);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('leaves a recently seen team alone', async () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha', lastConnectionDate: recent });
    const before = (await dataStore.loadTeamRaw('t1'))._rev;

    expect(await refreshLastConnectionDate(dataStore, 't1')).toBe(false);
    expect((await dataStore.loadTeamRaw('t1'))._rev).toBe(before);
  });
});

// The in-lock decision above keeps a burst to one write, but on PostgreSQL —
// where joins overlap — every join still queued its own update, and each queued
// updater parsed the whole team record under the lock before declining. The
// refresher shares one refresh per team on a pod.
describe('createLastConnectionRefresher', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('starts one refresh for ten concurrent joins, and only its caller answers true', async () => {
    const pending = deferred<boolean>();
    const refresh = vi.fn(() => pending.promise);
    const refresher = createLastConnectionRefresher({}, refresh);

    const calls = Array.from({ length: 10 }, () => refresher.run('t1'));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresher.pending()).toBe(1);
    pending.resolve(true);

    expect(await Promise.all(calls)).toEqual([true, false, false, false, false, false, false, false, false, false]);
    expect(refresher.pending()).toBe(0);

    // Settled: the next join starts a refresh of its own.
    refresh.mockImplementation(() => Promise.resolve(false));
    await refresher.run('t1');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('rejects only for the caller that started a failing refresh', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const pending = deferred<boolean>();
      const refresher = createLastConnectionRefresher({}, () => pending.promise);
      const first = refresher.run('t1');
      const others = Array.from({ length: 3 }, () => refresher.run('t1'));
      pending.reject(new Error('store down'));

      await expect(first).rejects.toThrow('store down');
      expect(await Promise.all(others)).toEqual([false, false, false]);
      expect(refresher.pending()).toBe(0);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('runs two teams concurrently', async () => {
    const a = deferred<boolean>();
    const b = deferred<boolean>();
    const refresh = vi.fn((_store: unknown, teamId: string) => (teamId === 'a' ? a.promise : b.promise));
    const refresher = createLastConnectionRefresher({}, refresh);

    const runA = refresher.run('a');
    const runB = refresher.run('b');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresher.pending()).toBe(2);
    b.resolve(true);
    a.resolve(true);
    expect(await Promise.all([runA, runB])).toEqual([true, true]);
    expect(refresher.pending()).toBe(0);
  });
});
