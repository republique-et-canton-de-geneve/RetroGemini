import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { DEFAULT_SESSION_EPOCH, TeamAuthRowCorruptError } from '../server/services/sessionEpoch.js';

/**
 * Decision D3b — each team's session epoch lives in a row of its own,
 * `team-auth:{teamId}`, and every team route and socket join reads it.
 *
 * Two promises are held here. The read is cheap: one statement that answers
 * whether the team exists *and* its epoch without ever reading the team
 * record's value, so a token-authenticated write still parses nothing but its
 * own record (the 38.1 hot path). And the rotation is part of the password
 * write: the same transaction holding the team row, so two concurrent
 * rotations end with one password and that rotation's epoch.
 *
 * SQLite always runs. The same suite runs against a real PostgreSQL when
 * `TEST_DATABASE_URL` is set (run it with `--no-file-parallelism`: the
 * PostgreSQL run shares rows with the other suites that read that variable).
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

const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-team-auth-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-team-auth-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`team session epochs (${engine.name})`, () => {
    let store: Store;
    let other: Store;
    let dir: string;
    const savedEnv: Record<string, string | undefined> = {};
    const prefix = `ta${Date.now().toString(36)}`;
    const created = new Set<string>();
    const tid = (n: string) => {
      const id = `${prefix}-${n}`;
      created.add(id);
      return id;
    };

    const writeRaw = async (key: string, text: string) => {
      const pool = store.getPgPool();
      if (pool) {
        await pool.query(
          `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, text]
        );
        return;
      }
      store.getSqliteDb().prepare(
        `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      ).run(key, text);
    };

    const readRaw = async (key: string): Promise<string | null> => {
      const pool = store.getPgPool();
      if (pool) {
        const result = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
        return result.rows[0]?.value ?? null;
      }
      return store.getSqliteDb().prepare('SELECT value FROM kv_store WHERE key = ?').get(key)?.value ?? null;
    };

    const saveTeam = (id: string, extra: Record<string, unknown> = {}) =>
      store.saveTeam(id, { id, name: `Team ${id}`, passwordHash: 'scrypt$1$1$1$salt$old', retrospectives: [], ...extra });

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      store = createDataStore({ rootDir: dir });
      await store.initDatabase();
      other = createDataStore({ rootDir: dir });
      await other.initDatabase();
    });

    afterAll(async () => {
      for (const id of created) {
        await store.deleteTeamRecord(id).catch(() => undefined);
      }
      await other.closeDatabase();
      await store.closeDatabase();
      rmSync(dir, { recursive: true, force: true });
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.restoreAllMocks();
    });

    it("reads a team that never rotated as the epoch '0', and a missing team as not existing", async () => {
      const id = tid('fresh');
      await saveTeam(id);

      expect(await store.loadTeamAuthState(id)).toEqual({ exists: true, sessionEpoch: DEFAULT_SESSION_EPOCH, revokedAt: null });
      expect(await store.loadTeamAuthState(tid('missing'))).toEqual({ exists: false, sessionEpoch: DEFAULT_SESSION_EPOCH, revokedAt: null });
    });

    it('never reads the team record: a record that does not parse still exists', async () => {
      // The performance proof. Parsing the record (what `loadTeam` does, and
      // what the 38.1 hot path must not do) throws on this text; the auth read
      // answers anyway, so it cannot be parsing it.
      const id = tid('unparseable');
      await writeRaw(`team:${id}`, '{"not json');

      await expect(store.loadTeam(id)).rejects.toThrow();
      expect(await store.loadTeamAuthState(id)).toMatchObject({ exists: true, sessionEpoch: DEFAULT_SESSION_EPOCH });
      // Gone before the scans below, which parse every record.
      await store.deleteTeamRecord(id);
    });

    it('rotates the epoch in the transaction that writes the team, and answers it', async () => {
      const id = tid('rotate');
      await saveTeam(id);
      const before = Date.now();

      const result = await store.atomicTeamUpdate(id, (team: Record<string, unknown>) => ({ ...team, passwordHash: 'new' }), { rotateSessionEpoch: true });

      expect(result.success).toBe(true);
      expect(result.sessionEpoch).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(result.revokedAt).toBeGreaterThanOrEqual(before);
      expect(await store.loadTeamAuthState(id)).toEqual({ exists: true, sessionEpoch: result.sessionEpoch, revokedAt: result.revokedAt });
      // Another pod reads the same row.
      expect((await other.loadTeamAuthState(id)).sessionEpoch).toBe(result.sessionEpoch);
    });

    it('leaves the epoch alone when the updater throws or declines, and without the option', async () => {
      const id = tid('declined');
      await saveTeam(id);
      const first = await store.atomicTeamUpdate(id, (team: Record<string, unknown>) => ({ ...team, passwordHash: 'p1' }), { rotateSessionEpoch: true });

      await expect(store.atomicTeamUpdate(id, () => { throw new Error('boom'); }, { rotateSessionEpoch: true })).rejects.toThrow('boom');
      expect((await store.loadTeamAuthState(id)).sessionEpoch).toBe(first.sessionEpoch);

      const declined = await store.atomicTeamUpdate(id, () => null, { rotateSessionEpoch: true });
      expect(declined.success).toBe(true);
      expect(declined.sessionEpoch).toBeUndefined();
      expect((await store.loadTeamAuthState(id)).sessionEpoch).toBe(first.sessionEpoch);

      await store.atomicTeamUpdate(id, (team: Record<string, unknown>) => ({ ...team, name: 'Renamed' }));
      expect((await store.loadTeamAuthState(id)).sessionEpoch).toBe(first.sessionEpoch);
    });

    it('does not rotate for a team that does not exist', async () => {
      const id = tid('ghost');
      const result = await store.atomicTeamUpdate(id, (team: Record<string, unknown>) => team, { rotateSessionEpoch: true });

      expect(result).toMatchObject({ success: false, error: 'team_not_found' });
      expect(await readRaw(`team-auth:${id}`)).toBeNull();
    });

    it('never repeats an epoch', async () => {
      const id = tid('repeat');
      await saveTeam(id);
      const seen = new Set<string>();
      for (let i = 0; i < 20; i += 1) {
        seen.add((await store.rotateTeamSessionEpoch(id)).sessionEpoch);
      }
      expect(seen.size).toBe(20);
      expect(seen.has(DEFAULT_SESSION_EPOCH)).toBe(false);
    });

    it('is no team: absent from every team scan and from the archive', async () => {
      const id = tid('scans');
      await saveTeam(id);
      await store.rotateTeamSessionEpoch(id);

      const ids = (await store.loadAllTeams()).map((team: { id: string }) => team.id);
      expect(ids.filter((teamId: string) => teamId === id)).toHaveLength(1);
      expect(ids.some((teamId: string) => teamId.startsWith('team-auth'))).toBe(false);
      const summaries = await store.loadTeamSummaries();
      expect(summaries.filter((summary: { id: string }) => summary.id === id)).toHaveLength(1);
      const archive = await store.loadPersistedData();
      expect(JSON.stringify(archive)).not.toContain('team-auth');
      expect(JSON.stringify(archive)).not.toContain('sessionEpoch');
    });

    it('goes with its team, and the boot sweep removes an orphan but keeps a live team row', async () => {
      const gone = tid('gone');
      const kept = tid('kept');
      await saveTeam(gone);
      await saveTeam(kept);
      await store.rotateTeamSessionEpoch(gone);
      const keptEpoch = (await store.rotateTeamSessionEpoch(kept)).sessionEpoch;

      await store.deleteTeamRecord(gone);
      expect(await readRaw(`team-auth:${gone}`)).toBeNull();

      const orphan = tid('orphan');
      await writeRaw(`team-auth:${orphan}`, JSON.stringify({ v: 1, sessionEpoch: 'x', revokedAt: 1 }));
      expect(await store.sweepOrphanedTeamAuthRows()).toBeGreaterThanOrEqual(1);
      expect(await readRaw(`team-auth:${orphan}`)).toBeNull();
      expect((await store.loadTeamAuthState(kept)).sessionEpoch).toBe(keptEpoch);
    });

    it('throws TeamAuthRowCorruptError on a corrupt row, and reads a later version with extra fields', async () => {
      const corrupt = tid('corrupt');
      await saveTeam(corrupt);
      await writeRaw(`team-auth:${corrupt}`, '{"sessionEpoch":');
      await expect(store.loadTeamAuthState(corrupt)).rejects.toBeInstanceOf(TeamAuthRowCorruptError);

      // A rotation writes blindly, so it repairs the row.
      const repaired = await store.atomicTeamUpdate(corrupt, (team: Record<string, unknown>) => ({ ...team, passwordHash: 'fixed' }), { rotateSessionEpoch: true });
      expect((await store.loadTeamAuthState(corrupt)).sessionEpoch).toBe(repaired.sessionEpoch);

      const later = tid('later');
      await saveTeam(later);
      await writeRaw(`team-auth:${later}`, JSON.stringify({ v: 2, sessionEpoch: 'e2', revokedAt: 7, scope: 'all' }));
      expect(await store.loadTeamAuthState(later)).toEqual({ exists: true, sessionEpoch: 'e2', revokedAt: 7 });
    });

    it('ends two concurrent rotations with one password and that rotation’s epoch', async () => {
      // The last rotation wins both fields, because the epoch is written under
      // the team's row lock. Written after the commit instead, the interleaving
      // "hash A, hash B, epoch B, epoch A" would leave B's password with A's
      // epoch, and A — who does not know B's password — a valid token.
      const id = tid('race');
      await saveTeam(id);
      const rotate = (s: Store, hash: string) =>
        s.atomicTeamUpdate(id, (team: Record<string, unknown>) => ({ ...team, passwordHash: hash }), { rotateSessionEpoch: true });

      for (let round = 0; round < 5; round += 1) {
        const [a, b] = await Promise.all([rotate(store, `hash-a-${round}`), rotate(other, `hash-b-${round}`)]);
        const stored = (await store.loadTeam(id)) as { passwordHash: string };
        const winner = stored.passwordHash === `hash-a-${round}` ? a : b;
        expect([`hash-a-${round}`, `hash-b-${round}`]).toContain(stored.passwordHash);
        expect((await store.loadTeamAuthState(id)).sessionEpoch).toBe(winner.sessionEpoch);
      }
    });
  });
}
