import { randomBytes } from 'crypto';
import rateLimit from 'express-rate-limit';

const teamReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'too_many_requests', retryAfter: '1 minute' },
  standardHeaders: true,
  legacyHeaders: false
});

const teamWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'too_many_requests', retryAfter: '1 minute' },
  standardHeaders: true,
  legacyHeaders: false
});

const registerFeedbackRoutes = ({
  app,
  dataStore,
  teamService,
  mailerService,
  logService,
  escapeHtml
}) => {
  app.post('/api/feedbacks/create', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId, password, sessionToken, feedback } = req.body || {};

      const { team, error } = await teamService.authenticateTeam(teamId, password, sessionToken);
      if (error) {
        return res.status(401).json({ error });
      }

      if (!feedback || !feedback.type || !feedback.title || !feedback.description) {
        return res.status(400).json({ error: 'missing_feedback_data' });
      }

      const feedbackId = 'feedback_' + randomBytes(5).toString('hex');
      const newFeedback = {
        id: feedbackId,
        teamId,
        teamName: team.name,
        type: feedback.type,
        title: feedback.title.trim().slice(0, 100),
        description: feedback.description.trim().slice(0, 2000),
        images: feedback.images || undefined,
        submittedBy: feedback.submittedBy,
        submittedByName: feedback.submittedByName,
        submittedAt: new Date().toISOString(),
        isRead: false,
        status: 'pending',
        comments: []
      };

      const result = await dataStore.atomicTeamUpdate(teamId, (t) => {
        if (!t.teamFeedbacks) {
          t.teamFeedbacks = [];
        }
        t.teamFeedbacks.unshift(newFeedback);
        return t;
      });

      if (!result.success) {
        return res.status(503).json({ error: 'failed_to_save' });
      }

      res.json({ success: true, feedback: newFeedback });
    } catch (err) {
      console.error('[Server] Failed to create feedback', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/feedbacks/all', teamReadLimiter, async (req, res) => {
    try {
      const { teamId, password, sessionToken } = req.body || {};

      const { error } = await teamService.authenticateTeam(teamId, password, sessionToken);
      if (error) {
        return res.status(401).json({ error });
      }

      // Projection: pulls only each team's id/name/teamFeedbacks in SQL instead
      // of deserializing every team's full retrospective history (audit R10).
      const teams = await dataStore.loadAllTeamFeedbacks();
      const meta = await dataStore.loadMetaData();

      const feedbacks = teams.flatMap((team) =>
        (team.teamFeedbacks || []).map((feedback) => ({
          ...feedback,
          teamId: feedback.teamId || team.id,
          teamName: feedback.teamName || team.name,
          isRead: feedback.isRead ?? false,
          status: feedback.status || 'pending',
          comments: feedback.comments || []
        }))
      );
      const orphaned = (meta.orphanedFeedbacks || []).map((feedback) => ({
        ...feedback,
        isRead: feedback.isRead ?? false,
        status: feedback.status || 'pending',
        comments: feedback.comments || []
      }));
      feedbacks.push(...orphaned);
      feedbacks.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      res.json({ feedbacks });
    } catch (err) {
      console.error('[Server] Failed to load all feedbacks', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.post('/api/feedbacks/comment', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId, password, sessionToken, feedbackTeamId, feedbackId, authorId, authorName, content } = req.body || {};

      const { error } = await teamService.authenticateTeam(teamId, password, sessionToken);
      if (error) {
        return res.status(401).json({ error });
      }

      if (!feedbackTeamId || !feedbackId || !authorId || !authorName || !content) {
        return res.status(400).json({ error: 'missing_comment_data' });
      }

      const requestingTeam = await dataStore.loadTeam(teamId);
      const requestingTeamName = requestingTeam ? requestingTeam.name : 'Unknown Team';

      const commentId = `comment_${Date.now()}_${randomBytes(3).toString('hex')}`;
      const newComment = {
        id: commentId,
        feedbackId,
        teamId,
        teamName: requestingTeamName,
        authorId,
        authorName,
        content: content.trim().slice(0, 1000),
        createdAt: new Date().toISOString()
      };

      let feedbackTitle = null;
      let feedbackType = null;

      const feedbackTeam = await dataStore.loadTeam(feedbackTeamId);
      // Audit H22: `stored` must follow the *write*, never the preliminary
      // read. Both updaters below re-check the target against the state the
      // store hands them, so a delete landing between the read and the
      // compare-and-swap leaves `stored` false — where trusting the read would
      // report success for an aborted write. Each updater assigns rather than
      // sets, because `atomicTeamUpdate`/`atomicMetaUpdate` may replay it on a
      // lost race and only the last attempt decided the outcome.
      let stored = false;

      if (feedbackTeam && feedbackTeam.teamFeedbacks) {
        const feedback = feedbackTeam.teamFeedbacks.find((f) => f.id === feedbackId);
        if (feedback) {
          feedbackTitle = feedback.title;
          feedbackType = feedback.type;
          const result = await dataStore.atomicTeamUpdate(feedbackTeamId, (t) => {
            const fb = (t.teamFeedbacks || []).find((f) => f.id === feedbackId);
            stored = !!fb;
            if (!fb) return null;
            if (!fb.comments) fb.comments = [];
            fb.comments.push(newComment);
            return t;
          });

          if (!result.success) {
            return res.status(503).json({ error: 'failed_to_save' });
          }
        }
      }

      if (!stored) {
        await dataStore.atomicMetaUpdate((meta) => {
          if (!Array.isArray(meta.orphanedFeedbacks)) return null;
          const feedback = meta.orphanedFeedbacks.find((f) => f.id === feedbackId);
          stored = !!feedback;
          if (!feedback) return null;
          feedbackTitle = feedback.title;
          feedbackType = feedback.type;
          if (!feedback.comments) feedback.comments = [];
          feedback.comments.push(newComment);
          return meta;
        });
      }

      // A comment lives either in its team's record or, once that team is
      // deleted, in `orphanedFeedbacks`. When neither holds the target both
      // updaters abort, and an aborted updater is reported as "nothing to
      // change" — indistinguishable from a successful write unless the route
      // says so. `TeamFeedback.tsx` reads `response.ok` as proof and drops the
      // draft, so answering 200 here threw away what the user had typed. The
      // author of a feedback may delete it at any time while someone else is
      // replying, so this is an ordinary race, not a crafted request.
      if (!stored) {
        return res.status(404).json({ error: 'feedback_not_found' });
      }

      if (feedbackTitle && mailerService.smtpEnabled && mailerService.mailer) {
        const settings = await dataStore.loadGlobalSettings();
        const adminEmail = settings.adminEmail;

        if (adminEmail) {
          const typeLabel = feedbackType === 'bug' ? 'Bug Report' : 'Feature Request';
          const safeFeedbackTitle = escapeHtml(feedbackTitle);
          const safeTeamName = escapeHtml(requestingTeamName);
          const safeAuthorName = escapeHtml(authorName);
          const safeContent = escapeHtml(content.trim().slice(0, 1000));

          try {
            await mailerService.mailer.sendMail({
              from: process.env.FROM_EMAIL || process.env.SMTP_USER,
              to: adminEmail,
              subject: `💬 New Comment on ${typeLabel}: ${feedbackTitle}`,
              text: `New comment from ${requestingTeamName}

${typeLabel}: ${feedbackTitle}
Comment by: ${authorName}

"${content.trim().slice(0, 1000)}"

---
Log in to the Super Admin Dashboard to view and respond.
`,
              html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #4f46e5;">💬 New Comment</h2>
  <p>New comment from <strong>${safeTeamName}</strong></p>
  <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0 0 4px 0; color: #64748b; font-size: 14px;">${typeLabel}</p>
    <h3 style="margin: 0; color: #1e293b;">${safeFeedbackTitle}</h3>
  </div>
  <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0 0 8px 0; color: #0369a1; font-size: 14px;">Comment by <strong>${safeAuthorName}</strong>:</p>
    <p style="margin: 0; color: #0c4a6e; white-space: pre-wrap;">${safeContent}</p>
  </div>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="color: #94a3b8; font-size: 12px;">Log in to the Super Admin Dashboard to view and respond.</p>
</div>
`
            });
            logService.addServerLog('info', 'email', `Comment notification sent to admin for: ${feedbackTitle}`);
          } catch (emailErr) {
            console.error('[Server] Failed to send comment notification to admin', emailErr);
          }
        }
      }

      res.json({ success: true, comment: newComment });
    } catch (err) {
      console.error('[Server] Failed to add comment', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/feedbacks/comment/delete', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId, password, sessionToken, feedbackTeamId, feedbackId, commentId } = req.body || {};

      const { error } = await teamService.authenticateTeam(teamId, password, sessionToken);
      if (error) {
        return res.status(401).json({ error });
      }

      if (!feedbackTeamId || !feedbackId || !commentId) {
        return res.status(400).json({ error: 'missing_comment_data' });
      }

      const feedbackTeam = await dataStore.loadTeam(feedbackTeamId);
      // Audit H22, extended to this route: `deleted` follows the *write*, not
      // the preliminary read. Both updaters below abort on three different
      // conditions — the feedback is gone, the comment is gone, or the comment
      // belongs to another team and must not be touched — and an aborted
      // updater reads as "nothing to change", so the route used to answer
      // `{ success: true }` for a deletion it had refused or missed. The client
      // reloads on `ok`, so the comment simply reappeared with no explanation.
      // Assign rather than set: the store may replay the updater on a lost race
      // and only the last attempt decided the outcome.
      let deleted = false;

      if (feedbackTeam && feedbackTeam.teamFeedbacks) {
        const feedback = feedbackTeam.teamFeedbacks.find((f) => f.id === feedbackId);
        if (feedback) {
          const result = await dataStore.atomicTeamUpdate(feedbackTeamId, (t) => {
            const fb = (t.teamFeedbacks || []).find((f) => f.id === feedbackId);
            const comment = fb && fb.comments
              ? fb.comments.find((c) => c.id === commentId)
              : null;
            deleted = !!comment && comment.teamId === teamId;
            if (!deleted) return null;
            fb.comments = fb.comments.filter((c) => c.id !== commentId);
            return t;
          });

          if (!result.success) {
            return res.status(503).json({ error: 'failed_to_save' });
          }
        }
      }

      if (!deleted) {
        await dataStore.atomicMetaUpdate((meta) => {
          if (!Array.isArray(meta.orphanedFeedbacks)) return null;
          const feedback = meta.orphanedFeedbacks.find((f) => f.id === feedbackId);
          const comment = feedback && feedback.comments
            ? feedback.comments.find((c) => c.id === commentId)
            : null;
          deleted = !!comment && comment.teamId === teamId;
          if (!deleted) return null;
          feedback.comments = feedback.comments.filter((c) => c.id !== commentId);
          return meta;
        });
      }

      // One opaque answer for "no such comment" and "not yours", so the
      // endpoint cannot be used to probe which comment ids exist.
      if (!deleted) {
        return res.status(404).json({ error: 'comment_not_found' });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to delete comment', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/feedbacks/delete', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId, password, sessionToken, feedbackId } = req.body || {};

      const { team, error } = await teamService.authenticateTeam(teamId, password, sessionToken);
      if (error) {
        return res.status(401).json({ error });
      }

      if (!feedbackId) {
        return res.status(400).json({ error: 'missing_feedback_id' });
      }

      let feedbackTitle = null;
      let feedbackType = null;
      const teamName = team ? team.name : 'Unknown Team';

      const result = await dataStore.atomicTeamUpdate(teamId, (t) => {
        if (!t.teamFeedbacks) return null;
        const feedback = t.teamFeedbacks.find((f) => f.id === feedbackId);
        if (!feedback || feedback.teamId !== teamId) return null;
        feedbackTitle = feedback.title;
        feedbackType = feedback.type;
        t.teamFeedbacks = t.teamFeedbacks.filter((f) => f.id !== feedbackId);
        return t;
      });

      if (!result.success) {
        return res.status(503).json({ error: 'failed_to_save' });
      }

      if (feedbackTitle && mailerService.smtpEnabled && mailerService.mailer) {
        const settings = await dataStore.loadGlobalSettings();
        const adminEmail = settings.adminEmail;

        if (adminEmail) {
          const typeLabel = feedbackType === 'bug' ? 'Bug Report' : 'Feature Request';
          const safeFeedbackTitle = escapeHtml(feedbackTitle);
          const safeTeamName = escapeHtml(teamName);

          try {
            await mailerService.mailer.sendMail({
              from: process.env.FROM_EMAIL || process.env.SMTP_USER,
              to: adminEmail,
              subject: `🗑️ Feedback Deleted by Team: ${feedbackTitle}`,
              text: `A feedback has been deleted by its author.

${typeLabel}: ${feedbackTitle}
Team: ${teamName}

---
This notification was sent from RetroGemini.
`,
              html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #64748b;">🗑️ Feedback Deleted</h2>
  <p>A feedback has been deleted by its author.</p>
  <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0 0 4px 0; color: #64748b; font-size: 14px;">${typeLabel}</p>
    <h3 style="margin: 0; color: #1e293b;">${safeFeedbackTitle}</h3>
    <p style="margin: 8px 0 0 0; color: #64748b; font-size: 14px;">Team: ${safeTeamName}</p>
  </div>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="color: #94a3b8; font-size: 12px;">This notification was sent from RetroGemini.</p>
</div>
`
            });
            logService.addServerLog('info', 'email', `Feedback deletion notification sent to admin for: ${feedbackTitle}`);
          } catch (emailErr) {
            console.error('[Server] Failed to send feedback deletion notification to admin', emailErr);
          }
        }
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to delete feedback', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });
};

export { registerFeedbackRoutes };
