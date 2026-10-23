import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createTokenService } from '../server/services/sessionTokens.js';
import { sessionVerdict } from '../server/services/sessionEpoch.js';

// Integration test against a real SQLite store (the default engine in CI). It
// exercises the faithful-replace restore semantics of savePersistedData: a
// restore must make the store match the archive exactly, removing "ghost"
// teams absent from the archive and clearing live session state.
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

describe('dataStore savePersistedData restore semantics (SQLite)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  const seedStore = async () => {
    await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha', members: [], retrospectives: [] });
    await dataStore.saveTeam('t2', { id: 't2', name: 'Beta', members: [], retrospectives: [] });
    await dataStore.saveTeamIndex(new Map([['alpha', 't1'], ['beta', 't2']]));
    // Two live sessions (one per team) that a backup archive never carries.
    await dataStore.saveSessionState('s1', { id: 's1', teamId: 't1', phase: 'brainstorm' });
    await dataStore.saveSessionState('s2', { id: 's2', teamId: 't2', phase: 'group' });
  };

  // An archive that only contains team-1 (team-2 has been deleted since the
  // backup was taken).
  const archiveWithOnlyTeam1 = {
    teams: [{ id: 't1', name: 'Alpha', members: [], retrospectives: [] }],
    meta: { revision: 1, updatedAt: '2025-01-01T00:00:00.000Z' },
    resetTokens: [],
    orphanedFeedbacks: []
  };

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-restore-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
    await seedStore();
  });

  afterEach(() => {
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

  it("replace mode removes teams absent from the archive from both records and index", async () => {
    await dataStore.savePersistedData(archiveWithOnlyTeam1, { mode: 'replace' });

    // The ghost team's record is gone from the raw prefix scan...
    const teams = await dataStore.loadAllTeams();
    expect(teams.map((t) => t.id).sort()).toEqual(['t1']);
    expect(await dataStore.loadTeam('t2')).toBeNull();

    // ...and from the login index.
    const index = await dataStore.loadTeamIndex();
    expect([...index.keys()].sort()).toEqual(['alpha']);
    expect(index.get('beta')).toBeUndefined();

    // The retained team survives intact.
    const t1 = await dataStore.loadTeam('t1');
    expect(t1?.name).toBe('Alpha');
  });

  it('replace mode clears all live session state', async () => {
    expect(await dataStore.loadSessionState('s1')).not.toBeNull();
    expect(await dataStore.loadSessionState('s2')).not.toBeNull();

    await dataStore.savePersistedData(archiveWithOnlyTeam1, { mode: 'replace' });

    expect(await dataStore.loadSessionState('s1')).toBeNull();
    expect(await dataStore.loadSessionState('s2')).toBeNull();
  });

  it('default merge mode leaves ghost teams and sessions in place (backward compatible)', async () => {
    await dataStore.savePersistedData(archiveWithOnlyTeam1);

    // Merge is additive: the extra team and the live sessions are untouched.
    const teams = await dataStore.loadAllTeams();
    expect(teams.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(await dataStore.loadSessionState('s1')).not.toBeNull();
    expect(await dataStore.loadSessionState('s2')).not.toBeNull();
  });

  it('replace mode restores an archive with entirely new teams', async () => {
    const freshArchive = {
      teams: [{ id: 't9', name: 'Gamma', members: [], retrospectives: [] }],
      meta: { revision: 1, updatedAt: '2025-01-01T00:00:00.000Z' },
      resetTokens: [],
      orphanedFeedbacks: []
    };

    await dataStore.savePersistedData(freshArchive, { mode: 'replace' });

    const teams = await dataStore.loadAllTeams();
    expect(teams.map((t) => t.id).sort()).toEqual(['t9']);
    const index = await dataStore.loadTeamIndex();
    expect([...index.keys()].sort()).toEqual(['gamma']);
    // Both old teams and their sessions are gone.
    expect(await dataStore.loadTeam('t1')).toBeNull();
    expect(await dataStore.loadSessionState('s1')).toBeNull();
  });
});

/**
 * Decision D3b — a session never outlives the password it was opened with,
 * and a whole-store restore can put an older password back. So the replace
 * gives a new session epoch to every team whose password it changes (or that
 * it brings back), and leaves every other team's sessions alone: a restore
 * that keeps a team's password signs nobody out of it.
 */
describe('dataStore savePersistedData and team session epochs (SQLite)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const tokens = createTokenService({
    secureCompare: (a: string, b: string) => a === b,
    superAdminPassword: null,
    tokenSecret: 'restore-epoch-test-secret'
  });

  const team = (id: string, name: string, passwordHash: string) => ({ id, name, passwordHash, members: [], retrospectives: [] });
  const archive = (...teams: ReturnType<typeof team>[]) => ({
    teams,
    meta: { revision: 1, updatedAt: '2025-01-01T00:00:00.000Z' },
    resetTokens: [],
    orphanedFeedbacks: []
  });
  // A token as a login mints it now, under the team's current epoch.
  const loginToken = async (teamId: string) =>
    tokens.createSessionToken(teamId, null, { sessionEpoch: (await dataStore.loadTeamAuthState(teamId)).sessionEpoch });
  const verdict = async (token: string) => {
    const claims = tokens.validateSessionToken(token);
    return sessionVerdict(claims, await dataStore.loadTeamAuthState(claims!.teamId));
  };

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-restore-epoch-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
    await dataStore.saveTeam('t1', team('t1', 'Alpha', 'hash-alpha-now'));
    await dataStore.saveTeam('t2', team('t2', 'Beta', 'hash-beta'));
    await dataStore.saveTeamIndex(new Map([['alpha', 't1'], ['beta', 't2']]));
  });

  afterEach(() => {
    try {
      dataStore.closeDatabase();
    } catch {
      /* ignore */
    }
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('signs out a team whose password the archive rolls back, and nobody else', async () => {
    const alpha = await loginToken('t1');
    const beta = await loginToken('t2');

    await dataStore.savePersistedData(archive(team('t1', 'Alpha', 'hash-alpha-then'), team('t2', 'Beta', 'hash-beta')), { mode: 'replace' });

    expect(await verdict(alpha)).toBe('revoked');
    expect(await verdict(beta)).toBe('current');
  });

  it('signs out a team the archive brings back, and forgets the epoch of a team it deletes', async () => {
    await dataStore.saveTeam('t3', team('t3', 'Gamma', 'hash-gamma'));
    await dataStore.rotateTeamSessionEpoch('t3');
    // A team deleted since the backup, whose token outlived it.
    const ghostToken = tokens.createSessionToken('t9', null, { sessionEpoch: '0' });

    await dataStore.savePersistedData(
      archive(team('t1', 'Alpha', 'hash-alpha-now'), team('t2', 'Beta', 'hash-beta'), team('t9', 'Delta', 'hash-delta')),
      { mode: 'replace' }
    );

    expect(await verdict(ghostToken)).toBe('revoked');
    const raw = dataStore.getSqliteDb().prepare('SELECT key FROM kv_store WHERE key = ?').get('team-auth:t3');
    expect(raw).toBeUndefined();
  });

  it('closes the hole a failed rotation and its retry would leave', async () => {
    // The replace writes Alpha with the archived password, and the rotation
    // after the write fails (best-effort: the restore itself succeeds).
    // Rotating only after the write would leave Alpha's sessions alive under
    // the rolled-back password, and the admin's retry would compare two equal
    // hashes and rotate nothing: the rotation *before* the write closes it.
    const alpha = await loginToken('t1');
    const db = dataStore.getSqliteDb();
    // The first rotation inserts Alpha's row; the second would update it.
    db.exec(`CREATE TRIGGER fail_second_rotation BEFORE UPDATE ON kv_store
             WHEN OLD.key = 'team-auth:t1' BEGIN SELECT RAISE(ABORT, 'simulated outage'); END`);
    const rolledBack = archive(team('t1', 'Alpha', 'hash-alpha-then'), team('t2', 'Beta', 'hash-beta'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await dataStore.savePersistedData(rolledBack, { mode: 'replace' });
    expect(warn).toHaveBeenCalled();
    db.exec('DROP TRIGGER fail_second_rotation');
    await dataStore.savePersistedData(rolledBack, { mode: 'replace' });

    expect((await dataStore.loadTeam('t1'))?.passwordHash).toBe('hash-alpha-then');
    expect(await verdict(alpha)).toBe('revoked');
    warn.mockRestore();
  });
});

