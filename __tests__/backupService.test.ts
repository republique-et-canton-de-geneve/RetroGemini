import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gunzipSync } from 'zlib';

// Dynamic import to allow env var mocking
let createBackupService: typeof import('../server/services/backupService').createBackupService;

const mockPersistedData = {
  teams: [
    { id: 'team-1', name: 'Alpha', members: [] },
    { id: 'team-2', name: 'Beta', members: [] }
  ],
  meta: { revision: 1, updatedAt: '2025-01-01T00:00:00.000Z' },
  resetTokens: [],
  orphanedFeedbacks: []
};

// In-memory backup store for testing
const createInMemoryBackupStore = () => {
  let backups: Array<{ id: string; filename: string; type: string; label?: string; createdAt: string; sizeBytes: number; teamCount: number; protected: boolean; data: Buffer }> = [];
  // Election marker for the atomic scheduler election. JS is single-threaded, so
  // this read-decide-write is naturally atomic — the same guarantee the real
  // store gets from its serialized transaction.
  let lastAutoBackupAt = 0;

  return {
    saveBackup: vi.fn(async (entry: any, compressedData: Buffer) => {
      backups.push({ ...entry, protected: entry.protected || false, data: compressedData });
    }),
    listBackups: vi.fn(async () => {
      return backups
        .map(({ data: _data, ...rest }) => rest)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }),
    getBackupData: vi.fn(async (id: string) => {
      const backup = backups.find((b) => b.id === id);
      if (!backup) return null;
      return { data: backup.data, filename: backup.filename };
    }),
    deleteBackup: vi.fn(async (id: string) => {
      const idx = backups.findIndex((b) => b.id === id);
      if (idx === -1) return false;
      backups.splice(idx, 1);
      return true;
    }),
    updateBackup: vi.fn(async (id: string, updates: any) => {
      const backup = backups.find((b) => b.id === id);
      if (!backup) return null;
      if (updates.label !== undefined) backup.label = updates.label || undefined;
      if (updates.protected !== undefined) backup.protected = !!updates.protected;
      const { data: _data, ...entry } = backup;
      return entry;
    }),
    getRecentBackupByType: vi.fn(async (type: string, withinMs: number) => {
      const cutoff = Date.now() - withinMs;
      const recent = backups.find(
        (b) => b.type === type && new Date(b.createdAt).getTime() > cutoff
      );
      return recent ? { id: recent.id } : null;
    }),
    claimAutoBackupInterval: vi.fn(async (windowMs: number) => {
      const now = Date.now();
      if (lastAutoBackupAt > 0 && now - lastAutoBackupAt < windowMs) {
        return false;
      }
      lastAutoBackupAt = now;
      return true;
    }),
    releaseAutoBackupClaim: vi.fn(async () => {
      lastAutoBackupAt = 0;
    }),
    purgeOldBackups: vi.fn(async (types: string[], maxCount: number) => {
      const matching = backups
        .filter((b) => types.includes(b.type) && !b.protected)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const excess = Math.max(0, matching.length - maxCount);
      const toRemove = matching.slice(0, excess);
      for (const item of toRemove) {
        const idx = backups.findIndex((b) => b.id === item.id);
        if (idx !== -1) backups.splice(idx, 1);
      }
      return excess;
    }),
    // Reset store between tests
    _reset: () => { backups = []; lastAutoBackupAt = 0; }
  };
};

const createMockDataStore = (backupStore: ReturnType<typeof createInMemoryBackupStore>) => ({
  loadPersistedData: vi.fn().mockResolvedValue(mockPersistedData),
  savePersistedData: vi.fn().mockResolvedValue(mockPersistedData),
  ...backupStore
});

const createMockLogService = () => ({
  addServerLog: vi.fn()
});

