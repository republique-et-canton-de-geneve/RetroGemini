import express from 'express';
import { gzipSync } from 'zlib';
import { describe, expect, it, vi } from 'vitest';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { hashPassword, isHashedPassword, verifyPassword } from '../server/services/passwordHashing.js';
import { postJson, request } from './helpers/routeTestServer';

/**
 * H23, prerequisite 2 — a restore can put plaintext password records back.
 *
 * The startup migration (decision D1) hashes every legacy record a *booted*
 * deployment holds, which is what makes removing the plaintext-compare fallback
 * thinkable. It runs exactly once, at boot. A super-admin restore then rewrites
 * the whole store from an archive that may predate hashing — and the store is
 * left holding clear-text passwords again, with no boot in sight to clean them
 * up. Today they still authenticate through the fallback, so the damage is
 * "plaintext passwords are readable in the database again". Once the fallback is
 * removed, the same restore would leave those teams unable to log in at all,
 * which is why this is the half that actually blocks H23 rather than a tidiness
 * exercise.
 *
 * Both restore routes are covered, because they are two independent writers of
 * the same state: `/api/super-admin/restore` replaces from an uploaded archive,
 * `/api/super-admin/backups/restore` from a stored one.
 *
 * The migration must never turn a successful restore into a failed one — a
 * restore is the recovery path, and a password-format pass failing is not a
 * reason to tell the administrator their rollback did not happen.
 */

const VALID_PASSWORD = 'super-secret';

type StoredTeam = { id: string; name: string; passwordHash: string };

const createRestoreDataStore = () => {
  const teamsById = new Map<string, StoredTeam>();

  return {
    teamsById,
    savePersistedData: vi.fn(async (data: { teams?: StoredTeam[] }) => {
      teamsById.clear();
      for (const team of data.teams || []) {
        teamsById.set(team.id, structuredClone(team));
      }
    }),
    loadAllTeams: vi.fn(async () => [...teamsById.values()].map((team) => structuredClone(team))),
    atomicTeamUpdate: vi.fn(async (teamId: string, updater: (team: StoredTeam) => StoredTeam | null) => {
      const team = teamsById.get(teamId);
      if (!team) return { success: false, error: 'not_found' };
      const next = updater(structuredClone(team));
      if (next) teamsById.set(teamId, next);
      return { success: true };
    }),
    loadPersistedData: vi.fn(async () => ({ teams: [...teamsById.values()] })),
    loadGlobalSettings: vi.fn(async () => ({})),
    loadSessionState: vi.fn(async () => null)
  };
};

const legacyArchive = () => ({
  teams: [
    { id: 'team-1', name: 'Platform Team', passwordHash: 'plaintext-from-2024' },
    { id: 'team-2', name: 'Payments Team', passwordHash: 'another-old-password' }
  ]
});

const buildApp = (overrides: Record<string, unknown> = {}) => {
  const app = express();
  app.use(express.json());

  const dataStore = (overrides.dataStore as ReturnType<typeof createRestoreDataStore>) ?? createRestoreDataStore();
  const storedArchive = (overrides.storedArchive as { teams: StoredTeam[] }) ?? legacyArchive();

  const backupService = {
    createBackup: vi.fn(async () => ({ id: 'backup-pre-restore', type: 'auto' })),
    listBackups: vi.fn(async () => []),
    getBackupConfig: vi.fn(() => ({ enabled: true, maxCount: 7 })),
    getBackupData: vi.fn(async () => ({ filename: 'backup-1.json.gz', data: gzipSync(JSON.stringify(storedArchive)) })),
    // Mirrors the real service: it decompresses the archive and hands it to the
    // same faithful-replace write the uploaded route uses.
    restoreFromBackup: vi.fn(async (backupId: string) => {
      await dataStore.savePersistedData(storedArchive);
      return { id: backupId, filename: 'backup-1.json.gz' };
    }),
    deleteBackup: vi.fn(async () => true),
    updateBackup: vi.fn(async () => ({}))
  };

  registerSuperAdminRoutes({
    app,
    io: { fetchSockets: vi.fn(async () => []), serverSideEmit: vi.fn() },
    dataStore,
    tokenService: {
      validateSuperAdminAuth: vi.fn((body: { password?: string } | undefined) => body?.password === VALID_PASSWORD),
      createSuperAdminToken: vi.fn(),
      validateSuperAdminToken: vi.fn(() => true)
    },
    mailerService: { smtpEnabled: false, mailer: null },
    logService: { addServerLog: vi.fn(), getServerLogs: vi.fn(() => []), clearServerLogs: vi.fn() },
    escapeHtml: (value: string) => String(value ?? ''),
    superAdminPassword: VALID_PASSWORD,
    sessionCache: new Map(),
    backupService,
    aiService: {},
    serverRuntime: { multiPodAdapter: false },
    ...overrides
  });

  return { app, dataStore, backupService };
};

