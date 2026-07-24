# RetroGemini Hardening Status

_Last updated: 2026-07-24_

This document is the handoff state for future Codex/AI sessions that continue the
hardening work from `retrogeminihardeningaudit.md`. Keep this file current after
each hardening PR so the next session does not need to rediscover what has
already been done.

## Source audit

- Original audit file: `retrogeminihardeningaudit.md`.
- Current status: keep the audit as historical source material; use this file as
  the up-to-date implementation tracker and test plan.
- The audit is intentionally broader than the current implementation. Do not
  assume an item is complete unless it is listed in the completed section below.

## Completed in the current hardening branch

### 1. Public route abuse hardening

Implemented in:

- `server/routes/publicRoutes.js`
- `server/routes/passwordResetRoutes.js`
- `server/routes/superAdminRoutes.js`
- `__tests__/routeHardening.test.ts`

Completed items:

- `/api/send-invite` intentionally has no request-count limiter so facilitators
  can invite large groups without a 15-minute lockout. Input validation still
  rejects malformed email and link fields.
- Added invite email validation before attempting to send mail.
- Added invite link type and length validation before attempting to send mail.
- Added an IP-based limiter to `/api/notify-new-feedback`.
- Added feedback notification shape and length validation.
- Added an IP-based limiter to `/api/send-password-reset`.
- Added password reset email, reset-link and team-name validation before touching
  reset-token state.
- Moved `/api/super-admin/restore` authentication before raw body parsing so
  unauthenticated callers cannot force body buffering first.
- Replaced the previous 1 GB restore body limit with `RESTORE_MAX_BODY_MB`,
  defaulting to 128 MB for better compatibility with image-heavy generated
  backups while still bounding memory use.
- Capped `/api/ai/generate-release-analysis` input before calling the AI service:
  - Requests with more than 50 retrospectives are rejected instead of silently
    omitting selected retrospectives.
  - `customPrompt` is capped to 4000 characters.
  - `additionalInstructions` is capped to 4000 characters.

Notes and limits:

- `/api/ai/*` endpoints are now fully authenticated with team session tokens;
  see section 7 below. The input capping from this section still applies.
- Restore decompressed-size caps are now implemented for both uploaded archives
  and stored server-side backups; see section 5 below.

### 2. Graceful shutdown and resource cleanup

Implemented in:

- `server/services/shutdown.js`
- `server/services/dataStore.js`
- `server.js`
- `__tests__/shutdown.test.ts`

Completed items:

- Added a reusable shutdown handler for `SIGTERM` and `SIGINT`.
- Shutdown sequence:
  1. Stop backup scheduler.
  2. Close Socket.IO.
  3. Close HTTP server.
  4. Close PostgreSQL pool or SQLite database.
  5. Exit with code 0 on success.
- Added a hard timeout that exits with code 1 if graceful shutdown hangs.
- Added duplicate-signal protection so repeated signals do not run shutdown twice.
- Added `dataStore.closeDatabase()` for PostgreSQL and SQLite cleanup.

Notes and limits:

- This does not attempt to flush in-flight session writes. The audit correction
  explicitly noted that no reliable handle exists for that today; in-flight writes
  either commit or are recovered by the existing client rejoin/merge/resend path.

### 3. Kubernetes rolling-update resilience

Implemented in:

- `k8s/base/deployment.yaml`
- `k8s/base/poddisruptionbudget.yaml`
- `k8s/base/kustomization.yaml`

Completed items:

- Added a `preStop` hook with `sleep 5` so endpoints can drain before process
  termination.
- Increased readiness, liveness and startup probe `timeoutSeconds` from 1 to 2.
- Added a `PodDisruptionBudget` with `minAvailable: 1`.
- Included the PDB in the base Kustomize resources.

Notes and limits:

- `/ready` intentionally remains pod-local and does not check the shared
  database. The audit correction explicitly warned that DB-dependent readiness
  would remove all pods from service during a shared database blip and defeat
  degraded-mode behavior.

### 4. Stateless HMAC-signed tokens

Implemented in:

- `App.tsx`
- `server/services/sessionTokens.js`
- `server/routes/superAdminRoutes.js`
- `server.js`
- `__tests__/App.test.tsx`
- `__tests__/sessionTokens.test.ts`
- `__tests__/routeHardening.test.ts`
- `README.md`
- `.env.example`
- `AGENTS.md`
- `k8s/base/deployment.yaml`
- `k8s/secrets-templates/postgresql-secret.yaml`
- `k8s/README.md`

Completed items:

- Replaced per-process `Map()` token stores with versioned HMAC-signed tokens.
- Team session tokens and super-admin session tokens now carry explicit token
  type, issued-at time, expiry time and nonce claims.
- Team session token validation returns the team/visitor claims without needing
  local token state, so tokens can be validated by another pod when the same
  signing secret is configured.
- Super-admin session tokens are also stateless and survive pod changes when the
  signing secret is shared.
- Validation rejects tampered payloads, tokens signed with a different secret
  and expired tokens.
- Super-admin session-token validation uses a separate short-window limiter from
  password login, so stale tokens after `SESSION_TOKEN_SECRET` rotation cannot
  exhaust the strict password-attempt quota.
- Browser startup keeps the saved super-admin token when validation is
  temporarily rate-limited or unavailable; only a `401` invalid/expired-token
  response clears it.
- Added `SESSION_TOKEN_SECRET` documentation for multi-pod and restart-safe
  deployments.
- Added optional `SESSION_TOKEN_SECRET` wiring to the Kubernetes deployment and
  secret template. It is optional in the deployment so existing clusters without
  the new key keep using the documented fallback until their secret is updated.

Notes and limits:

- Set the same `SESSION_TOKEN_SECRET` on every pod. If it is unset,
  `SUPER_ADMIN_PASSWORD` is used as a compatibility fallback when configured.
  If neither value is set, the service logs a warning and uses a process-local
  random secret; that preserves functionality but does not satisfy restart or
  multi-pod token continuity.
- `invalidateSessionToken()` is now a no-op because signed stateless tokens
  cannot be revoked locally. Restore still loads the referenced team after token
  validation and rejects tokens for missing teams.

### 5. Restore decompressed-size caps

Implemented in:

- `server/services/restoreArchive.js`
- `server/routes/superAdminRoutes.js`
- `server/services/backupService.js`
- `__tests__/routeHardening.test.ts`
- `__tests__/backupService.test.ts`
- `README.md`
- `.env.example`
- `AGENTS.md`
- `k8s/base/deployment.yaml`
- `k8s/README.md`

Completed items:

- Added `RESTORE_MAX_DECOMPRESSED_MB`, defaulting to 512 MB.
- Added `RESTORE_MAX_BODY_MB=128` and `RESTORE_MAX_DECOMPRESSED_MB=512` to the
  Kubernetes deployment so cluster config is explicit and matches the code
  defaults.
- Uploaded super-admin restores now gunzip through a streaming size counter and
  return `413` before parsing JSON when decompressed output exceeds the cap.
- Stored server-side backup restores use the same capped parser, so a compressed
  backup record cannot expand without bound during restore.
- JSON archives are also checked against the decompressed-size cap.
- Gzip detection supports `application/gzip`, `application/x-gzip` and gzip
  magic bytes for compatibility with generic `application/octet-stream` clients.

Notes and limits:

- `RESTORE_MAX_BODY_MB` still caps the compressed/uploaded request body before
  route handling; `RESTORE_MAX_DECOMPRESSED_MB` caps the expanded JSON data that
  is actually parsed.
- Restore remains merge-like rather than faithful replace; deleting teams absent
  from the archive and cross-pod session-cache invalidation remain separate
  backlog work.

### 6. Versioning

Implemented in:

- `VERSION`

Completed items:

- Bumped `VERSION` from `27.0` to `27.1` for internal/security hardening.
- Bumped `VERSION` from `27.3` to `27.4` for stateless-token and restore-cap
  hardening.
- Bumped `VERSION` from `27.4` to `27.5` for the super-admin session-validation
  rate-limit regression fix.
- Bumped `VERSION` from `27.7` to `27.8` for the AI route authentication
  hardening.
- Bumped `VERSION` from `27.8` to `27.9` after `27.8` was deployed, for the
  follow-up that exempts authenticated AI requests from rate limiting.
- Bumped `VERSION` from `27.9` to `27.10` for the stage-7a token-auth
  hardening on team and feedback endpoints.
- Bumped `VERSION` from `27.10` to `27.11` for the stage-7b client
  token-preference hardening.
- Bumped `VERSION` from `27.11` to `27.12` for the stage-7c
  password-hashing-at-rest hardening.
- Bumped `VERSION` from `27.12` to `27.13` for the stage-7e invite-credential
  hardening.
- Bumped `VERSION` from `27.15` to `27.16` for the socket `update-session`
  flood-throttle + shape-validation hardening (audit PR-12). (`27.13` → `27.15`
  were unrelated post-7e merges: release-analysis bug fixes and CI/dependency
  bookkeeping.)
