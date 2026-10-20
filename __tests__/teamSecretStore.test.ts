import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

/**
 * Where a team's Jira token lives, and what may never happen to it.
 *
 * The token is stored in its own row, `team-secret:{teamId}`, and never on the
 * team record: the record is sent to every member's browser, written whole by
 * several routes, copied by merges and restores, and included in every backup a
 * super admin can download. Its own key is none of those. Four rules follow,
 * one per block below:
 *
 *  - the row is invisible to every scan of teams (`LIKE 'team:%'` never
 *    matches `team-secret:`, whose fifth character is `-`);
 *  - deleting a team deletes its secret first, so a failure leaves the team
 *    intact for a retry rather than a secret with no team;
 *  - a whole-store restore keeps a secret only for a team that is in the
 *    archive and existed before it, and carries the current Jira links onto
 *    the archive (a restore never rolls a credential back, so the token stays
 *    and the links must too, or the next click creates every issue again);
 *  - the Jira connection (`jira-settings`) is its own row, read strictly: the
 *    `global-settings` writers read-modify-write a blob whose read answers `{}`
 *    on error, which would erase a connection kept beside them.
 *
 * SQLite always runs. The same suite runs against a real PostgreSQL when
 * `TEST_DATABASE_URL` is set, e.g.
 * `TEST_DATABASE_URL=postgres://user:pass@localhost/db npx vitest run __tests__/teamSecretStore.test.ts`.
 * The replace restore runs on SQLite only: it deletes every `team:` and
 * `session:` row the archive does not hold, which on a shared PostgreSQL test
 * database would wipe the rows of every suite running beside this one.
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
type Json = Record<string, any>;

const LINK = { key: 'RETRO-7', createdAt: '2026-10-20T09:00:00.000Z' };

const sealed = (marker: string) => ({
  jira: { v: 1, iv: 'aXY', tag: 'dGFn', ct: `ct-${marker}`, connectedAs: 'Bot', setAt: '2026-10-20T08:00:00.000Z' }
});

const engines: { name: string; postgres: boolean; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    postgres: false,
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-team-secret-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    postgres: true,
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-team-secret-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`team secrets and the Jira connection in the store (${engine.name})`, () => {
    let store: Store;
    let dir: string;
    const savedEnv: Record<string, string | undefined> = {};
    const prefix = `ts${Date.now().toString(36)}`;
    // Every id a test touches, so the cleanup cannot fall out of step with the
    // tests (the PostgreSQL run writes into a shared database).
    const created = new Set<string>();
    const tid = (n: string) => {
      const id = `${prefix}-${n}`;
      created.add(id);
      return id;
    };
    let jiraSettingsBefore: string | null = null;

    // Raw SQL for what the store has no method for: a corrupt row, a refused
    // delete. Both engines, written once.
    const exec = async (sqliteSql: string, pgSql: string, params: unknown[] = []) => {
      if (engine.postgres) return (store.getPgPool() as any).query(pgSql, params);
      return store.getSqliteDb()!.prepare(sqliteSql).run(...params);
    };
    const readRaw = async (key: string): Promise<string | null> => {
      if (engine.postgres) {
        const result = await (store.getPgPool() as any).query('SELECT value FROM kv_store WHERE key = $1', [key]);
        return result.rows[0]?.value ?? null;
      }
      const row = store.getSqliteDb()!.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value ?? null;
    };
    const writeRaw = (key: string, value: string) => exec(
      'INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );
    const deleteRaw = (key: string) => exec('DELETE FROM kv_store WHERE key = ?', 'DELETE FROM kv_store WHERE key = $1', [key]);

    // A database trigger that refuses to delete one row: the only honest way
    // to make the store's own delete fail half-way through an operation.
    const refuseDeleteOf = async (key: string) => {
      const name = `${prefix.replace(/[^a-z0-9]/g, '')}_refuse_${created.size}`;
      if (engine.postgres) {
        const pool = store.getPgPool() as any;
        await pool.query(`CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused by test'; END; $$ LANGUAGE plpgsql`);
        await pool.query(`CREATE TRIGGER ${name} BEFORE DELETE ON kv_store FOR EACH ROW WHEN (OLD.key = '${key}') EXECUTE FUNCTION ${name}()`);
        return async () => {
          await pool.query(`DROP TRIGGER IF EXISTS ${name} ON kv_store`);
          await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
        };
      }
      const db = store.getSqliteDb()!;
      db.prepare(`CREATE TRIGGER ${name} BEFORE DELETE ON kv_store WHEN old.key = '${key}' BEGIN SELECT RAISE(ABORT, 'refused by test'); END`).run();
      return async () => {
        db.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
      };
    };

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      store = createDataStore({ rootDir: dir });
      await store.initDatabase();
      jiraSettingsBefore = await readRaw('jira-settings');
    });

    afterAll(async () => {
      for (const id of created) {
        await store.deleteTeamRecord(id).catch(() => {});
        await store.deleteTeamSecret(id).catch(() => {});
      }
      if (jiraSettingsBefore === null) await deleteRaw('jira-settings');
      else await writeRaw('jira-settings', jiraSettingsBefore);
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
      vi.restoreAllMocks();
    });

    describe('the team-secret row', () => {
      it('saves, loads and deletes a team secret, and reads null when there is none', async () => {
        const id = tid('crud');
        expect(await store.loadTeamSecret(id)).toBeNull();

        await store.saveTeamSecret(id, sealed('one'));
        expect(await store.loadTeamSecret(id)).toEqual(sealed('one'));

        await store.saveTeamSecret(id, sealed('two'));
        expect(await store.loadTeamSecret(id)).toEqual(sealed('two'));

        await store.deleteTeamSecret(id);
        expect(await store.loadTeamSecret(id)).toBeNull();
      });

      // A Jira 401 marks the token refused only when it is still the token the
      // failing request used: the read and the write are one compare-and-swap,
      // so a token saved meanwhile is never overwritten with the one it replaced.
      it('updates a secret only while it still holds what the updater was shown', async () => {
        const id = tid('cas');
        expect(await store.updateTeamSecret(id, () => sealed('never'))).toBe(false);
        expect(await store.loadTeamSecret(id)).toBeNull();

        await store.saveTeamSecret(id, sealed('one'));
        const shown: Json[] = [];
        expect(await store.updateTeamSecret(id, (current: Json) => {
          shown.push(current);
          return { jira: { ...current.jira, refusedAt: '2026-10-20T10:00:00.000Z' } };
        })).toBe(true);
        expect(shown).toEqual([sealed('one')]);
        expect(await store.loadTeamSecret(id)).toEqual({ jira: { ...sealed('one').jira, refusedAt: '2026-10-20T10:00:00.000Z' } });

        // Nothing to change: no write.
        const before = await readRaw(`team-secret:${id}`);
        expect(await store.updateTeamSecret(id, () => null)).toBe(false);
        expect(await readRaw(`team-secret:${id}`)).toBe(before);

        // Replaced between the read and the write — a token saved on another
        // pod, say: the write is dropped and the new token survives. The
        // replacement lands right after the store's read, on the store's own
        // connection (SQLite: inside the updater; PostgreSQL: behind the read).
        const key = `team-secret:${id}`;
        const replacement = JSON.stringify(sealed('replaced'));
        const markStale = (current: Json) => ({ jira: { ...current.jira, refusedAt: 'stale' } });
        let wrote: boolean;
        if (engine.postgres) {
          const pool = store.getPgPool() as any;
          const original = pool.query.bind(pool);
          const spy = vi.spyOn(pool, 'query').mockImplementation(async (...args: any[]) => {
            const result = await original(...args);
            if (/^SELECT value FROM kv_store/.test(String(args[0])) && args[1]?.[0] === key) {
              await original('UPDATE kv_store SET value = $2 WHERE key = $1', [key, replacement]);
            }
            return result;
          });
          try {
            wrote = await store.updateTeamSecret(id, markStale);
          } finally {
            spy.mockRestore();
          }
        } else {
          wrote = await store.updateTeamSecret(id, (current: Json) => {
            store.getSqliteDb()!.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(replacement, key);
            return markStale(current);
          });
        }
        expect(wrote).toBe(false);
        expect(await store.loadTeamSecret(id)).toEqual(sealed('replaced'));
      });

      it('refuses a team id that is not a non-empty string, rather than writing team-secret:undefined', async () => {
        for (const bad of [undefined, null, '', 42]) {
          await expect(store.saveTeamSecret(bad as unknown as string, sealed('x'))).rejects.toThrow(TypeError);
          await expect(store.loadTeamSecret(bad as unknown as string)).rejects.toThrow(TypeError);
          await expect(store.deleteTeamSecret(bad as unknown as string)).rejects.toThrow(TypeError);
        }
      });

      // Read as a team, the row would be a ghost team on the login screen and
      // in the console — and its sealed token would travel in every backup.
      it('is never read as a team by any scan', async () => {
        const id = tid('scan');
        await store.saveTeam(id, { id, name: `Scan ${id}`, members: [], retrospectives: [] });
        await store.saveTeamSecret(id, sealed('scan'));
        const lonely = tid('lonely');
        await store.saveTeamSecret(lonely, sealed('lonely'));

        const all = (await store.loadAllTeams()).filter((team: Json) => String(team.id).startsWith(prefix));
        expect(all.map((team: Json) => team.id)).toEqual([id]);
        expect(JSON.stringify(all)).not.toContain('ct-scan');

        const summaries = (await store.loadTeamSummaries()).filter((team: Json) => String(team.id).startsWith(prefix));
        expect(summaries.map((team: Json) => team.id)).toEqual([id]);
        expect(await store.teamExists(lonely)).toBe(false);
      });
    });

    describe('deleting a team', () => {
      it('deletes its secret with it', async () => {
        const id = tid('delete');
        await store.saveTeam(id, { id, name: `Delete ${id}` });
        await store.saveTeamSecret(id, sealed('delete'));

        await store.deleteTeamRecord(id);

        expect(await store.loadTeamRaw(id)).toBeNull();
        expect(await store.loadTeamSecret(id)).toBeNull();
      });

      // The other order would leave, on a failure, a secret nobody can reach
      // or remove: the team is gone, and with it every way to authenticate a
      // retry.
      it('deletes the secret first: when that fails, the team is still there to retry', async () => {
        const id = tid('delete-order');
        await store.saveTeam(id, { id, name: `Order ${id}` });
        await store.saveTeamSecret(id, sealed('order'));
        const release = await refuseDeleteOf(`team-secret:${id}`);
        try {
          await expect(store.deleteTeamRecord(id)).rejects.toThrow();
          expect(await store.loadTeamRaw(id)).not.toBeNull();
        } finally {
          await release();
        }

        await store.deleteTeamRecord(id);
        expect(await store.loadTeamRaw(id)).toBeNull();
        expect(await store.loadTeamSecret(id)).toBeNull();
      });
    });

    describe('sweepOrphanedTeamSecrets', () => {
      // An older pod deleting a team during a rolling update knows nothing of
      // secrets, and a token saved while its team was being deleted can land
      // after the record went: both leave a secret with no team.
      it('removes every secret whose team is gone, keeps the others, and says how many it removed', async () => {
        // Anything a previous run left behind goes first, so the count below
        // is this test's alone.
        await store.sweepOrphanedTeamSecrets();
        const kept = tid('sweep-kept');
        await store.saveTeam(kept, { id: kept, name: `Kept ${kept}` });
        await store.saveTeamSecret(kept, sealed('kept'));
        const orphanA = tid('sweep-orphan-a');
        const orphanB = tid('sweep-orphan-b');
        await store.saveTeamSecret(orphanA, sealed('a'));
        await store.saveTeamSecret(orphanB, sealed('b'));

        expect(await store.sweepOrphanedTeamSecrets()).toBe(2);

        expect(await store.loadTeamSecret(kept)).toEqual(sealed('kept'));
        expect(await store.loadTeamSecret(orphanA)).toBeNull();
        expect(await store.loadTeamSecret(orphanB)).toBeNull();
        expect(await store.sweepOrphanedTeamSecrets()).toBe(0);
      });
    });

    describe('the Jira connection (jira-settings)', () => {
      it('reads null before anything is saved, then what was saved', async () => {
        await deleteRaw('jira-settings');
        expect(await store.loadJiraSettings()).toBeNull();

        const settings = { enabled: true, baseUrl: 'https://jira.example.org', allowSelfSignedCerts: false };
        await store.saveJiraSettings(settings);
        expect(await store.loadJiraSettings()).toEqual(settings);
      });

      it('refuses to store anything but one settings object', async () => {
        for (const bad of [null, undefined, 'x', [1]]) {
          await expect(store.saveJiraSettings(bad as unknown as Json)).rejects.toThrow(TypeError);
        }
      });

      // The global-settings read answers `{}` on an error, and every writer of
      // that blob replaces it whole: a hiccup would erase whatever sat beside
      // it. The Jira connection has its own row and a read that fails loudly.
      it('fails loudly on an unreadable row instead of answering "not configured"', async () => {
        await writeRaw('jira-settings', '{not json');
        await expect(store.loadJiraSettings()).rejects.toThrow();
        await store.saveJiraSettings({ enabled: false, baseUrl: null, allowSelfSignedCerts: false });
      });

      it('fails loudly when the database cannot be queried', async () => {
        const closed = createDataStore({ rootDir: dir });
        await closed.initDatabase();
        await closed.closeDatabase();
        await expect(closed.loadJiraSettings()).rejects.toThrow();
      });

      it('is a row of its own, untouched by a global-settings write', async () => {
        const settings = { enabled: true, baseUrl: 'https://jira.example.org/jira', allowSelfSignedCerts: true };
        await store.saveJiraSettings(settings);
        const globalBefore = await readRaw('global-settings');
        try {
          await store.saveGlobalSettings({ infoMessage: 'Maintenance' });
          expect(await store.loadJiraSettings()).toEqual(settings);
          expect(await store.loadGlobalSettings()).not.toHaveProperty('jira');
        } finally {
          if (globalBefore === null) await deleteRaw('global-settings');
          else await writeRaw('global-settings', globalBefore);
        }
      });
    });

    describe.skipIf(engine.postgres)('a whole-store restore (replace)', () => {
      const archiveOf = (teams: Json[]) => ({ teams, meta: { revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' }, resetTokens: [], orphanedFeedbacks: [] });
      const team = (id: string, extra: Json = {}) => ({ id, name: `Team ${id}`, members: [], retrospectives: [], healthChecks: [], globalActions: [], ...extra });

      it('keeps a secret only for a team in the archive that existed before; drops the others', async () => {
        const stays = tid('replace-stays');
        const removed = tid('replace-removed');
        const revived = tid('replace-revived');
        await store.saveTeam(stays, team(stays));
        await store.saveTeam(removed, team(removed));
        await store.saveTeamSecret(stays, sealed('stays'));
        await store.saveTeamSecret(removed, sealed('removed'));
        // Deleted since the backup, but its secret survived the deletion (an
        // older pod, a token saved mid-deletion): the restore brings the team
        // back, and must not hand it a token nobody set for it since.
        await store.saveTeamSecret(revived, sealed('revived'));

        await store.savePersistedData(archiveOf([team(stays), team(revived)]), { mode: 'replace' });

        expect(await store.loadTeamSecret(stays)).toEqual(sealed('stays'));
        expect(await store.loadTeamSecret(removed)).toBeNull();
        expect(await store.loadTeamSecret(revived)).toBeNull();
        expect(await store.loadTeamRaw(revived)).not.toBeNull();
        expect(await store.loadTeamRaw(removed)).toBeNull();
      });

      it('removes the secrets before any team row, so a failure never leaves a secret behind its deleted team', async () => {
        const removed = tid('replace-order');
        await store.saveTeam(removed, team(removed));
        await store.saveTeamSecret(removed, sealed('order'));
        const release = await refuseDeleteOf(`team:${removed}`);
        try {
          await expect(store.savePersistedData(archiveOf([]), { mode: 'replace' })).rejects.toThrow();
          expect(await store.loadTeamSecret(removed)).toBeNull();
        } finally {
          await release();
        }
      });

      // A backup taken before the issues were created: without the carry the
      // actions come back unlinked while the token stays, and the next click
      // creates every issue a second time.
      it('carries the current Jira links onto the archived actions', async () => {
        const id = tid('replace-links');
        await store.saveTeam(id, team(id, {
          globalActions: [{ id: 'a1', text: 'Fix the build', done: false, jira: LINK }],
          retrospectives: [{ id: 'r1', actions: [{ id: 'a1', text: 'Fix the build', done: false, jira: LINK }] }]
        }));

        await store.savePersistedData(archiveOf([team(id, {
          globalActions: [{ id: 'a1', text: 'Fix the build', done: false }],
          retrospectives: [{ id: 'r1', actions: [{ id: 'a1', text: 'Fix the build', done: false }, { id: 'a2', text: 'Other' }] }]
        })]), { mode: 'replace' });

        const restored = await store.loadTeam(id);
        expect(restored.globalActions[0].jira).toEqual(LINK);
        expect(restored.retrospectives[0].actions[0].jira).toEqual(LINK);
        expect(restored.retrospectives[0].actions[1]).not.toHaveProperty('jira');
      });

      it('restores without carrying when the current record cannot be read, rather than failing the restore', async () => {
        const id = tid('replace-unreadable');
        await writeRaw(`team:${id}`, '{not json');
        const warn = vi.mocked(console.warn);
        warn.mockClear();

        await store.savePersistedData(archiveOf([team(id, { globalActions: [{ id: 'a1', text: 'Kept' }] })]), { mode: 'replace' });

        const restored = await store.loadTeam(id);
        expect(restored.globalActions).toEqual([{ id: 'a1', text: 'Kept' }]);
        expect(warn.mock.calls.some((call) => String(call[0]).includes('Jira links'))).toBe(true);
      });

      it('restores the team record as archived, jiraClaims included: it is team data', async () => {
        const id = tid('replace-claims');
        const claims = { a1: { at: '2026-10-20T09:00:00.000Z', requestId: 'req-1' } };
        await store.savePersistedData(archiveOf([team(id, { jiraClaims: claims, jiraTarget: { mode: 'project', projectKey: 'RETRO', issueTypeId: '3', labels: [] } })]), { mode: 'replace' });

        const restored = await store.loadTeam(id);
        expect(restored.jiraClaims).toEqual(claims);
        expect(restored.jiraTarget).toMatchObject({ projectKey: 'RETRO' });
      });
    });
  });
}

describe('wiring', () => {
  // A source assertion, like the email and password passes beside it: every
  // suite builds its own store, so a sweep missing from `server.js` would leave
  // them all green while production kept the orphans. It proves the call is
  // written in the right place and cannot fail the boot, not that it runs —
  // the sweep's own tests above cover that.
  it('sweeps orphaned team secrets at startup, after the email pass and before the startup backup, without failing the boot', () => {
    const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

    const emails = source.indexOf('await healStoredEmails({ dataStore });');
    const sweep = source.indexOf('await dataStore.sweepOrphanedTeamSecrets()');
    const backup = source.indexOf('await backupService.createStartupBackup();');
    expect(emails).toBeGreaterThan(-1);
    expect(sweep).toBeGreaterThan(emails);
    expect(backup).toBeGreaterThan(sweep);

    const between = source.slice(emails, backup);
    expect(between.lastIndexOf('try {', between.indexOf('sweepOrphanedTeamSecrets'))).toBeGreaterThan(-1);
    expect(between.slice(between.indexOf('sweepOrphanedTeamSecrets'))).toMatch(/\} catch \(err\) \{\s*console\.warn\(/);
    // One summary line on every run, like the two passes before it, and it
    // names what the sweep returned.
    expect(between).toMatch(/const (\w+) = await dataStore\.sweepOrphanedTeamSecrets\(\);\s*console\.info\([^)]*\$\{\1\}/);
  });
});