// The uploaded route takes the archive as the raw request body and its
// credential in a header, so it cannot use `postJson`. It is sent gzipped
// under `application/gzip` because that is what the super-admin UI sends and
// the only content type that survives the global `express.json()` — see H30.
const uploadArchive = (archive: unknown) => ({
  method: 'POST' as const,
  headers: {
    'content-type': 'application/gzip',
    'x-super-admin-password': VALID_PASSWORD
  },
  body: gzipSync(JSON.stringify(archive))
});

describe('restore rehashes legacy password records (H23 prerequisite)', () => {
  it('leaves no plaintext password behind after an uploaded-archive restore', async () => {
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/super-admin/restore', uploadArchive(legacyArchive()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, teamsRestored: 2 });

    for (const team of dataStore.teamsById.values()) {
      expect(isHashedPassword(team.passwordHash)).toBe(true);
    }
    // The credential must survive the upgrade, not merely the shape: an
    // administrator restoring a 2024 backup expects those teams to log in.
    expect(await verifyPassword('plaintext-from-2024', dataStore.teamsById.get('team-1')!.passwordHash)).toBe(true);
    expect(await verifyPassword('another-old-password', dataStore.teamsById.get('team-2')!.passwordHash)).toBe(true);
    expect(await verifyPassword('wrong', dataStore.teamsById.get('team-1')!.passwordHash)).toBe(false);
  });

  it('leaves no plaintext password behind after a stored-backup restore', async () => {
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/super-admin/backups/restore', postJson({
      password: VALID_PASSWORD,
      backupId: 'backup-1'
    }));

    expect(response.status).toBe(200);
    for (const team of dataStore.teamsById.values()) {
      expect(isHashedPassword(team.passwordHash)).toBe(true);
    }
    expect(await verifyPassword('plaintext-from-2024', dataStore.teamsById.get('team-1')!.passwordHash)).toBe(true);
  });

  it('runs the migration after the replace, never before it', async () => {
    // Order is the whole point: the pass has to see the *restored* records. Run
    // it first and it hashes the state the archive is about to overwrite.
    const { app, dataStore } = buildApp();

    await request(app, '/api/super-admin/restore', uploadArchive(legacyArchive()));

    expect(dataStore.savePersistedData.mock.invocationCallOrder[0])
      .toBeLessThan(dataStore.loadAllTeams.mock.invocationCallOrder[0]);
  });

  it('writes nothing when the restored archive already holds hashes', async () => {
    const hashed = await hashPassword('modern-password');
    const { app, dataStore } = buildApp();

    await request(app, '/api/super-admin/restore', uploadArchive({
      teams: [{ id: 'team-1', name: 'Platform Team', passwordHash: hashed }]
    }));

    // The common case — every backup taken since hashing shipped — must cost one
    // scan and no writes at all.
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
    expect(dataStore.teamsById.get('team-1')!.passwordHash).toBe(hashed);
  });

  it('still reports a successful restore when the rehash pass fails', async () => {
    const dataStore = createRestoreDataStore();
    dataStore.atomicTeamUpdate = vi.fn(async () => {
      throw new Error('store unavailable');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/restore', uploadArchive(legacyArchive()));

    // The restore *did* happen. Reporting it as failed would send an
    // administrator into a second rollback of state that is already correct.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, teamsRestored: 2 });
    expect(dataStore.teamsById.size).toBe(2);
    warn.mockRestore();
  });

  it('still reports a successful stored-backup restore when the rehash pass fails', async () => {
    const dataStore = createRestoreDataStore();
    dataStore.loadAllTeams = vi.fn(async () => {
      throw new Error('store unavailable');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/backups/restore', postJson({
      password: VALID_PASSWORD,
      backupId: 'backup-1'
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    warn.mockRestore();
  });

  it('does not rehash when the restore never ran', async () => {
    // A rejected restore leaves the live store untouched, so the pass must not
    // run against it — it would be a write nobody asked for on state that is
    // not being replaced.
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/super-admin/restore', uploadArchive({ teams: 'not-an-array' }));

    expect(response.status).toBe(400);
    expect(dataStore.loadAllTeams).not.toHaveBeenCalled();
    expect(dataStore.atomicTeamUpdate).not.toHaveBeenCalled();
  });

  it('does not rehash when the pre-restore snapshot fails', async () => {
    const { app, dataStore, backupService } = buildApp();
    backupService.createBackup.mockResolvedValueOnce(null);

    const response = await request(app, '/api/super-admin/backups/restore', postJson({
      password: VALID_PASSWORD,
      backupId: 'backup-1'
    }));

    expect(response.status).toBe(503);
    expect(dataStore.loadAllTeams).not.toHaveBeenCalled();
  });
});
