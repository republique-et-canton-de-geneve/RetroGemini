import rateLimit from 'express-rate-limit';
import { compactInviteLink } from '../../utils/inviteLink.js';
import { createPublicOriginResolver } from '../services/publicOrigin.js';

const isValidEmail = (value) => (
  typeof value === 'string' &&
  value.length <= 320 &&
  /^[^\s@]+@[^\s@]+$/.test(value)
);

const registerPublicRoutes = ({
  app,
  dataStore,
  teamService,
  mailerService,
  logService,
  escapeHtml,
  sanitizeEmailLink,
  inviteAuthLimiterMax = 20,
  publicReadLimiterMax = 600,
  // Audit H4: authentication (H3) stops an anonymous relay, but it does not stop
  // an authenticated team from mailing a foreign-host phishing link through the
  // deployment's SMTP identity. The origin is the server's, not the caller's.
  //
  // Unlike the password-reset route, this one accepts the request `Host` as the
  // origin when `PUBLIC_BASE_URL` is unset, rather than refusing to send. The
  // asymmetry is deliberate: reaching this route needs a team credential, and
  // the join payload it mails is one the caller already holds — so a forged
  // `Host` gains an attacker nothing they do not already have, while failing
  // closed would break invitations for every deployment that has not set the
  // variable. Setting `PUBLIC_BASE_URL` pins this route too.
  resolveEmailLink = createPublicOriginResolver().resolveEmailLink
}) => {
  // Audit H5: the two public GETs below are unauthenticated and each reads the
  // global-settings record, so without a cap one caller drives unbounded
  // database work. They share a single budget because they read the *same*
  // record — metering them separately would just let an attacker alternate.
  //
  // The cap is deliberately far above real traffic: both fire once per
  // component mount, and these deployments put a whole office behind one NAT
  // egress address, so a morning login rush must never reach it. 600/min still
  // bounds an abusive client by two orders of magnitude.
  const publicReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: publicReadLimiterMax,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Per-IP cap on *rejected* invite credentials — deliberately NOT a limit on
  // invitations. There is no cap of any kind on how many invites an
  // authenticated team may send: a facilitator inviting a whole department in
  // one batch is the normal case, and a whole office shares one egress IP.
  //
  // What this bounds is the anonymous probe. Authenticating costs a data-store
  // read (and scrypt on the password path), so without it an unauthenticated
  // caller could drive unbounded database work one request at a time (CodeQL
  // `js/missing-rate-limiting`). `requestWasSuccessful` narrows the meter to
  // 401s only, so nothing a real facilitator can do — a typo'd address (400),
  // a deployment without SMTP (501), a send failure (500) — ever counts.
  const inviteAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: inviteAuthLimiterMax,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401
  });

  app.get('/api/wifi-config', (_req, res) => {
    const ssid = process.env.WIFI_SSID;
    const password = process.env.WIFI_PASSWORD;
    if (!ssid || !password) {
      return res.status(404).json({ error: 'wifi_not_configured' });
    }
    res.json({ ssid, password });
  });

  app.get('/api/info-message', publicReadLimiter, async (_req, res) => {
    try {
      const settings = await dataStore.loadGlobalSettings();
      res.json({ infoMessage: settings.infoMessage || '' });
    } catch (err) {
      console.error('[Server] Failed to load info message', err);
      res.status(500).json({ error: 'failed_to_load' });
    }
  });

  app.get('/api/ai-status', publicReadLimiter, async (_req, res) => {
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
  app.post('/api/send-invite', inviteAuthLimiter, async (req, res) => {
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

    if (!mailerService.smtpEnabled || !mailerService.mailer) {
      return res.status(501).json({ error: 'email_not_configured' });
    }

    // No send quota by design: an authenticated team may invite as many people
    // as it needs, in as many batches as it needs.

    // The team name comes from the authenticated record, never from the
    // request body: otherwise a member of one team could mail an invite that
    // claims to come from another.
    const authenticatedTeamName = team.name || 'a RetroGemini team';
    const compactedLink = compactInviteLink(link);
    const canonicalLink = resolveEmailLink(req, compactedLink);
    if (!canonicalLink) {
      return res.status(400).json({ error: 'invalid_link' });
    }
    const safeInviteLink = sanitizeEmailLink(canonicalLink);
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
Use this link to join: ${canonicalLink}
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
