import { randomBytes } from 'crypto';
import { hashPassword, isHashedPassword } from '../services/passwordHashing.js';
import { isPasswordLongEnough, PASSWORD_TOO_SHORT_ERROR } from '../../utils/passwordPolicy.js';
import { parseEmailInput, INVALID_EMAIL_ERROR } from '../../utils/emailAddress.js';
import { claimTeamNameKey, releaseTeamNameKey } from '../services/teamNameIndex.js';
import { fingerprintTeamContent, MergeSourceError, planTeamMerge } from '../services/teamMerge.js';
import { changedSinceMerge, loadEffectiveTeam, SessionReadError } from '../services/mergeSources.js';
import {
  deleteTeamAndPreserveFeedbacks,
  FeedbackMoveError,
  findMergeTarget,
  SourceChangedSinceMergeError
} from '../services/teamDeletion.js';
import { SECURITY_ACTIONS } from '../services/securityEvents.js';

/**
 * The super-admin team merge and team deletion (DESIGN: AGENTS.md → *Merging
 * teams*). Registered from inside `registerSuperAdminRoutes`, so the route
 * inventory test that posts a forged token to every super-admin route covers
 * these too, and so does the `server.js` wiring check for `securityEvents`.
 *
 * Every handler authenticates first, before reading the body: an anonymous
 * caller must learn nothing, not even which team ids exist.
 */

// `/api/send-password-reset` refuses a team name longer than this, so a merged
// team named beyond it could never receive a reset mail.
const TEAM_NAME_MAX_LENGTH = 200;
const PASSWORD_SOURCES = new Set(['primary', 'secondary', 'new']);

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
/** The client's `randomId()` shape — 9 base-36 characters from a crypto source. */
const generateEntityId = () => {
  let id = '';
  for (const byte of randomBytes(9)) id += BASE36[byte % 36];
  return id;
};

