import { randomBytes } from 'crypto';

const registerPasswordResetRoutes = ({
  app,
  dataStore,
  mailerService,
  escapeHtml,
  sanitizeEmailLink,
  hashResetToken,
  pruneResetTokens
}) => {
  const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

  app.post('/api/send-password-reset', async (req, res) => {
    if (!mailerService.smtpEnabled || !mailerService.mailer) {
      return res.status(501).json({ error: 'email_not_configured' });
    }

    const { email, teamName, resetLink, resetBaseUrl } = req.body || {};
    const requestedLink = resetBaseUrl || resetLink;
    if (!email || !requestedLink || !teamName) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    const safeTeamName = escapeHtml(teamName);
    const safeResetLink = sanitizeEmailLink(requestedLink);
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

  app.post('/api/password-reset/verify', async (req, res) => {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ error: 'missing_token' });
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

  app.post('/api/password-reset/confirm', async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'password_too_short' });
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
        const result = await dataStore.atomicTeamUpdate(targetTeamId, (team) => {
          teamName = team.name;
          team.passwordHash = newPassword;
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
