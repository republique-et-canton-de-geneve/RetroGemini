import { gzipSync } from 'zlib';
import { randomBytes } from 'crypto';
import { getRestoreMaxDecompressedBytes, parseRestoreArchiveBody } from './restoreArchive.js';

const createBackupService = ({ dataStore, logService }) => {
  const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';
  const BACKUP_INTERVAL_HOURS = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS) || 24);
  const BACKUP_MAX_COUNT = Math.max(1, Number(process.env.BACKUP_MAX_COUNT) || 7);
  const BACKUP_ON_STARTUP = process.env.BACKUP_ON_STARTUP !== 'false';

  const STARTUP_DEDUP_MS = 5 * 60 * 1000; // 5 minutes
  const INTERVAL_MS = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;

  // Multi-pod scheduler election: every pod runs its own interval timer, so
  // without a guard a `replicas: N` deployment writes N `auto` backups per tick
  // (a "stampede") — the max-count retention window then only holds
  // BACKUP_MAX_COUNT / N real intervals of history. Before a scheduled `auto`
  // backup we skip if any `auto` backup already exists within this election
  // window; the first pod to fire in an interval wins and the rest defer. The
  // window is one interval minus a jitter so a backup that is a *full* interval
  // old (the previous tick) never suppresses the current tick's backup.
  const AUTO_ELECTION_JITTER_MS = Math.round(INTERVAL_MS * 0.1);
  const AUTO_ELECTION_WINDOW_MS = Math.max(0, INTERVAL_MS - AUTO_ELECTION_JITTER_MS);

  let schedulerInterval = null;
  let backupInProgress = false;

  // ---------------------------------------------------------------------------
  // Core backup operations
  // ---------------------------------------------------------------------------

  const generateId = () => {
    return `backup_${Date.now()}_${randomBytes(4).toString('hex')}`;
  };

  const createBackup = async (type, label, { protected: isProtected = false } = {}) => {
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
        protected: isProtected
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

    // Faithful replace: the store must end up matching the archive exactly
    // (ghost teams removed, live session state cleared), not merely merged with
    // it. The route layer clears the session caches after this resolves.
    await dataStore.savePersistedData(data, { mode: 'replace' });
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

    schedulerInterval = setInterval(() => {
      runScheduledBackup();
    }, INTERVAL_MS);

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
    const recent = await dataStore.getRecentBackupByType('startup', STARTUP_DEDUP_MS);
    if (recent) {
      console.info('[Backup] Recent startup backup exists, skipping');
      return null;
    }

    return await createBackup('startup', 'Server startup');
  };

  // Runs on each scheduler tick. Performs the cross-pod election described above
  // before delegating to createBackup, so only one pod persists an `auto` backup
  // per interval. Exposed on the service so the scheduled action is directly
  // unit-testable without relying on wall-clock timers.
  const runScheduledBackup = async () => {
    if (!BACKUP_ENABLED) {
      return null;
    }

    try {
      const recent = await dataStore.getRecentBackupByType('auto', AUTO_ELECTION_WINDOW_MS);
      if (recent) {
        console.info('[Backup] Recent auto backup exists (another pod won this interval), skipping');
        return null;
      }
    } catch (err) {
      // A transient store error during the election check must not become an
      // unhandled rejection on the scheduler tick. Fall through and let
      // createBackup run (it has its own try/catch and the in-process
      // backupInProgress guard); the worst case is one extra backup this tick,
      // which retention reclaims.
      console.error('[Backup] Scheduler election check failed, proceeding without it', err);
    }

    return await createBackup('auto');
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
    createStartupBackup,
    runScheduledBackup
  };
};

export { createBackupService };