- Bumped `VERSION` from `27.16` to `27.17` for the faithful-restore semantics +
  cross-pod session-cache invalidation hardening (audit PR-6).
- Bumped `VERSION` from `27.17` to `27.18` for the multi-pod backup scheduler
  election hardening (audit PR-13 / R16).
- No `CHANGELOG.md` entry was added, matching the repo rule that security fixes,
  bug fixes and internal hardening bump `Y` only and do not produce user-facing
  changelog entries.

### 7. AI route authentication (audit PR-4)

Implemented in:

- `server/routes/aiRoutes.js` (new module; the four `/api/ai/*` endpoints moved
  out of `server/routes/superAdminRoutes.js`)
- `server.js`
- `components/Session.tsx`
- `components/session/ReviewPhase.tsx`
- `components/dashboard/ReleaseAnalysisModal.tsx`
- `__tests__/aiRoutes.test.ts` (new; also absorbed the two release-analysis cap
  tests previously in `__tests__/routeHardening.test.ts`)
- `__tests__/releaseAnalysisModal.test.tsx`
- `AGENTS.md`

Completed items:

- All four `/api/ai/*` endpoints (`suggest-group-title`, `suggest-groups`,
  `generate-retro-summary`, `generate-release-analysis`) now require a valid
  team session token (`sessionToken` in the request body) before any input
  processing or AI service call.
- The token is validated statelessly (HMAC, from section 4) and the referenced
  team must still exist in the data store; missing, invalid, expired or
  team-orphaned tokens all return `401 { error: 'unauthorized' }`.
- Authentication runs before input validation, so anonymous callers cannot
  probe input-shape behavior either.
- The client sends the token from the in-memory auth state
  (`dataService.getSessionToken()`) at every AI call site: group-title
  suggestion, group suggestions, the two retro-summary paths, and release
  analysis. All authenticated client paths (login, team creation, session
  restore, invite join) hold a session token, so the change is invisible to
  users.
- `/api/team/create` now issues a session token in its response and the client
  stores it, so a facilitator who just created a team can use AI features
  without logging out and back in (review finding).
- Authenticated AI requests are never rate limited (product decision: a
  facilitator grouping tickets must not lock up mid-session). The 30/min
  per-IP limiter only applies to requests without a validly signed token —
  unauthenticated or garbage-token spam from a shared proxy/NAT IP exhausts
  only that per-IP bucket and can never starve a logged-in team (review
  finding). The release-analysis input caps from section 1 are unchanged.

Notes and limits:

