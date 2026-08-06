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
- **Minimal base image**: Node 26 Alpine for reduced attack surface
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
- The web client sends its session token alongside the password on all routine team and feedback calls; the server checks the token first (it is cheap to validate) and falls back to password verification, so rotating `SESSION_TOKEN_SECRET` never locks out a client that still holds a valid password, and a valid token keeps a member working after a mid-session password change

### Invite Credentials

- Newly minted invite links embed a dedicated **invite credential**: a stateless HMAC-signed token scoped to one team, derived on demand for any authenticated session and signed with the same `SESSION_TOKEN_SECRET`
- The credential is bound to a per-team **invite epoch** stored on the team record. Changing the team password (from the dashboard, the super-admin panel or an email reset) bumps the epoch, which **revokes every outstanding invite link at once** — the revocation ability password-embedding links never had
- Invite credentials do not expire with time (invite links have always lived until the password rotated); joining with one issues a normal, expiring session token
- The credential never contains or reveals the team password. Older invite links that embed the plaintext password keep working through the password-verify path until stage 7d removes it
- **A stable `SESSION_TOKEN_SECRET` is required for durable invite links**: without it the signing secret is process-local and random, so newly minted invite links (like sessions) stop working after every restart or when routed to another pod. The server logs an explicit startup warning in that configuration. The secret is deliberately never stored in the database or in backups — a leaked backup must not allow forging session tokens or invite credentials

### AI Endpoints

- All `/api/ai/*` endpoints require a valid team session token; anonymous network callers cannot drive the internal LLM
- AI is disabled by default and configured through the super-admin panel

## Security Considerations

### Team Passwords

