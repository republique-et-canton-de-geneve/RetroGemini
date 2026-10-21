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
 * The Jira integration follows the same line, for the same reason. The
 * connection (`jira-settings`) is deployment configuration, and each team's
 * token (`team-secret:{teamId}`) is a live credential — sealed, but a
 * downloaded archive should hold no Jira credential at all, sealed or not.
 * Neither is in an archive: a restore into a fresh installation needs the
 * console's Jira settings entered again, and every team its token. What a
 * team record holds about Jira (`jiraTarget`, the issues `jiraClaims` was
 * creating) is team data, carried and restored like the rest of the record.
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
    await store.updateGlobalSettings(() => ({
      adminEmail: 'admin@example.org',
      infoMessage: 'Maintenance Friday',
      ai: { enabled: true, apiUrl: 'https://llm.internal.example/v1', apiKey: 'secret-key-xyz' }
    }));

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

  it('does NOT carry the Jira connection or any team\'s Jira token, and that is deliberate', async () => {
    await store.saveTeam('t1', makeTeam('t1', 'Equipe Bilan'));
    await store.saveTeamIndex(new Map([['equipe bilan', 't1']]));
    await store.saveJiraSettings({ enabled: true, baseUrl: 'https://jira.internal.example/jira', allowSelfSignedCerts: true });
    await store.saveTeamSecret('t1', {
      jira: { v: 1, iv: 'aXZpdml2aXZpdml2', tag: 'dGFndGFndGFndGFn', ct: 'sealed-jira-token-ciphertext', connectedAs: 'Jira Robot', setAt: '2026-10-20T08:00:00.000Z' }
    });

    // Both really are in the store, or the assertions below prove nothing.
    expect(await store.loadJiraSettings()).toMatchObject({ baseUrl: 'https://jira.internal.example/jira' });
    expect(await store.loadTeamSecret('t1')).toMatchObject({ jira: { ct: 'sealed-jira-token-ciphertext' } });

    const archive = await store.loadPersistedData();

    expect(archive).not.toHaveProperty('jiraSettings');
    expect(archive).not.toHaveProperty('teamSecrets');
    const serialised = JSON.stringify(archive);
    expect(serialised).not.toContain('sealed-jira-token-ciphertext');
    expect(serialised).not.toContain('Jira Robot');
    expect(serialised).not.toContain('jira.internal.example');
  });

  it('carries the Jira fields of a team record and restores them as stored: they are team data', async () => {
    const target = { mode: 'project', projectKey: 'BILAN', issueTypeId: '10001', labels: ['retrospective'] };
    const claims = { a1: { at: '2026-10-20T09:00:00.000Z', requestId: 'req-1' } };
    const link = { key: 'BILAN-4', createdAt: '2026-10-20T09:00:01.000Z' };
    await store.saveTeam('t1', {
      ...makeTeam('t1', 'Equipe Bilan'),
      jiraTarget: target,
      jiraClaims: claims,
      globalActions: [{ id: 'a0', text: 'Linked', done: false, jira: link }]
    });
    await store.saveTeamIndex(new Map([['equipe bilan', 't1']]));
    await store.saveTeamSecret('t1', { jira: { v: 1, iv: 'aXY', tag: 'dGFn', ct: 'sealed' } });

    const archive = await store.loadPersistedData();
    expect(archive.teams[0]).toMatchObject({ jiraTarget: target, jiraClaims: claims });

    // Restored into an empty installation: the record comes back whole, and
    // no token comes with it.
    process.env.DATA_STORE_PATH = join(rootDir, 'fresh.sqlite');
    const fresh = createDataStore({ rootDir });
    await fresh.initDatabase();
    try {
      await fresh.savePersistedData(JSON.parse(JSON.stringify(archive)), { mode: 'replace' });
      const restored = await fresh.loadTeam('t1');
      expect(restored.jiraTarget).toEqual(target);
      expect(restored.jiraClaims).toEqual(claims);
      expect(restored.globalActions[0].jira).toEqual(link);
      expect(await fresh.loadTeamSecret('t1')).toBeNull();
      expect(await fresh.loadJiraSettings()).toBeNull();
    } finally {
      await fresh.closeDatabase();
    }
  });
});