- This intentionally breaks any third-party automation that called `/api/ai/*`
  anonymously. The audit flagged checking access logs for such callers as a
  pre-merge blocker (decision #3); confirm before merging or communicate the
  break. Such callers can be migrated by logging in with team credentials and
  reusing the returned `sessionToken`.
- Authorization is team-level, not payload-level: any authenticated team member
  can submit any payload (the AI endpoints remain stateless prompt builders and
  do not read other teams' data server-side). Binding payload contents to the
  caller's team remains out of scope, matching the audit's note that current AI
  payloads carry no team identifiers.

### 8. Documentation truth pass (audit PR-9, docs only)

Implemented in (no code changes, no retest needed):

- `README.md`
- `SECURITY.md`
- `AGENTS.md`
- `.env.example`
- `AUDIT_REPORT.md`

Completed items:

- `README.md`: the Data Persistence section no longer claims SQLite-only —
  PostgreSQL (recommended for multi-pod) and the Redis/PostgreSQL Socket.IO
  adapters are documented; the env table gained `DATABASE_URL`, `REDIS_URL`,
  `AUTH_RATE_LIMIT_MAX`, `TRUST_PROXY` and the correct `PORT` default.
- `SECURITY.md`: added sections describing the stateless HMAC session tokens
  (`SESSION_TOKEN_SECRET` guidance), the authenticated `/api/ai/*` endpoints,
  the actual rate-limiting behavior, and an explicit warning that server-side
  backups contain every team's password in clear text until password hashing
  ships.
- `AGENTS.md`: the API table now lists all real endpoints (team routes,
  feedback routes, password-reset verify/confirm, info-message) and marks
  `/api/data` as deprecated (it returns `410`); the env list gained
  `REDIS_URL`/`REDIS_HOST`, `CORS_ORIGIN` and `TRUST_PROXY`.
- `.env.example`: added the previously undocumented `TRUST_PROXY`,
  `AUTH_RATE_LIMIT_MAX` and Redis adapter variables.
- `AUDIT_REPORT.md`: prefixed with a "historical document" banner pointing to
  this file, since its 2025 findings (no tests, no CI, no linting) are long
  obsolete.

### 9. Password-hashing stage 7a — token auth on team endpoints (audit PR-7a)

Implemented in:

- `server/services/teamService.js`
- `server/routes/teamRoutes.js`
- `server/routes/feedbackRoutes.js`
- `server.js`
- `__tests__/teamTokenAuth.test.ts` (new)
- `SECURITY.md`
- `AGENTS.md`

Completed items:

- `authenticateTeam(teamId, password, sessionToken)` — the single auth choke
  point used by all 8 password-protected `/api/team/:teamId/*` endpoints and
  all 5 `/api/feedbacks/*` endpoints — now accepts a valid team session token
  (HMAC-signed, from section 4) as an alternative credential to the plaintext
  password. Purely additive: either valid credential grants access.
- The token must be minted for the exact team being addressed
  (`claims.teamId === teamId`); a token for one team never authenticates
  requests against another team, including feedback routes where `teamId`
  comes from the request body.
- Password behavior is byte-for-byte unchanged: valid password still works,
  wrong password still returns `invalid_password`, credential-less requests
  still return `invalid_password`, unknown teams still return
  `team_not_found`. A token-only failure returns the new `invalid_token` code.
- A valid token wins even when an outdated password is also supplied, so a
  member whose team password was rotated mid-session keeps working until the
  client refreshes its stored password.
- `createTeamService` takes an optional `tokenService`; when absent (older
  tests/tools), token auth is simply disabled and password auth is unchanged.
- Documented the alternative-credential behavior in `SECURITY.md` (including
  the `SESSION_TOKEN_SECRET` rotation implication) and in the `AGENTS.md`
  API reference.

Notes and limits:

- This is stage 7a of the audit's 4-stage plan. The client still sends
  passwords everywhere; stage 7b (client prefers token auth after
  login/restore) is the next step, followed by 7c (bcrypt-at-rest with
  dual-verify and rehash-on-login) and 7d (plaintext-compare removal).
- Read the audit traps before starting 7c: C-7c (invite-link generation reads
  the in-memory plaintext password, so `restore-session` must keep returning
  `password` until invite links are migrated) and R4b (restoring pre-hashing
  backups reintroduces plaintext records; dual-verify covers it).
- Rate-limiting behavior on team routes is unchanged in this stage;
  token-authenticated requests use the same limiters as password requests.

### 10. Password-hashing stage 7b — client prefers the session token (audit PR-7b)

Implemented in:

- `services/dataService.ts`
- `components/TeamFeedback.tsx`
- `components/Dashboard.tsx`
- `__tests__/dataServiceTokenAuth.test.tsx` (new)

Completed items:

- The central `apiCall()` helper now sends `sessionToken` alongside `password`
  on every team/feedback request. The stage-7a server checks the password
  first and a valid token rescues a stale password, so always sending both
  can never regress: after a `SESSION_TOKEN_SECRET` rotation a stale token
  plus a valid password still authenticates, and after a mid-session password
  rotation the token keeps the member working.
- `JSON.stringify` drops the `sessionToken` key when no token is held, so
  invite-only sessions (`setAuthFromInvite()` sets a password but no token)
  keep their exact previous request payload.
- The credential guards that silently skipped persistence without an
  in-memory password (`persistRetrospective`, `persistHealthCheck`,
  `persistAction`, `persistMembers`, `persistTeamUpdate`, `refreshFromServer`,
  `deleteTeam`) now accept token-or-password, so a token-only session — what
  `restore-session` will produce once stage 7c stops echoing the plaintext
  password — reads and writes normally instead of dropping writes.
- `isAuthenticated()` is token-aware for the same reason.
- The 7b pointer in this file claimed `services/dataService.ts` was the only
  client module calling team/feedback endpoints; that was incomplete.
  `components/TeamFeedback.tsx` makes four direct `/api/feedbacks/*` fetches
  and `components/Dashboard.tsx` one (`/api/feedbacks/create`). All five now
  carry the session token too (TeamFeedback via a new optional `sessionToken`
  prop supplied by Dashboard from `dataService.getSessionToken()`).
- Unchanged on purpose: login/create/restore, `/api/team/:teamId/password`
  (changing the password still requires the in-memory password), and
  invite-link generation, which embeds the plaintext password (trap C-7c) and
  still throws in a token-only session. New tests lock these guards.

Notes and limits:

- The plaintext password is still sent whenever the client holds one; 7b only
  makes the token sufficient. Removing the password from routine calls is
  stage 7d, after 7c (bcrypt-at-rest with dual-verify) and after invite-link
  generation is migrated off the plaintext password.
- `restore-session` must keep returning `password` until invite-link
  generation is migrated (trap C-7c), so real token-only sessions do not
  exist yet; the new tests simulate them to keep 7c unblocked.

### 11. Password-hashing stage 7c — hash at rest with dual-verify (audit PR-7c)

Implemented in:

- `server/services/passwordHashing.js` (new)
- `server/services/teamService.js`
- `server/routes/teamRoutes.js`
- `server/routes/superAdminRoutes.js`
- `server/routes/passwordResetRoutes.js`
- `services/dataService.ts`
- `App.tsx`
- `__tests__/passwordHashing.test.ts` (new)
- `__tests__/teamTokenAuth.test.ts`
- `__tests__/dataServiceTokenAuth.test.tsx`
- `SECURITY.md`
- `AGENTS.md`

Completed items:

- Team passwords are hashed at rest using **Node's built-in `crypto.scrypt`**
  (N=16384, r=8, p=1, 16-byte salt, 32-byte key, parameters stored per record
  as `scrypt$N$r$p$salt$hash`). scrypt was chosen over a bcrypt dependency on
  purpose: no new npm package for the air-gapped deployment, memory-hard, and
  it runs in the libuv threadpool so verification never blocks the event loop.
  Parsed parameters are capped (N ≤ 2^17, r ≤ 16, p ≤ 4, salt/hash length
  bounds) so a crafted record smuggled in via backup restore cannot turn
  verification into a CPU/memory bomb.
- **Dual-verify**: hashed records verify through scrypt with a constant-time
  digest compare; records not parseable as a hash fall back to a
  length-hiding constant-time plaintext compare (this also removes the
  non-constant-time `!==` comparison the audit flagged). Old invite links,
  which embed the plain team secret forever, keep working at every stage.
- **Rehash-on-auth**: a legacy plaintext record that successfully verifies is
  upgraded to a hash in place — on `/api/team/login` and on any
  password-authenticated team/feedback call. The guarded updater (only
  upgrade if the record is still the same plaintext) plus `atomicTeamUpdate`
  CAS retries make the two-pod upgrade race harmless (audit's failure-mode
  table row for PR-7c), and an upgrade failure never fails the
  authentication itself.
- All four password-writing paths now store hashes: team create, team
  password change, super-admin `update-password`, and password-reset
  confirm.
- `authenticateTeam` now checks the **session token first** and the password
  second. 7b clients send both credentials on every call; the HMAC check is
  cheap while scrypt is deliberately expensive. The outcome is identical to
  the old password-first order for every credential combination, so observable
  behavior and error codes are unchanged.
- A bounded positive-verify cache (keyed by the full stored hash string, so a
  password change with its new salt can never serve a stale positive) keeps
  password-only clients (invite joins, expired tokens) at
  constant-time-compare cost per call instead of a full scrypt derive.
  Passwords are never run through a fast digest anywhere in the module — not
  for comparison, not for cache keys (CodeQL
  js/insufficient-password-hash) — the only hash a password meets is scrypt;
  comparisons use `timingSafeEqual` on buffers, the same pattern as
  `secureTokenCompare` in `sessionTokens.js`.
- `/api/team/restore-session` echoes `password` **only for legacy plaintext
  records** (smooth migration for pre-7c localStorage blobs); hashed records
  have no plaintext to return. To keep trap C-7c closed, the client now
  persists the team password in its saved-session localStorage blob and
  `restoreSession(token, fallbackPassword)` uses that local copy when the
  server omits the password — so a restored session can still mint invite
  links (which embed the plain team secret by design) and change the team
  password. A server-echoed password (legacy record) wins over the local
  copy.
- Resolved the open decision recorded after 7b: `/api/team/:teamId/password`
  is now **password-only** — the session token is deliberately not accepted,
  so a leaked token can never rotate the team password and durably take over
  a team. The web client already never sent a token there (7b), so there is
  no client impact.
- Updated `SECURITY.md` (Team Passwords + Backups sections now describe
  hashed-at-rest reality, the legacy-record upgrade path, the invite-link
  plaintext contract, and the browser-local password copy) and the
  `AGENTS.md` team-record documentation.

Notes and limits:

- The client still sends the password alongside the token whenever it holds
  one; removing it from routine calls is stage 7d, after a deprecation
  window (owner call per the audit) and only once pre-hashing backups leave
  the retention window (trap R4b: restoring an old backup reintroduces
  plaintext records, which dual-verify + rehash-on-auth absorb).
- Invite links keep carrying the plain team secret — that is the audit's
  documented contract (they are the shareable credential). The browser's
  saved-session blob now also carries it (documented in `SECURITY.md`);
  static analyzers may flag that as clear-text storage of sensitive data —
  it is a deliberate, documented trade-off required to keep invite minting
  working from restored sessions, and it stores a secret the same browser
  already holds in every invite URL it has generated or joined from.
  CodeQL raises exactly this on the PR
  (`js/clear-text-storage-of-sensitive-data`, high) for the saved-session
  writes in `App.tsx` and `services/dataService.ts`. These should be
  **dismissed as accepted risk** in the repository's code-scanning UI, with
  this section as the rationale: client-side encryption would be theater
  (any key lives in the same JS context an attacker would already control),
  and dropping the local copy breaks invite minting after every browser
  refresh (trap C-7c). Do not restructure the code just to silence the
  scanner.
- Legacy records are upgraded lazily (on next successful password auth), not
  by a bulk migration, so a database dump taken after deploy can still
  contain plaintext for dormant teams until they next log in. Token-first
  ordering would have starved that migration for restored pre-hashing
  sessions (their calls authenticate via token), so `authenticateTeam` also
  upgrades opportunistically when a token-authenticated call carries the
  correct plaintext password for a still-legacy record (review finding).
- Stage-7c review follow-ups applied on the PR: the scrypt derive is wrapped
  in try/catch with an explicit `maxmem` and tightened parameter caps
  (r ≤ 8, p ≤ 2), so a crafted or corrupted stored record can only read as a
  failed match, never as a 500 that locks the team out;
  `createMemberInvite` now refuses a token-only session just like
  `createSessionInvite`, instead of minting invite links whose payload has no
  password and cannot join; `changeTeamPassword` patches the saved-session
  blob's password copy in place (the `App.tsx` persist effect does not rerun
  on rotation), so a reload after rotating the password no longer restores
  the stale secret into new invite links. One suggestion was deliberately
  rejected: falling back to plaintext compare when a stored value parses as
  a hash would let a leaked hash string authenticate as the password
  (pass-the-hash); the theoretical lockout requires a human password that is
  literally a full valid `scrypt$...` record.
- Residual, unavoidable client-side gap: if the password is rotated by a
  *different* session, other sessions keep working via their tokens but
  their local password copies are stale, so invite links they mint embed the
  old password until they re-login. Pre-7c the server self-healed this on
  reload by echoing the current plaintext — with hashing there is no
  plaintext to echo, and rotating a shared secret is supposed to invalidate
  distributed copies anyway.

### 12. Password-hashing stage 7e — invite credentials replace the plaintext password in invite links (post-7c corrective)

Implemented in:

- `server/services/sessionTokens.js` (new `team-invite` token family)
- `server/services/teamService.js` (`getTeamInviteEpoch`, `inviteEpoch` stripped
  from client responses)
- `server/routes/teamRoutes.js` (mint endpoint, login via `inviteCredential`,
  epoch bump on password change, epoch protected in `/update`, restore-session
  echo removed)
- `server/routes/superAdminRoutes.js` (epoch bump on `update-password`)
- `server/routes/passwordResetRoutes.js` (epoch bump on reset confirm)
- `services/dataService.ts`
- `App.tsx`
- `components/TeamLogin.tsx`
- `components/InviteModal.tsx`
- `components/Dashboard.tsx`
- `__tests__/sessionTokens.test.ts`
- `__tests__/teamTokenAuth.test.ts`
- `__tests__/dataService.test.ts`
- `__tests__/dataServiceTokenAuth.test.tsx`
- `e2e/retro-full-flow.spec.ts`, `e2e/healthcheck-full-flow.spec.ts`,
  `e2e/retro-participants-origin.spec.ts` (async invite-link waits)
- `SECURITY.md`
- `AGENTS.md`

Completed items:

- New **invite credential** token family (`team-invite`, version-prefixed like
  session tokens, signed with the same `SESSION_TOKEN_SECRET`): claims are
  `{teamId, epoch}` only — deliberately **deterministic** (no iat/nonce, so the
  credential is derived on demand and never stored) and **non-time-expiring**
  (invite links have always lived until the password rotated; revocation is by
  epoch instead of clock). The `type` claim seals token families: a session
  token can never join as an invite credential and vice versa (tested).
- Per-team `inviteEpoch` counter on the team record (absent = 0 for legacy
  records). All three password-rotation paths bump it (team password route,
  super-admin `update-password`, email reset confirm), revoking every
  outstanding invite link at once — matching pre-7e behavior where rotation
  broke links because they embedded the old password, and adding the revocation
  ability invite links never had. `inviteEpoch` is stripped from client
  responses (like `passwordHash`) and cannot be written back through
  `/api/team/:teamId/update`, so a client can never restore an older epoch to
  re-validate revoked links.
- New `POST /api/team/:teamId/invite-credential` endpoint: any authenticated
  session (password **or** session token) derives the current credential. This
  is the exit from trap C-7c — a restored token-only session mints working
  invite links without the client ever persisting the password.
- `/api/team/login` accepts `inviteCredential` as an alternative to `password`
  (team resolved by name exactly as before, then `claims.teamId` and
  `claims.epoch` must match). Old links carrying `password` keep joining
  through dual-verify until 7d. Credential-only failures return
  `invalid_invite_credential`; password behavior and error codes unchanged.
- Client: `createSessionInvite` / `createMemberInvite` /
  `createHealthCheckInvite` are now async and embed the fetched credential
  (60-second in-memory cache, cleared on logout and password change — which
  also bounds the documented 7c residual of stale links after another session
  rotates the password to ≤60s of modal reuse instead of "until re-login").
  `importTeam` sends `inviteCredential` when the link carries one.
  InviteModal generates the link in an effect (loading state until ready).
- **The plaintext password no longer touches localStorage**: the saved-session
  blob holds only the session token, `restoreSession()` takes no fallback
  password, and `/api/team/restore-session` **never echoes a password anymore,
  even for legacy plaintext records** (old blobs still containing
  `teamPassword` are rewritten without it on first restore). This closes the
  four CodeQL `js/clear-text-storage-of-sensitive-data` alerts dismissed as
  accepted risk on PR #366 — the flagged sinks no longer exist; the dismissed
  alerts should now be closed as fixed in the code-scanning UI.
- Changing the team password from a restored (token-only) session now prompts
  for the current password in the dashboard settings (the route was already
  password-only since 7c; pre-7e the localStorage copy silently supplied it).
  `changeTeamPassword(teamId, newPassword, currentPassword?)` passes an
  explicit current password through, and surfaces "Current password is
  incorrect" instead of a generic failure.
- `SECURITY.md` invite-link and local-storage paragraphs rewritten (new
  Invite Credentials section); `AGENTS.md` API table and team-record docs
  updated.

Notes and limits:

- Old invite links minted before 7e still embed the plaintext password and
  keep working through dual-verify; they die at stage 7d with the
  plaintext-compare removal. New links reveal nothing if leaked after a
  rotation (the credential is dead and contains no secret).
- The login-by-name semantics are unchanged on purpose: renaming a team still
  invalidates outstanding invite links (they carry the old name), exactly as
  before 7e.
- Restoring a database backup restores each team's `inviteEpoch` alongside its
  `passwordHash`, so links and passwords stay consistent with each other.
- An invite-credential join issues a normal session token, so invited
  participants can themselves open the invite modal — the mint endpoint only
  requires an authenticated session, same trust model as before (any member
  who held the password could always share it).

Stage-7e review follow-ups applied on PR #367:

- CodeQL's `js/user-controlled-bypass` (high) fired repeatedly on the login
  handler: it flags **any** early-return input-presence guard that tests a
  `req.body` field before the credential verification. Cleared over three
  iterations: (1) both the invite-credential and password verifications now
  **always run** (each rejects a missing/blank credential internally); (2)
  the `missing_credentials` decision moved **after** those verifications, so
  credential presence only selects the 400/401 response code; (3) the last
  remaining guard, `if (!teamName)`, was removed entirely — a blank name now
  resolves to no team and returns `team_not_found`, which the team lookup
  already did, so the guard had no security value and was pure
  false-positive bait. Net behavior change: a login with a blank/missing
  team name returns `team_not_found` (401) instead of `missing_credentials`
  (400); login was never anti-enumerating, so this leaks nothing new, and
  the `missing_credentials` 400 still returns for the real case (known team,
  no credentials). This is the documented pattern to avoid in this repo:
  input-presence validation on an auth handler will trip CodeQL — either
  fold the check into the natural lookup/verify path (as here) or dismiss
  the alert as a false positive with rationale, but never gate the actual
  credential verification on a request field.
- Regression caught by CI (not the local subset run): calling
  `validateInviteCredential` unconditionally surfaced an incomplete
  `tokenService` mock in `teamRenameIndex.test.ts` as a 500. The real
  service always exposes the method; the mock was completed. Lesson recorded
  in `AGENTS.md` ("After Opening a Pull Request"): re-run the **full** suite
  before pushing a fix, since an auth-handler change can break another
  suite's mock.
- Codex flagged a real gap (P2): with no `SESSION_TOKEN_SECRET` configured,
  the signing secret is process-local and random, so newly minted invite
  links die on restart or on another pod — where password-embedding links
  survived. **Owner decision: documented requirement, not persisted secret.**
  The startup warning now names invite links explicitly, and README /
  AGENTS.md / .env.example / k8s/README.md / SECURITY.md all state that a
  stable `SESSION_TOKEN_SECRET` is required for durable invite links. The
  alternative — generating a secret on first boot and persisting it in the
  data store — was deliberately rejected: the HMAC secret would land in the
  database and in every backup archive, so a leaked backup would allow
  forging session tokens and invite credentials for every team. Deployments
  without the secret already accept non-durable sessions; new invite links
  now share that documented property (old password links continue to work).

### 13. Socket `update-session` flood throttle + shape validation (audit PR-12)

Implemented in:

- `server/services/socketHandlers.js` (new `validateSessionUpdateShape`,
  `consumeUpdateToken`, `parseUpdateThrottleConfig`; wired into the
  `update-session` handler)
- `__tests__/socketUpdateThrottle.test.ts` (new; pure-unit + integration
  coverage)
- `.env.example`, `k8s/base/deployment.yaml`, `k8s/README.md`, `AGENTS.md`
  (env parity + Socket.IO event doc)
- `VERSION` (`27.15` → `27.16`)

Completed items:

- **Cheap top-level shape validation before the CAS.** `update-session` now
  runs `validateSessionUpdateShape(sessionData, sessionId)` first. It keeps the
  previous checks (must be a plain object, blob `id` must match the joined
  session) and adds a **non-negative-safe-integer `_rev` guard**: because
  `saveSessionState` coerces `_rev` with `Number()` and advances it with
  `+ 1`, a crafted `_rev` would otherwise poison the optimistic-concurrency CAS
  — `"abc"`/`{}` coerce to `NaN`, and a finite-but-unsafe magnitude such as
  `2**53` or `1e308` does not advance under `+ 1`, freezing the revision line so
  later stale blobs stamped with the same huge value are no longer ordered by
  the CAS (Codex P1 review finding). Legitimate clients always stamp a
  non-negative integer `_rev` (`services/syncService.ts` does
  `Number(...) || 0`; the server only stores `Math.max(...) + 1`), so this
  never rejects a real write. This closes a real revision-poisoning gap, not
  just a theoretical one.
- **Per-socket token-bucket throttle (`consumeUpdateToken`).** An optional
  token bucket caps how many `update-session` writes one client can drive
  through the expensive path (DB read + CAS write + room broadcast).
  Configured by `SOCKET_UPDATE_RATE` (sustained writes/second, default `0` =
  disabled) and `SOCKET_UPDATE_BURST` (momentary burst, default `2 × rate`).
  Bucket state lives on `socket.data.updateBucket`; the config is read once at
  handler registration.
- **A throttled write is healed, never dropped.** The throttle only engages
  when the session is in this pod's cache, so a throttled write can always be
  healed by emitting the cached authoritative state (`sessionCache.get`, an
  in-memory O(1) read — no DB, no broadcast); its `syncService` re-applies its
  own data and re-sends. A throttled legitimate burst therefore costs a
  round-trip, the same contract as a stale-CAS rejection — no user action is
  lost (audit failure-mode row for PR-12: "heal-with-authoritative, never drop
  silently"). If the cache has no snapshot (the session's first write, or after
  a `SESSION_CACHE_MAX` LRU eviction), the write is **let through the normal
  path** instead of throttled — there would be no authoritative state to heal
  the sender with, and dropping it would lose the edit (Codex P2 review
  finding). The normal path repopulates the cache, so subsequent writes are
  throttled again.
- Crypto-strong ids for new sessions (the third bullet of audit PR-12) were
  already delivered by the earlier stage-7b review follow-up
  (`utils/randomId.ts` / `crypto.getRandomValues` on the client,
  `crypto.randomBytes` on the server), so PR-12 did not need to repeat it.

Notes and limits:

- **The throttle is disabled by default on purpose.** Enabling it is a
  capacity-sensitive change to the session-sync path, which the repo rule says
  must be load-tested (`npm run test:load`, `loadtest/README.md`) at the real
  cadence before rollout. Shipping it `SOCKET_UPDATE_RATE=0` keeps runtime
  behaviour byte-for-byte unchanged by default (the only added cost on the hot
  path is one `rate > 0` check), so the merge is safe without a staging
  load-test; operators enable it after their own load-test. Timer sync writes
  at ~1/s, so `20` is a generous starting point that legitimate cadence never
  hits.
- The shape validation runs **before** the throttle, so a flood of malformed
  blobs is rejected without consuming tokens (and never reached the DB before
  this change either). The throttle only gates well-formed writes that would
  otherwise hit the CAS.
- The throttle only engages for cached sessions (see the heal bullet above), so
  an uncached write — first write of a session, or after LRU eviction — is
  processed normally rather than throttled. In steady state the cache is always
  populated after the first successful persist, so the throttle is active for
  essentially all live traffic while never dropping an unhealable write.

Stage-13 review follow-ups applied on PR #382 (all four Codex findings):

- **P1 — `_rev` must be a non-negative safe integer, not merely finite.** A
  crafted finite-but-unsafe `_rev` (`2**53`, `1e308`) passed `Number.isFinite`
  but does not advance under `saveSessionState`'s `+ 1`, so one accepted blob
  could freeze the revision line and let later stale blobs stamped with the
  same huge value bypass the CAS. `validateSessionUpdateShape` now requires
  `Number.isSafeInteger(_rev) && _rev >= 0`.
- **P2 — heal-or-defer when the cache is empty.** The throttle previously
  emitted nothing and returned when `sessionCache.get` missed (post-eviction),
  silently dropping the edit. It now only throttles when the session is cached
  and otherwise lets the write through the normal (cache-repopulating) path.
- **P2 — reject a sub-token burst.** `SOCKET_UPDATE_BURST < 1` (e.g. `0.5`)
  would cap the bucket below one token and throttle every write forever;
  `parseUpdateThrottleConfig` now floors the burst to an integer and requires
  `>= 1`, falling back to the derived `2 × rate` default otherwise.
- **P2 — document the knobs in README.** Per the repo's Configuration Parity
  rule (which lists `README.md`), `SOCKET_UPDATE_RATE`/`SOCKET_UPDATE_BURST`
  were added to the README env table alongside the other surfaces.
- New regression coverage for all four in `__tests__/socketUpdateThrottle.test.ts`
  (unsafe/negative/fractional `_rev`; sub-1 burst fallback; a never-caching
  store proving no write is dropped when it cannot be healed).

### 14. Faithful restore semantics + cross-pod cache invalidation (audit PR-6)

Implemented in:

- `server/services/dataStore.js` (`savePersistedData(data, { mode })`; new
  `SESSION_PREFIX`, `kvKeysByPrefix`, `kvDeleteByPrefix` helpers)
- `server/services/boundedCache.js` (new `clear()`)
- `server/services/backupService.js` (`restoreFromBackup` uses replace mode;
  `createBackup` accepts a `{ protected }` option)
- `server/routes/superAdminRoutes.js` (both restore routes: protected
  pre-restore snapshot, replace mode, `invalidateSessionCaches()`)
- `server/services/socketHandlers.js` (cross-pod `sessions-invalidated`
  listener)
- `server.js` (`serverRuntime.multiPodAdapter` flag set after adapter init)
- `__tests__/dataStoreRestore.test.ts` (new), `__tests__/boundedCache.test.ts`,
  `__tests__/backupService.test.ts`, `__tests__/routeHardening.test.ts`,
  `__tests__/socketSessionInvalidation.test.ts` (new)
- `AGENTS.md`, `VERSION` (`27.16` → `27.17`)

Completed items:

- **Restore is now a faithful replace, not a merge.** Before this change,
  `savePersistedData` upserted the archive's teams and rebuilt the login index
  from the archive, but left every `team:{id}` record that was *absent* from
  the archive in place. Because the index was rebuilt (so the ghost team
  dropped out of login) while its record survived, a team deleted since the
  backup lingered as a "ghost" — it still showed up in the `team:` prefix scan
  behind the super-admin dashboard and `loadAllTeams()`. `savePersistedData`
  now takes a `{ mode }` option: `mode: 'replace'` deletes the ghost team
  records and clears **all** live `session:*` state (a backup never carries
  session blobs; a stale session could otherwise let a client re-persist
  pre-restore state and resurrect reverted data). `mode` defaults to `'merge'`
  (the historical additive behaviour), so the change is opt-in and every
  non-restore path is byte-for-byte unchanged. The archive upsert runs before
  the cleanup, so a crash mid-cleanup leaves the restored data in place rather
  than a half-emptied store.
- **Cross-pod session-cache invalidation (audit C-6).** A restore rewrites the
  shared store, but each pod also holds an in-memory `sessionCache`. Clearing
  only the restoring pod's cache leaves the *other* replica able to serve or
  re-persist a stale snapshot (C-6: "single-pod cache clear is not enough at
  `replicas:2`"). After a successful replace, the restore route clears this
  pod's cache directly and `io.serverSideEmit('sessions-invalidated')` so every
  other pod clears its cache via the Redis/PostgreSQL adapter. The broadcast is
  gated on `serverRuntime.multiPodAdapter` (set from `initSocketAdapter`'s
  return value) so single-pod deployments never trigger the in-memory adapter's
  "serverSideEmit not supported" warning. `boundedCache` gained a `clear()`
  method; `socketHandlers` registers the receive-side `io.on('sessions-
  invalidated')` listener (which never fires on the emitting pod, since
  `serverSideEmit` does not loop back).
- **Protected pre-restore snapshot.** Restore is now destructive, so it must be
  recoverable. Both restore routes take a pre-restore backup **first** (if it
  throws, the catch aborts before anything is overwritten) and mark it
  `protected` so retention purge cannot delete the one copy of the pre-restore
  state. `createBackup(type, label, { protected })` gained the option
  (defaulting false, so all existing callers are unchanged); the uploaded
  `/api/super-admin/restore` path — which previously took no pre-restore
  snapshot at all — now takes one too.

Notes and limits:

- **Residual — connected-client resurrection.** Clearing DB session rows and
  all pod caches does not stop a client that is *actively connected* to a live
  session at the instant of restore: its next `update-session` finds no
  authoritative row and re-persists its in-memory blob as a **fresh** session
  row (a new `_rev` line). This is bounded — it produces a new session, never a
  ghost team, and the team data itself is faithfully replaced — and is inherent
  to a live-collaboration system during a global rollback. Preventing it fully
  would require a client-facing "discard your session" signal (frontend + e2e
  scope); the audit's chosen mechanism (cache invalidation) is what shipped.
  Operators should run restores during low activity.
- **Protected pre-restore snapshots accumulate.** Because they are excluded
  from auto-purge, repeated restores leave a protected snapshot each time;
  prune old ones manually from the super-admin backups panel. This is the
  audit's deliberate trade-off ("make the pre-restore snapshot protected …
  excluded from auto-purge") — over-retaining the recovery path beats losing
  it.
- The prefix scans use collation-safe `LIKE 'team:%'` / `LIKE 'session:%'`
  (the same pattern as `kvGetMultipleByPrefix`); `LIKE 'team:%'` never matches
  the `team-index` record (its fourth character is `-`, not `:`).

Stage-14 review follow-ups applied on PR #383 (Codex findings):

- **P1 — reject malformed restore payloads before the destructive replace.**
  The uploaded `/api/super-admin/restore` handler previously coerced a payload
  whose `teams` was missing or not an array to `teams: []`. Harmless under the
  old merge semantics, but a wipe-everything under `mode: 'replace'` — an admin
  uploading `{}`, `{ "teams": {} }` or a truncated file would delete every team
  and live session. The handler now returns `400 { error: 'invalid_backup_data' }`
  for a non-array `teams`; a deliberate "restore to empty" still works via an
  explicit `teams: []`. Regression: `routeHardening.test.ts › rejects a
  malformed restore payload before the destructive replace`.
- **P1 — abort the restore when the pre-restore snapshot cannot be created.**
  `createBackup` returns `null` when another backup is already running or the
  snapshot write fails. Both restore routes ignored that and proceeded to the
  destructive replace with **no recovery point**. Both now return
  `503 { error: 'pre_restore_snapshot_failed' }` when the snapshot is falsy, so
  the replace only runs once a protected pre-restore snapshot exists. Regression:
  `routeHardening.test.ts › aborts the restore when the protected pre-restore
  snapshot cannot be created`.
- **P2 — concurrent team writes during restore can race the replace (documented
  residual, not fixed here).** The one-time `team:` key scan that computes which
  ghost records to delete can race a team create/rename/update landing on
  another pod *during* the restore: a row inserted after the scan is not
  deleted, and index writes can interleave with the archive index rebuild, so
  the store may not exactly match the archive even though the route returns
  success. Fully closing this needs an **exclusive store-level lock** (a
  PostgreSQL advisory lock, plus a maintenance gate all writers honour for the
  single-file SQLite case) — a distributed-locking mechanism materially larger
  than PR-6's scope, which framed restore as a low-activity maintenance
  operation. Left as separate future work; the operational guidance (run
  restores during low activity) already mitigates it, and the protected
  pre-restore snapshot bounds the blast radius. Tracked in the backlog below.

### 15. Multi-pod backup scheduler election (audit PR-13 / R16)

Implemented in:

- `server/services/dataStore.js` (`getRecentStartupBackup` generalized to
  `getRecentBackupByType(type, withinMs)`)
- `server/services/backupService.js` (new `runScheduledBackup` election
  wrapper; startup dedup switched to the generalized query)
- `__tests__/backupService.test.ts` (mock updated to `getRecentBackupByType`;
  new `scheduler election (multi-pod)` suite)
- `AGENTS.md`, `VERSION` (`27.17` → `27.18`)

Completed items:

- **Cross-pod election on scheduled `auto` backups.** Every pod runs its own
  `setInterval` backup scheduler; the previous 5-minute dedup covered only the
  `startup` type, so at `replicas: N` each interval produced **N** `auto`
  backups (R16 stampede). With `BACKUP_MAX_COUNT` retention that collapsed the
  real history horizon to `BACKUP_MAX_COUNT / N` intervals. The scheduler tick
  now runs `runScheduledBackup`, which first checks the shared store for any
  `auto` backup created within an **election window** and skips if one exists —
  the first pod to fire in an interval wins, the rest defer. Result: one `auto`
  backup per interval regardless of pod count, so retention again spans a full
  `BACKUP_MAX_COUNT` intervals.
- **Election window = interval − jitter.** The window is
  `BACKUP_INTERVAL_HOURS` minus a 10% jitter (`AUTO_ELECTION_WINDOW_MS`), so a
  backup that is a *full* interval old (the previous tick) never suppresses the
  current tick's backup, while a backup from *this* tick on any pod does. The
  jitter absorbs the phase spread between pods' independently-anchored interval
  timers and event-loop/clock skew.
- **Generalized the dedup query.** `dataStore.getRecentStartupBackup(withinMs)`
  became `getRecentBackupByType(type, withinMs)` (same single-row
  `type + created_at > cutoff` query pattern, both PG and SQLite branches). The
  startup-backup dedup now calls it with `'startup'`; the scheduler election
  calls it with `'auto'`. Only internal callers referenced the old name.
- `runScheduledBackup` is exposed on the service so the scheduled action is
  directly unit-testable (two instances over one store ⇒ one backup; window
  expiry lets the next interval's backup through) without wall-clock timers.

Notes and limits:

- The election is a **best-effort check-then-write against the shared store**,
  not a distributed lock. Two pods whose interval timers fire within the same
  query round-trip can both observe "no recent auto backup" and both create one
  — so a given interval yields **1, occasionally 2**, never N. Closing the last
  narrow race would need the same exclusive store-level lock called out as the
  PR-6 residual (a PostgreSQL advisory lock + a SQLite maintenance gate);
  disproportionate for a backup-frequency optimization, so it is deliberately
  left as best-effort.
- Manual, startup and pre-restore-snapshot backups are unaffected — the
  election only gates the scheduled `auto` type; every other `createBackup`
  caller still writes unconditionally (subject to the in-process
  `backupInProgress` guard).
- No new env var and no behavior change for single-pod deployments (the window
  check just finds this pod's own recent backup, exactly as intended). The
  documented `BACKUP_INTERVAL_HOURS` semantics are unchanged.

## Review follow-ups applied

The PR review follow-ups have been addressed in the current branch:

- Shutdown now skips `server.close()` when Socket.IO has already made the HTTP
  server stop listening, avoiding a double-close path.
- `/api/send-invite` has no count-based limiter by product decision: large
  facilitation sessions may invite more than 100 people at once.
- Feedback notification payload validation now happens before loading global
  settings or sending mail.
- Password-reset links are validated as HTTP(S) URLs before `new URL()` is used
  for token insertion.
- Email validation accepts internal single-label domains such as `alice@corp`.
- Authenticated AI requests bypass rate limiting entirely (product decision);
  the per-IP limiter only throttles unauthenticated callers, so invalid-token
  spam cannot block a logged-in team.
- Team creation now returns a session token so brand-new facilitators are not
  rejected by the authenticated AI routes before their first re-login.
- Stage-7b review follow-ups (PR #359): `changeTeamPassword()` explicitly
  omits the session token, so changing the credential still requires the
  current credential — a session holding a still-valid token but a
  rotated-away password cannot change the team password (Codex P1 finding).
  All production id generation moved off `Math.random()`: the client now
  uses `utils/randomId.ts` (Web Crypto `getRandomValues`, which unlike
  `crypto.randomUUID` also works on plain-HTTP intranet origins) for member,
  session, ticket, column, template, feedback ids and invite tokens, and the
  server routes use `crypto.randomBytes` for team, member, feedback and
  comment ids. CodeQL (js/insecure-randomness, high) flagged the new
  `sessionToken` prop because the browser session blob
  (`retro-open-session`) persists Math.random-derived ids next to the
  session token and `JSON.parse` taint covers the whole parsed object; the
  token's own security never depended on those ids (HMAC signature and nonce
  were always `crypto`-based), but invite tokens are bearer credentials, so
  crypto-random generation is strictly better anyway.
- ~~Open decision recorded for 7c: the server still accepts a session token on
  `/api/team/:teamId/password`.~~ **Resolved in stage 7c** (see completed
  section 11): that route is now password-only server-side, so a leaked token
  can never rotate the team password.

## Automated checks already run

The following checks were run after the current hardening changes:

- `npm run test -- sessionTokens.test.ts routeHardening.test.ts backupService.test.ts` - passed.
- `npm run test -- restoreArchive.test.ts routeHardening.test.ts backupService.test.ts` - passed.
- `npm run test -- routeHardening.test.ts` - passed after adding the
  super-admin stale-token rate-limit regression test.
- `npm run test -- App.test.tsx routeHardening.test.ts` - passed after adding
  the browser-refresh/session-validation regression tests.
- `npm run test -- routeHardening.test.ts shutdown.test.ts` — passed.
- `npm run test -- aiRoutes.test.ts routeHardening.test.ts` — passed after adding
  the AI route authentication tests.
- `npm run test -- releaseAnalysisModal.test.tsx` — passed after asserting the
  client forwards the team session token to the release-analysis endpoint.
- `npm run lint` — passed with the repo's pre-existing warning backlog.
- `npm run type-check` — passed.
- `npm run test` — passed: 60 files, 519 tests.
- `npm run test:coverage` — passed for the currently configured coverage scope.
- `npm run build` — passed with the existing large-bundle warning.
- `npm audit --omit=dev --audit-level=high` — passed with 0 high vulnerabilities.
- After the stage-7a change (2026-07-10): `npm run lint` (0 errors),
  `npm run type-check`, `npm run test` (61 files, 543 tests including the new
  `teamTokenAuth.test.ts`), `npm run test:coverage`, `npm run build` and
  `npm audit --omit=dev --audit-level=high` (0 vulnerabilities) — all passed.
- After the stage-7b change (2026-07-10): `npm run lint` (0 errors, known
  warning backlog), `npm run type-check`, `npm run test` (62 files, 554 tests
  including the new `dataServiceTokenAuth.test.tsx`), `npm run test:coverage`,
  `npm run build` (known chunk-size warning) and
  `npm audit --omit=dev --audit-level=high` (0 vulnerabilities) — all passed.
- After the stage-7c change (2026-07-20): `npm run lint` (0 errors, known
  warning backlog), `npm run type-check`, `npm run test` (64 files, 585 tests
  including the new `passwordHashing.test.ts` and the extended
  `teamTokenAuth.test.ts` migration suite), `npm run test:coverage`,
  `npm run build` (known chunk-size warning) and
  `npm audit --omit=dev --audit-level=high` (0 vulnerabilities) — all passed.
- After the stage-7e change (2026-07-20): `npm run lint` (0 errors, known
  warning backlog), `npm run type-check`, `npm run test` (64 files, 610 tests
  including the new invite-credential suites in `sessionTokens.test.ts`,
  `teamTokenAuth.test.ts`, `dataService.test.ts` and
  `dataServiceTokenAuth.test.tsx`), `npm run test:coverage`, `npm run build`
  (known chunk-size warning), `npm audit --omit=dev --audit-level=high`
  (0 vulnerabilities), **and the full Playwright e2e suite (10/10 passed
  locally)** — the e2e invite flows exercise the new credential join path
  end-to-end, so they were run in-session this time rather than deferred to
  the PR.
- Before 7e, E2E tests were intentionally not run locally to save session
  time/tokens; the PR owner ran them in GitHub on the PR.
- After the audit PR-6 change (2026-07-23): `npm run lint` (0 errors, known
  warning backlog), `npm run type-check`, `npm run test` (68 files, 646 tests
  including the new `dataStoreRestore.test.ts` and
  `socketSessionInvalidation.test.ts`, plus the extended `boundedCache`,
  `backupService` and `routeHardening` suites), `npm run test:coverage`,
  `npm run build` (known chunk-size warning) and
  `npm audit --omit=dev --audit-level=high` (0 vulnerabilities) — all passed.
  E2e was deferred to the PR: this change is server-side (restore is a
  super-admin-only path with no e2e coverage), so the unit + integration
  suites are the relevant guards.
- After the audit PR-13 change (2026-07-24): `npm run lint` (0 errors, known
  360-warning backlog), `npm run type-check`, `npm run test` (68 files, 652
  tests including the new `scheduler election (multi-pod)` suite in
  `backupService.test.ts`), `npm run build` (known chunk-size warning) and
  `npm audit --omit=dev --audit-level=high` (0 vulnerabilities) — all passed.
  E2e was deferred to the PR: the backup scheduler is a server-side, super-admin
  /operator-facing path with no e2e coverage, so the unit suite is the relevant
  guard.

## Required non-regression test plan for this version

Run this plan before promoting the hardening branch to a real environment.

### A. Automated baseline

Run:

```bash
npm run lint
npm run type-check
npm run test
npm run test:coverage
npm run build
npm audit --omit=dev --audit-level=high
```

Expected result:

- All commands exit successfully.
- `npm run lint` may still print the known warning backlog, but must have 0
  errors.
- `npm run build` may still print the known chunk-size warning.

### B. Playwright end-to-end suite

Run this in the GitHub PR environment rather than from this Codex session. The
PR owner is responsible for starting or re-running the Playwright E2E check on
the PR.

Expected result:

- Full Playwright suite passes.
- Pay special attention to release-analysis and retrospective invite flows,
  because this hardening changed AI input caps and invite/password-reset
  validation paths.

### C. Token/session auth non-regression

Validate in an environment configured like production:

1. Set the same `SESSION_TOKEN_SECRET` on every pod or process.
2. Team session token:
   - Log in to a team.
   - Refresh the browser or restart the backend process.
   - Expected: the browser restores the team session without forcing re-login.
3. Super-admin session token:
   - Log in to the super-admin panel.
   - Restart the backend process or route the next request to another pod.
   - Expected: `/api/super-admin/validate-session` and dashboard actions keep
     accepting the existing session token until expiry.
4. Wrong secret check:
   - Change `SESSION_TOKEN_SECRET` for one process only.
   - Expected: tokens minted by the other process are rejected with `401`.
5. Team-endpoint token auth (stage 7a):
   - POST `/api/team/:teamId` with only a `sessionToken` from a valid login.
   - Expected: `200` with the team state; the same token against another
     team's id returns `401`, and password-only requests keep working.
6. Client token preference (stage 7b):
   - Log in from a browser and watch a routine team request (e.g. a
     retrospective save or the Feedback Hub list) in the network tab.
   - Expected: the request body carries both `password` and `sessionToken`.
   - Change the team password from a second browser session; the first
     session keeps saving (its still-valid token authenticates) until it
     re-logs in.
   - Join via an invite link (no token): requests carry only `password` and
     keep working.
7. Password hashing at rest (stage 7c):
   - Create a new team; inspect its KV record (or a fresh backup).
   - Expected: `passwordHash` is a `scrypt$...` string, not the typed
     password; login with the typed password works.
   - Take a team record that still stores a plaintext password (pre-7c data
     or a restored old backup) and log in with that password.
   - Expected: login succeeds and the stored record is now a `scrypt$...`
     hash; logging in again still succeeds; a wrong password still fails.
   - Join via a pre-7c invite link (it embeds the plaintext password).
   - Expected: the join still works against the now-hashed record.
   - POST `/api/team/:teamId/password` with only a valid `sessionToken` (no
     `password`).
   - Expected: `401` — rotating the credential requires the current
     password.
8. Invite credentials (stage 7e):
   - Log in, open the invite modal, copy the link and decode the `join`
     payload (base64 JSON).
   - Expected: the payload contains `inviteCredential` and **no `password`
     field**; opening the link in a second browser joins the team.
   - Refresh the browser (session restore) and open the invite modal again.
   - Expected: a working link is still minted (the client fetches the
     credential from `/api/team/:teamId/invite-credential` with its session
     token); `restore-session` returns no `password` field and localStorage
     (`retro-open-session`) contains no `teamPassword` (verify in devtools).
   - Change the team password, then open a link minted before the change.
   - Expected: the old link no longer joins (revoked by the epoch bump); a
     newly minted link works.
   - Change the team password right after a browser refresh (token-only
     session).
   - Expected: the settings panel asks for the current password; a wrong
     current password is rejected, the correct one rotates the password.
   - Join via a pre-7e invite link (it embeds the plaintext password).
   - Expected: the join still works (dual-verify path, until stage 7d).

### D. Email and notification non-regression

Validate in an environment with SMTP configured:

1. Invite email happy path:
   - Create or open a team.
   - Send an invite to a valid email address.
   - Expected: request succeeds and recipient receives the invite.
2. Invite email invalid input:
   - Try an invalid recipient email.
   - Expected: request returns `400` and no email is sent.
3. Password reset happy path:
   - Configure a team facilitator email.
   - Request a reset for the correct team/email pair.
   - Expected: request returns the existing success behavior and sends a reset
     email with a working token link.
4. Password reset anti-enumeration:
   - Request a reset for an unknown team or wrong facilitator email.
   - Expected: route preserves the existing non-enumerating success behavior.
5. Password reset invalid input:
   - Submit malformed email, overly long team name, or invalid reset link.
   - Expected: request returns `400` before creating reset-token state.
6. Feedback notification happy path:
   - Configure the admin notification email.
   - Submit a bug report and a feature request.
   - Expected: notifications are sent.
7. Feedback notification invalid input:
   - Submit missing title/type, unsupported type, or oversized fields.
   - Expected: request returns `400` and no notification email is sent.
8. Rate-limit behavior:
   - Repeatedly submit reset/feedback notification requests from the same IP
     until the limit is exceeded.
   - Expected: those routes return `429` with the configured retry message.
   - Do not expect `/api/send-invite` to return `429` based on recipient count;
     facilitators may invite large groups.

### E. Super-admin backup restore non-regression

Validate in a non-production environment:

1. Unauthenticated restore attempt:
   - POST a body to `/api/super-admin/restore` without super-admin password or
     session token.
   - Expected: `401` before restore processing.
2. Authenticated JSON restore:
   - Export or create a small valid backup JSON payload.
   - Restore with valid super-admin credentials.
   - Expected: restore succeeds and team count is reported.
3. Authenticated gzip restore:
   - Restore a gzip backup under the configured body limit.
   - Expected: restore succeeds.
4. Oversized compressed body:
   - Send a request larger than `RESTORE_MAX_BODY_MB`.
   - Expected: request is rejected by Express body limit.
5. Oversized decompressed gzip body:
   - Send a gzip archive under `RESTORE_MAX_BODY_MB` but larger than
     `RESTORE_MAX_DECOMPRESSED_MB` after expansion.
   - Expected: request returns `413` with `restore_archive_too_large`, and no
     data is restored.
6. Backward compatibility:
   - Restore an older backup archive created before this branch.
   - Expected: archive format still restores.

### F. AI feature non-regression

Validate with AI configured:

1. Suggest group title.
2. Suggest ticket groups.
3. Generate retrospective summary.
4. Generate release analysis with a normal release-size selection.
5. Generate release analysis with more than 50 retrospectives selected.
6. Call any `/api/ai/*` endpoint without a `sessionToken`, with a garbage
   token, and with a token minted under a different `SESSION_TOKEN_SECRET`.

Expected result:

- Existing AI features still work for normal inputs when used from a logged-in
  browser session (the client sends the team session token automatically).
- Release analysis returns a clear `400` response when more than 50
  retrospectives are supplied, so selected retrospectives are never silently
  omitted.
- Long custom prompts or additional instructions are accepted but truncated to the
  backend cap.
- Unauthenticated or invalid-token AI calls return `401` with
  `{ "error": "unauthorized" }` and never reach the AI service.

### G. Graceful shutdown non-regression

Validate locally or in staging:

1. Start the app with `npm run start` or the production container.
2. Open a retrospective session in a browser.
3. Send `SIGTERM` to the Node process or delete one pod in Kubernetes.
4. Expected server logs:
   - Received termination signal.
   - Backup scheduler stopped.
   - Socket.IO and HTTP close complete.
   - Datastore closes.
   - Process exits 0 before the hard timeout.
5. Expected user behavior:
   - Browser sees a normal disconnect/reconnect flow.
   - Existing session state is restored after reconnection.

### H. Kubernetes rollout non-regression

Validate in a staging namespace with at least 2 replicas:

1. Apply the base Kustomize output and confirm the PDB exists:

```bash
kubectl get pdb retrogemini
```

2. Confirm the deployment has the `preStop` hook and 2-second probe timeouts:

```bash
kubectl describe deployment retrogemini
```

3. Trigger a rolling restart:

```bash
kubectl rollout restart deployment retrogemini
kubectl rollout status deployment retrogemini
```

Expected result:

- Rollout completes.
- PDB prevents voluntary disruption from taking all app pods down at once.
- Active browser sessions reconnect rather than losing work.
- `/ready` remains a pod-local readiness endpoint and should not flap solely
  because PostgreSQL has a transient shared outage.

### I. Stage-7c manual-only validation (gaps not covered by unit/e2e tests)

The unit suite runs against mock stores and the e2e suite runs against a
fresh SQLite database, so none of the following is exercised automatically.
Run these in staging (PostgreSQL, 2 replicas, shared `SESSION_TOKEN_SECRET`,
SMTP configured) with a **copy of production data**:

1. Real legacy-data migration: log in to a team created before this deploy.
   - Expected: login works, the stored `passwordHash` becomes `scrypt$...`,
     a second login works, a wrong password still fails. Spot-check the KV
     record directly in PostgreSQL.
2. Real old invite link: reuse an invite link (from an actual email) minted
   before the deploy, after its team's record has been hashed.
   - Expected: the join still works end-to-end.
3. Two-pod rehash race: right after deploy, authenticate the same legacy
   team by password from two browsers simultaneously (routed to different
   pods if possible).
   - Expected: no 500s, no `max_retries_exceeded` in logs, one final hash,
     both sessions work. (The CAS retry covers this by design — this
     validates it on the real store.)
4. Pre-7c backup restore: restore a backup archive created before the
   deploy.
   - Expected: restore succeeds (plaintext records reintroduced), affected
     teams still log in and are re-upgraded to hashes on that login. Then
     create a fresh post-7c backup and restore it: hashed records round-trip
     and logins still work (a hash must never be re-hashed or corrupted).
5. Email password reset over real SMTP: full flow from request to new
   login.
   - Expected: reset works, the stored record is a hash, old password dead.
6. Multi-session rotation: session A rotates the team password while
   session B (valid token) is active; then refresh B.
   - Expected: B keeps reading/writing via its token. Since stage 7e, B's
     *new* invite links work again at most 60 seconds after the rotation
     (the client's invite-credential cache expires and the next mint fetches
     the current epoch) — the pre-7e residual of B minting dead links until
     re-login is gone; only links B minted from a stale cached credential
     within that minute fail.
7. Pre-deploy localStorage blobs: refresh a browser session opened before
   the deploy (whether or not its saved blob still contains a pre-7e
   `teamPassword` copy).
   - Expected: the session restores as token-only, dashboard and saves work,
     the invite modal mints working links via the server credential, and the
     rewritten blob no longer contains `teamPassword`. Changing the team
     password now prompts for the current password. No silent crash.
8. Auth latency and load: confirm login/team-create latency is acceptable
   (~tens of ms of scrypt) and run `npm run test:load` against staging per
   the repo rule for capacity-sensitive changes; also leave one tab open
   past token expiry (7 days, or shorten the expiry in a test build) to
   confirm password-fallback calls stay fast (verify cache) and eventually
   force a clean re-login.
9. Super-admin password override from the real panel.
   - Expected: team password changed, stored as a hash, new login works.

## Remaining audit backlog

Prioritize future work roughly in this order unless product/security priorities
change.

### P0 / early P1

1. Stage password hashing (audit PR-7, stages 7a-7d).
   - **7a done 2026-07-10** (see completed section 9): token auth on all team
     and feedback endpoints, additive.
   - **7b done 2026-07-10** (see completed section 10): the client sends the
     session token on all routine team/feedback calls and token-only sessions
     read/write normally; the password keeps working as a fallback.
   - **7c done 2026-07-20** (see completed section 11): scrypt hash at rest
     with dual-verify and rehash-on-auth; trap C-7c handled by persisting the
     password in the client's saved-session blob instead of the server echo
     (`restore-session` only echoes for legacy plaintext records);
     `SECURITY.md` updated; `/api/team/:teamId/password` made password-only.
   - **7e done 2026-07-20** (see completed section 12): invite links embed a
     signed, epoch-revocable invite credential instead of the plaintext
     password; the saved-session blob holds only the session token;
     `restore-session` never echoes a password. Follow-up for the repo owner:
     close the four CodeQL `js/clear-text-storage-of-sensitive-data` alerts
     (dismissed as accepted risk on PR #366) as fixed — the flagged sinks no
     longer exist.
   - Remaining: **7d** — remove the plaintext-compare fallback and stop
     sending the password on routine client calls, only after a deprecation
     window (owner call per the audit) and only once pre-hashing backups have
     left the retention window (trap R4b: restoring an old backup
     reintroduces plaintext records, which 7c's dual-verify + rehash-on-auth
     absorb in the meantime). 7e removed the last client-side dependency on
     the plaintext (invite minting and localStorage), so 7d is now blocked
     only by the deprecation/retention windows. Note that 7d also retires
     the pre-7e invite links that embed the plaintext password — announce
     that break alongside the deprecation window.
2. Implement faithful restore semantics (audit PR-6).
   - **Done 2026-07-23** (see completed section 14): restore is now a faithful
     replace (`savePersistedData(data, { mode: 'replace' })`) that deletes teams
     absent from the archive and clears live session state; cross-pod
     session-cache invalidation ships via `io.serverSideEmit('sessions-
     invalidated')` (the socket.io-broadcast option from C-6, gated on a
     multi-pod adapter); both restore routes take a protected pre-restore
     snapshot first.
   - Remaining (documented residuals, not code-blocked): a client actively
     connected at the instant of restore can re-persist its in-memory session
     once as a fresh row (would need a client-facing discard signal to close
     fully); protected pre-restore snapshots accumulate and are pruned manually;
     **concurrent team writes on another pod during the restore window can race
     the one-time replace scan** (Codex PR-383 P2) — fully closing it needs an
     exclusive store-level lock (PostgreSQL advisory lock + a SQLite maintenance
     gate), a distributed-locking piece larger than PR-6; mitigated today by the
     "run restores during low activity" guidance and the pre-restore snapshot.

### P1 / P2

3. Per-socket `update-session` throttle and cheap shape validation.
   - **Done 2026-07-23** (see completed section 13): the cheap shape check
     (including the non-finite `_rev` guard) ships enabled; the per-socket
     token-bucket throttle ships disabled by default (`SOCKET_UPDATE_RATE=0`).
   - Remaining for the operator: run `npm run test:load` at the real cadence,
     then enable the throttle (e.g. `SOCKET_UPDATE_RATE=20`) in staging/prod.
     The code is inert until then, so no code follow-up is blocked on it.
4. CI truth pass:
   - Fix ESLint server override.
   - Burn down warnings or add a warning budget.
   - Expand coverage scope.
   - Run E2E on PRs.
   - Add the production Node major to CI.
5. Documentation truth pass — **done 2026-07-09** (see completed section 8).
   Residual: keep `SECURITY.md` and the AGENTS/README env+API references in
   sync with future changes; the password-hashing work (item 1) must update
   the plaintext-password statements when it lands.
6. Backup scheduler election to avoid multi-pod backup stampedes.
   - **Done 2026-07-24** (see completed section 15): scheduled `auto` backups
     are elected via the shared store (`getRecentBackupByType('auto', interval −
     jitter)`), so `N` pods produce one backup per interval instead of `N`.
     Residual: the check-then-write election is best-effort, so an exact-tick
     collision can yield 2 (never N) — closing it fully needs the same
     store-level lock noted as the PR-6 residual, disproportionate here.
7. Dead-code cleanup and minor hazards:
    - Duplicate/dead rate limiter config.
    - Unused nginx template.
    - Timer `unref()` cleanups.
    - Backup JSON pretty-print overhead.

### P3

8. Frontend decomposition and code splitting for large modules/bundle size.
9. Feedback endpoint performance improvements using summary projection patterns.
10. Roster reconnect-stampede optimization.

## Future-session guidance

- Start by reading this file, then consult `retrogeminihardeningaudit.md` for the
  detailed rationale behind each remaining item.
- Do not re-implement completed items unless a review comment identifies a bug.
- Keep changes small and independently revertible.
- For each follow-up PR, update this file before committing.
- For any user-visible change, follow the repo `VERSION`/`CHANGELOG.md` rules in
  `AGENTS.md`; most hardening work is internal and should be `Y`-only with no
  changelog entry.