Team passwords are **hashed at rest** (scrypt via Node's crypto module — memory-hard, salted per record). **Only a scrypt record authenticates**: a stored value in any other shape is refused, so a team record predating password hashing cannot be used to log in. Converting one is the startup migration's job alone (`server/services/passwordMigration.js`), which runs on every boot **and after either restore route** — that hook is what normally keeps a rollback to a pre-hashing archive from stranding teams. It is a best-effort pass, not a guarantee: it counts per-team failures and neither the restore routes nor the boot sequence fail on them, so a team whose conversion fails (a write conflict, a store error) cannot log in until a later boot converts it successfully. Check the migration line in the super-admin log viewer after restoring an old archive — it reports `N record(s) hashed, M failed` on every boot, including the clean one. The authentication path itself performs no writes. "At rest" covers stored data only — a verified password is also held in the running process's memory (see *Verified Passwords in Process Memory* below).

**There is no minimum-strength policy beyond four characters.** The server accepts any team password of four characters or more, with no complexity, dictionary or reuse check, and no account lockout. The only brake on guessing is the rate limiter on `/api/team/login`: **20 rejected attempts per fifteen minutes, keyed on the client IP together with the team name, and counted per pod** — so a two-replica deployment admits roughly 3 800 guesses a day from one address against one team. (`AUTH_RATE_LIMIT_MAX`, documented elsewhere as 5, governs team creation and session restore, neither of which verifies a guessed password.) A team password is a *shared* secret protecting that team's entire history, so choosing a strong one is currently an operator responsibility rather than something the application enforces.

What the browser and invite links hold:

- **Newly minted invite links carry an invite credential, not the password** (see Invite Credentials above). Links minted before this change embed the plain team password in the URL and still work, because they authenticate through the ordinary password path; treat those older invite emails and chat messages as containing the team password, and rotate the password to invalidate them.
- **The browser never persists the team password.** Saved-session data holds only the session token; a session restored after a page refresh mints invite links through the server-derived invite credential, and changing the team password from a restored session prompts for the current password.

For production deployments:

- Use strong, unique passwords for each team
- Consider network-level access controls
- Deploy behind a VPN or authenticated proxy for sensitive environments

### Verified Passwords in Process Memory

`server/services/passwordHashing.js` keeps a bounded in-memory verification cache: once a password verifies against a scrypt record, the plaintext is kept in a `Map` keyed by that stored hash string, so the next request presenting the same password costs a constant-time buffer compare instead of a fresh scrypt derivation. A team credential is checked on every team and feedback API call, and clients holding only a password resend it each time, so without the cache every such call would pay the full memory-hard derivation.

- **Only successful verifications are cached**, and every successful verification is by definition against a scrypt record — a stored value in any other shape never authenticates, so nothing else can reach the cache.
- **The cache is bounded to 1000 entries per process**; when it is full, the oldest inserted entry is evicted before a new one is added. Eviction follows insertion order, not recency of use: a cache hit does not refresh an entry's position, so a password presented on every request is still evicted once 1000 other records have been cached after it. Eviction only drops the reference — the plaintext buffer is not zeroed, so its bytes remain in the heap until it is garbage collected and that memory is reused.
- **It lives in process memory only** — never written to the database, a file or a backup — and each pod has its own. There is no expiry: an entry stays until the bound evicts it or the process exits. A password change produces a new stored hash, so an old entry can never authenticate the new credential; it simply lingers unused until evicted.

For an operator this means the memory of a running server process is credential material: a core dump, a heap snapshot, a debugger attached to the process, or memory swapped to disk can expose the cache's up-to-1000 team passwords in clear text. Treat that as a floor rather than a ceiling: a credential being verified at that instant is in the same memory whether or not the cache holds it. Mitigate it the usual way — restrict host and container access, disable core dumps, and treat pod memory dumps and heap snapshots as secrets.

This is a conscious trade-off (scrypt cost per request against plaintext residency in RAM), not an oversight. It **qualifies** the "hashed at rest" statement above — stored records and backups still hold only hashes for upgraded teams — rather than contradicting it.

### Backups and Team Passwords

Server-side backups and downloaded backup archives contain each team's stored credential — a scrypt hash for every record the startup migration has converted, which on a current deployment is all of them. **Archives created before password hashing shipped contain every password in clear text.** Restoring one puts those records back, which is why both restore routes re-run the password migration over the restored data: the records are converted immediately rather than on each team's next login, because a non-scrypt record cannot authenticate at all. Treat backup files and the super-admin credential with the same care as the database itself:

- Restrict access to the backup volume/table and to `/api/super-admin/backups/download`
- Store downloaded archives in an encrypted location and delete them when no longer needed

**What an archive does and does not contain.** It carries teams (with their members, retrospectives, health checks, actions and feedbacks), the team-name index, password-reset tokens and orphaned feedbacks. It does **not** carry `global-settings` — AI configuration, admin email, the info banner — nor live session state. Restoring into a fresh, empty database therefore restores the data but not the deployment's global configuration, which has to be re-entered from the super-admin panel.

### AI / LLM Configuration

AI is disabled by default and configured only from the super-admin panel. Three properties of that configuration matter to an operator, and all three are deliberate:

- **The API key is stored unencrypted** in the `global-settings` record of the application database, and `/api/super-admin/ai-settings` returns it in clear text to the authenticated super-admin client. It is *not* included in backup archives (those carry team data only). Access to the database or to the super-admin credential is therefore access to a live third-party API credential.
- **`allowSelfSignedCerts` disables TLS certificate verification** on the outbound call to the LLM (`rejectUnauthorized: false`). It exists for internal endpoints whose enterprise CA the container does not trust; prefer mounting that CA (see *Corporate proxy and custom CA* in the README) and leave the switch off.
- **Enabling AI exports retrospective content** — ticket text, group titles and participant-authored notes, which routinely name colleagues — to whatever `apiUrl` is configured. Record that endpoint in the deployment's data-processing documentation before enabling the feature, and prefer an endpoint inside the same trust boundary as the application.

### Database Security

- SQLite database is unencrypted at rest
- The PostgreSQL deployment shipped in `k8s/` stores its data on an ordinary PersistentVolumeClaim with no application-level encryption; encryption at rest, if required, comes from the cluster's storage class
- Ensure the data volume has appropriate filesystem permissions
- Regular backups are recommended. The application's own backups live in a `backups` table **inside the same database they protect**, so they survive a bad restore or an accidental deletion but not the loss of the volume — keep an independent `pg_dump` outside the cluster as well (see `k8s/README.md`)

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
