# RetroGemini Hardening Status

_Last updated: 2026-07-10_

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
- Bumped `VERSION` from `27.10` to `27.11` for the stage-7b client token-auth
  preference on routine team and feedback calls.
- Bumped `VERSION` from `27.11` to `27.12` for the CodeQL session-token storage
  hardening follow-up.
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

- This is the server-side foundation of stages 7a and 7b of the audit's 4-stage
  plan. The remaining stages are 7c (bcrypt-at-rest with dual-verify and
  rehash-on-login) and 7d (plaintext-compare removal).
- Read the audit traps before starting 7c: C-7c (invite-link generation reads
  the in-memory plaintext password, so `restore-session` must keep returning
  `password` until invite links are migrated) and R4b (restoring pre-hashing
  backups reintroduces plaintext records; dual-verify covers it).
- Rate-limiting behavior on team routes is unchanged in this stage;
  token-authenticated requests use the same limiters as password requests.

### 10. Password-hashing stage 7b — client token preference (audit PR-7b)

Implemented in:

- `services/dataService.ts`
- `__tests__/dataService.test.ts`
- `SECURITY.md`
- `AGENTS.md`

Completed items:

- Routine `/api/team/:teamId/*` and `/api/feedbacks/*` reads and writes now
  send the signed `sessionToken` when one is available, rather than repeatedly
  placing the team password in the request body.
- Invite-based sessions, which only carry a plaintext team password, retain the
  password fallback and remain fully compatible.
- Persistence and refresh guards now accept either credential, so a token-only
  session does not silently skip updates while password hashing is introduced.
- The password-change request deliberately includes the current password as
  well as the token; login, creation and invite flows continue to use their
  existing password contracts.
- Regression tests cover token preference, the invite fallback, token-only
  persistence, and the password-change exception.

Notes and limits:

- `restore-session` continues returning the password because client-side invite
  generation still embeds it. Do not remove that field until invite links have
  migrated away from the plaintext credential (audit trap C-7c).
- This reduces routine password exposure on the wire but does not yet change
  the database or backup plaintext format; that is stage 7c.

### 11. Team session cookie persistence (CodeQL follow-up)

Implemented in:

- `server/services/teamSessionCookie.js` (new)
- `server/routes/teamRoutes.js`
- `services/dataService.ts`
- `App.tsx`
- `__tests__/teamTokenAuth.test.ts`
- `__tests__/dataService.test.ts`
- `__tests__/App.test.tsx`
- `SECURITY.md`
- `AGENTS.md`

Completed items:

- Replaced the persisted `localStorage` team session token with a host-only
  `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production) set on team
  create, login and restore.
- Browser reloads restore team state through that cookie; the signed token is
  returned only for the active in-memory client session, so routine token-auth
  calls continue working without browser persistence.
- Existing `retro-open-session` records migrate once: a legacy token is used
  for restore and immediately removed before the safe navigation state is
  saved again. This prevents a deployment from interrupting active sessions.
- Added authenticated `/api/team/logout` cookie clearing, so a team logout
  removes the browser-persistent credential as well as in-memory state.
- Added regression tests for cookie attributes, cookie-based restore, logout
  clearing, in-memory restore token handling and legacy storage migration.

Notes and limits:

- This directly resolves CodeQL's high-severity alert for the team token at
  `App.tsx:280`. It does not change the separate super-admin session storage
  path, which is outside this narrowly scoped PR follow-up.

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
- After the stage-7b change (2026-07-10): `npm run ci` passed with lint at 0
  errors (339 existing warnings), type-check, 61 test files / 547 tests, and a
  production build. `npm run test:coverage` also passed (74.67% statements,
  62.75% branches, 80.90% functions, 81.83% lines). The production dependency
  audit could not be re-run because the configured internal Nexus audit endpoint
  returned HTTP 500; re-run it from CI or once that service is healthy.
- After the CodeQL session-cookie follow-up (2026-07-10): the targeted
  `teamTokenAuth.test.ts`, `dataService.test.ts` and `App.test.tsx` suites
  passed (106 tests), as did type-check, targeted lint and production build.
  The concurrent full-suite run hit existing timeout failures; each affected
  suite passed in isolation, so GitHub CI remains the full-suite authority.
- E2E tests were intentionally not run locally to save session time/tokens; the
  PR owner will run them in GitHub on the PR.

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

## Remaining audit backlog

Prioritize future work roughly in this order unless product/security priorities
change.

### P0 / early P1

1. Stage password hashing (audit PR-7, stages 7a-7d).
   - **7a and 7b done 2026-07-10** (see completed sections 9 and 10): server
     token auth is additive and the client now prefers that token for routine
     team and feedback calls.
   - Remaining: dual-verify bcrypt-at-rest with rehash-on-login (7c), then
     plaintext-compare removal only after a deprecation window (7d).
   - Preserve the existing API semantics: either valid credential grants
     access, a valid token beats a stale password, and token-only failures
     return `invalid_token` (existing password error codes are unchanged).
   - Known traps recorded in the audit (read them before starting):
     - C-7c: client-side invite-link generation reads the in-memory plaintext
       password (`utils/inviteLink.js`, `buildMinimalInvitePayload`). A user who
       restored a session has that plaintext only because `restore-session`
       still returns it. `restore-session` must keep returning `password` until
       invite-link generation is migrated to token auth, otherwise restored
       users cannot mint invites.
     - R4b: restoring an old backup reintroduces plaintext password records
       after bcrypt ships; 7c's dual-verify covers this, so 7d must not land
       while pre-hashing backups are still in the retention window.
     - Once hashing ships, update the `SECURITY.md` "Team Passwords" and
       "Backups Contain Team Passwords" sections, which currently document the
       plaintext reality.
2. Implement faithful restore semantics (audit PR-6).
   - Restore should remove teams absent from the archive and address cross-pod
     session-cache invalidation (audit C-6: a single-pod cache clear is not
     enough at `replicas:2` — needs a broadcast or cache-epoch check).

### P1 / P2

3. Per-socket `update-session` throttle and cheap shape validation.
   - Requires load-test validation before rollout.
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
