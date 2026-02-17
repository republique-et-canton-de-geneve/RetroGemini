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
      const { teamId, password, feedback } = req.body || {};

      const { team, error } = await teamService.authenticateTeam(teamId, password);
      if (error) {
        return res.status(401).json({ error });
      }

      if (!feedback || !feedback.type || !feedback.title || !feedback.description) {
        return res.status(400).json({ error: 'missing_feedback_data' });
      }

      const feedbackId = 'feedback_' + Math.random().toString(36).substr(2, 9);
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

      await dataStore.atomicReadModifyWrite((data) => {
        const targetTeam = data.teams.find((t) => t.id === teamId);
        if (!targetTeam) return null;
        if (!targetTeam.teamFeedbacks) {
          targetTeam.teamFeedbacks = [];
        }
        targetTeam.teamFeedbacks.unshift(newFeedback);
        return data;
      });

      res.json({ success: true, feedback: newFeedback });
    } catch (err) {
      console.error('[Server] Failed to create feedback', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/feedbacks/all', teamReadLimiter, async (req, res) => {
    try {
      const { teamId, password } = req.body || {};

      const { error } = await teamService.authenticateTeam(teamId, password);
      if (error) {
        return res.status(401).json({ error });
      }

      const currentData = await dataStore.loadPersistedData();
      const feedbacks = currentData.teams.flatMap((team) =>
        (team.teamFeedbacks || []).map((feedback) => ({
          ...feedback,
          teamId: feedback.teamId || team.id,
          teamName: feedback.teamName || team.name,
          isRead: feedback.isRead ?? false,
          status: feedback.status || 'pending',
          comments: feedback.comments || []
        }))
      );
      const orphaned = (currentData.orphanedFeedbacks || []).map((feedback) => ({
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
      const { teamId, password, feedbackTeamId, feedbackId, authorId, authorName, content } = req.body || {};

      const { error } = await teamService.authenticateTeam(teamId, password);
      if (error) {
        return res.status(401).json({ error });
      }

      if (!feedbackTeamId || !feedbackId || !authorId || !authorName || !content) {
        return res.status(400).json({ error: 'missing_comment_data' });
      }

      const currentData = await dataStore.loadPersistedData();
      const requestingTeam = currentData.teams.find((t) => t.id === teamId);
      const requestingTeamName = requestingTeam ? requestingTeam.name : 'Unknown Team';

      const commentId = `comment_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
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

      await dataStore.atomicReadModifyWrite((data) => {
        const feedbackTeam = data.teams.find((t) => t.id === feedbackTeamId);
        let feedback = null;
        if (feedbackTeam && feedbackTeam.teamFeedbacks) {
          feedback = feedbackTeam.teamFeedbacks.find((f) => f.id === feedbackId);
        }
        if (!feedback && Array.isArray(data.orphanedFeedbacks)) {
          feedback = data.orphanedFeedbacks.find((f) => f.id === feedbackId);
        }
        if (!feedback) return null;

        feedbackTitle = feedback.title;
        feedbackType = feedback.type;

        if (!feedback.comments) {
          feedback.comments = [];
        }
        feedback.comments.push(newComment);
        return data;
      });

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
      const { teamId, password, feedbackTeamId, feedbackId, commentId } = req.body || {};

      const { error } = await teamService.authenticateTeam(teamId, password);
      if (error) {
        return res.status(401).json({ error });
      }

      if (!feedbackTeamId || !feedbackId || !commentId) {
        return res.status(400).json({ error: 'missing_comment_data' });
      }

      await dataStore.atomicReadModifyWrite((data) => {
        const feedbackTeam = data.teams.find((t) => t.id === feedbackTeamId);
        let feedback = null;
        if (feedbackTeam && feedbackTeam.teamFeedbacks) {
          feedback = feedbackTeam.teamFeedbacks.find((f) => f.id === feedbackId);
        }
        if (!feedback && Array.isArray(data.orphanedFeedbacks)) {
          feedback = data.orphanedFeedbacks.find((f) => f.id === feedbackId);
        }
        if (!feedback || !feedback.comments) return null;

        const comment = feedback.comments.find((c) => c.id === commentId);
        if (!comment) return null;

        if (comment.teamId !== teamId) {
          return null;
        }

        feedback.comments = feedback.comments.filter((c) => c.id !== commentId);
        return data;
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[Server] Failed to delete comment', err);
      res.status(500).json({ error: 'failed_to_save' });
    }
  });

  app.post('/api/feedbacks/delete', teamWriteLimiter, async (req, res) => {
    try {
      const { teamId, password, feedbackId } = req.body || {};

      const { team, error } = await teamService.authenticateTeam(teamId, password);
      if (error) {
        return res.status(401).json({ error });
      }

      if (!feedbackId) {
        return res.status(400).json({ error: 'missing_feedback_id' });
      }

      let feedbackTitle = null;
      let feedbackType = null;
      const teamName = team ? team.name : 'Unknown Team';

      await dataStore.atomicReadModifyWrite((data) => {
        const feedbackTeam = data.teams.find((t) => t.id === teamId);
        if (!feedbackTeam || !feedbackTeam.teamFeedbacks) return null;

        const feedback = feedbackTeam.teamFeedbacks.find((f) => f.id === feedbackId);
        if (!feedback || feedback.teamId !== teamId) {
          return null;
        }

        feedbackTitle = feedback.title;
        feedbackType = feedback.type;

        feedbackTeam.teamFeedbacks = feedbackTeam.teamFeedbacks.filter((f) => f.id !== feedbackId);
        return data;
      });

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
