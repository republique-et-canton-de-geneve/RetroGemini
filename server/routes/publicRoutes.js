import rateLimit from 'express-rate-limit';
import { compactInviteLink } from '../../utils/inviteLink.js';

const isValidEmail = (value) => (
  typeof value === 'string' &&
  value.length <= 320 &&
  /^[^\s@]+@[^\s@]+$/.test(value)
);

const registerPublicRoutes = ({
  app,
  dataStore,
  mailerService,
  logService,
  escapeHtml,
  sanitizeEmailLink
}) => {
  app.get('/api/wifi-config', (_req, res) => {
    const ssid = process.env.WIFI_SSID;
    const password = process.env.WIFI_PASSWORD;
    if (!ssid || !password) {
      return res.status(404).json({ error: 'wifi_not_configured' });
    }
    res.json({ ssid, password });
  });

  app.get('/api/info-message', async (_req, res) => {
    try {
      const settings = await dataStore.loadGlobalSettings();
      res.json({ infoMessage: settings.infoMessage || '' });
    } catch (err) {
      console.error('[Server] Failed to load info message', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.get('/api/ai-status', async (_req, res) => {
    try {
      const settings = await dataStore.loadGlobalSettings();
      const ai = settings.ai;
      res.json({ enabled: !!(ai && ai.enabled && ai.apiUrl) });
    } catch (err) {
      console.error('[Server] Failed to load AI status', err);
      res.json({ enabled: false });
    }
  });

  app.get('/api/data', async (_req, res) => {
    console.warn('[Server] DEPRECATED: /api/data GET called - client should use /api/team endpoints');
    res.status(410).json({ error: 'endpoint_deprecated', teams: [], meta: { revision: 0, updatedAt: new Date().toISOString() } });
  });

  app.post('/api/data', async (_req, res) => {
    console.warn('[Server] DEPRECATED: /api/data POST called - client should use /api/team endpoints');
    res.status(410).json({ error: 'endpoint_deprecated', message: 'Use /api/team endpoints instead' });
  });

  app.post('/api/send-invite', async (req, res) => {
    if (!mailerService.smtpEnabled || !mailerService.mailer) {
      return res.status(501).json({ error: 'email_not_configured' });
    }

    const { email, name, link, teamName, sessionName } = req.body || {};
    if (!email || !link) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'invalid_email' });
    }

    if (typeof link !== 'string' || link.length > 4096) {
      return res.status(400).json({ error: 'invalid_link' });
    }

    const compactedLink = compactInviteLink(link);
    const safeInviteLink = sanitizeEmailLink(compactedLink);
    const safeName = escapeHtml(name || 'You');
    const safeTeamName = escapeHtml(teamName || 'a RetroGemini team');
    const safeSessionName = sessionName ? escapeHtml(sessionName) : '';
    const safeInviteLinkHtml = escapeHtml(safeInviteLink);

    try {
      await mailerService.mailer.sendMail({
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
        to: email,
        subject: `Invitation to join ${teamName || 'RetroGemini'}`,
        text: `${name || 'You'},

You have been invited to join ${teamName || 'a RetroGemini team'}${sessionName ? ` for the session "${sessionName}"` : ''}.
Use this link to join: ${compactedLink}
`,
        html: `<p>${safeName},</p>
<p>You have been invited to join <strong>${safeTeamName}</strong>${safeSessionName ? ` for the session "${safeSessionName}"` : ''}.</p>
<p><a href="${safeInviteLinkHtml}" target="_blank" rel="noreferrer">Join with this link</a></p>`
      });

      res.status(204).end();
    } catch (err) {
      console.error('[Server] Failed to send invite email', err);
      res.status(500).json({ error: 'send_failed' });
    }
  });


  const feedbackNotificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/notify-new-feedback', feedbackNotificationLimiter, async (req, res) => {
    if (!mailerService.smtpEnabled || !mailerService.mailer) {
      return res.status(204).end();
    }

    const { feedback } = req.body || {};

    if (!feedback || !feedback.title || !feedback.type) {
      return res.status(400).json({ error: 'missing_feedback_data' });
    }

    if (typeof feedback.title !== 'string' || feedback.title.length > 200 ||
        typeof feedback.description !== 'string' || feedback.description.length > 10000 ||
        (feedback.type !== 'bug' && feedback.type !== 'feature')) {
      return res.status(400).json({ error: 'invalid_feedback_data' });
    }

    try {
      const settings = await dataStore.loadGlobalSettings();
      const adminEmail = settings.adminEmail;

      if (!adminEmail) {
        return res.status(204).end();
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
      res.status(204).end();
    } catch (err) {
      console.error('[Server] Failed to send feedback notification email', err);
      res.status(204).end();
    }
  });
};

export { registerPublicRoutes };
