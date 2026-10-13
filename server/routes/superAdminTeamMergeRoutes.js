import { randomBytes } from 'crypto';
import { hashPassword, isHashedPassword } from '../services/passwordHashing.js';
import { isPasswordLongEnough, PASSWORD_TOO_SHORT_ERROR } from '../../utils/passwordPolicy.js';
import { parseEmailInput, INVALID_EMAIL_ERROR } from '../../utils/emailAddress.js';
import { claimTeamNameKey, nameHeldByAnotherRecord, releaseTeamNameKey } from '../services/teamNameIndex.js';
import {
  fingerprintMergePlanInput,
  fingerprintTeamContent,
  MergeSourceError,
  planTeamMerge
} from '../services/teamMerge.js';
import { assessSourceChanges, loadEffectiveTeam, SessionReadError } from '../services/mergeSources.js';
import { deleteTeamAndPreserveFeedbacks, FeedbackMoveError, findMergeTargets } from '../services/teamDeletion.js';
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
// Team names have no cap on creation or rename, and an audit row's `detail` is
// cut at 1000 characters: names are shortened there so the facts after them —
// which password opens the merged team — always fit.
const AUDIT_NAME_MAX_LENGTH = 80;
const auditName = (name) => (typeof name === 'string' ? name.slice(0, AUDIT_NAME_MAX_LENGTH) : '');
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
  serverRuntime,
  readLimiter,
  actionLimiter,
  generateId = generateEntityId
}) => {
  const verifyProvenance = tokenService.verifyMergeProvenance;
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
    // With a cross-pod adapter configured but down, this pod sees its own
    // sockets only: a room open on another pod would read as empty.
    const adapter = serverRuntime?.socketAdapter;
    if (adapter?.expected && !adapter.active) return null;
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
      ],
      // The records alone, for after a restore has wiped the live copies
      // (`assessSourceChanges`).
      recordFingerprints: { primary: fingerprintTeamContent(primary), secondary: fingerprintTeamContent(secondary) }
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
      const { primary, secondary, freshened, recordFingerprints } = sources;

      const { report } = planTeamMerge({
        primary,
        secondary,
        newTeamId: 'preview',
        name: 'preview',
        passwordHash: '',
        facilitatorEmail: undefined,
        mergedAt: new Date().toISOString(),
        generateId,
        freshened,
        recordFingerprints
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
        fingerprints: { primary: fingerprintMergePlanInput(primary), secondary: fingerprintMergePlanInput(secondary) },
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
      const { primary, secondary, freshened, recordFingerprints } = sources;

      if (expectedFingerprints && (
        expectedFingerprints.primary !== fingerprintMergePlanInput(primary) ||
        expectedFingerprints.secondary !== fingerprintMergePlanInput(secondary)
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

      const nameKey = trimmedName.toLowerCase();
      if (await nameHeldByAnotherRecord(dataStore, newTeamId, nameKey)) {
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
        freshened,
        recordFingerprints
      });
      // Signed, so a deletion can tell this record from a `mergedFrom` some
      // team wrote itself (`tokenService.verifyMergeProvenance`).
      team.mergedFrom = team.mergedFrom.map((entry) => ({
        ...entry,
        signature: tokenService.signMergeProvenance({
          mergedTeamId: newTeamId,
          sourceTeamId: entry.teamId,
          mergedAt: entry.mergedAt,
          fingerprint: entry.fingerprint
        })
      }));

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
        // Short facts first, names last and shortened. `passwordSource`, not
        // `password`: the shared redactor blanks any key named like a secret,
        // and which credential opens the merged team is the one fact here an
        // investigation needs.
        detail: {
          passwordSource,
          sourceIds: [primary.id, secondary.id],
          counts: report.merged,
          name: auditName(trimmedName),
          sourceNames: [auditName(primary.name), auditName(secondary.name)]
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

  /**
   * Deleting a team, with what it would cost said first.
   *
   * Each way the deletion could lose something is a named reason, refused with
   * 409 `confirmation_required` and the facts behind it. The console shows them
   * and the admin acknowledges *those* reasons; every reason not acknowledged is
   * checked again, so acknowledging an open session never also waves through a
   * change made since the merge. A protected snapshot is taken before anything
   * is removed, whatever was acknowledged.
   */
  const DELETE_REASONS = new Set(['source_changed', 'sources_deleted', 'sessions_open', 'sessions_unknown']);

  app.post('/api/super-admin/delete-team', actionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);

    const { teamId, confirmName, mergedInto, acknowledge } = req.body || {};
    if (typeof teamId !== 'string' || !teamId) return res.status(400).json({ error: 'missing_team_id' });
    const acknowledged = new Set(Array.isArray(acknowledge) ? acknowledge.filter((reason) => DELETE_REASONS.has(reason)) : []);

    try {
      const team = await dataStore.loadTeam(teamId);
      if (!team) return res.status(404).json({ error: 'team_not_found' });

      // Typed confirmation, checked on the server: a misclick on the wrong row
      // of the console must not be enough to delete a team.
      const expected = typeof team.name === 'string' ? team.name.trim() : '';
      if (typeof confirmName !== 'string' || confirmName.trim() !== expected) {
        return res.status(400).json({ error: 'confirm_name_mismatch' });
      }

      const reasons = [];
      const facts = {};
      const targets = await findMergeTargets(dataStore, teamId);

      // A merge source holding work its merged team does not.
      const assessment = await assessSourceChanges(deps, team, targets.map((target) => target.entry));
      if (assessment.changed) {
        reasons.push('source_changed');
        facts.changes = assessment.changes;
        facts.mergedInto = targets.map((target) => target.name);
      }

      // A merged team whose sources are gone: deleting it undoes the merge
      // after the only other copy has been removed.
      const gone = [];
      for (const source of Array.isArray(team.mergedFrom) ? team.mergedFrom : []) {
        if (source?.teamId && !(await dataStore.loadTeam(source.teamId))) gone.push(source.name);
      }
      if (gone.length > 0) {
        reasons.push('sources_deleted');
        facts.sources = gone;
      }

      // Unknown is not "nobody": without a reliable answer it is a reason too.
      const live = await findLiveSessions([{ role: 'team', team }]);
      if (live === null) {
        reasons.push('sessions_unknown');
      } else if (live.length > 0) {
        reasons.push('sessions_open');
        facts.sessions = live.map((entry) => entry.name);
      }

      if (reasons.some((reason) => !acknowledged.has(reason))) {
        return res.status(409).json({ error: 'confirmation_required', reasons, ...facts });
      }

      // A protected snapshot first, as both restore routes take one: this is
      // the only copy of the team once the record is gone. `createBackup` also
      // answers with an empty archive when it could not read the store, which
      // is no recovery point at all.
      const snapshot = await backupService.createBackup('auto', 'Pre-delete snapshot', { protected: true });
      if (!snapshot || !(snapshot.teamCount > 0)) {
        return res.status(503).json({ error: 'pre_delete_snapshot_failed' });
      }

      // Feedbacks move only into the merged team the admin confirmed, and the
      // move itself checks the merge's signature under the lock. Anything else
      // — no confirmation, an unsigned or forged entry — orphans them, which
      // keeps them exactly as a deletion always has.
      const mergeTarget = typeof mergedInto === 'string'
        ? targets.find((target) => target.id === mergedInto) ?? null
        : null;

      let outcome;
      try {
        outcome = await deleteTeamAndPreserveFeedbacks({ dataStore, team, mergeTarget, verifyProvenance });
      } catch (err) {
        if (err instanceof FeedbackMoveError) return res.status(503).json({ error: 'failed_to_move_feedbacks' });
        throw err;
      }

      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.TEAM_DELETE,
        actor: 'super-admin',
        outcome: 'success',
        target: teamId,
        detail: {
          snapshot: snapshot.id,
          ...(reasons.length > 0 ? { acknowledged: reasons } : {}),
          ...(outcome.mergedInto ? { mergedInto: outcome.mergedInto } : {}),
          name: auditName(team.name)
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
