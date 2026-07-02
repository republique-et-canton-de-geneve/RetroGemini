import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

// Unit-level proof of the fix: saveSessionState is a compare-and-swap on `_rev`.
// A write built on a stale revision must be rejected and must not touch the
// stored state. On the pre-fix code saveSessionState always upserted and had no
// `success`/`stale` result, so every assertion below fails without the fix.

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

describe('saveSessionState compare-and-swap', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-cas-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
  });

  afterAll(() => {
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

  it('accepts the first write and assigns rev 1', async () => {
    const r = await dataStore.saveSessionState('s1', { id: 's1', phase: 'brainstorm', _rev: 0 });
    expect(r.success).toBe(true);
    expect(r.stale).toBe(false);
    expect(r.data._rev).toBe(1);
  });

  it('accepts an up-to-date write and advances the rev', async () => {
    const r = await dataStore.saveSessionState('s1', { id: 's1', phase: 'discuss', _rev: 1 });
    expect(r.success).toBe(true);
    expect(r.data._rev).toBe(2);
    expect(r.data.phase).toBe('discuss');
  });

  it('rejects a stale write and preserves the authoritative state', async () => {
    // Advance to a completed state at rev 3.
    const done = await dataStore.saveSessionState('s1', {
      id: 's1',
      phase: 'close',
      roti: { uA: 5 },
      actions: [{ id: 'a1' }],
      _rev: 2
    });
    expect(done.data._rev).toBe(3);

    // A stale client built on rev 1 tries to revert to 'discuss'.
    const stale = await dataStore.saveSessionState('s1', {
      id: 's1',
      phase: 'discuss',
      roti: {},
      actions: [],
      _rev: 1
    });

    expect(stale.success).toBe(false);
    expect(stale.stale).toBe(true);
    // The rejection returns the authoritative (unchanged) state.
    expect(stale.data.phase).toBe('close');
    expect(stale.data._rev).toBe(3);

    // And nothing was overwritten in storage.
    const stored = await dataStore.loadSessionState('s1');
    expect(stored.phase).toBe('close');
    expect(stored.roti).toEqual({ uA: 5 });
    expect(stored._rev).toBe(3);
  });

  it('accepts a write from a client that is level with the server (concurrent winner)', async () => {
    // Current rev is 3. A client at rev 3 writes -> accepted as rev 4.
    const r = await dataStore.saveSessionState('s1', { id: 's1', phase: 'close', roti: { uA: 5, uB: 4 }, _rev: 3 });
    expect(r.success).toBe(true);
    expect(r.data._rev).toBe(4);
    expect(r.data.roti).toEqual({ uA: 5, uB: 4 });
  });
});
