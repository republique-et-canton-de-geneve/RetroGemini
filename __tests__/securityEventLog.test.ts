import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createSecurityEventLog, SECURITY_ACTIONS } from '../server/services/securityEvents.js';
import { runWithContext } from '../server/services/logContext.js';

/**
 * Audit H45 — **privileged actions leave a durable trace.**
 *
 * The super admin is a single shared password. It can read every team's data,
 * rename and delete teams, download and restore backups, and reconfigure the
 * LLM endpoint. Until this, the only record of any of that was H44's in-memory
 * ring — so after a rolling update there was no evidence a restore had ever
 * happened. "A team's retrospectives disappeared: deletion, restore, or bug?"
 * had no answer at all.
 *
 * These rows are the answer. They live in the database, beside `backups`, and
 * they survive the pod.
 *
 * **Append-only means the application has no path that mutates or removes a
 * row** — there is no update and no delete in `dataStore`'s security-event API,
 * which is asserted below. It does **not** mean the database enforces it: an
 * operator with SQL access can still delete rows, and no application-level
 * design can prevent that. Say it that way rather than claiming more.
 *
 * Run against a real SQLite store, the default engine in CI. The PostgreSQL
 * branch is the same two statements against the same column names; what a
 * SQLite run cannot catch is a divergence between the two dialects, which is
 * why the two `CREATE TABLE` statements sit next to each other in `dataStore`.
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

describe('H45 — the security event log (SQLite)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-audit-'));
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

  const req = (ip = '10.1.2.3') => ({ ip });

  it('writes a row carrying the actor, the action, the outcome and the source IP', async () => {
    const log = createSecurityEventLog({ dataStore });

    await log.record(req('192.0.2.9'), {
      action: SECURITY_ACTIONS.SUPER_ADMIN_LOGIN,
      actor: 'super-admin',
      outcome: 'success'
    });

    const events = await dataStore.listSecurityEvents({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'super-admin.login',
      actor: 'super-admin',
      outcome: 'success',
      sourceIp: '192.0.2.9'
    });
    expect(typeof events[0].createdAt).toBe('string');
  });

  it('records a FAILED super-admin authentication', async () => {
    // The one that matters and the one most likely to be forgotten: a trail
    // that only holds successes cannot show an attempt to guess the password.
    const log = createSecurityEventLog({ dataStore });

    await log.record(req(), {
      action: SECURITY_ACTIONS.SUPER_ADMIN_LOGIN,
      actor: 'anonymous',
      outcome: 'failure'
    });

    const [event] = await dataStore.listSecurityEvents({ limit: 10 });
    expect(event.outcome).toBe('failure');
    expect(event.actor).toBe('anonymous');
  });

  it('carries the correlation id of the request that produced it (H44)', async () => {
    // This is what joins a row to the log lines around it. Without it the trail
    // says "a restore happened at 14:20" and stops there.
    const log = createSecurityEventLog({ dataStore });

    await runWithContext({ correlationId: 'incident-1420' }, async () => {
      await log.record(req(), {
        action: SECURITY_ACTIONS.BACKUP_RESTORE,
        actor: 'super-admin',
        outcome: 'success',
        target: 'backup-7'
      });
    });

    const [event] = await dataStore.listSecurityEvents({ limit: 10 });
    expect(event.correlationId).toBe('incident-1420');
    expect(event.target).toBe('backup-7');
  });

  it('survives a restart of the process — the point of the whole item', async () => {
    const log = createSecurityEventLog({ dataStore });
    await log.record(req(), {
      action: SECURITY_ACTIONS.TEAM_DELETE,
      actor: 'team:abc',
      outcome: 'success',
      target: 'abc'
    });
    await dataStore.closeDatabase();

    // A different process object reading the same file, which is what a rolling
    // update produces. H44's in-memory ring loses everything here.
    const reopened = createDataStore({ rootDir: dir });
    await reopened.initDatabase();
    try {
      const events = await reopened.listSecurityEvents({ limit: 10 });
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('team.delete');
    } finally {
      await reopened.closeDatabase();
      dataStore = reopened;
    }
  });

  it('survives a faithful-replace restore — the reason it is a table and not a KV record', async () => {
    // `savePersistedData(..., { mode: 'replace' })` deletes every `team:` record
    // absent from the archive and clears all `session:` state. Put the trail in
    // `kv_store` and a restore erases the evidence of the restore — which is
    // the one moment an investigation most needs it. This pins the separation
    // rather than trusting the comment beside the CREATE TABLE.
    const log = createSecurityEventLog({ dataStore });
    await log.record(req(), {
      action: SECURITY_ACTIONS.BACKUP_RESTORE,
      actor: 'super-admin',
      outcome: 'success',
      target: 'backup-3'
    });

    await dataStore.savePersistedData({ teams: [] }, { mode: 'replace' });

    const events = await dataStore.listSecurityEvents({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('backup.restore');
  });

  it('returns the newest event first, and honours the limit', async () => {
    const log = createSecurityEventLog({ dataStore });
    for (const target of ['one', 'two', 'three']) {
      await log.record(req(), {
        action: SECURITY_ACTIONS.TEAM_RENAME,
        actor: 'super-admin',
        outcome: 'success',
        target
      });
    }

    const events = await dataStore.listSecurityEvents({ limit: 2 });
    expect(events.map((e) => e.target)).toEqual(['three', 'two']);
  });

  it('exposes no way to change or remove a recorded event', async () => {
    // Append-only, as far as the application is concerned. If someone adds an
    // `updateSecurityEvent` later, this fails and they have to argue for it.
    const surface = Object.keys(dataStore).filter((key) => /securityevent/i.test(key));
    expect(surface.sort()).toEqual(['appendSecurityEvent', 'listSecurityEvents']);
  });

  it('never stores a secret, even when a caller puts one in the detail', async () => {
    // `detail` is free-form and written by call sites that also handle
    // passwords and API keys. It is serialised through the same redaction the
    // log records use, so a slip at one call site does not put a credential in
    // the database — where it would outlive the process that leaked it.
    const log = createSecurityEventLog({ dataStore });

    await log.record(req(), {
      action: SECURITY_ACTIONS.AI_SETTINGS_UPDATE,
      actor: 'super-admin',
      outcome: 'success',
      detail: { apiUrl: 'https://llm.internal.example/v1', apiKey: 'sk-super-secret-value' }
    });

    const [event] = await dataStore.listSecurityEvents({ limit: 10 });
    expect(event.detail).toContain('llm.internal.example');
    expect(event.detail).not.toContain('sk-super-secret-value');
  });

  it('never lets a failed audit write break the operation it was recording', async () => {
    // A restore that worked must not be reported as failed because the audit
    // insert did not. The reverse trade — losing the operation to protect the
    // record — is worse for an internal deployment, and the loss is loud.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = {
      appendSecurityEvent: vi.fn(async () => {
        throw new Error('disk full');
      })
    };
    const log = createSecurityEventLog({ dataStore: broken });

    await expect(
      log.record(req(), {
        action: SECURITY_ACTIONS.BACKUP_RESTORE,
        actor: 'super-admin',
        outcome: 'success'
      })
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses an action name that is not in the declared set', async () => {
    // The action strings are what an investigation greps for. A typo that
    // writes `team.delted` produces a row nobody will ever find, so the set is
    // closed and a stray name is a loud failure at the call site rather than a
    // quiet hole in the trail.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = createSecurityEventLog({ dataStore });

    await log.record(req(), { action: 'team.delted', actor: 'super-admin', outcome: 'success' });

    expect(await dataStore.listSecurityEvents({ limit: 10 })).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
