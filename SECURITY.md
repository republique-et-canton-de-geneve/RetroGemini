# Security Policy

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainers with details of the vulnerability
3. Allow time for the issue to be addressed before public disclosure

## Security Features

### Data Privacy

- **Self-hosted**: All data stays on your server
- **No external services**: No third-party analytics, tracking, or data collection
- **No telemetry**: The application does not phone home

### Container Security

- **Non-root execution**: Container runs as unprivileged user
- **Minimal base image**: Node 20 Alpine for reduced attack surface
- **Security context**: OpenShift-compatible security settings
- **Capability dropping**: All Linux capabilities dropped

### Network Security

- **TLS support**: Configure via reverse proxy (nginx, OpenShift Route)
- **Security headers**: X-Frame-Options, X-Content-Type-Options, etc.
- **Health endpoints**: `/health` and `/ready` for monitoring
- **Rate limiting**: Per-IP limits on authentication, password-reset and feedback-notification endpoints; unauthenticated calls to AI endpoints are also throttled per IP (authenticated team requests are not limited)

### Session Tokens

- Team and super-admin sessions use **stateless HMAC-signed tokens** with explicit type, issue time, expiry and nonce claims
- Set `SESSION_TOKEN_SECRET` to the same value on every pod so tokens survive restarts and non-sticky routing; without it, a process-local random secret is used and sessions do not survive restarts
- Tampered tokens, tokens signed with another secret, and expired tokens are rejected
- All team and feedback endpoints accept a valid team session token as an **alternative credential** to the team password; the token must be minted for the exact team being addressed, so a token for one team never authorizes requests against another. Rotating `SESSION_TOKEN_SECRET` therefore also invalidates the token path into team data until clients log in again
- The web client sends its session token alongside the password on all routine team and feedback calls; the server checks the password first, so rotating `SESSION_TOKEN_SECRET` never locks out a client that still holds a valid password, and a valid token keeps a member working after a mid-session password change

### AI Endpoints

- All `/api/ai/*` endpoints require a valid team session token; anonymous network callers cannot drive the internal LLM
- AI is disabled by default and configured through the super-admin panel

## Security Considerations

### Team Passwords

Team passwords provide access control but are stored as-is in the database. For production deployments:

- Use strong, unique passwords for each team
- Consider network-level access controls
- Deploy behind a VPN or authenticated proxy for sensitive environments

### Backups Contain Team Passwords

Because team passwords are stored as-is, **server-side backups and downloaded backup archives contain every team's password in clear text**. Treat backup files and the super-admin credential with the same care as the database itself:

- Restrict access to the backup volume/table and to `/api/super-admin/backups/download`
- Store downloaded archives in an encrypted location and delete them when no longer needed

### Database Security

- SQLite database is unencrypted at rest
- Ensure the data volume has appropriate filesystem permissions
- Regular backups are recommended

### CORS Configuration

The Socket.IO server accepts connections from any origin by default. For production:

- Deploy behind a reverse proxy that handles CORS
- Use network policies to restrict access

### SMTP Credentials

- SMTP credentials are passed via environment variables
- Do not commit credentials to source control
- Use secrets management in Kubernetes/OpenShift

## Recommended Production Setup

1. **Deploy behind a reverse proxy** (nginx, Traefik, or platform ingress)
2. **Enable TLS** for all connections
3. **Use network policies** to restrict pod-to-pod communication
4. **Mount secrets** for SMTP credentials instead of environment variables
5. **Regular updates** of the base image and dependencies

## Dependency Security

Run regular security audits:

```bash
npm audit
```

Update dependencies regularly to address known vulnerabilities.

## Version Support

Security updates are provided for the latest release only. We recommend always running the latest version.
