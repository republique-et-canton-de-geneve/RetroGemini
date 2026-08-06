import { randomBytes } from 'crypto';
import rateLimit from 'express-rate-limit';
import { hashPassword } from '../services/passwordHashing.js';
import { isPasswordLongEnough, PASSWORD_TOO_SHORT_ERROR } from '../../utils/passwordPolicy.js';
import { getTeamInviteEpoch } from '../services/teamService.js';
import { createPublicOriginResolver } from '../services/publicOrigin.js';

const isValidEmail = (value) => (
  typeof value === 'string' &&
  value.length <= 320 &&
  /^[^\s@]+@[^\s@]+$/.test(value)
);

const isValidHttpUrl = (value) => {
  if (typeof value !== 'string' || value.length > 4096) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

// Reset tokens are minted as `randomBytes(32).toString('hex')`, and only their
// SHA-256 hash is ever persisted — so a value that is not 64 lowercase hex
// characters cannot match a stored token, whatever the store contains. Checking
// the shape first lets both token endpoints answer exactly as they would have,
// without a data-store round trip and, on `/confirm`, without taking the meta
// write lock that real reset-token writes queue behind (audit H5).
const isResetTokenShaped = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

const registerPasswordResetRoutes = ({
  app,
  dataStore,
  mailerService,
  escapeHtml,
  sanitizeEmailLink,
  hashResetToken,
  pruneResetTokens,
  resetTokenLimiterMax = 20,
  // Audit H4: the mailed link's origin comes from the server, never from the
  // caller — a reset mail carries a live token, so a caller-named host is
  // account takeover through the deployment's own SMTP identity.
  publicOrigin = createPublicOriginResolver()
}) => {
  const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

  const passwordResetEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Audit H5: `/verify` and `/confirm` are unauthenticated and both do
  // data-store work per call, so one caller could otherwise drive unbounded
  // reads and unbounded meta-lock contention. The cap is per IP and shared by
  // the two, because they are two steps of the same flow: a real user verifies
  // once and confirms once, so 20 per 15 minutes leaves generous room for
  // reloads and for colleagues behind a shared NAT egress address. This is not
  // a brute-force gate — a 256-bit token does not need one.
  const resetTokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: resetTokenLimiterMax,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/send-password-reset', passwordResetEmailLimiter, async (req, res) => {
    if (!mailerService.smtpEnabled || !mailerService.mailer) {
      return res.status(501).json({ error: 'email_not_configured' });
    }

    // Audit H4, and the Codex review of PR #405 that sharpened it: this route
    // is the one place where an *anonymous* caller makes the server mail a live
    // credential. Deriving the link's origin from the request `Host` is not
    // enough here — `Host` is still caller-controlled, and any edge that
    // forwards an arbitrary one (a default virtual host, or an attacker with
    // direct network access to the pod) puts the token back on a host the
    // attacker chose. So this route requires an origin the *operator*
    // configured, and refuses to mail anything without one.
    //
    // `/api/send-invite` deliberately keeps the `Host` fallback: it is
    // authenticated, and the payload it mails is a credential the caller
    // already holds, so a foreign host there gains an attacker nothing they do
    // not already have.
    if (!publicOrigin.hasConfiguredBaseUrl()) {
      console.warn(
        '[Server] Refusing to mail a password reset: PUBLIC_BASE_URL is not set, ' +
        'so the server has no origin it can trust to build the link on (audit H4)'
      );
      return res.status(501).json({ error: 'public_base_url_not_configured' });
    }

    const { email, teamName, resetLink, resetBaseUrl } = req.body || {};
    const requestedLink = resetBaseUrl || resetLink;
    if (!email || !requestedLink || !teamName) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'invalid_email' });
    }

    if (!isValidHttpUrl(requestedLink)) {
      return res.status(400).json({ error: 'invalid_link' });
    }

    if (typeof teamName !== 'string' || teamName.length > 200) {
      return res.status(400).json({ error: 'invalid_team_name' });
    }

    // The caller may pick the path it wants to land on, but not the host: the
    // origin is this deployment's own (PUBLIC_BASE_URL, else the request's).
    const canonicalLink = publicOrigin.resolveEmailLink(req, requestedLink);
    if (!canonicalLink) {
      return res.status(400).json({ error: 'invalid_link' });
    }

    const safeTeamName = escapeHtml(teamName);
    const safeResetLink = sanitizeEmailLink(canonicalLink);
    const safeResetUrl = new URL(safeResetLink);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const index = await dataStore.loadTeamIndex();
      const teamId = index.get(teamName.toLowerCase());

      if (!teamId) {
        return res.status(204).end();
      }

      const team = await dataStore.loadTeam(teamId);
      const facilitatorEmail = team?.facilitatorEmail?.trim().toLowerCase();

      if (!team || !facilitatorEmail || facilitatorEmail !== normalizedEmail) {
        return res.status(204).end();
      }

      const token = randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(token);
      const now = Date.now();
      const expiresAt = now + RESET_TOKEN_TTL_MS;

      await dataStore.atomicMetaUpdate((meta) => {
        const tokens = pruneResetTokens(meta.resetTokens);
        const filtered = tokens.filter((entry) => entry.teamId !== team.id);
        filtered.push({
          tokenHash,
          teamId: team.id,
          createdAt: now,
          expiresAt
        });
        meta.resetTokens = filtered;
        return meta;
      });

      safeResetUrl.searchParams.set('reset', token);
      const resetLinkWithToken = safeResetUrl.toString();
      const safeResetLinkHtml = escapeHtml(resetLinkWithToken);

      await mailerService.mailer.sendMail({
        from: process.env.FROM_EMAIL || process.env.SMTP_USER,
        to: email,
        subject: `Password Reset - ${teamName}`,
        text: `Hello,

You have requested a password reset for the team "${teamName}".

Click this link to reset your password: ${resetLinkWithToken}

This link is valid for 1 hour.

If you did not request this reset, please ignore this email.
`,
        html: `<p>Hello,</p>
<p>You have requested a password reset for the team <strong>${safeTeamName}</strong>.</p>
<p><a href="${safeResetLinkHtml}" target="_blank" rel="noreferrer">Click here to reset your password</a></p>
<p>This link is valid for 1 hour.</p>
<p><em>If you did not request this reset, please ignore this email.</em></p>`
      });

      res.status(204).end();
    } catch (err) {
      console.error('[Server] Failed to send password reset email', err);
      res.status(500).json({ error: 'send_failed' });
    }
  });

  app.post('/api/password-reset/verify', resetTokenLimiter, async (req, res) => {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ error: 'missing_token' });
    }

    if (!isResetTokenShaped(token)) {
      return res.json({ valid: false });
    }

    try {
      const meta = await dataStore.loadMetaData();
      const prunedTokens = pruneResetTokens(meta.resetTokens);
      const tokenHash = hashResetToken(token);
      const tokenEntry = prunedTokens.find((entry) => entry.tokenHash === tokenHash);

      if (prunedTokens.length !== meta.resetTokens.length) {
        await dataStore.atomicMetaUpdate((m) => {
          m.resetTokens = pruneResetTokens(m.resetTokens);
          return m;
        });
      }

      if (!tokenEntry) {
        return res.json({ valid: false });
      }

      const team = await dataStore.loadTeam(tokenEntry.teamId);
      if (!team) {
        return res.json({ valid: false });
      }

      return res.json({ valid: true, teamName: team.name });
    } catch (err) {
      console.error('[Server] Failed to verify reset token', err);
      return res.status(500).json({ error: 'verification_failed' });
    }
  });

  app.post('/api/password-reset/confirm', resetTokenLimiter, async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    // Audit H39. Checked before the token is looked up, so a refused password
    // never consumes the single-use reset token — otherwise learning the rule
    // would cost the user a second reset mail.
    if (!isPasswordLongEnough(newPassword)) {
      return res.status(400).json({ error: PASSWORD_TOO_SHORT_ERROR });
    }

    // Answered identically to an unknown token, but without the meta write lock.
    if (!isResetTokenShaped(token)) {
      return res.status(400).json({ error: 'invalid_or_expired_token' });
    }

    let updated = false;
    let teamName = null;

    try {
      let targetTeamId = null;

      await dataStore.atomicMetaUpdate((meta) => {
        meta.resetTokens = pruneResetTokens(meta.resetTokens);
        const tokenHash = hashResetToken(token);
        const tokenIndex = meta.resetTokens.findIndex((entry) => entry.tokenHash === tokenHash);
        if (tokenIndex === -1) {
          return null;
        }
        targetTeamId = meta.resetTokens[tokenIndex].teamId;
        meta.resetTokens.splice(tokenIndex, 1);
        return meta;
      });

      if (targetTeamId) {
        const newPasswordHash = await hashPassword(newPassword);
        const result = await dataStore.atomicTeamUpdate(targetTeamId, (team) => {
          teamName = team.name;
          team.passwordHash = newPasswordHash;
          // Password rotation revokes outstanding invite links (stage 7e).
          team.inviteEpoch = getTeamInviteEpoch(team) + 1;
          updated = true;
          return team;
        });
        if (!result.success) {
          updated = false;
        }
      }

      if (!updated) {
        return res.status(400).json({ error: 'invalid_or_expired_token' });
      }

      return res.json({
        success: true,
        message: `Password updated for ${teamName}. You can now log in.`,
        teamName
      });
    } catch (err) {
      console.error('[Server] Failed to reset password', err);
      return res.status(500).json({ error: 'reset_failed' });
    }
  });
};

export { registerPasswordResetRoutes };
