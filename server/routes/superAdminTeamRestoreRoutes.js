import rateLimit from 'express-rate-limit';
import { TEAM_NAME_MAX_LENGTH } from '../../utils/teamNamePolicy.js';
import { claimTeamNameKey, nameHeldByAnotherRecord, releaseTeamNameKey } from '../services/teamNameIndex.js';
import {
  findArchivedTeam,
  listRestorableTeams,
  planTeamRestore,
  restoredSessionEntry,
  sessionIdsOf,
  TeamRestoreError
} from '../services/teamRestore.js';
import { SECURITY_ACTIONS } from '../services/securityEvents.js';

/**
 * Restoring one team from a stored backup (DESIGN: AGENTS.md → *Restoring one
 * team*; the record it writes is decided by `server/services/teamRestore.js`).
 * Registered from inside `registerSuperAdminRoutes`, so the route inventory test
 * that posts a forged token to every super-admin route covers these too, and so
 * does the `server.js` wiring check for `securityEvents`.
 *
 * Every handler authenticates before reading the body.
 */

// An audit row's `detail` is cut at 1000 characters; a team name has no cap.
const AUDIT_NAME_MAX_LENGTH = 80;
const auditName = (name) => (typeof name === 'string' ? name.slice(0, AUDIT_NAME_MAX_LENGTH) : '');

// A row a socket write moved between our read and our write is read again; past
// this the restore reports the session as not updated rather than spin.
const SESSION_WRITE_ATTEMPTS = 3;

const revOf = (entry) => {
  const rev = Number(entry?._rev);
  return Number.isFinite(rev) ? rev : 0;
};

class SessionReadError extends Error {}

