import { randomBytes } from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { hashPassword } from '../services/passwordHashing.js';
import { isPasswordLongEnough, PASSWORD_TOO_SHORT_ERROR } from '../../utils/passwordPolicy.js';
import { getTeamInviteEpoch } from '../services/teamService.js';
import { SECURITY_ACTIONS, NO_OP_SECURITY_EVENTS } from '../services/securityEvents.js';
import {
  claimTeamNameKey,
  releaseTeamNameKey,
  releaseTeamNameKeys,
  releaseAllTeamNameKeys
} from '../services/teamNameIndex.js';

const registerTeamRoutes = ({
  app,
  dataStore,
  teamService,
  tokenService,
  mailerService,
  logService,
  escapeHtml,
  teamReadLimiterMax = 120,
  // Audit H45 — see the note on the same parameter in `superAdminRoutes.js`
  // for why the default is a no-op and what asserts the real wiring.
  securityEvents = NO_OP_SECURITY_EVENTS
}) => {
  // Allow tests / development to raise the auth-write limiter via env var
  // without affecting production defaults.
  const authLimiterMax = (() => {
    const raw = process.env.AUTH_RATE_LIMIT_MAX;
    if (!raw) return 5;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  })();

  // Metered on rejected credentials only, like `/api/send-invite`
  // (publicRoutes.js). Counting every request made this an availability risk
  // rather than a safeguard: `/api/team/restore-session` runs on *every page
  // load* for a returning user (App.tsx), so with the default of 5 a handful of
  // reloads from one egress IP locked real people out of a running
  // retrospective for fifteen minutes — and since the limiter is per pod, the
  // ceiling was neither predictable nor generous.
  //
  // `requestWasSuccessful` narrows the meter to 401 alone, so nothing a
  // legitimate user can do ever counts: a restored session (200), a page load
  // with no stored token (400), a team deleted since (404), a facilitator
  // colliding on an existing team name (409). What remains metered is exactly
  // what the limiter exists for — an anonymous prober guessing session tokens,
  // each guess costing a data-store read (CodeQL `js/missing-rate-limiting`).
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: authLimiterMax,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const teamName = typeof req.body?.teamName === 'string' ? req.body.teamName.toLowerCase() : '';
      return `${ipKeyGenerator(req)}:${teamName}`;
    }
  });

  const teamReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: teamReadLimiterMax,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  const teamWriteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });
  const { sanitizeTeamForClient, authenticateTeam, atomicUpdateTeam } = teamService;

  app.post('/api/team/login', loginLimiter, async (req, res) => {
    try {
      const { teamName, password, inviteCredential } = req.body || {};

      // A missing/blank team name simply resolves to no team below and is
      // reported as team_not_found. There is deliberately no early
      // `if (!teamName)` guard: an input-presence branch that tests a
      // request field before the credential verification is what CodeQL
      // (js/user-controlled-bypass) flags — the name never lets a caller
      // skip authentication, so the guard was a false-positive magnet with
      // no security value (the team lookup already validates the name).
      const index = await dataStore.loadTeamIndex();
      const teamId = index.get((teamName || '').toLowerCase());

      if (!teamId) {
        return res.status(401).json({ error: 'team_not_found' });
      }

      const team = await dataStore.loadTeam(teamId);

      if (!team) {
        return res.status(401).json({ error: 'team_not_found' });
      }

      // Both credential verifications always run — each one rejects a
      // missing/blank credential internally — so no user-supplied field
      // decides whether authentication executes. This is the fix for the
      // CodeQL js/user-controlled-bypass alert: the credential-presence check
      // below only selects the error response, it never gates the auth.
      //
      // Invite-credential joins (stage 7e): new invite links carry a signed,
      // team-scoped credential instead of the plaintext password. It must be
      // minted for this exact team and for the team's current invite epoch —
      // a password rotation bumps the epoch and revokes every older link.
      const inviteClaims = tokenService.validateInviteCredential(inviteCredential);
      const inviteAuthenticated = !!inviteClaims &&
        inviteClaims.teamId === team.id &&
        inviteClaims.epoch === getTeamInviteEpoch(team);

      // Dual-verify (stage 7c): hashed records verify via scrypt, legacy
      // plaintext records via constant-time compare and are upgraded to a
      // hash on this successful login (rehash-on-login). Old invite links
      // that embed the plaintext password keep joining through this path
      // until stage 7d retires it.
      const passwordAuthenticated = await teamService.verifyTeamPassword(team, password);

      if (!inviteAuthenticated && !passwordAuthenticated) {
        // Auth already ran and failed above; this only picks the status code.
        if (!password && !inviteCredential) {
          return res.status(400).json({ error: 'missing_credentials' });
        }
        return res.status(401).json({
          error: password ? 'invalid_password' : 'invalid_invite_credential'
        });
      }

      const sessionToken = tokenService.createSessionToken(team.id, null);

      res.json({
        team: sanitizeTeamForClient(team),
        sessionToken
      });
    } catch (err) {
      console.error('[Server] Failed to login team', err);
      res.status(500).json({ error: 'login_failed' });
    }
  });

  app.post('/api/team/restore-session', authLimiter, async (req, res) => {
    try {
      const { sessionToken } = req.body || {};

      if (!sessionToken) {
        return res.status(400).json({ error: 'missing_token' });
      }

      const session = tokenService.validateSessionToken(sessionToken);
      if (!session) {
        return res.status(401).json({ error: 'invalid_or_expired_token' });
      }

      const team = await dataStore.loadTeam(session.teamId);

      if (!team) {
        tokenService.invalidateSessionToken(sessionToken);
        return res.status(404).json({ error: 'team_not_found' });
      }

      // Stage 7e: the password is never echoed back, even for legacy
      // plaintext records. Restored sessions no longer need it — invite
      // links are minted from a server-derived invite credential and
      // changing the team password prompts for the current one.
      res.json({
        team: sanitizeTeamForClient(team)
      });
    } catch (err) {
      console.error('[Server] Failed to restore session', err);
      res.status(500).json({ error: 'restore_failed' });
    }
  });

  app.post('/api/team/create', authLimiter, async (req, res) => {
    try {
      const { name, password, facilitatorEmail } = req.body || {};

      if (typeof name !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'missing_fields' });
      }

      // The rename path below trims; creation must too, or the two disagree
      // about what the same name means. Untrimmed, "Alpha " and "Alpha" are
      // two distinct index keys — two teams that render identically in the
      // login picker — and a whitespace-only name satisfies the form's
      // `required` attribute and creates a team with a blank label.
      const trimmedName = name.trim();

      if (!trimmedName || !password) {
        return res.status(400).json({ error: 'missing_fields' });
      }

      // Audit H39 — one minimum, read from `utils/passwordPolicy.js` rather
      // than restated here. The rule binds on write only: `/api/team/login`
      // deliberately never consults it, so a team whose password predates the
      // rule keeps authenticating (decision D18, option (a)).
      if (!isPasswordLongEnough(password)) {
        return res.status(400).json({ error: PASSWORD_TOO_SHORT_ERROR });
      }

      const newTeam = {
        // The team id is embedded as a claim in issued session tokens, so it
        // must not come from Math.random() (CodeQL js/insecure-randomness).
        id: randomBytes(5).toString('hex'),
        name: trimmedName,
        passwordHash: await hashPassword(password),
        facilitatorEmail: facilitatorEmail || undefined,
        members: [
          {
            id: 'admin-' + randomBytes(3).toString('hex'),
            name: 'Facilitator',
            color: 'bg-indigo-500',
            role: 'facilitator'
          }
        ],
        archivedMembers: [],
        customTemplates: [],
        retrospectives: [],
        globalActions: []
      };

      const nameKey = trimmedName.toLowerCase();
      try {
        await dataStore.atomicTeamIndexUpdate((index) => {
          if (index.has(nameKey)) {
            return null;
          }
          index.set(nameKey, newTeam.id);
          return index;
        });

        const currentIndex = await dataStore.loadTeamIndex();
        if (currentIndex.get(nameKey) !== newTeam.id) {
          return res.status(409).json({ error: 'team_name_exists' });
        }
      } catch {
        return res.status(409).json({ error: 'team_name_exists' });
      }

      try {
        await dataStore.saveTeam(newTeam.id, newTeam);
      } catch (saveErr) {
        // Compensating release, in the spirit of the rename rollback below.
        // The name is claimed in the index *before* the record exists, so a
        // failed write here would otherwise leave a claim pointing at nothing:
        // creation answers 409 from the index alone, login resolves an id whose
        // record is missing (401), and `/api/team/list` scans records so the
        // team is not even visible. The name would be unusable for good, with
        // no route back from the UI.
        //
        // Keyed on our own id: a concurrent creation that legitimately won the
        // name must never be evicted by our cleanup.
        await dataStore.atomicTeamIndexUpdate((index) => {
          if (index.get(nameKey) !== newTeam.id) {
            return null;
          }
          index.delete(nameKey);
          return index;
        }).catch((rollbackErr) => {
          console.error('[Server] Failed to release team-index claim after create failure', rollbackErr);
        });
        throw saveErr;
      }

      if (mailerService.smtpEnabled && mailerService.mailer) {
        try {
          const settings = await dataStore.loadGlobalSettings();
          if (settings.notifyNewTeam && settings.adminEmail) {
            const safeTeamName = escapeHtml(newTeam.name);
            const createdAt = new Date().toLocaleString();
            await mailerService.mailer.sendMail({
              from: process.env.FROM_EMAIL || process.env.SMTP_USER,
              to: settings.adminEmail,
              subject: `New team created: ${newTeam.name}`,
              html: `
              <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #334155;">New Team Created</h2>
                <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0;">
                  <p style="margin: 0 0 8px 0;"><strong>Team name:</strong> ${safeTeamName}</p>
                  <p style="margin: 0 0 8px 0;"><strong>Team ID:</strong> ${newTeam.id}</p>
                  <p style="margin: 0;"><strong>Created at:</strong> ${createdAt}</p>
                </div>
                <p style="color: #64748b; font-size: 12px;">This is an automated notification from RetroGemini.</p>
              </div>
            `,
              text: `New team created:\n\nTeam name: ${newTeam.name}\nTeam ID: ${newTeam.id}\nCreated at: ${createdAt}`
            });
            logService.addServerLog('info', 'email', `New team notification sent to ${settings.adminEmail} for team: ${newTeam.name}`);
          }
        } catch (emailErr) {
          logService.addServerLog('warn', 'email', `Failed to send new team notification: ${emailErr.message}`);
        }
      }

      return res.status(201).json({
        team: sanitizeTeamForClient(newTeam),
        sessionToken: tokenService.createSessionToken(newTeam.id, null)
      });
    } catch (err) {
      console.error('[Server] Failed to create team', err);
      res.status(500).json({ error: 'failed_to_create' });
    }
  });

  app.get('/api/team/list', teamReadLimiter, async (_req, res) => {
    try {
      // Summary projection avoids deserializing every team's full retro history
      // just to render the login screen's team picker.
      const summaries = await dataStore.loadTeamSummaries();
      const teamList = summaries
        .map((team) => ({
          id: team.id,
          name: team.name,
          memberCount: Array.isArray(team.members) ? team.members.length : 0,
          lastConnectionDate: team.lastConnectionDate
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      res.json({ teams: teamList });
    } catch (err) {
      console.error('[Server] Failed to list teams', err);
      res.status(500).json({ error: 'failed_to_list' });
    }
  });

  app.post('/api/team/:teamId', teamReadLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      res.json({
        team: sanitizeTeamForClient(team)
      });
    } catch (err) {
      console.error('[Server] Failed to get team', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  // Stage 7e: any authenticated session (password or session token) can
  // derive the team's current invite credential on demand. The credential is
  // what invite links embed instead of the plaintext password, so a restored
  // token-only session keeps minting working links without the client ever
  // persisting the password again.
  app.post('/api/team/:teamId/invite-credential', teamReadLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      res.json({
        inviteCredential: tokenService.createInviteCredential(team.id, getTeamInviteEpoch(team))
      });
    } catch (err) {
      console.error('[Server] Failed to create invite credential', err);
      res.status(500).json({ error: 'failed_to_create' });
    }
  });

  app.post('/api/team/:teamId/update', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken, updates } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'invalid_updates' });
      }

      // inviteEpoch is stripped like passwordHash: letting a client write it
      // back could restore an older epoch and re-validate invite links that a
      // password rotation revoked.
      const { passwordHash: _ignoredHash, id: _ignoredId, inviteEpoch: _ignoredEpoch, ...safeUpdates } = updates;

      // Claim the new name, keep the old one until the record write lands.
      //
      // The reverse — freeing the old key in the same write that claims the new
      // one — is what made the rollback below dangerous. For the width of the
      // record write the old name was unclaimed, so a concurrent creation or
      // rename could legitimately take it, and the rollback then *restored* it
      // unconditionally: the winner kept its record and lost its name, reachable
      // by nothing (`/api/team/login` resolves the other team, and no UI can
      // free the name again). The same rollback pointed the old name at a
      // deleted record when a deletion landed in that window. Both are the
      // terminal state invariant 15 exists to prevent, and both come from a
      // compensating write that *widens* the index — see the deletion path
      // below, and `server/services/teamNameIndex.js`.
      //
      // With the claim first, every failure path only removes a mapping this
      // request added itself: the team is reachable under its old name
      // throughout, and the old key is freed only once the record carries the
      // new name.
      let claimedNameKey = null;
      let nameKeysToRelease = [];
      // Audit H45. Compared against the *stored* name rather than against the
      // index key: a change of casing alone keeps the same key but is still a
      // rename the user sees, and it is the displayed name an investigation is
      // reconciling. Every dashboard edit — a member added, an action closed —
      // comes through this route, so recording anything broader would bury the
      // real renames.
      let renamedTo = null;
      if (Object.prototype.hasOwnProperty.call(safeUpdates, 'name')) {
        const requestedName = typeof safeUpdates.name === 'string' ? safeUpdates.name.trim() : '';
        if (!requestedName) {
          return res.status(400).json({ error: 'team_name_empty' });
        }
        safeUpdates.name = requestedName;
        if (requestedName !== team.name) renamedTo = requestedName;

        const oldNameKey = (team.name || '').toLowerCase();
        const newNameKey = requestedName.toLowerCase();

        // A rename that only changes the casing keeps the same key: there is
        // nothing to claim, and nothing to release afterwards — releasing it
        // would delete the team's only mapping.
        if (newNameKey !== oldNameKey) {
          const claim = await claimTeamNameKey(dataStore, teamId, newNameKey);
          if (!claim.claimed) {
            return res.status(409).json({ error: 'team_name_exists' });
          }
          // Only a claim this request *added* may be taken back on failure: the
          // name can already be the team's own — a retry after a lost release —
          // and releasing it then would drop a mapping this request never made.
          claimedNameKey = claim.added ? newNameKey : null;
          // Every other key the team held, not just the current name. A rename
          // whose final release was lost leaves an alias behind, and releasing
          // the old name alone left it claimed for good: nobody else could ever
          // take that name, and it kept resolving to the team (Codex, PR #413).
          nameKeysToRelease = claim.previousKeys;
        }
      }

      const result = await atomicUpdateTeam(teamId, (currentTeam) => ({
        ...currentTeam,
        ...safeUpdates,
        id: currentTeam.id,
        passwordHash: currentTeam.passwordHash,
        inviteEpoch: getTeamInviteEpoch(currentTeam)
      }));

      if (!result.success) {
        if (claimedNameKey) {
          // Release only what this request claimed. The team never stopped
          // holding its old name, so there is nothing to restore.
          await releaseTeamNameKey(dataStore, teamId, claimedNameKey).catch((releaseErr) => {
            console.error('[Server] Failed to release team-index claim after update failure', releaseErr);
          });
        }
        return res.status(500).json({ error: result.error });
      }

      if (nameKeysToRelease.length > 0) {
        // The record now carries the new name, so every key the team held before
        // is free to give up. If this write is lost the team simply answers to
        // its old names too until the next rename or deletion sweeps them —
        // reachable either way, and every mapping still points at a record that
        // exists, which is the property that matters.
        await releaseTeamNameKeys(dataStore, teamId, nameKeysToRelease).catch((releaseErr) => {
          console.error('[Server] Failed to release the previous team names from the index', releaseErr);
        });
      }

      if (renamedTo) {
        await securityEvents.record(req, {
          action: SECURITY_ACTIONS.TEAM_RENAME,
          actor: `team:${teamId}`,
          outcome: 'success',
          target: teamId,
          detail: { from: team.name, to: renamedTo }
        });
      }

      res.json({
        team: sanitizeTeamForClient(result.team)
      });
    } catch (err) {
      console.error('[Server] Failed to update team', err);
      res.status(500).json({ error: 'failed_to_update' });
    }
  });

  app.post('/api/team/:teamId/retrospective/:retroId', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId, retroId } = req.params;
      const { password, sessionToken, retrospective } = req.body || {};

      const { error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      if (!retrospective) {
        return res.status(400).json({ error: 'missing_retrospective' });
      }

      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        if (!currentTeam.retrospectives) currentTeam.retrospectives = [];

        const idx = currentTeam.retrospectives.findIndex((r) => r.id === retroId);
        if (idx !== -1) {
          // Rev guard: this HTTP persist is the second way a stale client blob
          // can clobber a live retro. If the incoming copy was built on an
          // older session revision than the one already stored, keep the newer
          // stored copy (skip the write). Only applies when both sides carry a
          // numeric _rev, so non-session edits are unaffected.
          const existingRev = Number(currentTeam.retrospectives[idx]?._rev);
          const incomingRev = Number(retrospective?._rev);
          if (Number.isFinite(existingRev) && Number.isFinite(incomingRev) && incomingRev < existingRev) {
            return null;
          }
          const merged = { ...retrospective, id: retroId, teamId };
          // Closed-action guard (mirrors reconcileRetroActionState on the
          // client): closing an action is done through /api/team/:teamId/action,
          // which does NOT advance the retro _rev, so a full-retro persist built
          // by a client that never saw the close would pass the rev guard above
          // and silently re-open it. Keep the stored `done: true` for any action
          // this blob still reports as open. Only that one transition is guarded
          // — a legitimate re-open goes through /action first (stored becomes
          // open, so the guard is a no-op); assignee/text and proposals are left
          // to the incoming blob.
          const storedActions = currentTeam.retrospectives[idx]?.actions;
          if (Array.isArray(merged.actions) && Array.isArray(storedActions)) {
            const storedById = new Map(storedActions.map((a) => [a.id, a]));
            merged.actions = merged.actions.map((a) => {
              if (!a || a.type === 'proposal') return a;
              const stored = storedById.get(a.id);
              if (stored && stored.type !== 'proposal' && stored.done && !a.done) {
                return { ...a, done: true };
              }
              return a;
            });
          }
          currentTeam.retrospectives[idx] = merged;
        } else {
          currentTeam.retrospectives.unshift({ ...retrospective, id: retroId, teamId });
        }

        return currentTeam;
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update retrospective', err);
      res.status(500).json({ error: 'failed_to_update' });
    }
  });

  app.post('/api/team/:teamId/healthcheck/:hcId', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId, hcId } = req.params;
      const { password, sessionToken, healthCheck } = req.body || {};

      const { error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      if (!healthCheck) {
        return res.status(400).json({ error: 'missing_healthcheck' });
      }

      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        if (!currentTeam.healthChecks) currentTeam.healthChecks = [];

        const idx = currentTeam.healthChecks.findIndex((h) => h.id === hcId);
        if (idx !== -1) {
          // Rev guard (see the retrospective handler): drop a stale HTTP persist
          // so an out-of-date client blob can't overwrite a newer health check.
          const existingRev = Number(currentTeam.healthChecks[idx]?._rev);
          const incomingRev = Number(healthCheck?._rev);
          if (Number.isFinite(existingRev) && Number.isFinite(incomingRev) && incomingRev < existingRev) {
            return null;
          }
          currentTeam.healthChecks[idx] = { ...healthCheck, id: hcId, teamId };
        } else {
          currentTeam.healthChecks.unshift({ ...healthCheck, id: hcId, teamId });
        }

        return currentTeam;
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update health check', err);
      res.status(500).json({ error: 'failed_to_update' });
    }
  });

  /**
   * Renaming a retrospective or a health check is its own endpoint for the same
   * reason closing an action is (audit H35, reported from the field: renamed
   * retros went back to their original title).
   *
   * The Dashboard used to rename by persisting the **whole** blob through
   * `/retrospective/:retroId`, carrying whatever `_rev` its cached copy held.
   * Any retro that was actually run has had its stored revision advanced by the
   * live session since the Dashboard loaded, so that blob is stale by
   * definition and the rev guard dropped the entire write — correctly, on the
   * wrong payload. The route then answered `{ success: true }`, because an
   * aborted updater reads as "nothing to change", and the client persist is
   * fire-and-forget, so nothing reported a problem.
   *
   * A granular write carries no `_rev` and touches one field, so there is
   * nothing for the guard to reject and nothing for it to protect. It
   * deliberately does **not** bump the stored revision either: a title change
   * must not make every live client lose its next optimistic-concurrency race.
   */
  const registerRenameRoute = (path, collection, notFoundError) => {
    app.post(path, teamWriteLimiter, async (req, res) => {
      try {
        const { teamId, targetId } = req.params;
        const { password, sessionToken, name } = req.body || {};

        const { error } = await authenticateTeam(teamId, password, sessionToken);

        if (error) {
          return res.status(401).json({ error });
        }

        // Trimmed and required, like the team-name paths (invariant 16): an
        // empty or whitespace-only title satisfies the form's `required`
        // attribute but leaves an unidentifiable entry on the Dashboard.
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (!trimmed) {
          return res.status(400).json({ error: 'missing_name' });
        }

        // Audit H34: success follows the write. The updater aborts when the id
        // matches nothing, which the store reports as "nothing to change" —
        // indistinguishable from a rename that landed unless we track it. A
        // rename to the name it already has is a *found* target, so it stays a
        // success rather than becoming a 404.
        let found = false;
        const result = await atomicUpdateTeam(teamId, (currentTeam) => {
          found = false;
          const list = currentTeam[collection];
          if (!Array.isArray(list)) return null;
          const idx = list.findIndex((entry) => entry && entry.id === targetId);
          if (idx === -1) return null;
          found = true;
          if (list[idx].name === trimmed) return null;
          list[idx].name = trimmed;
          return currentTeam;
        });

        if (!result.success) {
          return res.status(500).json({ error: result.error });
        }

        if (!found) {
          return res.status(404).json({ error: notFoundError });
        }

        res.json({ success: true });
      } catch (err) {
        console.error('[Server] Failed to rename session', err);
        res.status(500).json({ error: 'failed_to_update' });
      }
    });
  };

  registerRenameRoute(
    '/api/team/:teamId/retrospective/:targetId/name',
    'retrospectives',
    'retrospective_not_found'
  );
  registerRenameRoute(
    '/api/team/:teamId/healthcheck/:targetId/name',
    'healthChecks',
    'healthcheck_not_found'
  );

  app.post('/api/team/:teamId/action', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken, action, retroId, healthCheckId } = req.body || {};

      const { error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      if (!action || !action.id) {
        return res.status(400).json({ error: 'missing_action' });
      }

      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        if (!currentTeam.globalActions) currentTeam.globalActions = [];

        const globalIdx = currentTeam.globalActions.findIndex((a) => a.id === action.id);
        if (globalIdx !== -1) {
          currentTeam.globalActions[globalIdx] = { ...action };
          return currentTeam;
        }

        if (retroId && currentTeam.retrospectives) {
          const retro = currentTeam.retrospectives.find((r) => r.id === retroId);
          if (retro && retro.actions) {
            const retroActionIdx = retro.actions.findIndex((a) => a.id === action.id);
            if (retroActionIdx !== -1) {
              retro.actions[retroActionIdx] = { ...action };
              return currentTeam;
            }
          }
        }

        if (healthCheckId && currentTeam.healthChecks) {
          const hc = currentTeam.healthChecks.find((h) => h.id === healthCheckId);
          if (hc && hc.actions) {
            const hcActionIdx = hc.actions.findIndex((a) => a.id === action.id);
            if (hcActionIdx !== -1) {
              hc.actions[hcActionIdx] = { ...action };
              return currentTeam;
            }
          }
        }

        currentTeam.globalActions.unshift(action);
        return currentTeam;
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update action', err);
      res.status(500).json({ error: 'failed_to_update' });
    }
  });

  app.post('/api/team/:teamId/members', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken, members, archivedMembers } = req.body || {};

      const { error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        if (members !== undefined) {
          currentTeam.members = members;
        }
        if (archivedMembers !== undefined) {
          currentTeam.archivedMembers = archivedMembers;
        }
        return currentTeam;
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({
        team: sanitizeTeamForClient(result.team)
      });
    } catch (err) {
      console.error('[Server] Failed to update members', err);
      res.status(500).json({ error: 'failed_to_update' });
    }
  });

  app.post('/api/team/:teamId/password', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, newPassword } = req.body || {};

      // Changing the credential requires the current credential: a session
      // token is deliberately not accepted here, so a leaked or stolen token
      // can never rotate the team password and durably take over the team
      // (stage-7c resolution of the open decision recorded after stage 7b).
      const { error } = await authenticateTeam(teamId, password, undefined);

      if (error) {
        return res.status(401).json({ error });
      }

      // Audit H39. Deliberately *after* `authenticateTeam` above: the policy
      // must not answer 400 to a caller who has not proved it holds the current
      // credential, or the route tells an anonymous prober which passwords the
      // rule would accept.
      if (!isPasswordLongEnough(newPassword)) {
        return res.status(400).json({ error: PASSWORD_TOO_SHORT_ERROR });
      }

      const newPasswordHash = await hashPassword(newPassword);
      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        currentTeam.passwordHash = newPasswordHash;
        // Rotating the password revokes every outstanding invite link by
        // bumping the invite epoch (stage 7e) — matching the pre-7e behavior
        // where rotation broke links because they embedded the old password.
        currentTeam.inviteEpoch = getTeamInviteEpoch(currentTeam) + 1;
        return currentTeam;
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.TEAM_PASSWORD_CHANGE,
        actor: `team:${teamId}`,
        outcome: 'success',
        target: teamId
      });
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to change password', err);
      res.status(500).json({ error: 'failed_to_update' });
    }
  });

  app.post('/api/team/:teamId/delete', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      if (team.teamFeedbacks && team.teamFeedbacks.length > 0) {
        const feedbacksToPreserve = team.teamFeedbacks.map((f) => ({
          ...f,
          teamId: f.teamId || team.id,
          teamName: f.teamName || team.name
        }));
        await dataStore.atomicMetaUpdate((meta) => {
          if (!Array.isArray(meta.orphanedFeedbacks)) {
            meta.orphanedFeedbacks = [];
          }
          // Upsert by feedback id, not append: deletion is several store writes
          // with no transaction around them, so any failure after this point
          // leaves the client to retry. An unconditional push preserved every
          // feedback twice per retry — `/api/feedbacks/all` concatenates team
          // feedbacks with orphaned ones, so the duplicates show on the board,
          // and every writer resolves an orphan by first match, so only one
          // copy of the pair would ever be updated again.
          //
          // *Replacing* rather than skipping matters just as much (Codex, PR
          // #407): between a failed attempt and the retry the team is still
          // live, and every feedback writer — the comment routes here and the
          // super-admin status/comment/delete routes — looks in the team record
          // first and only falls back to `orphanedFeedbacks`. So any change in
          // that window lands on the *live* copy, and skipping an already-
          // preserved id would freeze the stale snapshot taken by the first
          // attempt and lose those changes when the record goes.
          const liveById = new Map(feedbacksToPreserve.map((f) => [f.id, f]));
          const merged = meta.orphanedFeedbacks.map((existing) => {
            const live = existing && liveById.get(existing.id);
            if (!live) return existing;
            liveById.delete(existing.id);
            return live;
          });
          merged.push(...liveById.values());
          meta.orphanedFeedbacks = merged;
          return meta;
        });
      }

      // Index entry first, record second — and on this path the index is only
      // ever *narrowed*, never widened. Both halves of that are load-bearing.
      //
      // Order: the reverse — record first — left the name resolving to nothing
      // when the index write failed: unusable for creation (409 straight from
      // the index), unusable for login (401 once the record lookup fails), and
      // beyond the reach of a retry, which can no longer authenticate against
      // the team it is deleting. This order leaves the record intact, so a
      // retry authenticates and completes, and the name is free either way.
      //
      // No rollback: restoring the entry when `deleteTeamRecord` fails looks
      // tidier and reintroduces exactly the state above (Codex, PR #407). Two
      // overlapping deletions are enough — A clears the entry and its record
      // delete fails; B sees no entry, deletes the record, succeeds; A then
      // restores a mapping to a record that no longer exists, and the name is
      // bricked for good. No re-check closes it, because the record can vanish
      // between the check and the write. So the rule is structural rather than
      // conditional: a deletion never adds a mapping. The cost is that an
      // un-retried failure leaves a record with no index entry — visible in
      // `/api/team/list`, not reachable by login — which is repairable by
      // retrying, unlike the state the rollback could produce.
      //
      // Every key, not the first match: a rename in flight holds two keys for
      // one team, and one whose final release was lost holds two for good.
      // Stopping at the first left the other pointing at the record this is
      // about to delete.
      await releaseAllTeamNameKeys(dataStore, teamId);

      await dataStore.deleteTeamRecord(teamId);

      await securityEvents.record(req, {
        action: SECURITY_ACTIONS.TEAM_DELETE,
        actor: `team:${teamId}`,
        outcome: 'success',
        target: teamId,
        detail: { name: team.name }
      });
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to delete team', err);
      res.status(500).json({ error: 'failed_to_delete' });
    }
  });

  // Audit H5: unauthenticated and it reads the team index on every call, so it
  // shares the read budget of its sibling anonymous index read,
  // `/api/team/list` — one budget an attacker cannot double by alternating.
  app.get('/api/team/exists/:teamName', teamReadLimiter, async (req, res) => {
    try {
      // Express already percent-decodes route parameters, so decoding again
      // here was a *second* decode. It threw `URIError` on any name holding a
      // bare `%` — answered 500, which `dataService.renameTeam` surfaces as
      // "please try again", forever, so no team could ever be renamed to
      // "Sprint 50%" — and it silently answered about a different name whenever
      // a decoded name still looked encoded ("a%20b" was checked as "a b").
      // Trimmed for the same reason creation and rename trim: the three must
      // agree on what a given name resolves to.
      const { teamName } = req.params;
      const index = await dataStore.loadTeamIndex();
      const exists = index.has(teamName.trim().toLowerCase());
      res.json({ exists });
    } catch (err) {
      console.error('[Server] Failed to check team existence', err);
      res.status(500).json({ error: 'check_failed' });
    }
  });
};

export { registerTeamRoutes };
