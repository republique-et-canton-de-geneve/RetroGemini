import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';

/**
 * What a backup archive carries — and what it deliberately does not (H43).
 *
 * Rehearsed on 2026-08-25 against a real PostgreSQL 16, by destroying the
 * database and restoring into an empty one. The data came back in full: team,
 * members, the retrospective with its status, the ticket **with its two votes**,
 * the action with its assignee, the ROTI, the feedback with its author, and the
 * original password still authenticated. The deployment's **configuration** did
 * not: before the wipe the AI settings read `enabled: true, apiUrl:
 * "https://llm.internal.example/v1"`; after the restore they read
 * `enabled: false, apiUrl: ""`, and `global-settings` was absent from the store.
 *
 * That omission is pinned here rather than left to be rediscovered, because
 * adding `globalSettings` to the archive is **not** an obvious improvement: the
 * archive is downloadable by the super admin, and `globalSettings.ai.apiKey` is
 * a live credential. Putting it in a file that leaves the server is a decision
 * with a security side, not a bug fix. Whoever changes this must change this
 * test too — which is the point.
 *
 * Runs against a real SQLite store in a temp directory rather than a stubbed
 * adapter: `createDataStore` takes a `rootDir`, and a test that mocks a shape
 * the factory does not accept passes without ever reaching the code it claims
 * to cover.
 */

const makeTeam = (id: string, name: string) => ({
  id,
  name,
  passwordHash: 'scrypt$16384$8$1$salt$hash',
  members: [{ id: 'm1', name: 'Alice', color: 'bg-rose-500', role: 'facilitator' }],
  retrospectives: [],
  healthChecks: [],
  globalActions: [],
  teamFeedbacks: []
});

describe('the backup archive contract', () => {
  let rootDir: string;
  let store: ReturnType<typeof createDataStore>;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'archive-contract-'));
    delete process.env.DATABASE_URL;
    // `DATA_STORE_PATH` is the first candidate the store tries; `rootDir` is the
    // last, behind `/data/data.sqlite` and `/tmp/data.sqlite`. Without this the
    // test silently opens whatever `/tmp/data.sqlite` an e2e run left behind —
    // which is how it first "passed" while reading 110 unrelated teams.
    process.env.DATA_STORE_PATH = join(rootDir, 'data.sqlite');
    store = createDataStore({ rootDir });
    await store.initDatabase();
  });

  afterEach(async () => {
    await store.closeDatabase();
    delete process.env.DATA_STORE_PATH;
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('carries the teams, the reset tokens and the orphaned feedbacks', async () => {
    await store.saveTeam('t1', makeTeam('t1', 'Equipe Bilan'));
    await store.saveTeamIndex(new Map([['equipe bilan', 't1']]));

    const archive = await store.loadPersistedData();

    expect(archive.teams.map((t: { name: string }) => t.name)).toEqual(['Equipe Bilan']);
    expect(archive).toHaveProperty('resetTokens');
    expect(archive).toHaveProperty('orphanedFeedbacks');
  });

  it('does NOT carry the deployment configuration, and that is deliberate', async () => {
    await store.saveTeam('t1', makeTeam('t1', 'Equipe Bilan'));
    await store.saveTeamIndex(new Map([['equipe bilan', 't1']]));
    await store.saveGlobalSettings({
      adminEmail: 'admin@example.org',
      infoMessage: 'Maintenance Friday',
      ai: { enabled: true, apiUrl: 'https://llm.internal.example/v1', apiKey: 'secret-key-xyz' }
    });

    // The settings really are in the store — otherwise the assertions below
    // would pass for the wrong reason.
    const stored = await store.loadGlobalSettings();
    expect(stored.ai.apiKey).toBe('secret-key-xyz');

    const archive = await store.loadPersistedData();

    // Restoring into a fresh installation therefore comes back with the data
    // and **without** the AI configuration, the admin email or the info banner.
    expect(archive).not.toHaveProperty('globalSettings');
    const serialised = JSON.stringify(archive);
    expect(serialised).not.toContain('secret-key-xyz');
    expect(serialised).not.toContain('admin@example.org');
    expect(serialised).not.toContain('Maintenance Friday');
  });
});
