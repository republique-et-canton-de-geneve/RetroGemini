import { gzipSync } from 'zlib';
import { randomBytes } from 'crypto';
import { getRestoreMaxDecompressedBytes, parseRestoreArchiveBody } from './restoreArchive.js';

const createBackupService = ({ dataStore, logService }) => {
  const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';
  const BACKUP_INTERVAL_HOURS = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS) || 24);
  const BACKUP_MAX_COUNT = Math.max(1, Number(process.env.BACKUP_MAX_COUNT) || 7);
  const BACKUP_ON_STARTUP = process.env.BACKUP_ON_STARTUP !== 'false';

  const STARTUP_DEDUP_MS = 5 * 60 * 1000; // 5 minutes

  let schedulerInterval = null;
  let backupInProgress = false;

  // ---------------------------------------------------------------------------
  // Core backup operations
  // ---------------------------------------------------------------------------

  const generateId = () => {
    return `backup_${Date.now()}_${randomBytes(4).toString('hex')}`;
  };

  const createBackup = async (type, label) => {
    if (backupInProgress) {
      return null;
    }

    backupInProgress = true;

    try {
      const currentData = await dataStore.loadPersistedData();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `retrogemini-backup-${timestamp}.json.gz`;

      const jsonData = JSON.stringify(currentData, null, 2);
      const compressed = gzipSync(Buffer.from(jsonData, 'utf8'));

      const teamCount = currentData.teams?.length || 0;
      const entry = {
        id: generateId(),
        filename,
        type,
        label: label || undefined,
        createdAt: new Date().toISOString(),
        sizeBytes: compressed.length,
        teamCount,
        protected: false
      };

      await dataStore.saveBackup(entry, compressed);

      console.info(`[Backup] Created ${type} backup: ${filename} (${teamCount} team(s), ${(compressed.length / 1024).toFixed(1)} KB)`);

      if (type === 'auto' || type === 'startup') {
        await enforceRetention();
      }

      return entry;
    } catch (err) {
      console.error('[Backup] Failed to create backup', err);
      return null;
    } finally {
      backupInProgress = false;
    }
  };

  const enforceRetention = async () => {
    try {
      const removed = await dataStore.purgeOldBackups(['auto', 'startup'], BACKUP_MAX_COUNT);
      if (removed > 0) {
        console.info(`[Backup] Retention: removed ${removed} old backup(s)`);
      }
    } catch (err) {
      console.error('[Backup] Retention cleanup failed', err);
    }
  };

  const listBackups = async () => {
    return await dataStore.listBackups();
  };

  const getBackupConfig = () => ({
    enabled: BACKUP_ENABLED,
    intervalHours: BACKUP_INTERVAL_HOURS,
    maxCount: BACKUP_MAX_COUNT,
    onStartup: BACKUP_ON_STARTUP
  });

  const getBackupData = async (backupId) => {
    return await dataStore.getBackupData(backupId);
  };

  const deleteBackup = async (backupId) => {
    const deleted = await dataStore.deleteBackup(backupId);
    if (deleted) {
      console.info(`[Backup] Deleted backup: ${backupId}`);
    }
    return deleted;
  };

  const restoreFromBackup = async (backupId) => {
    const result = await dataStore.getBackupData(backupId);
    if (!result) {
      throw new Error('Backup not found');
    }

    const data = await parseRestoreArchiveBody(
      result.data,
      'application/gzip',
      getRestoreMaxDecompressedBytes()
    );

    await dataStore.savePersistedData(data);
    console.info(`[Backup] Restored from backup: ${result.filename}`);
    return { id: backupId, filename: result.filename };
  };

  const updateBackup = async (backupId, updates) => {
    return await dataStore.updateBackup(backupId, updates);
  };

  // ---------------------------------------------------------------------------
  // Scheduler
  // ---------------------------------------------------------------------------

  const startScheduler = () => {
    if (!BACKUP_ENABLED) {
      console.info('[Backup] Automatic backups disabled (BACKUP_ENABLED=false)');
      return;
    }

    const intervalMs = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
    schedulerInterval = setInterval(async () => {
      await createBackup('auto');
    }, intervalMs);

    console.info(`[Backup] Scheduler started: every ${BACKUP_INTERVAL_HOURS}h, max ${BACKUP_MAX_COUNT} backups`);
  };

  const stopScheduler = () => {
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Startup backup (deduplicated)
  // ---------------------------------------------------------------------------

  const createStartupBackup = async () => {
    if (!BACKUP_ENABLED || !BACKUP_ON_STARTUP) {
      return null;
    }

    // Deduplicate: skip if a startup backup was created within the last 5 minutes
    const recent = await dataStore.getRecentStartupBackup(STARTUP_DEDUP_MS);
    if (recent) {
      console.info('[Backup] Recent startup backup exists, skipping');
      return null;
    }

    return await createBackup('startup', 'Server startup');
  };

  return {
    createBackup,
    listBackups,
    getBackupConfig,
    getBackupData,
    deleteBackup,
    restoreFromBackup,
    updateBackup,
    startScheduler,
    stopScheduler,
    createStartupBackup
  };
};

export { createBackupService };
