import express from 'express';
import { gzipSync, gunzipSync } from 'zlib';
import rateLimit from 'express-rate-limit';

const registerSuperAdminRoutes = ({
  app,
  io,
  dataStore,
  tokenService,
  mailerService,
  logService,
  escapeHtml,
  superAdminPassword,
  sessionCache,
  backupService,
  aiService
}) => {
  const shouldSkipSuperAdminLimit = () => !superAdminPassword;

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkipSuperAdminLimit
  });

  const superAdminActionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkipSuperAdminLimit
  });

  const superAdminPollingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'too_many_attempts', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });
  app.post('/api/super-admin/verify', authLimiter, (req, res) => {
    const { password } = req.body || {};

    if (!superAdminPassword) {
      return res.status(503).json({ error: 'super_admin_not_configured' });
    }

    if (tokenService.validateSuperAdminAuth({ password })) {
      const sessionToken = tokenService.createSuperAdminToken();
      return res.json({ success: true, sessionToken });
    }

    return res.status(401).json({ error: 'invalid_password' });
  });

  app.post('/api/super-admin/validate-session', authLimiter, (req, res) => {
    const { sessionToken } = req.body || {};

    if (!superAdminPassword) {
      return res.status(503).json({ error: 'super_admin_not_configured' });
    }

    if (!sessionToken || !tokenService.validateSuperAdminToken(sessionToken)) {
      return res.status(401).json({ error: 'invalid_or_expired_token' });
    }

    return res.json({ success: true });
  });

  app.post('/api/super-admin/teams', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const teams = await dataStore.loadAllTeams();
      const sanitizedTeams = teams.map((t) => ({
        id: t.id,
        name: t.name,
        facilitatorEmail: t.facilitatorEmail,
        members: (t.members || []).map((m) => ({ id: m.id, name: m.name, color: m.color, role: m.role })),
        lastConnectionDate: t.lastConnectionDate
      }));
      res.json({ teams: sanitizedTeams });
    } catch (err) {
      console.error('[Server] Failed to load persisted data', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.post('/api/super-admin/feedbacks', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const teams = await dataStore.loadAllTeams();
      const meta = await dataStore.loadMetaData();

      const feedbacks = teams.flatMap((team) =>
        (team.teamFeedbacks || []).map((feedback) => ({
          ...feedback,
          teamId: feedback.teamId || team.id,
          teamName: feedback.teamName || team.name,
          isRead: feedback.isRead ?? false,
          status: feedback.status || 'pending'
        }))
      );
      const orphaned = (meta.orphanedFeedbacks || []).map((feedback) => ({
        ...feedback,
        isRead: feedback.isRead ?? false,
        status: feedback.status || 'pending'
      }));
      feedbacks.push(...orphaned);
      feedbacks.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      res.json({ feedbacks });
    } catch (err) {
      console.error('[Server] Failed to load feedbacks', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.post('/api/super-admin/update-email', superAdminActionLimiter, async (req, res) => {
    const { teamId, facilitatorEmail } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!teamId) {
      return res.status(400).json({ error: 'missing_team_id' });
    }

    try {
      const result = await dataStore.atomicTeamUpdate(teamId, (team) => {
        team.facilitatorEmail = facilitatorEmail || undefined;
        return team;
      });
      if (!result.success) {
        return res.status(404).json({ error: 'team_not_found' });
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update email', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/feedbacks/update', superAdminActionLimiter, async (req, res) => {
    const { teamId, feedbackId, updates } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!teamId || !feedbackId || !updates) {
      return res.status(400).json({ error: 'missing_feedback_data' });
    }

    try {
      let statusChanged = false;
      let oldStatus = null;
      let newStatus = null;
      let feedbackTitle = null;
      let feedbackType = null;
      let teamEmail = null;
      let teamName = null;

      const team = await dataStore.loadTeam(teamId);
      let found = false;

      if (team && team.teamFeedbacks) {
        const feedback = team.teamFeedbacks.find((f) => f.id === feedbackId);
        if (feedback) {
          found = true;
          await dataStore.atomicTeamUpdate(teamId, (t) => {
            const fb = t.teamFeedbacks.find((f) => f.id === feedbackId);
            if (!fb) return null;

            if (updates.status && updates.status !== fb.status) {
              statusChanged = true;
              oldStatus = fb.status;
              newStatus = updates.status;
              feedbackTitle = fb.title;
              feedbackType = fb.type;
              teamEmail = t.facilitatorEmail;
              teamName = t.name;
            }

            Object.assign(fb, updates);
            if (!fb.teamName) fb.teamName = t.name;
            if (!fb.teamId) fb.teamId = t.id;
            return t;
          });
        }
      }

      if (!found) {
        await dataStore.atomicMetaUpdate((meta) => {
          if (!Array.isArray(meta.orphanedFeedbacks)) return null;
          const feedback = meta.orphanedFeedbacks.find((f) => f.id === feedbackId);
          if (!feedback) return null;

          if (updates.status && updates.status !== feedback.status) {
            statusChanged = true;
            oldStatus = feedback.status;
            newStatus = updates.status;
            feedbackTitle = feedback.title;
            feedbackType = feedback.type;
            teamName = feedback.teamName;
          }

          Object.assign(feedback, updates);
          if (!feedback.teamName) feedback.teamName = 'Deleted Team';
          if (!feedback.teamId) feedback.teamId = teamId;
          return meta;
        });
      }

      if (statusChanged && teamEmail && mailerService.smtpEnabled && mailerService.mailer) {
        const statusLabels = {
          pending: 'Pending',
          in_progress: 'In Progress',
          resolved: 'Resolved',
          rejected: 'Rejected'
        };
        const statusEmojis = {
          pending: '⏳',
          in_progress: '🔄',
          resolved: '✅',
          rejected: '❌'
        };
        const typeLabel = feedbackType === 'bug' ? 'Bug Report' : 'Feature Request';
        const safeFeedbackTitle = escapeHtml(feedbackTitle);
        const safeTeamName = escapeHtml(teamName);

        try {
          await mailerService.mailer.sendMail({
            from: process.env.FROM_EMAIL || process.env.SMTP_USER,
            to: teamEmail,
            subject: `${statusEmojis[newStatus]} Feedback Status Updated: ${feedbackTitle}`,
            text: `Hello ${teamName},

The status of your ${typeLabel} has been updated.

Title: ${feedbackTitle}
Previous Status: ${statusLabels[oldStatus]}
New Status: ${statusLabels[newStatus]}

---
This notification was sent because your feedback status was updated in RetroGemini.
`,
            html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #4f46e5;">
    ${statusEmojis[newStatus]} Feedback Status Updated
  </h2>
  <p>Hello <strong>${safeTeamName}</strong>,</p>
  <p>The status of your ${typeLabel} has been updated.</p>
  <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <h3 style="margin: 0 0 8px 0; color: #1e293b;">${safeFeedbackTitle}</h3>
    <p style="margin: 4px 0; color: #64748b; font-size: 14px;">
      <strong>Previous Status:</strong> <span style="color: #94a3b8;">${statusLabels[oldStatus]}</span><br>
      <strong>New Status:</strong> <span style="color: ${newStatus === 'resolved' ? '#16a34a' : newStatus === 'rejected' ? '#dc2626' : newStatus === 'in_progress' ? '#2563eb' : '#ca8a04'}; font-weight: bold;">${statusLabels[newStatus]}</span>
    </p>
  </div>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="color: #94a3b8; font-size: 12px;">
    This notification was sent because your feedback status was updated in RetroGemini.
  </p>
</div>
`
          });
          logService.addServerLog('info', 'email', `Feedback status notification sent to ${teamEmail} for: ${feedbackTitle}`);
        } catch (emailErr) {
          console.error('[Server] Failed to send feedback status notification email', emailErr);
          logService.addServerLog('warn', 'email', `Failed to send feedback status notification to ${teamEmail}: ${emailErr.message}`);
        }
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update feedback', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/feedbacks/delete', superAdminActionLimiter, async (req, res) => {
    const { teamId, feedbackId } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!teamId || !feedbackId) {
      return res.status(400).json({ error: 'missing_feedback_data' });
    }

    try {
      let feedbackTitle = null;
      let feedbackType = null;
      let teamEmail = null;
      let teamName = null;

      const team = await dataStore.loadTeam(teamId);
      let found = false;

      if (team && team.teamFeedbacks) {
        const feedback = team.teamFeedbacks.find((f) => f.id === feedbackId);
        if (feedback) {
          found = true;
          feedbackTitle = feedback.title;
          feedbackType = feedback.type;
          teamEmail = team.facilitatorEmail;
          teamName = team.name;
          await dataStore.atomicTeamUpdate(teamId, (t) => {
            t.teamFeedbacks = (t.teamFeedbacks || []).filter((f) => f.id !== feedbackId);
            return t;
          });
        }
      }

      if (!found) {
        await dataStore.atomicMetaUpdate((meta) => {
          if (!Array.isArray(meta.orphanedFeedbacks)) return null;
          const feedback = meta.orphanedFeedbacks.find((f) => f.id === feedbackId);
          if (!feedback) return null;
          feedbackTitle = feedback.title;
          feedbackType = feedback.type;
          teamName = feedback.teamName;
          meta.orphanedFeedbacks = meta.orphanedFeedbacks.filter((f) => f.id !== feedbackId);
          return meta;
        });
      }

      if (feedbackTitle && teamEmail && mailerService.smtpEnabled && mailerService.mailer) {
        const typeLabel = feedbackType === 'bug' ? 'Bug Report' : 'Feature Request';
        const safeFeedbackTitle = escapeHtml(feedbackTitle);
        const safeTeamName = escapeHtml(teamName);

        try {
          await mailerService.mailer.sendMail({
            from: process.env.FROM_EMAIL || process.env.SMTP_USER,
            to: teamEmail,
            subject: `🗑️ Feedback Deleted: ${feedbackTitle}`,
            text: `Hello ${teamName},

Your ${typeLabel} "${feedbackTitle}" has been deleted by the administrator.

If you have questions about this action, please contact the administrator.

---
This notification was sent from RetroGemini.
`,
            html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #dc2626;">🗑️ Feedback Deleted</h2>
  <p>Hello <strong>${safeTeamName}</strong>,</p>
  <p>Your ${typeLabel} "<strong>${safeFeedbackTitle}</strong>" has been deleted by the administrator.</p>
  <p>If you have questions about this action, please contact the administrator.</p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="color: #94a3b8; font-size: 12px;">This notification was sent from RetroGemini.</p>
</div>
`
          });
          logService.addServerLog('info', 'email', `Feedback deletion notification sent to ${teamEmail} for: ${feedbackTitle}`);
        } catch (emailErr) {
          console.error('[Server] Failed to send feedback deletion notification', emailErr);
        }
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to delete feedback', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/feedbacks/comment', superAdminActionLimiter, async (req, res) => {
    const { teamId, feedbackId, content } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!teamId || !feedbackId || !content) {
      return res.status(400).json({ error: 'missing_comment_data' });
    }

    try {
      let feedbackTitle = null;
      let feedbackType = null;
      let teamEmail = null;
      let teamName = null;

      const commentId = `comment_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newComment = {
        id: commentId,
        feedbackId,
        teamId: 'super-admin',
        teamName: 'Super Admin',
        authorId: 'super-admin',
        authorName: 'Super Admin',
        content: content.trim().slice(0, 1000),
        createdAt: new Date().toISOString(),
        isAdmin: true
      };

      const team = await dataStore.loadTeam(teamId);
      let found = false;

      if (team && team.teamFeedbacks) {
        const feedback = team.teamFeedbacks.find((f) => f.id === feedbackId);
        if (feedback) {
          found = true;
          feedbackTitle = feedback.title;
          feedbackType = feedback.type;
          teamEmail = team.facilitatorEmail;
          teamName = team.name;
          await dataStore.atomicTeamUpdate(teamId, (t) => {
            const fb = (t.teamFeedbacks || []).find((f) => f.id === feedbackId);
            if (!fb) return null;
            if (!fb.comments) fb.comments = [];
            fb.comments.push(newComment);
            return t;
          });
        }
      }

      if (!found) {
        await dataStore.atomicMetaUpdate((meta) => {
          if (!Array.isArray(meta.orphanedFeedbacks)) return null;
          const feedback = meta.orphanedFeedbacks.find((f) => f.id === feedbackId);
          if (!feedback) return null;
          feedbackTitle = feedback.title;
          feedbackType = feedback.type;
          teamName = feedback.teamName;
          if (!feedback.comments) feedback.comments = [];
          feedback.comments.push(newComment);
          return meta;
        });
      }

      if (feedbackTitle && teamEmail && mailerService.smtpEnabled && mailerService.mailer) {
        const typeLabel = feedbackType === 'bug' ? 'Bug Report' : 'Feature Request';
        const safeFeedbackTitle = escapeHtml(feedbackTitle);
        const safeTeamName = escapeHtml(teamName);
        const safeContent = escapeHtml(content.trim().slice(0, 1000));

        try {
          await mailerService.mailer.sendMail({
            from: process.env.FROM_EMAIL || process.env.SMTP_USER,
            to: teamEmail,
            subject: `💬 Admin Comment on: ${feedbackTitle}`,
            text: `Hello ${teamName},

The administrator has added a comment on your ${typeLabel} "${feedbackTitle}":

"${content.trim().slice(0, 1000)}"

---
This notification was sent from RetroGemini.
`,
            html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #4f46e5;">💬 Admin Comment</h2>
  <p>Hello <strong>${safeTeamName}</strong>,</p>
  <p>The administrator has added a comment on your ${typeLabel}:</p>
  <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <h3 style="margin: 0 0 8px 0; color: #1e293b;">${safeFeedbackTitle}</h3>
  </div>
  <div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0; color: #78350f; white-space: pre-wrap;">${safeContent}</p>
  </div>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="color: #94a3b8; font-size: 12px;">This notification was sent from RetroGemini.</p>
</div>
`
          });
          logService.addServerLog('info', 'email', `Admin comment notification sent to ${teamEmail} for: ${feedbackTitle}`);
        } catch (emailErr) {
          console.error('[Server] Failed to send admin comment notification', emailErr);
        }
      }

      res.json({ success: true, comment: newComment });
    } catch (err) {
      console.error('[Server] Failed to add admin comment', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/update-password', superAdminActionLimiter, async (req, res) => {
    const { teamId, newPassword } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!teamId) {
      return res.status(400).json({ error: 'missing_team_id' });
    }

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'password_too_short' });
    }

    try {
      const result = await dataStore.atomicTeamUpdate(teamId, (team) => {
        team.passwordHash = newPassword;
        return team;
      });
      if (!result.success) {
        return res.status(404).json({ error: 'team_not_found' });
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update password', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/rename-team', superAdminActionLimiter, async (req, res) => {
    const { teamId, newName } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!teamId) {
      return res.status(400).json({ error: 'missing_team_id' });
    }

    if (!newName || newName.trim().length === 0) {
      return res.status(400).json({ error: 'team_name_empty' });
    }

    const trimmedName = newName.trim();

    try {
      const team = await dataStore.loadTeam(teamId);
      if (!team) {
        return res.status(404).json({ error: 'team_not_found' });
      }

      const oldName = team.name;

      const newNameKey = trimmedName.toLowerCase();
      const oldNameKey = oldName.toLowerCase();

      await dataStore.atomicTeamIndexUpdate((index) => {
        if (index.has(newNameKey) && index.get(newNameKey) !== teamId) return null;

        index.delete(oldNameKey);
        index.set(newNameKey, teamId);
        return index;
      });

      await dataStore.atomicTeamUpdate(teamId, (t) => {
        t.name = trimmedName;
        return t;
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to rename team', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post(
    '/api/super-admin/restore',
    superAdminActionLimiter,
    express.raw({
      type: ['application/gzip', 'application/x-gzip', 'application/octet-stream', 'application/json'],
      limit: '1gb'
    }),
    async (req, res) => {
      const password = req.header('x-super-admin-password');
      const sessionToken = req.header('x-super-admin-session-token');

      if (!tokenService.validateSuperAdminAuth({ password, sessionToken })) {
        return res.status(401).json({ error: 'unauthorized' });
      }

      if (!req.body || !(req.body instanceof Buffer) || req.body.length === 0) {
        return res.status(400).json({ error: 'missing_archive' });
      }

      try {
        let data;

        try {
          const decompressed = gunzipSync(req.body);
          data = JSON.parse(decompressed.toString('utf8'));
        } catch {
          try {
            data = JSON.parse(req.body.toString('utf8'));
          } catch {
            return res.status(400).json({ error: 'invalid_backup_format' });
          }
        }

        if (!data || typeof data !== 'object') {
          return res.status(400).json({ error: 'invalid_backup_data' });
        }

        if (!Array.isArray(data.teams)) {
          data.teams = [];
        }

        await dataStore.savePersistedData(data);

        const teamCount = data.teams.length;
        console.info('[Server] Restored backup');

        res.json({ success: true, teamsRestored: teamCount });
      } catch (err) {
        console.error('[Server] Failed to restore backup', err);
        res.status(500).json({ error: 'restore_failed' });
      }
    }
  );

  app.post('/api/super-admin/backup', superAdminActionLimiter, async (_req, res) => {
    if (!tokenService.validateSuperAdminAuth(_req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const currentData = await dataStore.loadPersistedData();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `retrogemini-backup-${timestamp}.json.gz`;

      const jsonData = JSON.stringify(currentData, null, 2);
      const compressed = gzipSync(Buffer.from(jsonData, 'utf8'));

      const teamCount = currentData.teams?.length || 0;
      console.info(`[Server] Creating backup: ${teamCount} team(s)`);

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(compressed);
    } catch (err) {
      console.error('[Server] Failed to create backup', err);
      res.status(500).json({ error: 'backup_failed' });
    }
  });

  // ---------------------------------------------------------------------------
  // Server-side backup management endpoints
  // ---------------------------------------------------------------------------

  app.post('/api/super-admin/backups/list', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const backups = await backupService.listBackups();
      const config = backupService.getBackupConfig();
      res.json({ backups, config });
    } catch (err) {
      console.error('[Server] Failed to list backups', err);
      res.status(500).json({ error: 'list_failed' });
    }
  });

  app.post('/api/super-admin/backups/create', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const { label } = req.body || {};
      const entry = await backupService.createBackup('manual', label || undefined);
      if (!entry) {
        return res.status(409).json({ error: 'backup_in_progress' });
      }
      res.json({ success: true, backup: entry });
    } catch (err) {
      console.error('[Server] Failed to create manual backup', err);
      res.status(500).json({ error: 'create_failed' });
    }
  });

  app.post('/api/super-admin/backups/download', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const { backupId } = req.body || {};
      if (!backupId) {
        return res.status(400).json({ error: 'missing_backup_id' });
      }

      const result = await backupService.getBackupData(backupId);
      if (!result) {
        return res.status(404).json({ error: 'backup_not_found' });
      }

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.data);
    } catch (err) {
      console.error('[Server] Failed to download backup', err);
      res.status(500).json({ error: 'download_failed' });
    }
  });

  app.post('/api/super-admin/backups/restore', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const { backupId } = req.body || {};
      if (!backupId) {
        return res.status(400).json({ error: 'missing_backup_id' });
      }

      // Create a pre-restore backup first
      await backupService.createBackup('auto', 'Pre-restore snapshot');

      const entry = await backupService.restoreFromBackup(backupId);
      res.json({ success: true, restored: entry });
    } catch (err) {
      console.error('[Server] Failed to restore from backup', err);
      res.status(500).json({ error: 'restore_failed' });
    }
  });

  app.post('/api/super-admin/backups/delete', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const { backupId } = req.body || {};
      if (!backupId) {
        return res.status(400).json({ error: 'missing_backup_id' });
      }

      const success = await backupService.deleteBackup(backupId);
      if (!success) {
        return res.status(404).json({ error: 'backup_not_found' });
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to delete backup', err);
      res.status(500).json({ error: 'delete_failed' });
    }
  });

  app.post('/api/super-admin/backups/update', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const { backupId, label, protected: isProtected } = req.body || {};
      if (!backupId) {
        return res.status(400).json({ error: 'missing_backup_id' });
      }

      const updates = {};
      if (label !== undefined) updates.label = label;
      if (isProtected !== undefined) updates.protected = isProtected;

      const entry = await backupService.updateBackup(backupId, updates);
      if (!entry) {
        return res.status(404).json({ error: 'backup_not_found' });
      }
      res.json({ success: true, backup: entry });
    } catch (err) {
      console.error('[Server] Failed to update backup', err);
      res.status(500).json({ error: 'update_failed' });
    }
  });

  app.post('/api/super-admin/info-message', superAdminActionLimiter, async (req, res) => {
    const { infoMessage } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const settings = await dataStore.loadGlobalSettings();
      settings.infoMessage = infoMessage || '';
      await dataStore.saveGlobalSettings(settings);
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update info message', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/admin-email', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const settings = await dataStore.loadGlobalSettings();
      res.json({ adminEmail: settings.adminEmail || '', notifyNewTeam: !!settings.notifyNewTeam });
    } catch (err) {
      console.error('[Server] Failed to load admin email', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.post('/api/super-admin/update-admin-email', superAdminActionLimiter, async (req, res) => {
    const { adminEmail } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const settings = await dataStore.loadGlobalSettings();
      settings.adminEmail = adminEmail || '';
      await dataStore.saveGlobalSettings(settings);
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update admin email', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/update-notify-new-team', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const { notifyNewTeam } = req.body || {};
      const settings = await dataStore.loadGlobalSettings();
      settings.notifyNewTeam = !!notifyNewTeam;
      await dataStore.saveGlobalSettings(settings);
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update notify new team setting', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/notify-feedback', superAdminActionLimiter, async (req, res) => {
    const { feedback } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!mailerService.smtpEnabled || !mailerService.mailer) {
      return res.status(501).json({ error: 'email_not_configured' });
    }

    try {
      const settings = await dataStore.loadGlobalSettings();
      const adminEmail = settings.adminEmail;

      if (!adminEmail) {
        return res.status(400).json({ error: 'admin_email_not_configured' });
      }

      if (!feedback || !feedback.title || !feedback.type) {
        return res.status(400).json({ error: 'missing_feedback_data' });
      }

      const typeLabel = feedback.type === 'bug' ? 'Bug Report' : 'Feature Request';
      const typeEmoji = feedback.type === 'bug' ? '🐛' : '✨';
      const safeFeedbackTitle = escapeHtml(feedback.title);
      const safeFeedbackTeamName = escapeHtml(feedback.teamName);
      const safeFeedbackSubmittedBy = escapeHtml(feedback.submittedByName);
      const safeFeedbackDescription = escapeHtml(feedback.description);
      const feedbackDate = new Date(feedback.submittedAt).toLocaleString();

      await mailerService.mailer.sendMail({
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
        to: adminEmail,
        subject: `${typeEmoji} New ${typeLabel}: ${feedback.title}`,
        text: `New ${typeLabel} submitted

Title: ${feedback.title}
Type: ${typeLabel}
Team: ${feedback.teamName}
Submitted by: ${feedback.submittedByName}
Date: ${feedbackDate}

Description:
${feedback.description}

---
Log in to the Super Admin Dashboard to review and respond to this feedback.
`,
        html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: ${feedback.type === 'bug' ? '#dc2626' : '#7c3aed'};">
    ${typeEmoji} New ${typeLabel}
  </h2>
  <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <h3 style="margin: 0 0 8px 0; color: #1e293b;">${safeFeedbackTitle}</h3>
    <p style="margin: 4px 0; color: #64748b; font-size: 14px;">
      <strong>Team:</strong> ${safeFeedbackTeamName}<br>
      <strong>Submitted by:</strong> ${safeFeedbackSubmittedBy}<br>
      <strong>Date:</strong> ${feedbackDate}
    </p>
  </div>
  <div style="margin: 16px 0;">
    <h4 style="color: #475569; margin-bottom: 8px;">Description:</h4>
    <p style="color: #334155; white-space: pre-wrap;">${safeFeedbackDescription}</p>
  </div>
  ${feedback.images && feedback.images.length > 0 ? `
  <p style="color: #64748b; font-size: 14px;">
    <em>${feedback.images.length} image(s) attached - view in Super Admin Dashboard</em>
  </p>
  ` : ''}
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="color: #94a3b8; font-size: 12px;">
    Log in to the Super Admin Dashboard to review and respond to this feedback.
  </p>
</div>
`
      });

      logService.addServerLog('info', 'email', `Feedback notification sent to ${adminEmail} for: ${feedback.title}`);
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to send feedback notification email', err);
      res.status(500).json({ error: 'send_failed' });
    }
  });

  app.post('/api/super-admin/active-sessions', superAdminPollingLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const activeSessions = [];

      const allSockets = await io.fetchSockets();

      const sessionRooms = new Map();
      for (const s of allSockets) {
        if (!s.data.userId || !s.data.userName) continue;
        for (const room of s.rooms) {
          if (room === s.id) continue;
          if (!sessionRooms.has(room)) sessionRooms.set(room, []);
          sessionRooms.get(room).push({ id: s.data.userId, name: s.data.userName });
        }
      }

      for (const [roomId, participants] of sessionRooms.entries()) {
        let sessionData = sessionCache.get(roomId);
        if (!sessionData) {
          sessionData = await dataStore.loadSessionState(roomId);
        }

        const isHealthCheck = sessionData && (sessionData.templateId || sessionData.dimensions);
        let teamName = 'Unknown';

        if (sessionData?.teamId) {
          const team = await dataStore.loadTeam(sessionData.teamId);
          if (team) {
            teamName = team.name;
          }
        }

        const sessionInfo = {
          sessionId: roomId,
          type: isHealthCheck ? 'healthcheck' : 'retrospective',
          teamId: sessionData?.teamId || '',
          teamName,
          sessionName: sessionData?.name || 'Unknown Session',
          phase: sessionData?.phase || 'Unknown',
          status: sessionData?.status || 'IN_PROGRESS',
          participants,
          connectedCount: participants.length
        };

        activeSessions.push(sessionInfo);
      }

      res.json({ sessions: activeSessions });
    } catch (err) {
      console.error('[Server] Failed to get active sessions', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.post('/api/super-admin/logs', superAdminActionLimiter, async (req, res) => {
    const { filter } = req.body || {};

    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      let logs = logService.getServerLogs();

      if (filter) {
        if (filter.level) {
          logs = logs.filter((l) => l.level === filter.level);
        }
        if (filter.source) {
          logs = logs.filter((l) => l.source === filter.source);
        }
      }

      res.json({ logs: logs.reverse() });
    } catch (err) {
      console.error('[Server] Failed to get server logs', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.post('/api/super-admin/clear-logs', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    logService.clearServerLogs();
    logService.addServerLog('info', 'server', 'Server logs cleared by admin');
    res.json({ success: true });
  });

  // ===================== AI / LLM Configuration =====================

  app.post('/api/super-admin/ai-settings', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const settings = await dataStore.loadGlobalSettings();
      const ai = settings.ai || { enabled: false, apiUrl: '' };
      res.json({ ai });
    } catch (err) {
      console.error('[Server] Failed to load AI settings', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.post('/api/super-admin/update-ai-settings', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      const { enabled, apiUrl, apiKey, model, allowSelfSignedCerts } = req.body || {};
      const settings = await dataStore.loadGlobalSettings();
      settings.ai = {
        enabled: !!enabled,
        apiUrl: (apiUrl || '').trim(),
        apiKey: (apiKey || '').trim() || undefined,
        model: (model || '').trim() || undefined,
        allowSelfSignedCerts: !!allowSelfSignedCerts
      };
      await dataStore.saveGlobalSettings(settings);
      logService.addServerLog('info', 'server', `AI settings updated (enabled: ${settings.ai.enabled})`);
      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to update AI settings', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/super-admin/test-ai', superAdminActionLimiter, async (req, res) => {
    if (!tokenService.validateSuperAdminAuth(req.body)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      // Auto-save current form values so the test uses the latest config
      const { apiUrl, apiKey, model, allowSelfSignedCerts } = req.body || {};
      if (apiUrl) {
        const settings = await dataStore.loadGlobalSettings();
        settings.ai = {
          enabled: true,
          apiUrl: apiUrl.trim(),
          apiKey: (apiKey || '').trim() || undefined,
          model: (model || '').trim() || undefined,
          allowSelfSignedCerts: !!allowSelfSignedCerts
        };
        await dataStore.saveGlobalSettings(settings);
      }

      const result = await aiService.suggestGroupTitle(['Things went well', 'Great teamwork', 'Good communication']);
      if (!result) {
        return res.status(400).json({ error: 'ai_not_configured', message: 'AI is not enabled or not configured' });
      }
      res.json({ success: true, response: result });
    } catch (err) {
      const errorMessage = err.message || err.cause?.message || 'Connection failed';
      console.error('[Server] AI test failed:', errorMessage);
      logService.addServerLog('error', 'server', `AI test failed: ${errorMessage}`);
      res.status(500).json({ error: 'ai_test_failed', message: errorMessage });
    }
  });

  // ===================== AI Action Endpoints =====================

  const aiActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'too_many_attempts', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/ai/suggest-group-title', aiActionLimiter, async (req, res) => {
    try {
      const { ticketTexts } = req.body || {};
      if (!Array.isArray(ticketTexts) || ticketTexts.length === 0) {
        return res.status(400).json({ error: 'missing_ticket_texts' });
      }
      const title = await aiService.suggestGroupTitle(ticketTexts);
      if (title === null) {
        return res.status(404).json({ error: 'ai_not_enabled' });
      }
      res.json({ title });
    } catch (err) {
      const errorMessage = err.message || err.cause?.message || 'AI request failed';
      console.error('[Server] AI suggest group title failed:', errorMessage);
      res.status(500).json({ error: 'ai_error', message: errorMessage });
    }
  });

  app.post('/api/ai/generate-retro-summary', aiActionLimiter, async (req, res) => {
    try {
      const { sessionData } = req.body || {};
      if (!sessionData) {
        return res.status(400).json({ error: 'missing_session_data' });
      }
      const summary = await aiService.generateRetroSummary(sessionData);
      if (summary === null) {
        return res.status(404).json({ error: 'ai_not_enabled' });
      }
      res.json({ summary });
    } catch (err) {
      const errorMessage = err.message || err.cause?.message || 'AI request failed';
      console.error('[Server] AI generate retro summary failed:', errorMessage);
      res.status(500).json({ error: 'ai_error', message: errorMessage });
    }
  });
};

export { registerSuperAdminRoutes };