describe('Backup Service', () => {
  let backupStore: ReturnType<typeof createInMemoryBackupStore>;
  let dataStore: ReturnType<typeof createMockDataStore>;
  let logService: ReturnType<typeof createMockLogService>;

  beforeEach(async () => {
    process.env.BACKUP_ENABLED = 'true';
    process.env.BACKUP_INTERVAL_HOURS = '24';
    process.env.BACKUP_MAX_COUNT = '3';
    process.env.BACKUP_ON_STARTUP = 'true';

    vi.resetModules();
    const mod = await import('../server/services/backupService');
    createBackupService = mod.createBackupService;

    backupStore = createInMemoryBackupStore();
    dataStore = createMockDataStore(backupStore);
    logService = createMockLogService();
  });

  afterEach(() => {
    delete process.env.BACKUP_ENABLED;
    delete process.env.BACKUP_INTERVAL_HOURS;
    delete process.env.BACKUP_MAX_COUNT;
    delete process.env.BACKUP_ON_STARTUP;
    delete process.env.RESTORE_MAX_DECOMPRESSED_MB;
  });

  describe('createBackup', () => {
    it('should create a backup entry stored via dataStore', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('manual', 'Test checkpoint');

      expect(entry).not.toBeNull();
      expect(entry!.type).toBe('manual');
      expect(entry!.label).toBe('Test checkpoint');
      expect(entry!.teamCount).toBe(2);
      expect(entry!.sizeBytes).toBeGreaterThan(0);
      expect(entry!.protected).toBe(false);
      expect(entry!.id).toMatch(/^backup_\d+_[a-f0-9]+$/);

      // Verify data was saved to dataStore
      expect(dataStore.saveBackup).toHaveBeenCalledOnce();
      const [savedEntry, savedData] = dataStore.saveBackup.mock.calls[0];
      expect(savedEntry.id).toBe(entry!.id);

      // Verify the compressed data is valid
      const decompressed = JSON.parse(gunzipSync(savedData).toString('utf8'));
      expect(decompressed.teams).toHaveLength(2);
      expect(decompressed.teams[0].name).toBe('Alpha');
    });

    it('should add entry to listing', async () => {
      const service = createBackupService({ dataStore, logService });
      await service.createBackup('auto', 'First');
      await service.createBackup('manual', 'Second');

      const backups = await service.listBackups();
      expect(backups).toHaveLength(2);
      const labels = backups.map((b: any) => b.label);
      expect(labels).toContain('First');
      expect(labels).toContain('Second');
    });

    it('should return null if dataStore.loadPersistedData fails', async () => {
      dataStore.loadPersistedData.mockRejectedValueOnce(new Error('DB error'));
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('auto');
      expect(entry).toBeNull();
    });

    it('should create a protected backup when the protected option is set', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('auto', 'Pre-restore snapshot', { protected: true });

      expect(entry).not.toBeNull();
      expect(entry!.protected).toBe(true);
      const [savedEntry] = dataStore.saveBackup.mock.calls[0];
      expect(savedEntry.protected).toBe(true);
    });

    it('should default protected to false when no option is given', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('auto', 'plain');
      expect(entry!.protected).toBe(false);
    });
  });

  describe('listBackups', () => {
    it('should return empty array when no backups exist', async () => {
      const service = createBackupService({ dataStore, logService });
      expect(await service.listBackups()).toEqual([]);
    });

    it('should return backups sorted by date descending', async () => {
      const service = createBackupService({ dataStore, logService });
      await service.createBackup('auto', 'First');
      await service.createBackup('auto', 'Second');
      await service.createBackup('manual', 'Third');

      const backups = await service.listBackups();
      expect(backups).toHaveLength(3);
      // Most recent first
      for (let i = 0; i < backups.length - 1; i++) {
        expect(new Date(backups[i].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(backups[i + 1].createdAt).getTime()
        );
      }
    });
  });

  describe('getBackupConfig', () => {
    it('should return current configuration', () => {
      const service = createBackupService({ dataStore, logService });
      const config = service.getBackupConfig();
      expect(config.enabled).toBe(true);
      expect(config.intervalHours).toBe(24);
      expect(config.maxCount).toBe(3);
      expect(config.onStartup).toBe(true);
    });
  });

  describe('getBackupData', () => {
    it('should return data for existing backup', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('manual');

      const result = await service.getBackupData(entry!.id);
      expect(result).not.toBeNull();
      expect(result!.filename).toBe(entry!.filename);
      expect(result!.data).toBeInstanceOf(Buffer);
    });

    it('should return null for non-existent backup', async () => {
      const service = createBackupService({ dataStore, logService });
      expect(await service.getBackupData('non-existent')).toBeNull();
    });
  });

  describe('deleteBackup', () => {
    it('should delete backup from dataStore', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('manual');

      const result = await service.deleteBackup(entry!.id);
      expect(result).toBe(true);
      expect(await service.listBackups()).toHaveLength(0);
    });

    it('should return false for non-existent backup', async () => {
      const service = createBackupService({ dataStore, logService });
      expect(await service.deleteBackup('non-existent')).toBe(false);
    });
  });

  describe('restoreFromBackup', () => {
    it('should decompress and call savePersistedData', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('manual');

      const restored = await service.restoreFromBackup(entry!.id);
      expect(restored).not.toBeNull();
      expect(dataStore.savePersistedData).toHaveBeenCalledWith(
        expect.objectContaining({ teams: expect.any(Array) }),
        { mode: 'replace' }
      );
    });

    it('should throw for non-existent backup', async () => {
      const service = createBackupService({ dataStore, logService });
      await expect(service.restoreFromBackup('non-existent')).rejects.toThrow('Backup not found');
    });

    it('should reject stored backups that exceed the decompressed-size cap', async () => {
      process.env.RESTORE_MAX_DECOMPRESSED_MB = '0.00001';
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('manual');

      await expect(service.restoreFromBackup(entry!.id)).rejects.toMatchObject({
        code: 'RESTORE_ARCHIVE_TOO_LARGE'
      });
      expect(dataStore.savePersistedData).not.toHaveBeenCalled();
    });
  });

  describe('updateBackup', () => {
    it('should update label', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('auto');

      const updated = await service.updateBackup(entry!.id, { label: 'New label' });
      expect(updated!.label).toBe('New label');

      const backups = await service.listBackups();
      expect(backups[0].label).toBe('New label');
    });

    it('should update protected status', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createBackup('auto');

      const updated = await service.updateBackup(entry!.id, { protected: true });
      expect(updated!.protected).toBe(true);
    });

    it('should return null for non-existent backup', async () => {
      const service = createBackupService({ dataStore, logService });
      expect(await service.updateBackup('non-existent', { label: 'test' })).toBeNull();
    });
  });

  describe('retention', () => {
    it('should delete oldest auto backups when exceeding max count', async () => {
      const service = createBackupService({ dataStore, logService });

      // Create 4 auto backups (max is 3)
      await service.createBackup('auto', 'auto-1');
      await service.createBackup('auto', 'auto-2');
      await service.createBackup('auto', 'auto-3');
      await service.createBackup('auto', 'auto-4');

      const backups = await service.listBackups();
      const autoBackups = backups.filter((b: any) => b.type === 'auto');
      expect(autoBackups.length).toBeLessThanOrEqual(3);
    });

    it('should not delete protected backups', async () => {
      const service = createBackupService({ dataStore, logService });

      const first = await service.createBackup('auto', 'protected-one');
      await service.updateBackup(first!.id, { protected: true });

      await service.createBackup('auto', 'auto-2');
      await service.createBackup('auto', 'auto-3');
      await service.createBackup('auto', 'auto-4');

      const backups = await service.listBackups();
      const protectedBackup = backups.find((b: any) => b.id === first!.id);
      expect(protectedBackup).toBeDefined();
    });

    it('should not count manual backups toward retention limit', async () => {
      const service = createBackupService({ dataStore, logService });

      await service.createBackup('manual', 'checkpoint-1');
      await service.createBackup('manual', 'checkpoint-2');
      await service.createBackup('auto', 'auto-1');
      await service.createBackup('auto', 'auto-2');
      await service.createBackup('auto', 'auto-3');

      const backups = await service.listBackups();
      const manualBackups = backups.filter((b: any) => b.type === 'manual');
      expect(manualBackups).toHaveLength(2);
    });
  });

  describe('createStartupBackup', () => {
    it('should create a startup backup', async () => {
      const service = createBackupService({ dataStore, logService });
      const entry = await service.createStartupBackup();

      expect(entry).not.toBeNull();
      expect(entry!.type).toBe('startup');
      expect(entry!.label).toBe('Server startup');
    });

    it('should deduplicate startup backups within 5 minutes', async () => {
      const service = createBackupService({ dataStore, logService });

      const first = await service.createStartupBackup();
      expect(first).not.toBeNull();

      const second = await service.createStartupBackup();
      expect(second).toBeNull();

      const backups = await service.listBackups();
      expect(backups.filter((b: any) => b.type === 'startup')).toHaveLength(1);
    });

    it('should not create backup when BACKUP_ENABLED is false', async () => {
      process.env.BACKUP_ENABLED = 'false';
      vi.resetModules();
      const mod = await import('../server/services/backupService');
      const service = mod.createBackupService({ dataStore, logService });

      const entry = await service.createStartupBackup();
      expect(entry).toBeNull();
    });

    it('should not create backup when BACKUP_ON_STARTUP is false', async () => {
      process.env.BACKUP_ON_STARTUP = 'false';
      vi.resetModules();
      const mod = await import('../server/services/backupService');
      const service = mod.createBackupService({ dataStore, logService });

      const entry = await service.createStartupBackup();
      expect(entry).toBeNull();
    });
  });

  describe('scheduler', () => {
    it('should not start when BACKUP_ENABLED is false', async () => {
      process.env.BACKUP_ENABLED = 'false';
      vi.resetModules();
      const mod = await import('../server/services/backupService');
      const service = mod.createBackupService({ dataStore, logService });

      // Should not throw
      service.startScheduler();
      service.stopScheduler();
    });

    it('should start and stop without error', () => {
      const service = createBackupService({ dataStore, logService });
      service.startScheduler();
      service.stopScheduler();
    });
  });

  describe('scheduler election (multi-pod)', () => {
    it('creates only one auto backup when two service instances share a store in one interval', async () => {
      // Simulate two pods running against the same backup store, each firing its
      // own scheduled tick. Only one should persist an auto backup; the other
      // must defer (multi-pod stampede prevention).
      const podA = createBackupService({ dataStore, logService });
      const podB = createBackupService({ dataStore, logService });

      const a = await podA.runScheduledBackup();
      const b = await podB.runScheduledBackup();

      const created = [a, b].filter((entry) => entry !== null);
      expect(created).toHaveLength(1);

      const autos = (await podA.listBackups()).filter((x: any) => x.type === 'auto');
      expect(autos).toHaveLength(1);
    });

    it('skips a scheduled auto backup when a recent auto backup already exists', async () => {
      const service = createBackupService({ dataStore, logService });

      const first = await service.runScheduledBackup();
      expect(first).not.toBeNull();
      expect(first!.type).toBe('auto');

      const second = await service.runScheduledBackup();
      expect(second).toBeNull();

      const autos = (await service.listBackups()).filter((b: any) => b.type === 'auto');
      expect(autos).toHaveLength(1);
    });

    it('creates a new auto backup once the election window has elapsed', async () => {
      // Interval is 24h (from beforeEach), so the election window is ~21.6h.
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const service = createBackupService({ dataStore, logService });

        const first = await service.runScheduledBackup();
        expect(first).not.toBeNull();

        // +10h: still inside the election window, so this tick defers.
        vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
        expect(await service.runScheduledBackup()).toBeNull();

        // +22h: past the window, so a fresh interval backup is due again.
        vi.setSystemTime(new Date('2026-01-01T22:00:00.000Z'));
        const third = await service.runScheduledBackup();
        expect(third).not.toBeNull();

        const autos = (await service.listBackups()).filter((b: any) => b.type === 'auto');
        expect(autos).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not create a scheduled backup when BACKUP_ENABLED is false', async () => {
      process.env.BACKUP_ENABLED = 'false';
      vi.resetModules();
      const mod = await import('../server/services/backupService');
      const service = mod.createBackupService({ dataStore, logService });

      expect(await service.runScheduledBackup()).toBeNull();
      expect(await service.listBackups()).toHaveLength(0);
    });

    it('skips the tick (no create, no unhandled rejection) when the election claim throws', async () => {
      // If the atomic claim itself fails (store unavailable), the tick must skip
      // rather than fall through to createBackup — falling through would let
      // every pod back up at once. A createBackup would fail anyway (same store).
      const service = createBackupService({ dataStore, logService });
      backupStore.claimAutoBackupInterval.mockRejectedValueOnce(new Error('DB blip'));

      const entry = await service.runScheduledBackup();
      expect(entry).toBeNull();
      expect(dataStore.loadPersistedData).not.toHaveBeenCalled();
      expect(await service.listBackups()).toHaveLength(0);
    });

    it('does not let a pre-restore snapshot suppress the next scheduled backup', async () => {
      // Regression: a super-admin restore first writes a protected auto backup
      // ("Pre-restore snapshot"). That backup must NOT count as the interval's
      // election winner — the election is a dedicated marker, not an existence
      // check on the backups table — so the next scheduled tick still runs.
      const service = createBackupService({ dataStore, logService });

      const snapshot = await service.createBackup('auto', 'Pre-restore snapshot', { protected: true });
      expect(snapshot).not.toBeNull();
      // createBackup does not touch the election marker.
      expect(backupStore.claimAutoBackupInterval).not.toHaveBeenCalled();

      const scheduled = await service.runScheduledBackup();
      expect(scheduled).not.toBeNull();
      expect(scheduled!.type).toBe('auto');

      const autos = (await service.listBackups()).filter((b: any) => b.type === 'auto');
      expect(autos).toHaveLength(2);
    });

    it('releases the interval claim when the backup fails so the next tick can retry', async () => {
      const service = createBackupService({ dataStore, logService });
      // Make the first createBackup fail (returns null) after the claim succeeds.
      dataStore.loadPersistedData.mockRejectedValueOnce(new Error('DB blip'));

      const first = await service.runScheduledBackup();
      expect(first).toBeNull();
      expect(backupStore.releaseAutoBackupClaim).toHaveBeenCalledTimes(1);

      // The claim was released, so an immediate retry re-elects and succeeds
      // instead of the store waiting a whole window with no scheduled backup.
      const second = await service.runScheduledBackup();
      expect(second).not.toBeNull();
      expect(second!.type).toBe('auto');
    });
  });
});
