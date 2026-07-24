import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

// Integration test against a real SQLite store (the default engine in CI). It
// exercises the atomic scheduler-election primitives used to stop the multi-pod
// `auto` backup stampede: claimAutoBackupInterval reserves an interval and
// releaseAutoBackupClaim reopens it.
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

describe('dataStore backup scheduler election (SQLite)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const WINDOW_MS = 60 * 60 * 1000; // 1h election window

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-election-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
  });

  afterEach(() => {
    vi.useRealTimers();
    try {
      dataStore.closeDatabase();
    } catch {
      /* ignore */
    }
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

  it('lets exactly one caller win a fresh interval', async () => {
    const results = await Promise.all([
      dataStore.claimAutoBackupInterval(WINDOW_MS),
      dataStore.claimAutoBackupInterval(WINDOW_MS),
      dataStore.claimAutoBackupInterval(WINDOW_MS)
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('rejects a second claim inside the window and accepts one after it elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    expect(await dataStore.claimAutoBackupInterval(WINDOW_MS)).toBe(true);

    // Inside the window: rejected.
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    expect(await dataStore.claimAutoBackupInterval(WINDOW_MS)).toBe(false);

    // Past the window: accepted again.
    vi.setSystemTime(new Date('2026-01-01T01:00:01.000Z'));
    expect(await dataStore.claimAutoBackupInterval(WINDOW_MS)).toBe(true);
  });

  it('reopens the interval after releaseAutoBackupClaim', async () => {
    expect(await dataStore.claimAutoBackupInterval(WINDOW_MS)).toBe(true);
    // Without a release, an immediate re-claim is rejected.
    expect(await dataStore.claimAutoBackupInterval(WINDOW_MS)).toBe(false);

    await dataStore.releaseAutoBackupClaim();

    // After the release, the interval is claimable again straight away.
    expect(await dataStore.claimAutoBackupInterval(WINDOW_MS)).toBe(true);
  });
});
