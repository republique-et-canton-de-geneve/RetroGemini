import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

/**
 * Integration coverage for the store's core primitives against a real SQLite
 * database (the default engine in CI). `dataStore.js` backs the hardening
 * invariants — per-team compare-and-swap, the team index, the meta record, the
 * session CAS and the backup store — and was the worst risk/coverage ratio in
 * the repo.
 *
 * Areas already owned by a dedicated suite are not repeated here:
 * `sessionStateCas.test.ts` (session CAS), `dataStoreRestore.test.ts` (faithful
 * replace), `dataStoreScaling.test.ts` / `dataStoreFeedbackProjection.test.ts`
 * (SQL projections), `dataStoreBackupElection.test.ts` (interval election).
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

describe('dataStore core primitives (SQLite)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-ds-core-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

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
    vi.restoreAllMocks();
  });

  // Writes a raw KV row, bypassing the store's own helpers. Used to simulate a
  // concurrent writer and to seed legacy records.
  const writeRaw = (key: string, value: unknown) => {
    dataStore.getSqliteDb()!.prepare(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, JSON.stringify(value));
  };

  const readRaw = (key: string) => {
    const row = dataStore.getSqliteDb()!.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as
      { value?: string } | undefined;
    return row?.value ? JSON.parse(row.value) : null;
  };

  describe('team records', () => {
    it('hides the revision stamp from callers but keeps it in the record', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });

      expect(await dataStore.loadTeam('t1')).toEqual({ id: 't1', name: 'Alpha' });
      expect(await dataStore.loadTeamRaw('t1')).toMatchObject({ id: 't1', _rev: 1 });
      expect(await dataStore.loadTeamRaw('t1')).toHaveProperty('_updatedAt');
    });

    it('advances the revision on every save', async () => {
      const first = await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });
      expect(first._rev).toBe(1);

      const second = await dataStore.saveTeam('t1', first);
      expect(second._rev).toBe(2);
    });

    it('answers null for a team that does not exist', async () => {
      expect(await dataStore.loadTeam('ghost')).toBeNull();
      expect(await dataStore.loadTeamRaw('ghost')).toBeNull();
    });

    it('deletes a team record', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });
      await dataStore.deleteTeamRecord('t1');

      expect(await dataStore.loadTeam('t1')).toBeNull();
      expect(await dataStore.loadAllTeams()).toEqual([]);
    });

    it('returns every team without its revision stamp, and never the index record', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });
      await dataStore.saveTeam('t2', { id: 't2', name: 'Beta' });
      await dataStore.saveTeamIndex(new Map([['alpha', 't1'], ['beta', 't2']]));

      const teams = await dataStore.loadAllTeams();

      expect(teams.map((t: { id: string }) => t.id).sort()).toEqual(['t1', 't2']);
      expect(teams.every((t: Record<string, unknown>) => !('_rev' in t))).toBe(true);
    });
  });

  describe('per-team compare-and-swap', () => {
    it('accepts a write built on the current revision and advances it', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });

      const result = await dataStore.atomicTeamSave('t1', { id: 't1', name: 'Renamed' }, 1);

      expect(result.success).toBe(true);
      expect(result.data._rev).toBe(2);
      expect((await dataStore.loadTeam('t1')).name).toBe('Renamed');
    });

    it('rejects a write built on a stale revision and returns the authoritative record', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });
      await dataStore.saveTeam('t1', { id: 't1', name: 'Beta', _rev: 1 });

      const result = await dataStore.atomicTeamSave('t1', { id: 't1', name: 'Stale' }, 1);

      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({ name: 'Beta', _rev: 2 });
      // The losing write is not persisted.
      expect((await dataStore.loadTeam('t1')).name).toBe('Beta');
    });

    it('creates a record when the caller expects revision 0', async () => {
      const result = await dataStore.atomicTeamSave('t1', { id: 't1', name: 'Alpha' }, 0);

      expect(result.success).toBe(true);
      expect(result.data._rev).toBe(1);
    });

    it('refuses to create a record when the caller expects an existing revision', async () => {
      const result = await dataStore.atomicTeamSave('t1', { id: 't1', name: 'Alpha' }, 3);

      expect(result).toEqual({ success: false, data: null });
      expect(await dataStore.loadTeam('t1')).toBeNull();
    });

    it('applies an update and hides the revision stamp from the updater', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });
      let seen: Record<string, unknown> | null = null;

      const result = await dataStore.atomicTeamUpdate('t1', (team: Record<string, unknown>) => {
        seen = { ...team };
        team.name = 'Renamed';
        return team;
      });

      expect(result).toEqual({ success: true, team: { id: 't1', name: 'Renamed' } });
      expect(seen).not.toHaveProperty('_rev');
      expect(seen).not.toHaveProperty('_updatedAt');
      expect((await dataStore.loadTeamRaw('t1'))._rev).toBe(2);
    });

    it('reports a missing team without calling the updater', async () => {
      const updater = vi.fn();

      expect(await dataStore.atomicTeamUpdate('ghost', updater)).toEqual({
        success: false,
        error: 'team_not_found'
      });
      expect(updater).not.toHaveBeenCalled();
    });

    it('treats an updater that returns nothing as a no-op that does not bump the revision', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });

      const result = await dataStore.atomicTeamUpdate('t1', () => null);

      expect(result).toEqual({ success: true, team: { id: 't1', name: 'Alpha' } });
      expect((await dataStore.loadTeamRaw('t1'))._rev).toBe(1);
    });

    it('retries a lost race and succeeds once the writer stops', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha', counter: 0 });
      let interference = 2;

      const result = await dataStore.atomicTeamUpdate('t1', (team: Record<string, unknown>) => {
        if (interference-- > 0) {
          // A concurrent writer lands between our read and our write.
          const current = readRaw('team:t1');
          writeRaw('team:t1', { ...current, _rev: Number(current._rev) + 1 });
        }
        team.counter = 1;
        return team;
      });

      expect(result.success).toBe(true);
      expect((await dataStore.loadTeam('t1')).counter).toBe(1);
    });

    it('gives up after the retry budget rather than looping forever', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });
      const updater = vi.fn((team: Record<string, unknown>) => {
        // A writer that always wins the race: every attempt is stale.
        const current = readRaw('team:t1');
        writeRaw('team:t1', { ...current, _rev: Number(current._rev) + 1 });
        return team;
      });

      const result = await dataStore.atomicTeamUpdate('t1', updater);

      expect(result).toEqual({ success: false, error: 'max_retries_exceeded' });
      expect(updater).toHaveBeenCalledTimes(5);
    });
  });

  describe('team index', () => {
    it('round-trips a name-to-id map', async () => {
      await dataStore.saveTeamIndex(new Map([['alpha', 't1'], ['beta', 't2']]));

      expect(await dataStore.loadTeamIndex()).toEqual(new Map([['alpha', 't1'], ['beta', 't2']]));
    });

    it('answers an empty map when no index has been written', async () => {
      expect(await dataStore.loadTeamIndex()).toEqual(new Map());
    });

    it('tolerates a malformed index record', async () => {
      writeRaw('team-index', { teams: 'not-an-object' });

      expect(await dataStore.loadTeamIndex()).toEqual(new Map());
    });

    it('keeps a team named __proto__ out of the prototype chain', async () => {
      // The index is user-named data, so it is stored as a Map and rebuilt onto
      // a null-prototype object; a team called "__proto__" must not pollute it.
      await dataStore.atomicTeamIndexUpdate((index: Map<string, string>) => {
        index.set('__proto__', 't-evil');
        index.set('constructor', 't-also-evil');
        return index;
      });

      const loaded = await dataStore.loadTeamIndex();
      expect(loaded.get('__proto__')).toBe('t-evil');
      expect(loaded.get('constructor')).toBe('t-also-evil');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });

    it('leaves the stored index untouched when the updater declines', async () => {
      await dataStore.saveTeamIndex(new Map([['alpha', 't1']]));

      const result = await dataStore.atomicTeamIndexUpdate(() => null);

      expect(result).toEqual(new Map([['alpha', 't1']]));
      expect(await dataStore.loadTeamIndex()).toEqual(new Map([['alpha', 't1']]));
    });

    it('retries a failing index transaction before giving up', async () => {
      let failures = 3;
      const updater = vi.fn((index: Map<string, string>) => {
        if (failures-- > 0) throw new Error('transient conflict');
        index.set('alpha', 't1');
        return index;
      });

      const result = await dataStore.atomicTeamIndexUpdate(updater);

      expect(result).toEqual(new Map([['alpha', 't1']]));
      expect(updater).toHaveBeenCalledTimes(4);
    });

    it('surfaces the failure when every index attempt fails', async () => {
      const updater = vi.fn(() => { throw new Error('permanent failure'); });

      await expect(dataStore.atomicTeamIndexUpdate(updater)).rejects.toThrow('permanent failure');
      expect(updater).toHaveBeenCalledTimes(5);
    });
  });

  describe('meta record', () => {
    it('fills in the expected arrays when nothing is stored', async () => {
      expect(await dataStore.loadMetaData()).toEqual({ resetTokens: [], orphanedFeedbacks: [] });
    });

    it('repairs a meta record with the wrong shape', async () => {
      writeRaw('retro-meta', { resetTokens: 'nope', orphanedFeedbacks: 42, other: 'kept' });

      expect(await dataStore.loadMetaData()).toEqual({
        resetTokens: [],
        orphanedFeedbacks: [],
        other: 'kept'
      });
    });

    it('normalizes on save as well as on load', async () => {
      await dataStore.saveMetaData({ resetTokens: null } as never);

      expect(readRaw('retro-meta')).toEqual({ resetTokens: [], orphanedFeedbacks: [] });
    });

    it('applies an update and persists it', async () => {
      const updated = await dataStore.atomicMetaUpdate((meta: Record<string, unknown[]>) => {
        meta.orphanedFeedbacks.push({ id: 'fb-1' });
        return meta;
      });

      expect(updated.orphanedFeedbacks).toEqual([{ id: 'fb-1' }]);
      expect((await dataStore.loadMetaData()).orphanedFeedbacks).toEqual([{ id: 'fb-1' }]);
    });

    it('leaves the stored meta untouched when the updater declines', async () => {
      await dataStore.saveMetaData({ resetTokens: [{ tokenHash: 'keep' }] } as never);

      const result = await dataStore.atomicMetaUpdate(() => null);

      expect(result.resetTokens).toEqual([{ tokenHash: 'keep' }]);
      expect((await dataStore.loadMetaData()).resetTokens).toEqual([{ tokenHash: 'keep' }]);
    });

    it('retries a failing meta transaction before giving up', async () => {
      let failures = 2;
      const updater = vi.fn((meta: Record<string, unknown[]>) => {
        if (failures-- > 0) throw new Error('transient conflict');
        meta.resetTokens.push({ tokenHash: 'later' });
        return meta;
      });

      await dataStore.atomicMetaUpdate(updater);

      expect(updater).toHaveBeenCalledTimes(3);
      expect((await dataStore.loadMetaData()).resetTokens).toEqual([{ tokenHash: 'later' }]);
    });

    it('surfaces the failure when every meta attempt fails', async () => {
      await expect(dataStore.atomicMetaUpdate(() => { throw new Error('permanent failure'); }))
        .rejects.toThrow('permanent failure');
    });
  });

  describe('session state', () => {
    it('answers null for a session that was never persisted', async () => {
      expect(await dataStore.loadSessionState('ghost')).toBeNull();
    });

    it('answers null instead of throwing when the stored blob is unreadable', async () => {
      dataStore.getSqliteDb()!.prepare(
        'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      ).run('session:broken', '{not json');

      expect(await dataStore.loadSessionState('broken')).toBeNull();
    });
  });

  describe('global settings', () => {
    it('answers an empty object before anything is configured', async () => {
      expect(await dataStore.loadGlobalSettings()).toEqual({});
    });

    it('round-trips settings and coerces a null write to an empty object', async () => {
      await dataStore.saveGlobalSettings({ adminEmail: 'admin@example.test' });
      expect(await dataStore.loadGlobalSettings()).toEqual({ adminEmail: 'admin@example.test' });

      await dataStore.saveGlobalSettings(null as never);
      expect(await dataStore.loadGlobalSettings()).toEqual({});
    });

    it('degrades to defaults rather than throwing when the store is unreadable', async () => {
      await dataStore.closeDatabase();

      expect(await dataStore.loadGlobalSettings()).toEqual({});

      // Re-open so afterEach can close cleanly.
      await dataStore.initDatabase();
    });

    it('surfaces a write failure', async () => {
      await dataStore.closeDatabase();

      await expect(dataStore.saveGlobalSettings({ adminEmail: 'x' })).rejects.toThrow();

      await dataStore.initDatabase();
    });
  });

  describe('legacy monolithic format', () => {
    it('rebuilds the legacy shape from per-team records', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });
      await dataStore.saveMetaData({
        resetTokens: [{ tokenHash: 'h' }],
        orphanedFeedbacks: [{ id: 'fb-1' }]
      } as never);

      const data = await dataStore.loadPersistedData();

      expect(data.teams).toEqual([{ id: 't1', name: 'Alpha' }]);
      expect(data.resetTokens).toEqual([{ tokenHash: 'h' }]);
      expect(data.orphanedFeedbacks).toEqual([{ id: 'fb-1' }]);
      expect(data.meta).toMatchObject({ revision: 0 });
    });

    it('degrades to an empty archive rather than throwing when the store is unreadable', async () => {
      await dataStore.closeDatabase();

      const data = await dataStore.loadPersistedData();

      expect(data).toMatchObject({ teams: [], resetTokens: [], orphanedFeedbacks: [] });
      await dataStore.initDatabase();
    });

    it('re-reads the store on refresh', async () => {
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });

      expect((await dataStore.refreshPersistedData()).teams).toHaveLength(1);
    });

    it('normalizes a malformed archive on save instead of rejecting it', async () => {
      const normalized = await dataStore.savePersistedData({ teams: 'nope' } as never);

      expect(normalized.teams).toEqual([]);
      expect(normalized.resetTokens).toEqual([]);
      expect(normalized.orphanedFeedbacks).toEqual([]);
      expect(normalized.meta).toMatchObject({ revision: 0 });
    });

    it('rebuilds the team index from the archive on save', async () => {
      await dataStore.savePersistedData({
        teams: [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta Team' }]
      } as never);

      expect(await dataStore.loadTeamIndex()).toEqual(new Map([['alpha', 't1'], ['beta team', 't2']]));
    });
  });

  describe('migration from the single-blob format', () => {
    it('does nothing when there is no legacy record', async () => {
      expect(await dataStore.migrateFromLegacyFormat()).toBe(false);
    });

    it('moves every team, the index and the meta out of the legacy blob', async () => {
      writeRaw('retro-data', {
        teams: [{ id: 't1', name: 'Alpha' }, { id: 't2', name: 'Beta' }],
        resetTokens: [{ tokenHash: 'h' }],
        orphanedFeedbacks: [{ id: 'fb-1' }]
      });

      expect(await dataStore.migrateFromLegacyFormat()).toBe(true);

      expect((await dataStore.loadAllTeams()).map((t: { id: string }) => t.id).sort()).toEqual(['t1', 't2']);
      expect(await dataStore.loadTeamIndex()).toEqual(new Map([['alpha', 't1'], ['beta', 't2']]));
      expect(await dataStore.loadMetaData()).toEqual({
        resetTokens: [{ tokenHash: 'h' }],
        orphanedFeedbacks: [{ id: 'fb-1' }]
      });
      // The legacy record is removed so the migration never runs twice.
      expect(readRaw('retro-data')).toBeNull();
    });

    it('drops a leftover legacy record when the store is already migrated', async () => {
      await dataStore.saveTeamIndex(new Map([['alpha', 't1']]));
      await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha' });
      writeRaw('retro-data', { teams: [{ id: 't-old', name: 'Should not appear' }] });

      expect(await dataStore.migrateFromLegacyFormat()).toBe(false);

      expect(readRaw('retro-data')).toBeNull();
      // The already-migrated data is untouched.
      expect((await dataStore.loadAllTeams()).map((t: { id: string }) => t.id)).toEqual(['t1']);
    });

    it('drops an empty legacy record without writing an index', async () => {
      writeRaw('retro-data', { teams: [] });

      expect(await dataStore.migrateFromLegacyFormat()).toBe(false);

      expect(readRaw('retro-data')).toBeNull();
      expect(await dataStore.loadTeamIndex()).toEqual(new Map());
    });

    it('ignores an unparseable legacy record', async () => {
      dataStore.getSqliteDb()!.prepare(
        'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      ).run('retro-data', '{not json');

      expect(await dataStore.migrateFromLegacyFormat()).toBe(false);
    });
  });

  describe('backup storage', () => {
    const entry = (overrides: Record<string, unknown> = {}) => ({
      id: 'b1',
      filename: 'b1.json.gz',
      type: 'manual',
      label: undefined,
      createdAt: '2026-07-01T00:00:00.000Z',
      sizeBytes: 10,
      teamCount: 2,
      protected: false,
      ...overrides
    });

    it('stores a backup and reads it back', async () => {
      await dataStore.saveBackup(entry({ label: 'before migration' }), Buffer.from('payload'));

      expect(await dataStore.listBackups()).toEqual([{
        id: 'b1',
        filename: 'b1.json.gz',
        type: 'manual',
        label: 'before migration',
        createdAt: '2026-07-01T00:00:00.000Z',
        sizeBytes: 10,
        teamCount: 2,
        protected: false
      }]);

      const data = await dataStore.getBackupData('b1');
      expect(data!.filename).toBe('b1.json.gz');
      expect(Buffer.from(data!.data).toString('utf8')).toBe('payload');
    });

    it('lists backups newest first and reports an absent label as undefined', async () => {
      await dataStore.saveBackup(entry({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }), Buffer.from('a'));
      await dataStore.saveBackup(entry({ id: 'new', createdAt: '2026-07-01T00:00:00.000Z' }), Buffer.from('b'));

      const backups = await dataStore.listBackups();

      expect(backups.map((b: { id: string }) => b.id)).toEqual(['new', 'old']);
      expect(backups[0].label).toBeUndefined();
    });

    it('answers null for an unknown backup', async () => {
      expect(await dataStore.getBackupData('ghost')).toBeNull();
      expect(await dataStore.deleteBackup('ghost')).toBe(false);
      expect(await dataStore.updateBackup('ghost', { label: 'x' })).toBeNull();
    });

    it('deletes a backup', async () => {
      await dataStore.saveBackup(entry(), Buffer.from('payload'));

      expect(await dataStore.deleteBackup('b1')).toBe(true);
      expect(await dataStore.listBackups()).toEqual([]);
    });

    it('updates the label and the protection flag independently', async () => {
      await dataStore.saveBackup(entry(), Buffer.from('payload'));

      expect(await dataStore.updateBackup('b1', { label: 'keep me' })).toMatchObject({
        label: 'keep me',
        protected: false
      });
      expect(await dataStore.updateBackup('b1', { protected: true })).toMatchObject({
        label: 'keep me',
        protected: true
      });
      // Clearing the label stores it as absent, not as an empty string.
      expect(await dataStore.updateBackup('b1', { label: '' })).toMatchObject({ label: undefined });
    });

    it('is a no-op when no updatable field is supplied', async () => {
      await dataStore.saveBackup(entry(), Buffer.from('payload'));

      expect(await dataStore.updateBackup('b1', {})).toBeNull();
    });

    it('finds a recent backup of a given type and ignores older or foreign ones', async () => {
      const recent = new Date(Date.now() - 1000).toISOString();
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      await dataStore.saveBackup(entry({ id: 'recent-auto', type: 'auto', createdAt: recent }), Buffer.from('a'));
      await dataStore.saveBackup(entry({ id: 'old-auto', type: 'auto', createdAt: old }), Buffer.from('b'));
      await dataStore.saveBackup(entry({ id: 'recent-manual', type: 'manual', createdAt: recent }), Buffer.from('c'));

      expect(await dataStore.getRecentBackupByType('auto', 60 * 60 * 1000)).toMatchObject({ id: 'recent-auto' });
      expect(await dataStore.getRecentBackupByType('auto', 500)).toBeNull();
      expect(await dataStore.getRecentBackupByType('startup', 60 * 60 * 1000)).toBeNull();
    });

    it('purges the oldest backups beyond the retention count', async () => {
      for (let i = 1; i <= 5; i++) {
        await dataStore.saveBackup(
          entry({ id: `b${i}`, type: 'auto', createdAt: `2026-07-0${i}T00:00:00.000Z` }),
          Buffer.from('x')
        );
      }

      expect(await dataStore.purgeOldBackups(['auto'], 3)).toBe(2);
      expect((await dataStore.listBackups()).map((b: { id: string }) => b.id)).toEqual(['b5', 'b4', 'b3']);
    });

    it('never purges a protected backup, even beyond the retention count', async () => {
      // This is why protected pre-restore snapshots accumulate: retention
      // deliberately skips them.
      await dataStore.saveBackup(
        entry({ id: 'snapshot', type: 'auto', createdAt: '2026-01-01T00:00:00.000Z', protected: true }),
        Buffer.from('x')
      );
      for (let i = 1; i <= 3; i++) {
        await dataStore.saveBackup(
          entry({ id: `b${i}`, type: 'auto', createdAt: `2026-07-0${i}T00:00:00.000Z` }),
          Buffer.from('x')
        );
      }

      expect(await dataStore.purgeOldBackups(['auto'], 1)).toBe(2);
      expect((await dataStore.listBackups()).map((b: { id: string }) => b.id).sort())
        .toEqual(['b3', 'snapshot']);
    });

    it('purges nothing when the count is within the retention limit', async () => {
      await dataStore.saveBackup(entry({ type: 'auto' }), Buffer.from('x'));

      expect(await dataStore.purgeOldBackups(['auto'], 7)).toBe(0);
      expect(await dataStore.listBackups()).toHaveLength(1);
    });

    it('purges across several types in one pass', async () => {
      await dataStore.saveBackup(entry({ id: 'a1', type: 'auto', createdAt: '2026-01-01T00:00:00.000Z' }), Buffer.from('x'));
      await dataStore.saveBackup(entry({ id: 's1', type: 'startup', createdAt: '2026-02-01T00:00:00.000Z' }), Buffer.from('x'));
      await dataStore.saveBackup(entry({ id: 'a2', type: 'auto', createdAt: '2026-03-01T00:00:00.000Z' }), Buffer.from('x'));
      // A manual backup is outside the purged types and must survive.
      await dataStore.saveBackup(entry({ id: 'm1', type: 'manual', createdAt: '2026-01-15T00:00:00.000Z' }), Buffer.from('x'));

      expect(await dataStore.purgeOldBackups(['auto', 'startup'], 1)).toBe(2);
      expect((await dataStore.listBackups()).map((b: { id: string }) => b.id).sort()).toEqual(['a2', 'm1']);
    });
  });

  describe('engine selection', () => {
    it('reports SQLite as the active engine and exposes its handle', () => {
      expect(dataStore.usePostgres).toBe(false);
      expect(dataStore.getSqliteDb()).not.toBeNull();
      expect(dataStore.getPgPool()).toBeNull();
    });

    it('closing twice is safe', async () => {
      await dataStore.closeDatabase();
      await dataStore.closeDatabase();

      expect(dataStore.getSqliteDb()).toBeNull();
      await dataStore.initDatabase();
    });
  });
});
