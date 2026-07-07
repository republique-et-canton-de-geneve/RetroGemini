# RetroGemini Hardening Status

_Last updated: 2026-07-07_

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

- Added an IP-based limiter to `/api/send-invite`.
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
  defaulting to 64 MB.
- Capped `/api/ai/generate-release-analysis` input before calling the AI service:
  - Retrospectives are capped to 50 entries.
  - `customPrompt` is capped to 4000 characters.
  - `additionalInstructions` is capped to 4000 characters.

Notes and limits:

- `/api/ai/*` endpoints are still not fully authenticated. Only input capping was
  applied because the audit identified a follow-up design dependency: team/token
  binding for AI routes should be handled after the token-auth work.
- Restore decompressed-size streaming caps are not implemented yet. The current
  fix blocks the unauthenticated pre-auth body-buffering path and caps compressed
  request size.

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

### 4. Versioning

Implemented in:

- `VERSION`

Completed items:

- Bumped `VERSION` from `27.0` to `27.1` for internal/security hardening.
- No `CHANGELOG.md` entry was added, matching the repo rule that security fixes,
  bug fixes and internal hardening bump `Y` only and do not produce user-facing
  changelog entries.

## Automated checks already run

The following checks were run after the current hardening changes:

- `npm run test -- routeHardening.test.ts shutdown.test.ts` — passed.
- `npm run lint` — passed with the repo's pre-existing warning backlog.
- `npm run type-check` — passed.
- `npm run test` — passed: 56 files, 476 tests.
- `npm run test:coverage` — passed for the currently configured coverage scope.
- `npm run build` — passed with the existing large-bundle warning.
- `npm audit --omit=dev --audit-level=high` — passed with 0 high vulnerabilities.
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

### C. Email and notification non-regression

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
   - Repeatedly submit invite/reset/feedback notification requests from the same
     IP until the limit is exceeded.
   - Expected: route returns `429` with the configured retry message.

### D. Super-admin backup restore non-regression

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
5. Backward compatibility:
   - Restore an older backup archive created before this branch.
   - Expected: archive format still restores.

### E. AI feature non-regression

Validate with AI configured:

1. Suggest group title.
2. Suggest ticket groups.
3. Generate retrospective summary.
4. Generate release analysis with a normal release-size selection.
5. Generate release analysis with more than 50 retrospectives selected.

Expected result:

- Existing AI features still work for normal inputs.
- Release analysis still returns successfully when more than 50 retrospectives are
  supplied, but the backend only forwards the first 50 to the AI service.
- Long custom prompts or additional instructions are accepted but truncated to the
  backend cap.

### F. Graceful shutdown non-regression

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

### G. Kubernetes rollout non-regression

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

1. Authenticate `/api/ai/*` properly after the token-auth design is settled.
   - The current branch only caps release-analysis inputs.
   - The audit noted there is no clean team binding in the current AI payloads.
2. Implement stateless HMAC-signed session/super-admin tokens.
   - Goal: survive restarts and multi-pod routing without token maps.
3. Stage password hashing.
   - Use the audit's staged plan: token auth first, client token preference,
     dual-verify with rehash-on-login, then eventual plaintext removal only after
     a deprecation window.
4. Add restore decompressed-size caps.
   - Current body limit caps compressed request size only.
5. Implement faithful restore semantics.
   - Restore should remove teams absent from the archive and address cross-pod
     session-cache invalidation.

### P1 / P2

6. Per-socket `update-session` throttle and cheap shape validation.
   - Requires load-test validation before rollout.
7. CI truth pass:
   - Fix ESLint server override.
   - Burn down warnings or add a warning budget.
   - Expand coverage scope.
   - Run E2E on PRs.
   - Add the production Node major to CI.
8. Documentation truth pass:
   - README, SECURITY, AGENTS, `.env.example`, maintenance docs.
   - Fix or archive stale audit/report documents.
9. Backup scheduler election to avoid multi-pod backup stampedes.
10. Dead-code cleanup and minor hazards:
    - Duplicate/dead rate limiter config.
    - Unused nginx template.
    - Timer `unref()` cleanups.
    - Backup JSON pretty-print overhead.

### P3

11. Frontend decomposition and code splitting for large modules/bundle size.
12. Feedback endpoint performance improvements using summary projection patterns.
13. Roster reconnect-stampede optimization.

## Future-session guidance

- Start by reading this file, then consult `retrogeminihardeningaudit.md` for the
  detailed rationale behind each remaining item.
- Do not re-implement completed items unless a review comment identifies a bug.
- Keep changes small and independently revertible.
- For each follow-up PR, update this file before committing.
- For any user-visible change, follow the repo `VERSION`/`CHANGELOG.md` rules in
  `AGENTS.md`; most hardening work is internal and should be `Y`-only with no
  changelog entry.
