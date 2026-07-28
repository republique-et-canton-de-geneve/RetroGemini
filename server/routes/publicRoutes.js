import rateLimit from 'express-rate-limit';
import { compactInviteLink } from '../../utils/inviteLink.js';
import { createBoundedCache } from '../services/boundedCache.js';

const isValidEmail = (value) => (
  typeof value === 'string' &&
  value.length <= 320 &&
  /^[^\s@]+@[^\s@]+$/.test(value)
);

// Invite mail is metered per team rather than per IP (audit H3). A per-IP
// limiter would punish the normal case: a facilitator inviting a whole group
// from the office egress IP that every other facilitator also shares. The
// quota is a fixed window over a bounded LRU of teams, so a long-lived pod
// cannot accumulate one counter per team it has ever seen.
const INVITE_QUOTA_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_INVITE_QUOTA_MAX = 200;
const INVITE_QUOTA_TRACKED_TEAMS = 500;

const resolveInviteQuotaMax = (configured) => {
  const value = Number(configured);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_INVITE_QUOTA_MAX;
};

const registerPublicRoutes = ({
  app,
  dataStore,
  teamService,
  mailerService,
  logService,
  escapeHtml,
  sanitizeEmailLink,
  inviteQuotaMax = resolveInviteQuotaMax(process.env.INVITE_MAX_PER_TEAM_PER_HOUR),
  inviteQuotaWindowMs = INVITE_QUOTA_WINDOW_MS,
  now = () => Date.now()
}) => {
  const inviteQuotaLimit = resolveInviteQuotaMax(inviteQuotaMax);
  const inviteQuotas = createBoundedCache({ max: INVITE_QUOTA_TRACKED_TEAMS });

  // Returns true when the team may send one more invite, consuming a slot.
  // Only called for an already-authenticated team, so a rejected credential
  // can never burn a legitimate facilitator's quota.
  const consumeInviteQuota = (teamId) => {
    const currentTime = now();
    const entry = inviteQuotas.get(teamId);

    if (!entry || currentTime - entry.windowStart >= inviteQuotaWindowMs) {
      inviteQuotas.set(teamId, { windowStart: currentTime, count: 1 });
      return true;
    }

    if (entry.count >= inviteQuotaLimit) {
      return false;
    }

    entry.count += 1;
    inviteQuotas.set(teamId, entry);
    return true;
  };
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

  // Audit H3: this endpoint mails an arbitrary link through the deployment's
  // SMTP identity, so it must never be reachable without a team credential.
  // Authentication comes first — before payload validation, before the SMTP
  // capability check — so an anonymous caller learns nothing about the
  // deployment and drives no work beyond one team lookup.
  app.post('/api/send-invite', async (req, res) => {
    const { teamId, password, sessionToken, email, name, link, sessionName } = req.body || {};

    // Cheap shape check first: no named team or no credential means there is
    // nothing worth a data-store round trip.
    if (typeof teamId !== 'string' || !teamId || (!password && !sessionToken)) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    const { team, error: authError } = await teamService.authenticateTeam(teamId, password, sessionToken);
    // A single opaque answer for "no such team" and "wrong credential", so the
    // endpoint cannot be used to enumerate team ids.
    if (authError || !team) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    if (!email || !link) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'invalid_email' });
    }

    if (typeof link !== 'string' || link.length > 4096) {
      return res.status(400).json({ error: 'invalid_link' });
    }

    if (!consumeInviteQuota(team.id)) {
      logService.addServerLog(
        'warn',
        'email',
        `Invite quota exceeded for team ${team.id} (${inviteQuotaLimit} per hour) - no invite sent`
      );
      return res.status(429).json({ error: 'invite_quota_exceeded', retryAfter: '1 hour' });
    }

    if (!mailerService.smtpEnabled || !mailerService.mailer) {
      return res.status(501).json({ error: 'email_not_configured' });
    }

    // The team name comes from the authenticated record, never from the
    // request body: otherwise a member of one team could mail an invite that
    // claims to come from another.
    const authenticatedTeamName = team.name || 'a RetroGemini team';
    const compactedLink = compactInviteLink(link);
    const safeInviteLink = sanitizeEmailLink(compactedLink);
    const safeName = escapeHtml(name || 'You');
    const safeTeamName = escapeHtml(authenticatedTeamName);
    const safeSessionName = sessionName ? escapeHtml(sessionName) : '';
    const safeInviteLinkHtml = escapeHtml(safeInviteLink);

    try {
      await mailerService.mailer.sendMail({
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
        to: email,
        subject: `Invitation to join ${authenticatedTeamName}`,
        text: `${name || 'You'},

You have been invited to join ${authenticatedTeamName}${sessionName ? ` for the session "${sessionName}"` : ''}.
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
