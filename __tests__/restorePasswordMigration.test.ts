import express from 'express';
import { gzipSync } from 'zlib';
import { describe, expect, it, vi } from 'vitest';
import { registerSuperAdminRoutes } from '../server/routes/superAdminRoutes.js';
import { hashPassword, isHashedPassword, verifyPassword } from '../server/services/passwordHashing.js';
import { postJson, request, withServer } from './helpers/routeTestServer';

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
    // The password pass reads two fields per team, never the full records.
    // There is deliberately no whole-record scan in this double: a pass that
    // went back to one would fail every case below, instead of passing
    // vacuously on a missing function.
    loadTeamPasswordHashes: vi.fn(async () =>
      [...teamsById.values()].map((team) => ({ id: team.id, passwordHash: team.passwordHash }))),
    // The email heal scans the projection, not the full records.
    loadTeamSummaries: vi.fn(async () => [...teamsById.values()].map((team) => structuredClone(team))),
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
    // The stored-backup restore checks the backup exists (metadata only)
    // before its snapshot, then reads and checks the archive after it.
    listBackups: vi.fn(async () => [{ id: 'backup-1' }]),
    getBackupConfig: vi.fn(() => ({ enabled: true, maxCount: 7 })),
    getBackupData: vi.fn(async () => ({ filename: 'backup-1.json.gz', data: gzipSync(JSON.stringify(storedArchive)) })),
    readBackupArchive: vi.fn(async () => ({ filename: 'backup-1.json.gz', data: structuredClone(storedArchive) })),
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
      .toBeLessThan(dataStore.loadTeamPasswordHashes.mock.invocationCallOrder[0]);
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
    dataStore.loadTeamPasswordHashes = vi.fn(async () => {
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
    expect(dataStore.loadTeamPasswordHashes).not.toHaveBeenCalled();
    expect(dataStore.loadTeamSummaries).not.toHaveBeenCalled();
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
    expect(dataStore.loadTeamPasswordHashes).not.toHaveBeenCalled();
    expect(dataStore.loadTeamSummaries).not.toHaveBeenCalled();
  });
});

/**
 * The same hook carries the email heal (`server/services/emailMigration.js`):
 * an archive taken before the shared email rule puts values like the incident's
 * `elisabeth.trolliet@etat.ge.ch;` back into a store the startup pass already
 * cleaned, and nothing else would run over them until the next boot.
 */
describe('restore cleans stored email addresses', () => {
  const dirtyArchive = () => ({
    teams: [
      {
        id: 'team-1',
        name: 'Platform Team',
        passwordHash: 'plaintext-from-2024',
        facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch;',
        members: [{ id: 'm1', name: 'Ann', email: 'Ann <Ann@Example.ch>' }]
      }
    ]
  });

  it('cleans the restored records after an uploaded-archive restore', async () => {
    const { app, dataStore } = buildApp();

    const response = await request(app, '/api/super-admin/restore', uploadArchive(dirtyArchive()));

    expect(response.status).toBe(200);
    const team = dataStore.teamsById.get('team-1') as unknown as {
      facilitatorEmail: string;
      members: { email: string }[];
    };
    expect(team.facilitatorEmail).toBe('elisabeth.trolliet@etat.ge.ch');
    expect(team.members[0].email).toBe('ann@example.ch');
  });

  it('cleans the restored records after a stored-backup restore', async () => {
    const { app, dataStore } = buildApp({ storedArchive: dirtyArchive() });

    const response = await request(app, '/api/super-admin/backups/restore', postJson({
      password: VALID_PASSWORD,
      backupId: 'backup-1'
    }));

    expect(response.status).toBe(200);
    expect((dataStore.teamsById.get('team-1') as unknown as { facilitatorEmail: string }).facilitatorEmail)
      .toBe('elisabeth.trolliet@etat.ge.ch');
  });

  it('still reports a successful restore when the email heal fails', async () => {
    const dataStore = createRestoreDataStore();
    dataStore.loadGlobalSettings = vi.fn(async () => {
      throw new Error('settings unavailable');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { app } = buildApp({ dataStore });

    const response = await request(app, '/api/super-admin/restore', uploadArchive(dirtyArchive()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, teamsRestored: 1 });
    warn.mockRestore();
  });
});

/**
 * Decision D3b — a restore can give a team a new session epoch (a password
 * rolled back, a team brought back), and the sockets joined with a token that
 * epoch revokes must leave their sessions at once. On a single pod, which
 * broadcasts nothing, the restoring pod's own sweep is the only immediate cut:
 * without it they stayed in their sessions, re-persisting pre-restore state,
 * until the periodic sweep a minute later. A refused restore wrote nothing,
 * so it sweeps nothing.
 */
describe('restore re-checks the live sockets', () => {
  const revocation = () => ({
    revokeTeamSessions: vi.fn(async () => undefined),
    sweepAllLocal: vi.fn(async () => undefined),
    attachLocalSweeper: vi.fn()
  });

  it('sweeps after an uploaded-archive restore, and not after a refused one', async () => {
    const sessionRevocation = revocation();
    const { app, backupService } = buildApp({ sessionRevocation });

    expect((await request(app, '/api/super-admin/restore', uploadArchive({ teams: 'not-an-array' }))).status).toBe(400);
    backupService.createBackup.mockResolvedValueOnce(null);
    expect((await request(app, '/api/super-admin/restore', uploadArchive(legacyArchive()))).status).toBe(503);
    expect(sessionRevocation.sweepAllLocal).not.toHaveBeenCalled();

    expect((await request(app, '/api/super-admin/restore', uploadArchive(legacyArchive()))).status).toBe(200);
    expect(sessionRevocation.sweepAllLocal).toHaveBeenCalledTimes(1);
  });

  it('sweeps after a stored-backup restore, and not after a refused one', async () => {
    const sessionRevocation = revocation();
    const { app, backupService } = buildApp({ sessionRevocation });
    const restore = () => postJson({ password: VALID_PASSWORD, backupId: 'backup-1' });

    backupService.createBackup.mockResolvedValueOnce(null);
    expect((await request(app, '/api/super-admin/backups/restore', restore())).status).toBe(503);

    // A second restore while one runs is refused.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const restoreFromBackup = backupService.restoreFromBackup.getMockImplementation()!;
    backupService.restoreFromBackup.mockImplementationOnce(async (backupId: string) => {
      await held;
      return restoreFromBackup(backupId);
    });
    await withServer(app, async (call) => {
      const first = call('/api/super-admin/backups/restore', restore());
      await vi.waitFor(() => expect(backupService.restoreFromBackup).toHaveBeenCalled());
      const second = await call('/api/super-admin/backups/restore', restore());
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: 'restore_in_progress' });
      expect(sessionRevocation.sweepAllLocal).not.toHaveBeenCalled();

      release();
      expect((await first).status).toBe(200);
    });
    expect(sessionRevocation.sweepAllLocal).toHaveBeenCalledTimes(1);
  });
});
