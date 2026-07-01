import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const registerTeamRoutes = ({
  app,
  dataStore,
  teamService,
  tokenService,
  mailerService,
  logService,
  escapeHtml
}) => {
  // Allow tests / development to raise the auth-write limiter via env var
  // without affecting production defaults.
  const authLimiterMax = (() => {
    const raw = process.env.AUTH_RATE_LIMIT_MAX;
    if (!raw) return 5;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  })();

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: authLimiterMax,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false
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
    max: 120,
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
      const { teamName, password } = req.body || {};

      if (!teamName || !password) {
        return res.status(400).json({ error: 'missing_credentials' });
      }

      const index = await dataStore.loadTeamIndex();
      const teamId = index.get(teamName.toLowerCase());

      if (!teamId) {
        return res.status(401).json({ error: 'team_not_found' });
      }

      const team = await dataStore.loadTeam(teamId);

      if (!team) {
        return res.status(401).json({ error: 'team_not_found' });
      }

      if (team.passwordHash !== password) {
        return res.status(401).json({ error: 'invalid_password' });
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

      res.json({
        team: sanitizeTeamForClient(team),
        password: team.passwordHash
      });
    } catch (err) {
      console.error('[Server] Failed to restore session', err);
      res.status(500).json({ error: 'restore_failed' });
    }
  });

  app.post('/api/team/create', authLimiter, async (req, res) => {
    try {
      const { name, password, facilitatorEmail } = req.body || {};

      if (!name || !password) {
        return res.status(400).json({ error: 'missing_fields' });
      }

      if (password.length < 4) {
        return res.status(400).json({ error: 'password_too_short' });
      }

      const newTeam = {
        id: Math.random().toString(36).substr(2, 9),
        name,
        passwordHash: password,
        facilitatorEmail: facilitatorEmail || undefined,
        members: [
          {
            id: 'admin-' + Math.random().toString(36).substr(2, 5),
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

      const nameKey = name.toLowerCase();
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

      await dataStore.saveTeam(newTeam.id, newTeam);

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
        team: sanitizeTeamForClient(newTeam)
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
      const { password } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password);

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

  app.post('/api/team/:teamId/update', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, updates } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password);

      if (error) {
        return res.status(401).json({ error });
      }

      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'invalid_updates' });
      }

      const { passwordHash: _ignoredHash, id: _ignoredId, ...safeUpdates } = updates;

      let renamedTo = null;
      if (Object.prototype.hasOwnProperty.call(safeUpdates, 'name')) {
        const requestedName = typeof safeUpdates.name === 'string' ? safeUpdates.name.trim() : '';
        if (!requestedName) {
          return res.status(400).json({ error: 'team_name_empty' });
        }
        safeUpdates.name = requestedName;

        const oldNameKey = (team.name || '').toLowerCase();
        const newNameKey = requestedName.toLowerCase();

        if (newNameKey !== oldNameKey) {
          let indexConflict = false;
          await dataStore.atomicTeamIndexUpdate((index) => {
            if (index.has(newNameKey) && index.get(newNameKey) !== teamId) {
              indexConflict = true;
              return null;
            }
            index.delete(oldNameKey);
            index.set(newNameKey, teamId);
            return index;
          });

          if (indexConflict) {
            return res.status(409).json({ error: 'team_name_exists' });
          }

          renamedTo = { oldNameKey, newNameKey };
        }
      }

      const result = await atomicUpdateTeam(teamId, (currentTeam) => ({
        ...currentTeam,
        ...safeUpdates,
        id: currentTeam.id,
        passwordHash: currentTeam.passwordHash
      }));

      if (!result.success) {
        if (renamedTo) {
          // Roll back the index change so the team stays reachable under its
          // previous name.
          await dataStore.atomicTeamIndexUpdate((index) => {
            if (index.get(renamedTo.newNameKey) === teamId) {
              index.delete(renamedTo.newNameKey);
            }
            index.set(renamedTo.oldNameKey, teamId);
            return index;
          }).catch((rollbackErr) => {
            console.error('[Server] Failed to roll back team-index after update failure', rollbackErr);
          });
        }
        return res.status(500).json({ error: result.error });
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
      const { password, retrospective } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password);

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
          currentTeam.retrospectives[idx] = { ...retrospective, id: retroId, teamId };
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
      const { password, healthCheck } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password);

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

  app.post('/api/team/:teamId/action', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, action, retroId, healthCheckId } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password);

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
      const { password, members, archivedMembers } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password);

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

      const { team, error } = await authenticateTeam(teamId, password);

      if (error) {
        return res.status(401).json({ error });
      }

      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: 'password_too_short' });
      }

      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        currentTeam.passwordHash = newPassword;
        return currentTeam;
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to change password', err);
      res.status(500).json({ error: 'failed_to_update' });
    }
  });

  app.post('/api/team/:teamId/delete', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password } = req.body || {};

      const { team, error } = await authenticateTeam(teamId, password);

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
          meta.orphanedFeedbacks.push(...feedbacksToPreserve);
          return meta;
        });
      }

      await dataStore.deleteTeamRecord(teamId);

      await dataStore.atomicTeamIndexUpdate((index) => {
        for (const [k, v] of index.entries()) {
          if (v === teamId) {
            index.delete(k);
            break;
          }
        }
        return index;
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to delete team', err);
      res.status(500).json({ error: 'failed_to_delete' });
    }
  });

  app.get('/api/team/exists/:teamName', async (req, res) => {
    try {
      const { teamName } = req.params;
      const index = await dataStore.loadTeamIndex();
      const exists = index.has(decodeURIComponent(teamName).toLowerCase());
      res.json({ exists });
    } catch (err) {
      console.error('[Server] Failed to check team existence', err);
      res.status(500).json({ error: 'check_failed' });
    }
  });
};

export { registerTeamRoutes };
