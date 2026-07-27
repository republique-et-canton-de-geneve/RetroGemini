import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

// Integration test for the feedback projection (audit R10) against a real
// SQLite store (the default engine in CI). loadAllTeamFeedbacks must return the
// same feedback data that a full loadAllTeams scan would, while pulling only
// id/name/teamFeedbacks out of the database — never the heavy history arrays.
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

const feedbackA1 = {
  id: 'fb-a1',
  teamId: 't1',
  teamName: 'Alpha',
  type: 'bug',
  title: 'Timer does not reset',
  description: 'The retro timer keeps counting after the phase ends.',
  images: ['data:image/png;base64,AAAA'],
  submittedBy: 'm1',
  submittedByName: 'Ann',
  submittedAt: '2026-02-01T00:00:00.000Z',
  isRead: false,
  status: 'pending',
  comments: [
    { id: 'c1', authorId: 'm1', authorName: 'Ann', content: 'Still broken', createdAt: '2026-02-02T00:00:00.000Z' }
  ]
};
const feedbackA2 = {
  id: 'fb-a2',
  teamId: 't1',
  teamName: 'Alpha',
  type: 'feature',
  title: 'Dark mode',
  description: 'Please add a dark theme.',
  submittedBy: 'm1',
  submittedByName: 'Ann',
  submittedAt: '2026-02-03T00:00:00.000Z',
  isRead: true,
  status: 'in_progress'
};

describe('dataStore feedback projection (SQLite)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-fb-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();

    // Team with feedbacks AND a deliberately heavy history payload the
    // projection must NOT load.
    await dataStore.saveTeam('t1', {
      id: 't1',
      name: 'Alpha',
      teamFeedbacks: [feedbackA1, feedbackA2],
      retrospectives: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, tickets: ['x', 'y', 'z'] })),
      healthChecks: Array.from({ length: 20 }, (_, i) => ({ id: `h${i}` }))
    });
    // Team with an explicitly empty feedback array.
    await dataStore.saveTeam('t2', { id: 't2', name: 'Beta', teamFeedbacks: [] });
    // Team with no teamFeedbacks key at all.
    await dataStore.saveTeam('t3', { id: 't3', name: 'Gamma' });
    // A non-team record that the prefix scan must exclude.
    await dataStore.saveTeamIndex(new Map([['alpha', 't1'], ['beta', 't2'], ['gamma', 't3']]));
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

  it('returns one lean entry per team, excluding team-index and the heavy history', async () => {
    const rows = await dataStore.loadAllTeamFeedbacks();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(Object.keys(byId).sort()).toEqual(['t1', 't2', 't3']);
    expect(byId.t1.name).toBe('Alpha');
    // The projection must not carry the heavy history arrays.
    expect((byId.t1 as Record<string, unknown>).retrospectives).toBeUndefined();
    expect((byId.t1 as Record<string, unknown>).healthChecks).toBeUndefined();
    expect(Object.keys(byId.t1).sort()).toEqual(['id', 'name', 'teamFeedbacks']);
  });

  it('preserves every feedback and its nested fields intact', async () => {
    const rows = await dataStore.loadAllTeamFeedbacks();
    const t1 = rows.find((r) => r.id === 't1')!;

    expect(t1.teamFeedbacks).toHaveLength(2);
    // Deep equality proves nested comments/images and all scalar fields survive
    // the SQL extraction + JSON round-trip.
    expect(t1.teamFeedbacks).toEqual([feedbackA1, feedbackA2]);
  });

  it('coerces empty and missing feedback keys to an empty array', async () => {
    const rows = await dataStore.loadAllTeamFeedbacks();
    expect(rows.find((r) => r.id === 't2')!.teamFeedbacks).toEqual([]);
    expect(rows.find((r) => r.id === 't3')!.teamFeedbacks).toEqual([]);
  });

  it('yields the same feedbacks a full loadAllTeams scan would (behaviour-preserving)', async () => {
    const projected = await dataStore.loadAllTeamFeedbacks();
    const full = await dataStore.loadAllTeams();

    const flatten = (teams: Array<{ id: string; teamFeedbacks?: unknown[] }>) =>
      teams
        .flatMap((t) => (t.teamFeedbacks || []).map((f) => ({ ownerTeam: t.id, feedback: f })))
        .sort((a, b) => (a.feedback as { id: string }).id.localeCompare((b.feedback as { id: string }).id));

    expect(flatten(projected)).toEqual(flatten(full));
  });
});
