import { createHash, randomBytes, randomInt } from 'crypto';
import rateLimit from 'express-rate-limit';
import { hashPassword, isHashedPassword } from '../services/passwordHashing.js';
import { isPasswordLongEnough, PASSWORD_TOO_SHORT_ERROR } from '../../utils/passwordPolicy.js';
import { parseEmailInput, INVALID_EMAIL_ERROR } from '../../utils/emailAddress.js';
import { TEAM_NAME_MAX_LENGTH } from '../../utils/teamNamePolicy.js';
import { claimTeamNameKey, nameHeldByAnotherRecord, releaseTeamNameKey } from '../services/teamNameIndex.js';
import {
  contentDigest,
  fingerprintMergePlanInput,
  fingerprintTeamContent,
  MergeSourceError,
  planTeamMerge
} from '../services/teamMerge.js';
import {
  assessMergedTeamChanges,
  assessSourceChanges,
  loadEffectiveTeam,
  mergeAncestors,
  SessionReadError
} from '../services/mergeSources.js';
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

// Team names have no cap on creation or rename, and an audit row's `detail` is
// cut at 1000 characters: names are shortened there so the facts after them —
// which password opens the merged team — always fit.
const AUDIT_NAME_MAX_LENGTH = 80;
const auditName = (name) => (typeof name === 'string' ? name.slice(0, AUDIT_NAME_MAX_LENGTH) : '');
const PASSWORD_SOURCES = new Set(['primary', 'secondary', 'new']);

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
/** The client's `randomId()` shape — 9 base-36 characters from a crypto source, unbiased. */
const generateEntityId = () => {
  let id = '';
  for (let index = 0; index < 9; index += 1) id += BASE36[randomInt(BASE36.length)];
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
  // The super-admin limiters' own rule: off when the console is not configured.
  skipRateLimit = () => false,
  generateId = generateEntityId
}) => {
  // Built here, with the console's read and action settings, rather than
  // passed in: each route module owns its limiters, which is also what lets
  // code scanning see that every route below is limited.
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
   * Retros and health checks someone has open right now. A warning on the
   * merge, a reason to acknowledge on a deletion — never a block: a forgotten
   * tab on an old retro would otherwise make a team impossible to merge or
   * delete. `null` when it cannot be known, which is not the same as nobody.
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
    // A team and one of its own merge sources, at any depth: the merged team
    // already holds the source's work, and merging them again copies all of it
    // a second time. The remedy for a source that changed since its merge is
    // to merge the original teams again, never the merged team with a source.
    const summaries = await dataStore.loadTeamSummaries({ withMergeProvenance: true });
    const ancestors = {
      primary: mergeAncestors(summaries, primary.id, verifyProvenance),
      secondary: mergeAncestors(summaries, secondary.id, verifyProvenance)
    };
    if (ancestors.primary.has(secondary.id) || ancestors.secondary.has(primary.id)) {
      return { status: 409, error: 'related_teams' };
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
      recordFingerprints: { primary: fingerprintTeamContent(primary), secondary: fingerprintTeamContent(secondary) },
      ancestors
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
    // The admin confirms the plan the preview showed, never a later one, so the
    // preview's fingerprints are not optional.
    if (typeof expectedFingerprints?.primary !== 'string' || typeof expectedFingerprints?.secondary !== 'string') {
      return res.status(400).json({ error: 'missing_fingerprints' });
    }

    let claimedKey = null;
    let newTeamId = null;
    try {
      const sources = await loadSources(req.body);
      if (sources.error) return res.status(sources.status).json({ error: sources.error });
      const { primary, secondary, freshened, recordFingerprints, ancestors } = sources;

      if (
        expectedFingerprints.primary !== fingerprintMergePlanInput(primary) ||
        expectedFingerprints.secondary !== fingerprintMergePlanInput(secondary)
      ) {
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
      // No id is excluded: the merged team has no record yet.
      if (await nameHeldByAnotherRecord(dataStore, null, nameKey)) {
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
      // What the merged team holds as created, so deleting it later can tell
      // "undoing the merge" from "deleting what was written there since"; and
      // each source's own merge sources, so a later merge of this team with
      // one of them is refused even once the team in between is gone.
      const { fingerprint: mergedFingerprint, parts: mergedParts } = contentDigest(team);
      // Signed over every field, so a deletion can tell this record from a
      // `mergedFrom` some team wrote or edited itself
      // (`tokenService.verifyMergeProvenance`).
      team.mergedFrom = team.mergedFrom.map((entry) => {
        const full = {
          ...entry,
          ancestorIds: [...ancestors[entry.role === 'primary' ? 'primary' : 'secondary']].sort(),
          mergedFingerprint,
          mergedParts
        };
        return { ...full, signature: tokenService.signMergeProvenance(newTeamId, full) };
      });

      // Claim the name before the record exists, and take the claim back only
      // if this request added it — the rule every index writer here follows
      // (`teamNameIndex.js`, HARDENING_STATUS.md invariant 15).
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
      // The record exists: from here on, the name is the merged team's.
      claimedKey = null;

      const sourceEmail = { primary: cleanedEmailOf(primary), secondary: cleanedEmailOf(secondary) };
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
          // Where the reset destination came from, never the address itself:
          // the recovery email is one step from the password.
          recoveryEmailSource: !email.email
            ? 'none'
            : email.email === sourceEmail.primary
              ? 'primary'
              : email.email === sourceEmail.secondary ? 'secondary' : 'other',
          sourceIds: [primary.id, secondary.id],
          counts: report.merged,
          name: auditName(trimmedName),
          sourceNames: [auditName(primary.name), auditName(secondary.name)]
        }
      });

      res.status(201).json({ success: true, team: { id: newTeamId, name: trimmedName }, report });
    } catch (err) {
      // A save that threw may still have landed (the connection dropped after
      // the commit): the name is released only when no record exists, or the
      // merged team would be left unreachable by login.
      if (claimedKey && newTeamId) {
        const landed = await dataStore.loadTeamRaw(newTeamId).catch(() => true);
        if (!landed) {
          await releaseTeamNameKey(dataStore, newTeamId, claimedKey).catch((releaseErr) => {
            console.error('[Server] Failed to release the merged team name after a failed save', releaseErr);
          });
        }
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
   * 409 `confirmation_required`, the facts behind it and a digest of those
   * facts. The console shows them; the admin acknowledges *those* reasons and
   * sends the digest back. Any change since — a new reason, a write to the team,
   * a session opened, a source that moved on — changes the digest and the
   * deletion is refused again with the new facts, so an acknowledgement never
   * waves through something the admin did not see.
   *
   * A protected snapshot is taken before anything is removed, and the record is
   * read again after it: a write that landed while the checks and the snapshot
   * ran answers 409 `team_changed` with nothing deleted, instead of being lost
   * with the record. What remains is the width of one read and two deletes,
   * as on the team-side deletion.
   */
  const DELETE_REASONS = new Set([
    'source_changed',
    'merge_unverified',
    'merged_team_changed',
    'sources_deleted',
    'sessions_open',
    'sessions_unknown'
  ]);

  const factsDigest = (facts) => createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32);

  app.post('/api/super-admin/delete-team', actionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) return unauthorized(res);

    const { teamId, confirmName, mergedInto, acknowledge, confirmation } = req.body || {};
    if (typeof teamId !== 'string' || !teamId) return res.status(400).json({ error: 'missing_team_id' });
    const acknowledged = new Set(Array.isArray(acknowledge) ? acknowledge.filter((reason) => DELETE_REASONS.has(reason)) : []);

    try {
      const stored = await dataStore.loadTeamRaw(teamId);
      if (!stored) return res.status(404).json({ error: 'team_not_found' });
      const { _rev: storedRev, _updatedAt: _ignoredUpdatedAt, ...team } = stored;

      // Typed confirmation, checked on the server: a misclick on the wrong row
      // of the console must not be enough to delete a team.
      const expected = typeof team.name === 'string' ? team.name.trim() : '';
      if (typeof confirmName !== 'string' || confirmName.trim() !== expected) {
        return res.status(400).json({ error: 'confirm_name_mismatch' });
      }

      const reasons = [];
      const facts = {};
      // A failed read throws: an empty answer would read as "merged into
      // nothing" and skip the check below.
      const targets = await findMergeTargets(dataStore, teamId);

      // A merge source holding work its merged team does not, or listed only by
      // provenance nobody signed.
      const assessment = await assessSourceChanges(deps, team, targets, verifyProvenance);
      if (assessment.status === 'changed') {
        reasons.push('source_changed');
        facts.changes = assessment.changes;
        facts.mergedInto = assessment.mergedInto;
      } else if (assessment.status === 'unverified') {
        reasons.push('merge_unverified');
        facts.mergedInto = assessment.mergedInto;
      }

      // A merged team written to since its merge: deleting it is no longer
      // just undoing the merge.
      const mergedTeam = await assessMergedTeamChanges(deps, team, verifyProvenance);
      if (mergedTeam.changed) {
        reasons.push('merged_team_changed');
        facts.mergedChanges = mergedTeam.changes;
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

      if (reasons.length > 0) {
        const digest = factsDigest({
          rev: storedRev ?? null,
          reasons,
          facts,
          liveIds: (live || []).map((entry) => entry.id).sort(),
          content: [assessment.fingerprint ?? null, mergedTeam.fingerprint ?? null]
        });
        if (reasons.some((reason) => !acknowledged.has(reason)) || confirmation !== digest) {
          return res.status(409).json({ error: 'confirmation_required', reasons, ...facts, confirmation: digest });
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

      // Everything above took time — summaries, live rows, every socket of the
      // cluster, a whole-store backup. A write that landed meanwhile is in the
      // record and maybe not in the snapshot: refuse rather than lose it.
      const current = await dataStore.loadTeamRaw(teamId);
      if (!current) return res.status(404).json({ error: 'team_not_found' });
      if ((current._rev ?? null) !== (storedRev ?? null)) {
        return res.status(409).json({ error: 'team_changed' });
      }

      // Feedbacks move only into the merged team the admin confirmed, and only
      // when that merge signed the entry naming this team; the move checks the
      // signature again under the lock. Anything else orphans them, which keeps
      // them exactly as a deletion always has.
      const mergeTarget = typeof mergedInto === 'string'
        ? targets.find((target) => target.id === mergedInto && verifyProvenance?.(target.id, target.entry)) ?? null
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

export { registerSuperAdminTeamMergeRoutes };