const registerSuperAdminTeamRestoreRoutes = ({
  app,
  io,
  dataStore,
  tokenService,
  sessionCache,
  backupService,
  securityEvents,
  // The whole-store restore's two follow-up passes, shared rather than copied:
  // a deleted team comes back with the archive's password record and addresses,
  // which may predate hashing or the email rule.
  afterRestore = async () => {},
  skipRateLimit = () => false
}) => {
  const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipRateLimit,
    skipSuccessfulRequests: true
  });
  const actionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipRateLimit
  });
  const unauthorized = (res) => res.status(401).json({ error: 'unauthorized' });

  const readArchive = async (backupId) => {
    if (typeof backupId !== 'string' || !backupId) return { status: 400, error: 'missing_backup_id' };
    const archive = await backupService.readBackupArchive(backupId);
    if (!archive) return { status: 404, error: 'backup_not_found' };
    return { archive: archive.data };
  };

  /**
   * The live `session:{id}` rows of an archived team's retros and health checks,
   * by revision. A row bound to another team is not this team's to overwrite.
   * A row that cannot be *read* is not "no row": its revision decides which
   * writes the restore must outrank, so the restore stops instead.
   */
  const readSessionRevs = async (teamId, archived) => {
    const revs = new Map();
    for (const sessionId of sessionIdsOf(archived)) {
      let row;
      try {
        row = await dataStore.loadSessionState(sessionId, { strict: true });
      } catch (err) {
        throw new SessionReadError(String(err?.message || err));
      }
      if (row && row.teamId === teamId) revs.set(sessionId, revOf(row));
    }
    return revs;
  };

  /**
   * Puts each restored entry into its live session row and sends it to the room,
   * through the compare-and-swap every socket write goes through. Best-effort,
   * like the live rename: the record is restored by then, and a row left behind
   * is reported to the admin rather than failing a restore that happened.
   *
   * Unlike the whole-store restore, other pods are not told to drop their
   * session caches: every cache read goes through `newerState`, which keeps the
   * higher revision, and the restored row is above any copy a cache can hold.
   * The room itself spans pods through the adapter.
   */
  const updateLiveSessions = async (teamId, team, sessionRevs, targets) => {
    let updated = 0;
    const notUpdated = [];
    for (const sessionId of sessionRevs.keys()) {
      const entry = restoredSessionEntry(team, sessionId);
      if (!entry) continue;
      let done = false;
      try {
        for (let attempt = 0; attempt < SESSION_WRITE_ATTEMPTS && !done; attempt++) {
          const row = await dataStore.loadSessionState(sessionId, { strict: true });
          if (!row || row.teamId !== teamId) {
            done = true;
            break;
          }
          // Lands on the revision the record now holds, or one past the row if a
          // socket write got there first: either way at or above the record, so
          // the room's next persist is never refused by the record's rev guard.
          const base = Math.max((targets.get(sessionId) ?? 1) - 1, revOf(row));
          const result = await dataStore.saveSessionState(sessionId, { ...entry, _rev: base });
          if (result.success) {
            done = true;
            updated += 1;
            sessionCache.set(sessionId, result.data);
            io.to(sessionId).emit('session-update', result.data);
          }
        }
      } catch (err) {
        console.warn(`[Server] Team restore: session ${JSON.stringify(sessionId)} not ${done ? 'broadcast' : 'updated'}`, err);
      }
      if (!done) notUpdated.push(sessionId);
    }
    return { updated, notUpdated };
  };

  const resolveDeletedTeamName = (requested, archived) => {
    const raw = requested === undefined || requested === null ? archived.name : requested;
    if (typeof raw !== 'string' || !raw.trim()) return { error: 'team_name_empty' };
    const name = raw.trim();
    if (name.length > TEAM_NAME_MAX_LENGTH) return { error: 'team_name_too_long' };
    return { name };
  };

  app.post('/api/super-admin/backups/teams', readLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);
    try {
      const read = await readArchive(req.body?.backupId);
      if (read.error) return res.status(read.status).json({ error: read.error });
      const summaries = await dataStore.loadTeamSummaries();
      res.json({ teams: listRestorableTeams(read.archive, summaries) });
    } catch (err) {
      console.error('[Server] Failed to list the teams of a backup', err);
      res.status(500).json({ error: 'list_failed' });
    }
  });

  app.post('/api/super-admin/backups/restore-team', actionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);

    const { backupId, teamId, name: requestedName } = req.body || {};
    let claimedKey = null;
    try {
      if (typeof teamId !== 'string' || !teamId) return res.status(400).json({ error: 'missing_team_id' });
      const read = await readArchive(backupId);
      if (read.error) return res.status(read.status).json({ error: read.error });

      const archived = findArchivedTeam(read.archive, teamId);
      if (!archived) return res.status(404).json({ error: 'team_not_in_backup' });

      const current = await dataStore.loadTeam(teamId);
      let deletedName = null;
      if (!current) {
        // A team deleted since the backup comes back under its old name or one
        // the admin chose, claimed before anything else is written so a refusal
        // leaves nothing behind.
        const resolved = resolveDeletedTeamName(requestedName, archived);
        if (resolved.error) return res.status(400).json({ error: resolved.error });
        const nameKey = resolved.name.toLowerCase();
        if (await nameHeldByAnotherRecord(dataStore, teamId, nameKey)) {
          return res.status(409).json({ error: 'team_name_exists' });
        }
        const claim = await claimTeamNameKey(dataStore, teamId, nameKey);
        if (!claim.claimed) return res.status(409).json({ error: 'team_name_exists' });
        if (claim.added) claimedKey = nameKey;
        deletedName = resolved.name;
      }

      // Checked before the snapshot, so a malformed archive costs no backup.
      planTeamRestore({ archived, current, orphanedFeedbacks: [], sessionRevs: new Map(), name: deletedName });

      let sessionRevs;
      try {
        sessionRevs = await readSessionRevs(teamId, archived);
      } catch (err) {
        if (err instanceof SessionReadError) {
          if (claimedKey) await releaseTeamNameKey(dataStore, teamId, claimedKey);
          return res.status(503).json({ error: 'session_read_failed' });
        }
        throw err;
      }

      // Protected for the reason the whole-store restore's is: it may be the
      // only copy of what this restore replaces.
      const snapshot = await backupService.createBackup('auto', 'Pre-restore snapshot', { protected: true });
      if (!snapshot) {
        if (claimedKey) await releaseTeamNameKey(dataStore, teamId, claimedKey);
        return res.status(503).json({ error: 'pre_restore_snapshot_failed' });
      }

      const meta = await dataStore.loadMetaData();
      const orphanedFeedbacks = meta?.orphanedFeedbacks || [];
      let plan = null;
      if (current) {
        // On the record as it is at write time, inside the team compare-and-swap:
        // a write that lands meanwhile is retried against, never overwritten.
        const result = await dataStore.atomicTeamUpdate(teamId, (fresh) => {
          plan = planTeamRestore({ archived, current: fresh, orphanedFeedbacks, sessionRevs });
          return plan.team;
        });
        if (!result.success) {
          await backupService.deleteBackup(snapshot.id).catch(() => {});
          if (result.error === 'team_not_found') return res.status(409).json({ error: 'team_changed' });
          return res.status(500).json({ error: 'restore_failed' });
        }
      } else {
        plan = planTeamRestore({ archived, current: null, orphanedFeedbacks, sessionRevs, name: deletedName });
        // Revision 0 means "only while there is still no record": a team that
        // reappeared meanwhile is not overwritten.
        const saved = await dataStore.atomicTeamSave(teamId, plan.team, 0);
        if (!saved.success) {
          if (claimedKey) await releaseTeamNameKey(dataStore, teamId, claimedKey);
          await backupService.deleteBackup(snapshot.id).catch(() => {});
          return res.status(409).json({ error: 'team_changed' });
        }
      }
      claimedKey = null;

      // Orphans of this team are in the record now; take them off the shared
      // list so the board does not show them twice. After the record write, so a
      // failure here duplicates a feedback rather than loses one.
      let feedbacksStillOrphaned = false;
      if (plan.unorphanedFeedbackIds.length > 0) {
        const ids = new Set(plan.unorphanedFeedbackIds);
        try {
          await dataStore.atomicMetaUpdate((stored) => {
            const list = Array.isArray(stored.orphanedFeedbacks) ? stored.orphanedFeedbacks : [];
            const kept = list.filter((feedback) => !(feedback?.teamId === teamId && ids.has(feedback.id)));
            if (kept.length === list.length) return null;
            return { ...stored, orphanedFeedbacks: kept };
          });
        } catch (err) {
          feedbacksStillOrphaned = true;
          console.warn('[Server] Team restore: recovered feedbacks left in orphanedFeedbacks too', err);
        }
      }

      const sessions = await updateLiveSessions(teamId, plan.team, sessionRevs, plan.targets);
      await afterRestore();

      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.TEAM_RESTORE,
        actor: 'super-admin',
        outcome: 'success',
        target: teamId,
        detail: {
          backupId,
          name: auditName(plan.team.name),
          recreated: !current,
          preRestoreSnapshot: snapshot.id,
          sessionsUpdated: sessions.updated,
          sessionsNotUpdated: sessions.notUpdated.length,
          feedbacksRecovered: plan.counts.feedbacksRecovered
        }
      });
      console.info(`[Server] Restored team ${teamId} from backup ${backupId} (${current ? 'existing' : 'recreated'})`);

      res.json({
        success: true,
        team: { id: teamId, name: plan.team.name },
        recreated: !current,
        counts: plan.counts,
        sessionsUpdated: sessions.updated,
        sessionsNotUpdated: sessions.notUpdated,
        feedbacksStillOrphaned,
        preRestoreSnapshot: snapshot.id
      });
    } catch (err) {
      if (claimedKey) await releaseTeamNameKey(dataStore, teamId, claimedKey).catch(() => {});
      if (err instanceof TeamRestoreError) {
        return res.status(err.status).json({ error: err.code, ...err.details });
      }
      console.error('[Server] Failed to restore a team from a backup', err);
      res.status(500).json({ error: 'restore_failed' });
    }
  });
};

export { registerSuperAdminTeamRestoreRoutes };
