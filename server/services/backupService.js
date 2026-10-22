import { gzip } from 'zlib';
import { createHash, randomBytes } from 'crypto';
import { promisify } from 'util';
import {
  InvalidRestoreArchiveError,
  getRestoreMaxDecompressedBytes,
  hasGzipMagic,
  parseRestoreArchiveBody
} from './restoreArchive.js';
import { ArchiveShapeError, archiveShapeProblem } from './archiveShape.js';
import { buildBackupArchive } from './backupArchive.js';

// Async: an import runs on a pod serving live sessions, and a synchronous gzip
// of a large file would stall every socket on it meanwhile.
const gzipAsync = promisify(gzip);

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

  // The whole-store archive, team by team through gzip (backupArchive.js):
  // what every stored backup and snapshot holds, and what the download sends.
  const buildArchive = () => buildBackupArchive({ dataStore });

  // `{ entry, reason }`: the stored backup, or `null` with why — 'in_progress'
  // (another backup of this pod is running) or 'failed' (the store could not
  // be read whole, or the write failed). A store that cannot be read whole is
  // a failed backup, never an archive missing teams: the reads are strict
  // (dataStore → iterateArchiveTeams / readArchiveMeta), and since retention
  // runs only after a stored backup, a failed automatic backup keeps every
  // good one.
  const createBackupOutcome = async (type, label, { protected: isProtected = false } = {}) => {
    if (backupInProgress) {
      return { entry: null, reason: 'in_progress' };
    }

    backupInProgress = true;

    try {
      // Compact JSON (no pretty-print indentation): the archive is gzipped for
      // storage and JSON.parse'd on restore, so indentation is pure overhead
      // (~30% larger uncompressed payload and extra CPU) with no consumer.
      const { data: compressed, teamCount, unrestorable } = await buildArchive();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `retrogemini-backup-${timestamp}.json.gz`;

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
      if (unrestorable.length > 0) {
        // Archived anyway (backupArchive.js says why); a whole-store restore
        // of this backup will refuse it until those records are repaired.
        console.warn(
          `[Backup] ${filename}: ${unrestorable.length} team record(s) cannot be restored by a whole-store restore `
          + `(no id or name, or an id another record holds): ${unrestorable.join(', ')}; `
          + 'single-team restores of the other teams still work'
        );
      }

      if (type === 'auto' || type === 'startup') {
        await enforceRetention();
      }

      return { entry, reason: null };
    } catch (err) {
      // The message names the unreadable key (`Team record "team:…" cannot be
      // archived (unparsable)`), never its content. It is written into the
      // line itself because the console's Logs tab serialises an Error
      // without its message, and this line is what the runbook says to look
      // for (k8s/README.md → A backup that cannot read a team fails).
      console.error(`[Backup] Failed to create backup: ${err?.message ?? String(err)}`, err);
      return { entry: null, reason: 'failed' };
    } finally {
      backupInProgress = false;
    }
  };

  // The entry or null, for the callers that only need to know whether a
  // recovery point exists (the snapshots, the scheduler, the startup backup).
  const createBackup = async (...args) => (await createBackupOutcome(...args)).entry;

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

  // A stored backup, decompressed and parsed under the same limits as a
  // restore. `null` when there is no such backup. Read by the single-team
  // restore, which needs the archive's content but must not apply it whole.
  const readBackupArchive = async (backupId) => {
    const result = await dataStore.getBackupData(backupId);
    if (!result) return null;
    const data = await parseRestoreArchiveBody(
      result.data,
      'application/gzip',
      getRestoreMaxDecompressedBytes()
    );
    return { filename: result.filename, data };
  };

  // `archive` is the stored backup already read (and checked) by the caller:
  // the whole-store restore route reads it after its snapshot to validate it,
  // and passes it here rather than parse the archive a second time. Without
  // it, the backup is read here as before.
  const restoreFromBackup = async (backupId, { archive: alreadyRead = null } = {}) => {
    const archive = alreadyRead ?? await readBackupArchive(backupId);
    if (!archive) {
      throw new Error('Backup not found');
    }

    // Faithful replace: the store must end up matching the archive exactly
    // (ghost teams removed, live session state cleared), not merely merged with
    // it. The route layer clears the session caches after this resolves.
    await dataStore.savePersistedData(archive.data, { mode: 'replace' });
    console.info(`[Backup] Restored from backup: ${archive.filename}`);
    return { id: backupId, filename: archive.filename };
  };

  // Parses and checks an uploaded file, and keeps only its team count: the
  // parsed copy goes out of scope here, before the gzip and the INSERT, so the
  // import's peak is the upload, its unpacked bytes and the parsed object —
  // never all of them plus a compressed copy.
  const countImportableTeams = async (body, maxDecompressedBytes) => {
    let data;
    try {
      data = await parseRestoreArchiveBody(body, 'application/octet-stream', maxDecompressedBytes);
    } catch (err) {
      if (err?.code === 'RESTORE_ARCHIVE_TOO_LARGE') throw err;
      // zlib's own errors included (a truncated or corrupt gzip): the import
      // has exactly two typed parse errors.
      throw new InvalidRestoreArchiveError();
    }
    const problem = archiveShapeProblem(data);
    if (problem) throw new ArchiveShapeError(problem.reason, problem);
    return data.teams.length;
  };

  /**
   * A backup file the super admin uploaded, stored as a backup row so every
   * backup route can read it (`/api/super-admin/backups/import`). Writes one
   * `backups` row and nothing else: no team, KV or session row, no retention
   * (an `imported` row is never purged), and not the `backupInProgress` flag a
   * checkpoint holds — an import never reads the store.
   *
   * The stored bytes are the uploaded file itself when it is gzip, else the
   * gzip of the uploaded bytes: no re-serialisation, so a download returns the
   * very file that was imported, the audit row's SHA-256 identifies it, and the
   * parser that accepted it here is the one that reads the row back.
   *
   * Throws `RestoreArchiveTooLargeError` (code RESTORE_ARCHIVE_TOO_LARGE),
   * `InvalidRestoreArchiveError` (INVALID_RESTORE_ARCHIVE — a corrupt or
   * truncated gzip included: zlib's own errors never escape untyped) or
   * `ArchiveShapeError` (INVALID_BACKUP_DATA, with `details`), and never writes
   * when it throws.
   *
   * @param {Buffer} body the uploaded bytes
   * @param {{ label?: string | null, maxDecompressedBytes?: number }} [options]
   * @returns {Promise<{
   *   entry: { id: string, filename: string, type: string, label?: string, createdAt: string, sizeBytes: number, teamCount: number, protected: boolean },
   *   sha256: string,
   *   compressed: boolean
   * }>}
   */
  const importBackup = async (body, { label = null, maxDecompressedBytes = getRestoreMaxDecompressedBytes() } = {}) => {
    const teamCount = await countImportableTeams(body, maxDecompressedBytes);
    const compressed = hasGzipMagic(body);
    const stored = compressed ? body : await gzipAsync(body);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const entry = {
      id: generateId(),
      // Built here, never from the request: it goes into Content-Disposition.
      filename: `retrogemini-import-${timestamp}.json.gz`,
      type: 'imported',
      label: label || undefined,
      // The import time: the list sorts by created_at, newest first.
      createdAt: new Date().toISOString(),
      sizeBytes: stored.length,
      teamCount,
      protected: false
    };
    const sha256 = createHash('sha256').update(body).digest('hex');
    await dataStore.saveBackup(entry, stored);
    console.info(`[Backup] Imported backup ${entry.filename} (${teamCount} team(s), ${(stored.length / 1024).toFixed(1)} KB)`);
    return { entry, sha256, compressed };
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
    // Don't let the backup timer keep the event loop alive on its own: in
    // production the HTTP server holds the process up, and tests/tools that
    // import the service can then exit cleanly instead of hanging on the timer.
    schedulerInterval.unref?.();

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

    let claimed;
    try {
      claimed = await dataStore.claimAutoBackupInterval(AUTO_ELECTION_WINDOW_MS);
    } catch (err) {
      // The election claim is atomic against the shared store. If the store is
      // unavailable we cannot elect a single winner, so we must NOT fall through
      // to createBackup — doing so would let every pod back up at once,
      // reintroducing the stampede exactly when the store is already struggling.
      // A createBackup here would fail anyway (it needs the same store). Skip
      // this tick and let the next one retry.
      console.error('[Backup] Scheduler election claim failed, skipping this tick', err);
      return null;
    }

    if (!claimed) {
      console.info('[Backup] Auto backup already claimed for this interval by another pod, skipping');
      return null;
    }

    let entry = null;
    try {
      entry = await createBackup('auto');
    } finally {
      if (!entry) {
        // The claim advanced the election marker, but the backup did not persist
        // (a store error, or an overlapping in-process backup). Release the claim
        // so the next tick can re-elect instead of the store going a whole
        // election window with no scheduled backup. Best-effort: if the release
        // itself fails, the interval is simply skipped until the window elapses.
        await dataStore.releaseAutoBackupClaim().catch(() => {});
      }
    }
    return entry;
  };

  return {
    buildArchive,
    createBackup,
    createBackupOutcome,
    listBackups,
    getBackupConfig,
    getBackupData,
    deleteBackup,
    readBackupArchive,
    restoreFromBackup,
    importBackup,
    updateBackup,
    startScheduler,
    stopScheduler,
    createStartupBackup,
    runScheduledBackup
  };
};

export { createBackupService };