const registerSuperAdminTeamMergeRoutes = ({
  app,
  io,
  dataStore,
  tokenService,
  sessionCache,
  backupService,
  securityEvents,
  readLimiter,
  actionLimiter,
  generateId = generateEntityId
}) => {
  const unauthorized = (res) => res.status(401).json({ error: 'unauthorized' });
  const deps = { dataStore, sessionCache };

  /**
   * The refusals every route here shares. A source the planner cannot carry
   * without dropping something, and a live session that could not be read, both
   * stop the operation with nothing written — the sources are untouched, so
   * waiting or repairing first costs nothing.
   */
  const answerKnownFailure = (res, err) => {
    if (err instanceof MergeSourceError) {
      res.status(422).json({ error: 'source_needs_repair', anomalies: err.anomalies });
      return true;
    }
    if (err instanceof SessionReadError) {
      res.status(503).json({ error: 'session_read_failed' });
      return true;
    }
    return false;
  };

  /**
   * Retros and health checks someone has open right now. A warning, never a
   * block: a forgotten tab on an old retro would otherwise make a team
   * impossible to merge or delete. Deletion has the stronger guard — it refuses
   * a source that changed since the merge.
   */
  const findLiveSessions = async (teams) => {
    try {
      const sockets = await io.fetchSockets();
      const openRooms = new Set();
      for (const socket of sockets) {
        if (!socket.data?.userId) continue;
        for (const room of socket.rooms) {
          if (room !== socket.id) openRooms.add(room);
        }
      }
      return teams.flatMap(({ role, team }) =>
        [...(team.retrospectives || []), ...(team.healthChecks || [])]
          .filter((entry) => entry && openRooms.has(entry.id))
          .map((entry) => ({ source: role, id: entry.id, name: typeof entry.name === 'string' ? entry.name : '' }))
      );
    } catch (err) {
      console.warn('[Server] Could not list live sessions for a team merge or deletion', err);
      return null;
    }
  };

  const loadSources = async (body) => {
    const { primaryTeamId, secondaryTeamId } = body || {};
    if (typeof primaryTeamId !== 'string' || !primaryTeamId || typeof secondaryTeamId !== 'string' || !secondaryTeamId) {
      return { status: 400, error: 'missing_team_id' };
    }
    if (primaryTeamId === secondaryTeamId) {
      return { status: 400, error: 'same_team' };
    }
    const [primary, secondary] = await Promise.all([
      dataStore.loadTeam(primaryTeamId),
      dataStore.loadTeam(secondaryTeamId)
    ]);
    if (!primary || !secondary) {
      return { status: 404, error: 'team_not_found' };
    }
    const effectivePrimary = await loadEffectiveTeam(deps, primary);
    const effectiveSecondary = await loadEffectiveTeam(deps, secondary);
    return {
      primary: effectivePrimary.team,
      secondary: effectiveSecondary.team,
      freshened: [
        ...effectivePrimary.freshened.map((entry) => ({ source: 'primary', ...entry })),
        ...effectiveSecondary.freshened.map((entry) => ({ source: 'secondary', ...entry }))
      ]
    };
  };

  const cleanedEmailOf = (team) => {
    const parsed = parseEmailInput(team.facilitatorEmail);
    return parsed.ok && parsed.email ? parsed.email : null;
  };

  app.post('/api/super-admin/merge-teams/preview', readLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);

    try {
      const sources = await loadSources(req.body);
      if (sources.error) return res.status(sources.status).json({ error: sources.error });
      const { primary, secondary, freshened } = sources;

      const { report } = planTeamMerge({
        primary,
        secondary,
        newTeamId: 'preview',
        name: 'preview',
        passwordHash: '',
        facilitatorEmail: undefined,
        mergedAt: new Date().toISOString(),
        generateId,
        freshened
      });
      const liveSessions = await findLiveSessions([
        { role: 'primary', team: primary },
        { role: 'secondary', team: secondary }
      ]);

      res.json({
        report,
        liveSessions,
        // Sent back with the merge, which refuses if either team changed in
        // between: the admin confirms the plan shown, not a later one.
        fingerprints: { primary: fingerprintTeamContent(primary), secondary: fingerprintTeamContent(secondary) },
        defaults: {
          name: `${primary.name} + ${secondary.name}`.slice(0, TEAM_NAME_MAX_LENGTH),
          emails: { primary: cleanedEmailOf(primary), secondary: cleanedEmailOf(secondary) },
          passwordSources: {
            primary: isHashedPassword(primary.passwordHash),
            secondary: isHashedPassword(secondary.passwordHash)
          }
        }
      });
    } catch (err) {
      if (answerKnownFailure(res, err)) return;
      console.error('[Server] Failed to preview a team merge', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.post('/api/super-admin/merge-teams', actionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);

    const { name, passwordSource, newPassword, facilitatorEmail, expectedFingerprints } = req.body || {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) return res.status(400).json({ error: 'team_name_empty' });
    if (trimmedName.length > TEAM_NAME_MAX_LENGTH) return res.status(400).json({ error: 'team_name_too_long' });
    if (!PASSWORD_SOURCES.has(passwordSource)) return res.status(400).json({ error: 'invalid_password_source' });
    if (passwordSource === 'new' && !isPasswordLongEnough(newPassword)) {
      return res.status(400).json({ error: PASSWORD_TOO_SHORT_ERROR });
    }
    const email = parseEmailInput(facilitatorEmail);
    if (!email.ok) return res.status(400).json({ error: INVALID_EMAIL_ERROR });

    let claimedKey = null;
    let newTeamId = null;
    try {
      const sources = await loadSources(req.body);
      if (sources.error) return res.status(sources.status).json({ error: sources.error });
      const { primary, secondary, freshened } = sources;

      if (expectedFingerprints && (
        expectedFingerprints.primary !== fingerprintTeamContent(primary) ||
        expectedFingerprints.secondary !== fingerprintTeamContent(secondary)
      )) {
        return res.status(409).json({ error: 'sources_changed_since_preview' });
      }

      let passwordHash;
      if (passwordSource === 'new') {
        passwordHash = await hashPassword(newPassword);
      } else {
        // A legacy plaintext value never authenticates (`teamService.js`), so
        // copying one would build a team nobody can open.
        passwordHash = (passwordSource === 'primary' ? primary : secondary).passwordHash;
        if (!isHashedPassword(passwordHash)) return res.status(400).json({ error: 'password_unavailable' });
      }

      // The index is the authority on names, but a record can outlive its index
      // entry (a deletion whose last step failed), and a restore rebuilds the
      // index from record names: two records sharing a name would then leave one
      // of them unreachable.
      const nameKey = trimmedName.toLowerCase();
      const summaries = await dataStore.loadTeamSummaries();
      if (summaries.some((summary) => typeof summary?.name === 'string' && summary.name.trim().toLowerCase() === nameKey)) {
        return res.status(409).json({ error: 'team_name_exists' });
      }

      // A 40-bit random id, as team creation uses. `atomicTeamSave` with an
      // expected revision of 0 would overwrite a legacy record that has no
      // `_rev`, so an id already in use is skipped explicitly.
      for (let attempt = 0; attempt < 5 && !newTeamId; attempt += 1) {
        const candidate = randomBytes(5).toString('hex');
        if (!(await dataStore.loadTeamRaw(candidate))) newTeamId = candidate;
      }
      if (!newTeamId) return res.status(503).json({ error: 'failed_to_save' });

      const { team, report } = planTeamMerge({
        primary,
        secondary,
        newTeamId,
        name: trimmedName,
        passwordHash,
        facilitatorEmail: email.email,
        mergedAt: new Date().toISOString(),
        generateId,
        freshened
      });

      // Claim the name before the record exists, and take the claim back only
      // if this request added it — the rule every index writer here follows
      // (`teamNameIndex.js`, AGENTS.md invariant 15).
      const claim = await claimTeamNameKey(dataStore, newTeamId, nameKey);
      if (!claim.claimed) return res.status(409).json({ error: 'team_name_exists' });
      claimedKey = claim.added ? nameKey : null;

      const saved = await dataStore.atomicTeamSave(newTeamId, team, 0);
      if (!saved?.success) {
        if (claimedKey) {
          await releaseTeamNameKey(dataStore, newTeamId, claimedKey).catch((releaseErr) => {
            console.error('[Server] Failed to release the merged team name after a lost save', releaseErr);
          });
        }
        return res.status(503).json({ error: 'failed_to_save' });
      }

      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.TEAM_MERGE,
        actor: 'super-admin',
        outcome: 'success',
        target: newTeamId,
        detail: {
          name: trimmedName,
          sources: [primary, secondary].map((source) => ({ id: source.id, name: source.name })),
          password: passwordSource,
          counts: report.merged
        }
      });

      res.status(201).json({ success: true, team: { id: newTeamId, name: trimmedName }, report });
    } catch (err) {
      if (claimedKey && newTeamId) {
        await releaseTeamNameKey(dataStore, newTeamId, claimedKey).catch(() => {});
      }
      if (answerKnownFailure(res, err)) return;
      console.error('[Server] Failed to merge teams', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/delete-team', actionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);

    const { teamId, confirmName, force } = req.body || {};
    if (typeof teamId !== 'string' || !teamId) return res.status(400).json({ error: 'missing_team_id' });

    try {
      const team = await dataStore.loadTeam(teamId);
      if (!team) return res.status(404).json({ error: 'team_not_found' });

      // Typed confirmation, checked on the server: a misclick on the wrong row
      // of the console must not be enough to delete a team.
      const expected = typeof team.name === 'string' ? team.name.trim() : '';
      if (typeof confirmName !== 'string' || confirmName.trim() !== expected) {
        return res.status(400).json({ error: 'confirm_name_mismatch' });
      }

      const mergeTarget = await findMergeTarget(dataStore, teamId);
      const changedAnswer = () => res.status(409).json({
        error: 'source_changed_since_merge',
        mergedInto: { id: mergeTarget.id, name: mergeTarget.name }
      });

      if (force !== true) {
        // The one way deleting a merge source loses work: something was
        // written to it after the merge copied it.
        if (mergeTarget && (await changedSinceMerge(deps, team, mergeTarget))) return changedAnswer();

        // Deleting a merged team undoes its merge — safe while both sources
        // still exist, and the loss of their only copy once one is gone.
        const sources = Array.isArray(team.mergedFrom) ? team.mergedFrom.filter((entry) => entry?.teamId) : [];
        const gone = [];
        for (const source of sources) {
          if (!(await dataStore.loadTeam(source.teamId))) gone.push(source.name);
        }
        if (gone.length > 0) return res.status(409).json({ error: 'merge_sources_deleted', sources: gone });

        const live = await findLiveSessions([{ role: 'team', team }]);
        if (live && live.length > 0) {
          return res.status(409).json({ error: 'team_in_use', sessions: live.map((entry) => entry.name) });
        }
      }

      // A protected snapshot first, as both restore routes take one: this is
      // the only copy of the team once the record is gone. `createBackup` also
      // answers with an empty archive when it could not read the store, which
      // is no recovery point at all.
      const snapshot = await backupService.createBackup('auto', 'Pre-delete snapshot', { protected: true });
      if (!snapshot || !(snapshot.teamCount > 0)) {
        return res.status(503).json({ error: 'pre_delete_snapshot_failed' });
      }

      let outcome;
      try {
        outcome = await deleteTeamAndPreserveFeedbacks({
          dataStore,
          sessionCache,
          team,
          mergeTarget,
          force: force === true
        });
      } catch (err) {
        // Changed between the check above and now: refused like the check.
        if (err instanceof SourceChangedSinceMergeError) return changedAnswer();
        if (err instanceof FeedbackMoveError) return res.status(503).json({ error: 'failed_to_move_feedbacks' });
        throw err;
      }

      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.TEAM_DELETE,
        actor: 'super-admin',
        outcome: 'success',
        target: teamId,
        detail: {
          name: team.name,
          snapshot: snapshot.id,
          ...(outcome.mergedInto ? { mergedInto: outcome.mergedInto } : {}),
          ...(force === true ? { forced: true } : {})
        }
      });

      res.json({
        success: true,
        movedFeedbacks: outcome.movedFeedbacks,
        orphanedFeedbacks: outcome.orphanedFeedbacks,
        mergedInto: outcome.mergedInto
      });
    } catch (err) {
      if (answerKnownFailure(res, err)) return;
      console.error('[Server] Failed to delete a team from the super-admin console', err);
      res.status(500).json({ error: 'failed_to_delete' });
    }
  });
};

export { registerSuperAdminTeamMergeRoutes, TEAM_NAME_MAX_LENGTH };
