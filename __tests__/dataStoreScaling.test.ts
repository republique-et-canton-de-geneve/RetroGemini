import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore, prefixRange } from '../server/services/dataStore.js';

describe('prefixRange', () => {
  it('produces an exclusive upper bound that brackets only the prefix', () => {
    const { lower, upper } = prefixRange('team:');
    expect(lower).toBe('team:');
    expect(upper).toBe('team;');
    expect('team:abc' >= lower && 'team:abc' < upper).toBe(true);
    // 'team-index' must NOT fall inside the team: range.
    expect('team-index' >= lower && 'team-index' < upper).toBe(false);
  });
});

// Integration test against a real SQLite store (the default engine in CI).
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

describe('dataStore team summaries (SQLite)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-ds-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();

    await dataStore.saveTeam('t1', {
      id: 't1',
      name: 'Alpha',
      facilitatorEmail: 'a@example.io',
      lastConnectionDate: '2026-01-01T00:00:00.000Z',
      members: [{ id: 'm1', name: 'Ann', color: 'bg-indigo-500', role: 'facilitator' }],
      // A deliberately heavy history payload that the summary must NOT load.
      retrospectives: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, tickets: ['x', 'y', 'z'] }))
    });
    await dataStore.saveTeam('t2', {
      id: 't2',
      name: 'Beta',
      members: [],
      retrospectives: []
    });
    // A non-team record sharing the `team-` textual neighbourhood; the range
    // scan must exclude it.
    await dataStore.saveTeamIndex(new Map([['alpha', 't1'], ['beta', 't2']]));
  });

  afterAll(() => {
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

  it('returns only summary fields without the heavy history arrays', async () => {
    const summaries = await dataStore.loadTeamSummaries();
    const byId = Object.fromEntries(summaries.map((s) => [s.id, s]));

    expect(Object.keys(byId).sort()).toEqual(['t1', 't2']);

    expect(byId.t1.name).toBe('Alpha');
    expect(byId.t1.facilitatorEmail).toBe('a@example.io');
    expect(byId.t1.lastConnectionDate).toBe('2026-01-01T00:00:00.000Z');
    expect(byId.t1.members).toHaveLength(1);
    expect(byId.t1.members[0].name).toBe('Ann');
    // The summary must not carry the retrospectives payload.
    expect((byId.t1 as Record<string, unknown>).retrospectives).toBeUndefined();

    expect(byId.t2.members).toEqual([]);
    expect(byId.t2.facilitatorEmail).toBeUndefined();
  });

  it('range scan in loadAllTeams excludes the team-index record', async () => {
    const teams = await dataStore.loadAllTeams();
    const ids = teams.map((t) => t.id).sort();
    expect(ids).toEqual(['t1', 't2']);
  });
});
