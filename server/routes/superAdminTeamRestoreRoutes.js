import rateLimit from 'express-rate-limit';
import { TEAM_NAME_MAX_LENGTH } from '../../utils/teamNamePolicy.js';
import { carryJiraLinks } from '../../utils/actionImpact.js';
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
import { createRestoreGate, RESTORE_IN_PROGRESS_ERROR } from '../services/restoreGate.js';

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

// Key order does not make two feedbacks different: PostgreSQL's jsonb does not
// keep it.
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
  // Shared with the whole-store restores by `registerSuperAdminRoutes`.
  restoreGate = createRestoreGate(),
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
    return { archive: archive.data, filename: archive.filename };
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
   * Puts each restored entry into its `session:{id}` row and sends it to the
   * room, through the compare-and-swap every socket write goes through.
   *
   * Rows that exist are overwritten, so the people in a session see the
   * restore. A row is also *written* for every restored entry that has been run
   * (a revision above 1) but has none — after a whole-store restore none do —
   * because without one, a client whose cached team record predates this
   * restore would seed the session from that cache on its first write, at a
   * revision the record accepts, and undo the restore for that retro.
   *
   * Best-effort, like the live rename: the record is restored by then, and a
   * row left behind is reported to the admin rather than failing a restore
   * that happened. Unlike the whole-store restore, other pods are not told to
   * drop their session caches: every cache read goes through `newerState`,
   * which keeps the higher revision, and the restored row is above any copy a
   * cache can hold. The room itself spans pods through the adapter.
   */
  const writeSessionRows = async (teamId, team, sessionRevs, targets) => {
    let updated = 0;
    let seeded = 0;
    const notUpdated = [];
    // Rows that landed above the revision the record was given, because a
    // socket write got to the row first (see `restampRecord`).
    const lifted = new Map();
    // Rows people may be in first, so a live session is not kept waiting
    // behind the seeding of every old retro of the team.
    const order = [...targets.keys()].sort((a, b) => Number(sessionRevs.has(b)) - Number(sessionRevs.has(a)));
    for (const sessionId of order) {
      const target = targets.get(sessionId);
      if (!sessionRevs.has(sessionId) && target <= 1) continue;
      const entry = restoredSessionEntry(team, sessionId);
      if (!entry) continue;
      let done = false;
      try {
        for (let attempt = 0; attempt < SESSION_WRITE_ATTEMPTS && !done; attempt++) {
          const row = await dataStore.loadSessionState(sessionId, { strict: true });
          if (row && row.teamId !== teamId) {
            done = true;
            break;
          }
          // Lands on the revision the record now holds, or one past the row if a
          // socket write got there first: either way at or above the record, so
          // the room's next persist is never refused by the record's rev guard.
          const base = Math.max(target - 1, revOf(row));
          const result = await dataStore.saveSessionState(sessionId, { ...entry, _rev: base });
          if (result.success) {
            done = true;
            const created = !row;
            if (created) seeded += 1;
            else updated += 1;
            if (revOf(result.data) > target) lifted.set(sessionId, revOf(result.data));
            // Published only while it is still the latest: a participant's
            // write can land between the save and here, and clients apply
            // every `session-update` they receive, so an older one would take
            // the room back to the restored state over that write.
            const latest = await dataStore.loadSessionState(sessionId);
            if (revOf(latest) === revOf(result.data)) {
              sessionCache.set(sessionId, result.data);
              if (!created) io.to(sessionId).emit('session-update', result.data);
            }
          }
        }
      } catch (err) {
        console.warn(`[Server] Team restore: session ${JSON.stringify(sessionId)} not ${done ? 'broadcast' : 'written'}`, err);
      }
      if (!done) notUpdated.push(sessionId);
    }
    return { updated, seeded, notUpdated, lifted };
  };

  /**
   * Lifts a record entry to the revision its row landed on, when that is above
   * the one the record was written with. The record is written first, at a
   * revision read before it; a socket write accepted on the row in between is
   * acked at exactly that revision, so the sender's next persist — still the
   * pre-restore state — passes the record's rev guard (it refuses only a
   * strictly older blob) and replaces the restored entry. Re-stamping puts the
   * restored entry back at the row's revision, above that persist. An entry
   * already above it came from someone working on the restored state and is
   * kept. Best-effort: the room's next persist heals the record anyway.
   *
   * The planned entry was computed before the rows were written, which takes
   * seconds for a team with many retros, and a Jira batch run from a live
   * session meanwhile writes its key on the record — for an action with no
   * backlog copy, its only copy. The Jira links the record holds now are
   * carried onto the planned team first (`carryJiraLinks`, the rule both
   * restores follow), so the re-stamp never drops a key and the next click
   * never creates a second issue. Nothing else of the record is kept: `done`,
   * ratings and deferrals are the archive's, which is what the re-stamp
   * exists to put back over a persist from before the restore.
   */
  const restampRecord = async (teamId, team, lifted) => {
    if (lifted.size === 0) return;
    try {
      await dataStore.atomicTeamUpdate(teamId, (fresh) => {
        let changed = false;
        const planned = carryJiraLinks(team, fresh);
        for (const list of ['retrospectives', 'healthChecks']) {
          if (!Array.isArray(fresh[list])) continue;
          fresh[list] = fresh[list].map((stored) => {
            const rev = lifted.get(stored?.id);
            if (rev === undefined || revOf(stored) > rev) return stored;
            const restored = restoredSessionEntry(planned, stored.id);
            if (!restored) return stored;
            changed = true;
            return { ...restored, _rev: rev };
          });
        }
        return changed ? fresh : null;
      });
    } catch (err) {
      console.warn('[Server] Team restore: the record could not be lifted to its live rows', err);
    }
  };

  /**
   * Takes this team's recovered orphans off the shared list — only the copies
   * still exactly as the plan read them. A reply posted to an orphan while the
   * restore ran would otherwise be removed with it; kept, it shows twice on the
   * board, which the admin can see and settle, rather than vanishing.
   */
  const unorphanFeedbacks = async (teamId, copies) => {
    if (copies.length === 0) return false;
    const asRead = new Map(copies.map((feedback) => [feedback.id, canonical(feedback)]));
    let changedMeanwhile = false;
    try {
      await dataStore.atomicMetaUpdate((stored) => {
        changedMeanwhile = false;
        const list = Array.isArray(stored.orphanedFeedbacks) ? stored.orphanedFeedbacks : [];
        const kept = list.filter((feedback) => {
          if (feedback?.teamId !== teamId || !asRead.has(feedback.id)) return true;
          if (asRead.get(feedback.id) === canonical(feedback)) return false;
          changedMeanwhile = true;
          return true;
        });
        if (kept.length === list.length) return null;
        return { ...stored, orphanedFeedbacks: kept };
      });
    } catch (err) {
      console.warn('[Server] Team restore: recovered feedbacks left in orphanedFeedbacks too', err);
      return true;
    }
    if (changedMeanwhile) {
      console.warn('[Server] Team restore: a recovered feedback changed during the restore and was kept in orphanedFeedbacks too');
    }
    return changedMeanwhile;
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

    // `expected` is what the console showed the admin: 'existing' (keeps the
    // current password) or 'deleted' (brings the archived one back). Optional,
    // so a caller that does not send it gets the plain behaviour.
    const { backupId, teamId, name: requestedName, expected } = req.body || {};
    // The name key this request added to the index for a deleted team.
    let claimedKey = null;
    let snapshot = null;
    let gateHeld = false;

    // Gives the name back, but only while no record holds it. Two restores of
    // the same deleted team share one claim: the first adds it, the second
    // finds it already the team's. If the first then fails *because the second
    // saved* (or while the second's snapshot runs), releasing would leave the
    // second's record with no name to log in by. A record means the name is in
    // use; the success path re-asserts it anyway (see below).
    const releaseClaim = async () => {
      if (!claimedKey) return;
      const key = claimedKey;
      claimedKey = null;
      try {
        if (!(await dataStore.loadTeamRaw(teamId))) await releaseTeamNameKey(dataStore, teamId, key);
      } catch (err) {
        console.warn('[Server] Team restore: the claimed name could not be released', err);
      }
    };
    // A clean refusal removes the snapshot it took; nothing was written.
    const refuse = async (status, error) => {
      await releaseClaim();
      if (snapshot) await backupService.deleteBackup(snapshot.id).catch(() => {});
      return res.status(status).json({ error });
    };

    try {
      if (typeof teamId !== 'string' || !teamId) return res.status(400).json({ error: 'missing_team_id' });
      const read = await readArchive(backupId);
      if (read.error) return res.status(read.status).json({ error: read.error });

      const archived = findArchivedTeam(read.archive, teamId);
      if (!archived) return res.status(404).json({ error: 'team_not_in_backup' });

      // Before the first write (the name claim): a whole-store restore running
      // meanwhile would leave a hybrid of two backups.
      if (!restoreGate.tryEnter()) return res.status(409).json({ error: RESTORE_IN_PROGRESS_ERROR });
      gateHeld = true;

      const current = await dataStore.loadTeam(teamId);
      // The two cases restore different credentials, and the dialog explained
      // one of them: a team deleted or recreated since the list was read gets
      // the list read again, not the other case behind the admin's back.
      if ((expected === 'existing' && !current) || (expected === 'deleted' && current)) {
        return refuse(409, 'team_changed');
      }
      let deletedName = null;
      let deletedNameKey = null;
      if (!current) {
        // A team deleted since the backup comes back under its old name or one
        // the admin chose, claimed before anything else is written so a refusal
        // leaves nothing behind.
        const resolved = resolveDeletedTeamName(requestedName, archived);
        if (resolved.error) return res.status(400).json({ error: resolved.error });
        deletedNameKey = resolved.name.toLowerCase();
        if (await nameHeldByAnotherRecord(dataStore, teamId, deletedNameKey)) {
          return res.status(409).json({ error: 'team_name_exists' });
        }
        const claim = await claimTeamNameKey(dataStore, teamId, deletedNameKey);
        if (!claim.claimed) return res.status(409).json({ error: 'team_name_exists' });
        if (claim.added) claimedKey = deletedNameKey;
        deletedName = resolved.name;
      }

      // Checked before the snapshot, so a malformed archive costs no backup.
      try {
        planTeamRestore({ archived, current, orphanedFeedbacks: [], sessionRevs: new Map(), name: deletedName });
      } catch (err) {
        if (err instanceof TeamRestoreError) {
          await releaseClaim();
          return res.status(err.status).json({ error: err.code, ...err.details });
        }
        throw err;
      }

      // Protected for the reason the whole-store restore's is: it may be the
      // only copy of what this restore replaces.
      snapshot = await backupService.createBackup('auto', 'Pre-restore snapshot', { protected: true });
      if (!snapshot) return refuse(503, 'pre_restore_snapshot_failed');

      // Read *after* the snapshot, which reads the whole store and can take
      // seconds: a live session moves on meanwhile, and a revision read before it
      // could end up at or below the row's, which the record's rev guard accepts.
      let sessionRevs;
      try {
        sessionRevs = await readSessionRevs(teamId, archived);
      } catch (err) {
        if (err instanceof SessionReadError) return refuse(503, 'session_read_failed');
        throw err;
      }

      // From here an unexpected error keeps the snapshot: the write it guards
      // may have landed before the error was raised.
      const meta = await dataStore.loadMetaData();
      const orphanedFeedbacks = meta?.orphanedFeedbacks || [];
      let plan = null;
      if (current) {
        // On the record as it is at write time, under the team's row lock: a
        // write queued before this one lands first and is planned against,
        // never overwritten.
        const result = await dataStore.atomicTeamUpdate(teamId, (fresh) => {
          plan = planTeamRestore({ archived, current: fresh, orphanedFeedbacks, sessionRevs });
          return plan.team;
        });
        if (!result.success) {
          return refuse(result.error === 'team_not_found' ? 409 : 500, result.error === 'team_not_found' ? 'team_changed' : 'restore_failed');
        }
      } else {
        plan = planTeamRestore({ archived, current: null, orphanedFeedbacks, sessionRevs, name: deletedName });
        // The team comes back under the same id, so a Jira secret its deletion
        // left behind (deleted by a pod from before team secrets, or a token
        // saved while the team was being deleted) would be re-attached to it:
        // the restored team would hold a token nobody set for it since. Removed
        // before the record exists; a failure is a clean refusal, since the
        // name claim and the snapshot are all this request has written.
        try {
          await dataStore.deleteTeamSecret(teamId);
        } catch (err) {
          console.warn('[Server] Team restore: the Jira secret left by the deletion could not be removed', err);
          return refuse(503, 'team_secret_delete_failed');
        }
        // Revision 0 means "only while there is still no record": a team that
        // reappeared meanwhile is not overwritten.
        const saved = await dataStore.atomicTeamSave(teamId, plan.team, 0);
        if (!saved.success) return refuse(409, 'team_changed');
        claimedKey = null;
        // Re-asserted after the save: a concurrent restore of the same team that
        // failed before this save could have released the claim both shared.
        // Best-effort like the release: the team is recreated by now, and an
        // error here must not answer 500 and skip the steps that follow.
        try {
          const held = await claimTeamNameKey(dataStore, teamId, deletedNameKey);
          if (!held.claimed) {
            console.error(`[Server] Team restore: ${JSON.stringify(plan.team.id)} was recreated but another team took its name meanwhile; rename it from the console`);
          }
        } catch (err) {
          console.error(`[Server] Team restore: ${JSON.stringify(plan.team.id)} was recreated but its name could not be re-asserted`, err);
        }
      }
      claimedKey = null;

      // Orphans of this team are in the record now; take them off the shared
      // list so the board does not show them twice. After the record write, so a
      // failure here duplicates a feedback rather than loses one.
      const feedbacksStillOrphaned = await unorphanFeedbacks(teamId, plan.unorphanedFeedbacks);

      const sessions = await writeSessionRows(teamId, plan.team, sessionRevs, plan.targets);
      await restampRecord(teamId, plan.team, sessions.lifted);
      await afterRestore();

      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.TEAM_RESTORE,
        actor: 'super-admin',
        outcome: 'success',
        target: plan.team.id,
        detail: {
          backupId,
          backup: read.filename,
          name: auditName(plan.team.name),
          recreated: !current,
          preRestoreSnapshot: snapshot.id,
          sessionsUpdated: sessions.updated,
          sessionsSeeded: sessions.seeded,
          sessionsNotUpdated: sessions.notUpdated.length,
          feedbacksRecovered: plan.counts.feedbacksRecovered
        }
      });
      // Logged from what the store holds (the archive's team id, the stored
      // backup's file name), never from the request body.
      console.info(`[Server] Restored team ${JSON.stringify(plan.team.id)} from ${JSON.stringify(read.filename)} (${current ? 'existing' : 'recreated'})`);

      res.json({
        success: true,
        team: { id: plan.team.id, name: plan.team.name },
        recreated: !current,
        counts: plan.counts,
        sessionsUpdated: sessions.updated,
        sessionsSeeded: sessions.seeded,
        sessionsNotUpdated: sessions.notUpdated,
        feedbacksStillOrphaned,
        preRestoreSnapshot: snapshot.id
      });
    } catch (err) {
      await releaseClaim();
      console.error('[Server] Failed to restore a team from a backup', err);
      res.status(500).json({ error: 'restore_failed' });
    } finally {
      if (gateHeld) restoreGate.leave();
    }
  });
};

export { registerSuperAdminTeamRestoreRoutes };
