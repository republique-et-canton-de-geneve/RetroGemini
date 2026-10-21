import express from 'express';
import { labelFromHeader } from '../services/backupLabel.js';
import { createRestoreGate } from '../services/restoreGate.js';
import { SECURITY_ACTIONS } from '../services/securityEvents.js';
import { createSuperAdminHeaderAuth } from './superAdminHeaderAuth.js';
import { createArchiveBodyErrorHandler } from './archiveBodyErrors.js';

/**
 * Importing a backup file (DESIGN: AGENTS.md → *Restoring one team* → *A file
 * is restored by importing it first*). The uploaded file becomes one row of the
 * shared `backups` table, of type `imported`, and every backup route then reads
 * it unchanged: the list, the team-restore dialog, the whole-store restore, the
 * download and the delete. That INSERT is the only write — no team, KV or
 * session row — so the import takes neither the restore gate, the pre-restore
 * snapshot nor the checkpoint's `backupInProgress` flag. Restoring *from* the
 * row goes through all of them.
 *
 * Nothing is kept between requests: the row is committed before the answer, so
 * the calls that follow can land on any pod.
 *
 * Registered from inside `registerSuperAdminRoutes`, so the route inventory test
 * that posts a forged credential to every super-admin route covers it, and so
 * does the `server.js` wiring check for `securityEvents`.
 */

export const IMPORT_IN_PROGRESS_ERROR = 'import_in_progress';

/**
 * One import at a time on this pod, entered **before** the body is read.
 *
 * Two imports buffered and parsed at once do not fit a 384 Mi pod serving live
 * sessions, and the realistic way to get two is a retry: behind the OpenShift
 * Route a 504 comes back at 30 s while the server is still gunzipping, parsing
 * or inserting, and the admin clicks again. Entered before `express.raw`, a
 * refused second upload is never buffered.
 *
 * The gate is held until the work is over, **not until the client leaves**:
 * `res` emits `'close'` when the client disconnects — that 504 included — while
 * the async handler is still running. So each entry gets one `release` (a
 * per-request flag: the gate is a single boolean, and a late event of one
 * request must never free a hold another request now has), called exactly once
 * by whichever settles the request: the handler's `finally`, the body-error
 * handler, or `'close'` — the last only when the handler never started (a
 * client that aborted mid-upload), since nothing else would release it then.
 *
 * Per pod, like the restore gate: two imports on two pods both succeed and
 * leave two rows, visible and deletable. It bounds import against import only;
 * an import beside a restore on the same pod is the documented memory ceiling
 * (k8s/README.md → *Automated backups*).
 */
export const createImportGateMiddleware = (importGate) => (req, res, next) => {
  if (!importGate.tryEnter()) return res.status(409).json({ error: IMPORT_IN_PROGRESS_ERROR });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    importGate.leave();
  };
  const hold = { release, handlerStarted: false };
  res.locals.importGate = hold;
  res.once('close', () => {
    if (!hold.handlerStarted) release();
  });
  return next();
};

export const registerSuperAdminBackupImportRoutes = ({
  app,
  tokenService,
  backupService,
  securityEvents,
  maxBodyBytes,
  maxDecompressedBytes,
  // Shared with the other backup actions: the same 60 per 15 minutes.
  limiter
}) => {
  const requireHeaderAuth = createSuperAdminHeaderAuth(tokenService);
  const enterImportGate = createImportGateMiddleware(createRestoreGate());

  app.post(
    '/api/super-admin/backups/import',
    limiter,
    // The order of these three is load-bearing: the credential before one byte
    // of the body is read, the gate before the body is buffered.
    requireHeaderAuth,
    enterImportGate,
    // `application/json` is deliberately absent (audit H30): the global
    // `express.json({ limit: '1mb' })` would claim it first. The console sends
    // `application/octet-stream`, which takes a gzip file and a plain JSON
    // file alike (the parser sniffs the gzip magic).
    express.raw({
      type: ['application/gzip', 'application/x-gzip', 'application/octet-stream'],
      limit: maxBodyBytes
    }),
    async (req, res) => {
      const gate = res.locals.importGate;
      // From here the `finally` below owns the release.
      gate.handlerStarted = true;
      try {
        if (!(req.body instanceof Buffer) || req.body.length === 0) {
          return res.status(400).json({ error: 'missing_archive' });
        }
        const label = labelFromHeader(req.header('x-backup-label'));
        const { entry, sha256, compressed } = await backupService.importBackup(req.body, { label, maxDecompressedBytes });
        // After the INSERT, and never allowed to fail it: the row is there.
        try {
          await securityEvents.record(req, {
            action: SECURITY_ACTIONS.BACKUP_IMPORT,
            actor: 'super-admin',
            outcome: 'success',
            target: entry.id,
            detail: {
              teamCount: entry.teamCount,
              sizeBytes: entry.sizeBytes,
              uploadedBytes: req.body.length,
              compressed,
              sha256,
              label
            }
          });
        } catch (err) {
          console.warn('[Server] The backup import could not be recorded in the audit trail', err);
        }
        return res.json({ success: true, backup: entry });
      } catch (err) {
        if (err?.code === 'RESTORE_ARCHIVE_TOO_LARGE') {
          return res.status(413).json({ error: 'restore_archive_too_large', maxBytes: maxDecompressedBytes });
        }
        if (err?.code === 'INVALID_RESTORE_ARCHIVE') return res.status(400).json({ error: 'invalid_backup_format' });
        if (err?.code === 'INVALID_BACKUP_DATA') return res.status(400).json({ error: 'invalid_backup_data', ...err.details });
        console.error('[Server] Failed to import a backup file', err);
        return res.status(500).json({ error: 'import_failed' });
      } finally {
        gate.release();
      }
    },
    createArchiveBodyErrorHandler({
      maxBytes: maxBodyBytes,
      failedError: 'import_failed',
      logMessage: '[Server] Failed to import a backup file',
      beforeAnswer: (_req, res) => res.locals.importGate?.release()
    })
  );
};
