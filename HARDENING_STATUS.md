# RetroGemini Hardening Status

_Last updated: 2026-07-28 (full re-audit; supersedes the previous completed-work journal)_

Forward-looking tracker for hardening work. It records **what is left**, the
**invariants not to break**, and **how a future session verifies its work**.
Completed work is not journalled here — `git log` and `retrogeminihardeningaudit.md`
hold that history. An item stays only if knowing it prevents a regression or
unblocks pending work.

---

## 0. How to resume ("continue the hardening work")

This file is the entry point. A session picking the work up runs this loop:

1. **Use the `gstack` skill** for the review workflow, as `AGENTS.md` requires
   (`/health` for the quality baseline, `/cso` for the security axis, `/review`
   before landing). **If `gstack` is not installed in your environment, say so
   explicitly and do not claim to have used it** — install it per the AGENTS.md
   instructions, or state plainly that the pass ran without it.
2. **Re-establish the baseline** (§1) before touching anything. If a check
   already fails on a clean tree, record that first — do not attribute it to
   your change later.
3. **Pick the top item in §6 whose prerequisites are met.** Items blocked on a
   maintainer decision (§5) stay blocked — ask, do not guess. Prefer finishing
   one lot completely over starting several.
4. **Do the work with the repo's TDD rule**: failing test first, then the fix,
   and leave the test committed. Acceptance criteria and the required tests are
   written into every §3 item already.
5. **Update this file in the same commit as the change** — see the status
   convention below.
6. **Follow `AGENTS.md` for `VERSION`/`CHANGELOG.md`.** Hardening is normally
   internal: bump `Y`, no changelog entry. Only a user-visible change bumps `X`
   and earns exactly one consolidated changelog bullet.
7. **Never ship production code under an already-deployed version.** Versions
   are deployed as they land, so a version number that has shipped is spent —
   reusing it means two different builds answer `/api/version` with the same
   value, and an operator cannot tell which one is running. Concretely:
   - **Touching anything the runtime image contains → bump `Y`, every time.**
     Per the `Dockerfile` production stage that is `dist/` (so any frontend
     source), `server.js`, `server/**`, `utils/**`, `VERSION` and
     `CHANGELOG.md`.
   - **Docs, tests and CI do not need a bump** when they cannot reach the
     image — `HARDENING_STATUS.md`, `AGENTS.md`, `README.md`, `__tests__/**`,
     `e2e/**` and `.github/**` are not copied into it. (`AGENTS.md` asks for a
     `Y` bump on docs in general; it costs nothing to bump anyway, but never
     skip one for a code change on the grounds that the docs rule felt
     optional.)
   - **Check before assuming.** `git log -S<version> -- VERSION` finds the
     commit that set the current value; `git diff <that-sha>..HEAD --stat`
     shows whether anything image-bound has moved since.

**Status convention — how to record progress.** Keep the tracker short. When an
item is finished, do **not** append a narrative of what you did; instead:

- **Delete the item** from §3 and its row from §6, and add one line to the
  *Recently closed* list below: `Hxx — one-line outcome — <commit sha or PR> — <date>`.
  Keep only the last ~10 lines there; older entries belong to `git log`.
- If an item is only **partly** done, leave it in §3 and prepend
  `**Partly done (<sha>):** <what is closed> / <what remains>` to its body, so
  the next session sees the remaining scope, not the history.
- If work revealed the item was **wrong or obsolete**, delete it and say so in
  *Recently closed* with `(obsolete: reason)`. Do not leave a corrected-but-dead
  entry behind.
- **New problems found while working** get a new `Hxx` entry in §3 with the same
  fields as the others (problem, files, failure scenario, acceptance, tests).
- Answered decisions move out of §5 into §2 *Invariants* when they lock in a
  rule, otherwise they are deleted once the dependent item ships.

The test: a session reading only this file should know what to do next without
reading `git log`. If the file has grown a history section, prune it.

### Recently closed

- **L6 — coverage push.** `server/routes/**` and `utils/**/*.js` are now *inside*
  the coverage gate (they were tested but never measured). `dataStore.js`
  45.7 → **71.5%**, routes 39.1 → **80.0%** (`superAdminRoutes.js` 18 → 97%,
  `passwordResetRoutes.js` 14.9 → 100%, `coreRoutes.js`/`versionService.js`/
  `colorUtils.ts` 0 → ~100%). Gate thresholds ratcheted 76/78/65/74 →
  **82/82/69/80** on a scope that grew from 2 973 to 4 445 statements.
  6 new suites, +233 tests. — 2026-07-29
- H1 / L5 — `join-session` now requires the team session token and rejects a token
  minted for another team, checked *before* the socket enters the room. Session
  creation is bound to the credential's team. Client, load-test harness and the
  four socket integration suites all carry the token. — 2026-07-28
- H3 / L4 — `/api/send-invite` authenticates with the team credential (401
  otherwise, opaque for unknown team vs wrong credential) and mails the
  *authenticated* team name rather than the caller-supplied one, closing the open
  relay. **No send quota, by owner decision**: an authenticated team may invite
  without limit. The one meter counts rejected credentials per IP, scoped to
  `401`s so no facilitator action can trip it — it exists only to bound anonymous
  data-store reads (CodeQL `js/missing-rate-limiting`). — 2026-07-28
- H6 / L1 — `_rev`/`_updatedAt` typed on both session types via `RevisionStamped`;
  the three `as unknown as SyncedSession` casts in `syncService.ts` are gone, so a
  refactor that drops the CAS stamp now fails `type-check`. — 2026-07-28
- H8.2 / H8.3 / L1 — one `socketAdapter.js` (root strategy resolver merged into
  `server/services/`), misleading `security.test.ts` renamed to
  `dataServiceSecurity.test.ts`, and both previously-0% modules given behavioural
  tests: `security.js` 97%, `socketAdapter.js` 100%. — 2026-07-28
- H2 / L2 — 8 `atomicTeamUpdate` call sites answered `{success:true}` after a lost
  write; all now return `503 failed_to_save`. The super-admin rename was the worst
  case (team index renamed, record write lost ⇒ divergence). — PR #393 — 2026-07-28

---

## 1. Verified baseline (measured 2026-07-29 on `claude/hardening-continuation-xym5z9`)

Note: a fresh container clone has no `node_modules` — run `npm ci` first, or
every check fails with `vitest: not found` / missing type definitions.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **pass** — 0 errors, **110 warnings** (budget is exactly `--max-warnings 110`: zero headroom) |
| Types | `npm run type-check` | **pass** — 0 errors |
| Unit tests | `npm run test` | **pass** — 83 files, 984 tests |
| Coverage | `npm run test:coverage` | **pass** — 82.58% stmts on the *gated scope* (see §4) |
| Build | `npm run build` | **pass** — 677 kB JS chunk (over Vite's 500 kB warning) |
| E2E | `npx playwright test` | **9/10** — `retro-participants-origin.spec.ts` is flaky (H14); it failed 2 of 3 isolated runs on a **clean tree**, so do not attribute it to your change |
| Prod audit | `npm audit --omit=dev --audit-level=high` | **pass** — 0 vulnerabilities |
| Dev audit | `npm audit` | 1 high (`brace-expansion` DoS, dev-only — does not gate CI) |

**Tooling note:** `gstack` (§0.1) is **not installed** in the remote container
this pass ran in — `~/.claude/skills/` has no `gstack` entry and the repo has no
`.claude/` bootstrap. The review workflow therefore ran **without** it; that is
recorded here rather than claimed.

**E2E runs fine in a sandboxed container** — it does not need a desktop. Playwright's
`webServer` block starts both the API and Vite itself; the only thing to supply is the
pre-installed browser:

```bash
export PW_CHROMIUM_PATH=$(find /opt/pw-browsers -name chrome -type f | head -1)
npx playwright test
```

Do not record e2e as "unverifiable here" without trying that first.

**Not run in this environment** (no failure implied, only unverified):

- `npm run test:load` — needs a staging deployment. Leaves capacity claims
  (throttle cadence, roster coalescing under stampede) unverified.
- Docker build / Trivy scan / k8s apply — no daemon or cluster available.
  Leaves image CVE posture and manifest validity unverified.

---

## 2. Invariants — do not break these

1. **Session-sync CAS.** `update-session` compares `_rev` and rejects stale
   blobs; `syncService` stamps writes with the rev they were built on. Raising
   a stamp artificially lets stale content overwrite newer state.
2. **The socket channel is authenticated.** `join-session` requires the team
   session token and rejects one minted for another team, *before* the socket
   joins the room. `syncService` reads the token at emit time so the automatic
   re-join after a reconnect keeps working (zero-downtime). Any new client or
   harness that speaks the socket protocol — including `loadtest/lib/simClient.js`
   — must present it.
3. **Facilitator-only fields** are enforced server-side in `sessionGuard.js`.
   Timer runtime fields and `participantsPanelCollapsed` must stay writable by
   everyone; `teamId` is immutable for everyone.
4. **Restore is a faithful replace**, not a merge, and takes a *protected*
   pre-restore snapshot first — aborting with `503` if that snapshot fails.
5. **Closed actions never silently re-open.** Both `reconcileRetroActionState`
   and the `/retrospective/:retroId` server handler enforce the guard; a
   legitimate re-open goes through the granular `/action` endpoint.
6. **Offline/air-gapped.** No external URLs at runtime — fonts, sounds, images
   and icons ship from `public/`.
7. **Legacy plaintext passwords still authenticate** through the constant-time
   fallback and are rehashed on next login. Removing it is stage 7d (§5, D1).
8. **`rehash-on-auth` failures must never fail authentication** —
   `teamService.js:34` intentionally ignores its `atomicTeamUpdate` result.
   This is the one call site where ignoring the result is correct (see H2).

---

## 3. Open findings

Severity: **P0** exploitable/data-losing · **P1** real risk · **P2** quality/ops.
Each item lists the failure scenario, acceptance criteria and the test that
must accompany the fix.

### H1b — [P2] Participant identity is self-asserted (needs per-user identity)

- **Problem:** `join-session` is authenticated at the *team* level (H1, closed),
  but the `userId` inside it is still self-asserted, so any team member can claim
  another member's identity and authorship of tickets, votes and roster presence
  is spoofable within the team.
- **Blocked by:** D2 — this cannot be closed without introducing per-user
  identity, which the product does not have today (one shared team password).
- **Risk:** low. Inside an already-trusted group, and the same person could
  simply log in and pick that identity in the UI.

### H12 — [P2] A denied socket join has no dedicated UI message

- **Files:** `components/Session.tsx`, `components/HealthCheckSession.tsx`
  (the `onJoinDenied` subscription), `services/syncService.ts`.
- **Problem:** found while closing H1. When the server refuses a join, the
  socket stays *connected*, so the session components reuse the offline
  affordance and show **"Reconnecting… editing is paused"**. That is safe (it
  stops edits that would go nowhere) but wrong: no reconnect will ever fix an
  expired or foreign-team credential. The user needs "your session expired,
  log in again", with a route back to the login screen.
- **Failure scenario:** a token expires mid-retro (7-day lifetime) or a browser
  running pre-H1 JavaScript reconnects to an updated pod during a rolling
  update. The participant sits in front of a frozen session waiting for a
  reconnect that cannot happen.
- **Acceptance:** a denied join renders a distinct, actionable message and
  offers a way back to login; the offline banner keeps its current wording for
  genuine disconnections.
- **Tests:** component test asserting the two states render differently;
  `syncService.test.ts` already covers the `join-denied` fan-out.
- **Effort:** S. **Regression risk:** low (presentation only).

### H13 — [P2] The image build needs the public internet, and fails without it

- **Files:** `Dockerfile:41-48` (both the `builder` and `production` stages run
  the same `npm ci`).
- **Problem:** found when the `Scan Docker Image for Vulnerabilities` job failed
  on this branch. `better-sqlite3` ships musl prebuilds for **some** Node
  versions only — the Dockerfile comment already says so — and when none
  matches, `node-gyp` rebuilds from source. That rebuild fetches the Node
  headers from `https://unofficial-builds.nodejs.org` **at image-build time**,
  so every image build depends on a third-party host being reachable and fast.
- **Failure scenario:** the fetch timed out (`AggregateError [ETIMEDOUT]`) and
  the whole job failed with no vulnerability involved — the build never reached
  Trivy. It is a flake today, but the same dependency makes an internal or
  air-gapped image build impossible, which sits badly with a product whose
  headline property is that it runs with no internet access.
- **Cost of leaving it:** intermittent red CI that looks like a security finding
  (the failing check is named *"Scan Docker Image for Vulnerabilities"*), so
  every occurrence costs someone a wasted CVE hunt.
- **Options:** (a) pin the base image to a Node version that *has* a musl
  prebuild for the pinned `better-sqlite3`, so no source build ever happens;
  (b) keep the source build but make it resilient — retry the `npm ci`, or
  pre-seed the headers via `npm_config_tarball` from a vendored/internal copy;
  (c) accept it and re-run the job when it flakes.
- **Acceptance:** an image build succeeds with no egress to
  `unofficial-builds.nodejs.org`, or the maintainer records (c) as the decision.
- **Tests:** not unit-testable. Verify with a `docker build` on a host with that
  domain blocked.
- **Effort:** S for (a) if a matching prebuild exists, M for (b).
  **Regression risk:** medium — it changes how the production image is built,
  and this environment has no Docker daemon to verify a change against.

### H14 — [P1] A lost sync race silently drops the session's invitee list

- **Files:** `components/session/mergeRemoteSession.ts` (no `invitedUsers`
  handling), `components/Session.tsx:2464-2477` (`onInvitesSent`).
- **Problem:** found while running the e2e suite for L6. Sending invites writes
  the invitees onto the session (`s.invitedUsers = …`) through the ordinary
  `updateSession` path, so the write goes through the `update-session` CAS. When
  it loses the race against a concurrent write (timer tick, roster sync), the
  server rejects it and heals the client with authoritative state — and
  `mergeRemoteSession` **does not re-apply `invitedUsers`**, so the invitee list
  is lost with no retry. Every other add-only field (own votes, unconfirmed
  ticket/proposal creations, open/history action snapshot entries) *is*
  re-applied; `invitedUsers` was simply never added to that list.
- **Failure scenario:** a facilitator invites the team, the write loses one CAS
  race, and the "Invited · waiting to join" section never appears — the
  facilitator has no record of who was invited and cannot tell whether the
  invite was sent. This is exactly what the e2e failure shows.
- **Evidence:** `e2e/retro-participants-origin.spec.ts:84` fails waiting for
  `invited-section`. On a **clean tree** it failed 2 of 3 isolated runs, so it is
  a pre-existing flake, not a regression from the coverage lot.
- **Acceptance:** a healed session re-applies invitees the snapshot lost and
  re-sends, exactly like `mergeSnapshotEntries` does for action snapshots
  (invitees are only ever *added* during a session, so a missing entry always
  means a lost race, never a removal). The e2e spec then passes repeatedly.
- **Tests:** unit in `__tests__/mergeRemoteSession.test.ts` — a healing snapshot
  that lost an invitee must re-add it and flag a re-send; plus the existing e2e
  spec as the integrated guard.
- **Effort:** S. **Regression risk:** low — additive, follows the established
  snapshot-merge pattern, but it is in the sync/merge path so run the whole unit
  suite.

### H4 — [P1] Reset-link and invite-link hosts are not constrained

- **Files:** `server/routes/passwordResetRoutes.js:12-23, 50, 105-128`;
  `server/routes/publicRoutes.js:72-95` (the invite `link` takes the same
  protocol-only path); `server/services/security.js:22-36`
  (`sanitizeEmailLink`).
- **Problem:** `isValidHttpUrl` / `sanitizeEmailLink` validate the *protocol*
  only. `resetBaseUrl` is caller-supplied and a **valid reset token is appended
  to it** before the mail is sent to the real facilitator.
- **Failure scenario:** attacker knows a team name + facilitator email (both
  are semi-public — `/api/team/list` exposes team names). They call
  `/api/send-password-reset` with `resetBaseUrl=https://evil.example/`. The
  facilitator receives a genuine-looking reset mail from the real system,
  clicks, and hands a live token to the attacker, who then calls
  `/api/password-reset/confirm` and takes over the team.
- **Risk:** high severity; likelihood low-medium (needs the email, and is
  rate-limited to 10/15min per IP).
- **Fix:** derive the link from server configuration, or allowlist hosts.
- **Blocked by:** D3 (same "what is the canonical public origin" decision).
- **Acceptance:** a reset request naming a foreign host is rejected or the
  host is ignored in favour of the configured origin; no token ever reaches a
  non-allowlisted host. **The same must hold for the invite `link`** — H3 is
  closed, but authentication alone still lets any *authenticated* team session
  mail a foreign-host phishing link through the deployment's SMTP identity, so
  this half of the invite problem is entirely still open.
- **Note:** `serverSecurity.test.ts` already pins `sanitizeEmailLink`'s
  current protocol-only behaviour with an explicit "audit H4 is still open"
  test, so the fix has to update that assertion consciously.
- **Tests:** unit in `routeHardening.test.ts` — a foreign `resetBaseUrl` must
  not produce a `sendMail` call carrying the token, **and** a foreign-host
  `/api/send-invite` `link` must not produce a `sendMail` call.
- **Effort:** S. **Regression risk:** low, but needs a config value for the
  public origin, so it touches `.env.example`, README, AGENTS.md and k8s
  together (parity rule).

### H5 — [P1] Unlimited unauthenticated endpoints do DB work per request

- **Files:** `passwordResetRoutes.js:137` (`/verify`), `:172` (`/confirm`),
  `teamRoutes.js:703` (`/api/team/exists/:teamName`), `publicRoutes.js:27, 37`.
- **Problem:** no limiter. `/confirm` takes the meta write lock via
  `atomicMetaUpdate` before it knows the token is garbage, so bogus requests
  serialize against real reset-token writes.
- **Risk:** availability only; tokens are 256-bit so this is not a brute-force
  path. Low severity, easy fix.
- **Acceptance:** limiters present and consistent with sibling routes;
  `/confirm` rejects an unparseable token before taking the meta lock.
- **Tests:** route-level assertions that the 11th/21st call in a window is 429.
- **Effort:** S. **Regression risk:** low — but see D3, e2e already needs
  `AUTH_RATE_LIMIT_MAX=50` to avoid tripping limits.

### H7 — [P2] k8s manifest drift and unset pod security context

- **File:** `k8s/base/deployment.yaml`.
- **Problems:**
  1. `image: jpfroud/retrogemini:10.2` while `VERSION` is `27.23` — 17 majors
     stale. Either operators always override it (then it is a trap) or
     something really runs 10.2.
  2. `securityContext: {}` — no `runAsNonRoot`, `readOnlyRootFilesystem`,
     `allowPrivilegeEscalation: false`, `capabilities: drop: [ALL]` or
     seccomp profile. The image drops to UID 1000 via `docker-entrypoint.sh`,
     but the pod spec enforces nothing on plain Kubernetes.
  3. `resources.requests.cpu: 1m` against a login path that runs scrypt
     (N=16384 ⇒ ~16 MB and real CPU per verify). Under node contention the pod
     is scheduled with almost no guaranteed CPU.
  4. `AUTH_RATE_LIMIT_MAX` is in README + `.env.example` but **not** in the
     manifest **and not in `k8s/README.md`**; `PG_POOL_MAX` is in the manifest,
     `.env.example` and `k8s/README.md` but **not** in README. Both violate the
     AGENTS.md configuration-parity rule.
- **Note:** the entrypoint intentionally starts as root to fix volume
  permissions, which conflicts with `runAsNonRoot: true`. Resolving 2 requires
  D4.
- **Acceptance:** image tag matches a real release; a documented decision on
  the security context; and parity restored across **every** surface the
  AGENTS.md rule lists — `.env.example`, `README.md`, the AGENTS.md env list,
  `k8s/base/deployment.yaml`, `k8s/README.md`, and `k8s/secrets-templates/*`
  (n/a for non-secret defaults, but state that explicitly rather than skipping
  it silently). Updating only the manifest still leaves operator guidance stale.
- **Tests:** not unit-testable. Verify with `kubectl apply --dry-run=server`
  and a rollout in a non-prod namespace.
- **Effort:** S (1, 3, 4) / M (2). **Regression risk:** low for docs, medium
  for the security context (can make pods unschedulable).

### H8 — [P2] Test-suite quality gaps

**Partly done:** the misleading test names and the duplicate `socketAdapter.js`
are closed (see *Recently closed*). What remains:

1. **Source-text assertions instead of behaviour.** `wifiConfig.test.ts` (12
   occurrences), `inviteModalLayout.test.ts` (5), `feedbackPreservation.test.ts`
   (4), `assignableMembers.test.ts` (2) read production files with
   `readFileSync` and assert `toContain('...')` on the source string. These
   pass when the code is broken and fail on harmless renames. Replace with
   behavioural tests.
- **Effort:** M. **Regression risk:** none (test-only).

### H9 — [P2] Frontend size and bundle (original audit R15, still open)

- `components/Session.tsx` 2646 lines, `SuperAdmin.tsx` 2336,
  `Dashboard.tsx` 2057, `services/dataService.ts` 1883,
  `server/routes/superAdminRoutes.js` 1199 — all against the AGENTS.md
  file-size guidance. Session.tsx, Dashboard.tsx and dataService.ts have
  **grown** since the original audit.
- Single 676 kB JS chunk (176 kB gzip), no code splitting, on an app whose
  primary client is a phone on corporate Wi-Fi.
- **This is the one place to demand a measurement before acting:** no profile
  or field timing exists today. Capture first-paint on a representative device
  before treating code-splitting as a win.
- **Effort:** L. **Regression risk:** high — decomposing the session components
  touches the sync/merge paths.

### H10 — [P2] Accepted residuals (documented, not scheduled)

Keep visible so nobody "rediscovers" them as bugs:

- **Plaintext password cached in process memory.** `passwordHashing.js:92-134`
  keeps up to 1000 verified plaintexts in a `Map` to avoid re-deriving scrypt.
  Deliberate and documented in code, but **not** in `SECURITY.md` — it
  partially qualifies "hashed at rest". Add it to the threat model.
- **Restore vs concurrent writes.** A write on another pod during the replace
  scan can race it. Needs a store-level lock (PG advisory lock + SQLite gate).
  Mitigated by "restore during low activity" + the pre-restore snapshot.
- **Stale-session resurrection across a restore.** Restore clears server-side
  caches but sends no client-facing discard signal, and `saveSessionState`
  (`dataStore.js:742-753`) accepts an incoming blob whenever the restored store
  has no row for that session (`current` is null ⇒ never rejected). A client
  connected at the instant of restore can therefore re-persist its pre-restore
  session once, as a fresh row. Bounded (a new session, never a ghost team) and
  expected during a global rollback — hence the standing **run restores during
  low activity** guidance. Closing it fully needs a client-facing discard event.
- **Protected pre-restore snapshots accumulate.** Every restore writes one, and
  retention deliberately skips protected rows (`dataStore.js:1258-1289`), so
  installations that restore repeatedly grow storage until an operator manually
  unprotects or deletes them. Keep this in mind when restore-testing.
- **Degraded mode forks revisions across pods** during a DB outage
  (original audit R7). Conscious tradeoff; not surfaced loudly in the logs.
- **`randomId` uses `byte % 36`**, a negligible modulo bias (~46.5→46.4 bits).
  Not worth changing; noted so it is not re-reported.

---

### H11 — [P1] The `update-session` throttle ships dormant in production

- **Files:** `server/services/socketHandlers.js` (token bucket),
  `k8s/base/deployment.yaml` (`SOCKET_UPDATE_RATE: "0"`).
- **Problem:** the per-socket token bucket was built and merged, but both the
  code default and the shipped manifest set `SOCKET_UPDATE_RATE=0`, so it is
  **off everywhere**. Until an operator runs the staging load test and picks a
  non-zero rate, a single socket can drive unbounded `update-session` DB writes
  and room broadcasts. Listing the load test as "not run" (§1) records the
  measurement gap but loses the outstanding *action*.
- **Failure scenario:** one hostile or looping client saturates the DB write
  path and the broadcast fan-out for every participant in its room.
- **Blocked by:** the load test needs a staging environment — the only true
  blocker here, and the reason this is an operator task rather than a code one.
- **Acceptance:** `npm run test:load` run at the real cadence; a non-zero
  `SOCKET_UPDATE_RATE` (timer sync is ~1/s, so ~20 is a generous start) set in
  staging then production, with the measured cadence recorded here.
- **Note:** the code is inert until enabled, so no code work is blocked on it.
  A throttled write is healed with authoritative state, never dropped.
- **Effort:** S (config) + the load-test run. **Regression risk:** medium —
  capacity-sensitive, which is exactly why the load test gates it.

## 4. Real test-coverage map

The `82.58%` figure gates `services/**/*.ts`, `server/services/**/*.js`,
`server/routes/**/*.js` and `utils/**/*.{ts,js}` — **4 445 of 9 832 production
statements, i.e. ~45% of the codebase** (was ~30% before L6). Measured
repo-wide with CLI overrides (config untouched), 2026-07-29:

| Layer | Stmts | Measured | In gate? | Verdict |
|---|---|---|---|---|
| Backend services | `server/services/**` 1 762 | **86.21%** | yes | good |
| — `dataStore.js` | 593 | **71.50% stmts / 60.06% branch** | yes | was 45.69%; the PG branches are the remaining gap and need a real PostgreSQL |
| — `mailerService.js` | 16 | **0%** | yes | thin wrapper, low value |
| Backend routes | `server/routes/**` 1 417 | **80.03%** | **yes (new)** | was measured at 39% and outside the gate |
| — `superAdminRoutes.js` | 602 | **97.17%** | yes | was 18% — largest + least covered backend file |
| — `passwordResetRoutes.js` | 114 | **100%** | yes | was 14.9% — the H4/H5 surface |
| — `feedbackRoutes.js` | 193 | **54.40%** | yes | lowest remaining route; contains 4 of the H2 call sites |
| — `publicRoutes.js` | 83 | **56.62%** | yes | next lowest |
| — `teamRoutes.js` | 334 | **66.46%** | yes | |
| — `aiRoutes.js` | 84 | **64.28%** | yes | |
| Frontend services | `services/**` 970 | **76.70%** | yes | good |
| Utils | `utils/**` 296 | **92.57%** | yes | `inviteLink.js` (81.8%) is now inside the gate |
| React components | `components/**` + `App.tsx` 5 326 | **37.18%** (App 30.81%) | **no** | owned by e2e; see D5 |
| Server bootstrap | `server.js` 61 | **0%** | no | wiring only |
| E2E | `e2e/*.spec.ts` 6 specs | not run in CI | n/a | see D5 |

**True repo-wide statement coverage: 57.47%** (5 651 / 9 832), up from ~48%.

**Gate thresholds** in `vitest.config.ts` are ratcheted to the measured actuals
minus ~3 points of Node 22/26 matrix margin (lines 82 / funcs 82 / branches 69 /
stmts 80). Raise them when coverage lands; never lower them to pass.

**Priority order for the next tests** (risk-weighted, not percentage-chasing):

1. `feedbackRoutes.js` (54%) and `publicRoutes.js` (57%) — the two remaining
   sub-60% routes, now that they are gated.
2. `teamRoutes.js` (66%) — the login/team-CRUD surface.
3. `dataStore.js` PostgreSQL branches — needs a real PG instance, so it is an
   environment problem rather than a test-writing one.
4. `socketHandlers.js` (90%) — the residual identity/authorization branches.

**Do not** chase 100%. Components stay out of unit coverage and are owned by
e2e (see D5).

---

## 5. Decisions the maintainer must make

These block or reshape the work above. Options and consequences only — no
default chosen.

**D1 — Stage 7d: retire the plaintext-compare fallback.**
Blocked only by the deprecation and backup-retention windows, not by code.
Retiring it also kills pre-7e invite links that embed the plaintext password.
*Options:* (a) announce a window and retire; (b) keep indefinitely and accept
that restoring an old backup reintroduces plaintext records. Consequence of
(a): older invite emails stop working and must be re-sent.

**D2 — Introduce per-user identity? (blocks H1b only; H1 is not blocked.)**
Today a team shares one password and `App.tsx:437` logs everyone in as the
facilitator by default, so the app has no notion of *which human* is acting.
That is why authorship inside a session is spoofable and cannot be fixed by
tightening the socket alone. *Options:* (a) leave it — the retro is a trusted
group and the shared-password model is deliberate; (b) add per-user accounts or
per-member invite credentials, a substantial product change affecting login,
invites and the roster. This is a product-direction question, not a security
patch — (a) is a perfectly defensible answer.

**D3 — Canonical public origin. (blocks H3, H4, and shapes H5.)**
Fixing reset/invite links properly needs the server to know its own public
URL. *Options:* (a) add a `PUBLIC_BASE_URL` env var (then update
`.env.example`, README, AGENTS.md, k8s together per the parity rule);
(b) allowlist hosts; (c) derive from the request `Host` header — simplest but
spoofable behind a proxy, so it interacts with `TRUST_PROXY`.

**D4 — Pod security context vs the root entrypoint. (blocks H7.2.)**
`docker-entrypoint.sh` starts as root to fix volume permissions, which is
incompatible with `runAsNonRoot: true`. *Options:* (a) keep the entrypoint and
set only the compatible fields; (b) drop the chown step, require correctly
pre-owned volumes (`fsGroup`), and enforce the full restricted context;
(c) leave as-is and rely on OpenShift SCC — which does not protect plain
Kubernetes users.

**D5 — E2E in CI.** The previous tracker recorded "owner decision: keep
manual-only". This now **contradicts AGENTS.md**, which instructs branch
protection to require the `E2E Tests (Playwright)` check — while `e2e.yml`
gates the job to `workflow_dispatch || dependabot`, so it never runs on a
human PR. One of the two must change. *Options:* (a) run e2e on PRs and keep
it required; (b) keep manual-only and remove the required-check instruction
from AGENTS.md. Consequence of (b): ~5 170 statements of React (the layer with
27% unit coverage) have no automated gate at all.

**D6 — Lint budget.** `--max-warnings 111` sits exactly on the current count,
so any new warning fails CI while a fixed one silently frees a slot. *Options:*
(a) burn the 111 down and lower the cap; (b) ratchet the cap downward as work
lands; (c) leave it and accept the brittleness.

---

## 6. Suggested delivery lots

Small, independently shippable, ordered by risk-adjusted value. Each is a
`Y`-only version bump with no CHANGELOG entry unless noted.

| Lot | Contents | Prereq | Success metric |
|---|---|---|---|
| **L3** | H5 (limiters) + H4 (link host) | D3 | foreign-host reset sends no mail; limiter tests pass |
| **L4b** | H11 (enable the dormant `SOCKET_UPDATE_RATE` throttle) | staging env for `npm run test:load` | load test run at real cadence; non-zero rate live in staging then prod |
| **L11** | H14 (healed sessions lose the invitee list) | none | `mergeRemoteSession` re-applies invitees; the e2e spec passes 3 runs in a row |
| **L7** | H7 (k8s image tag, env parity, cpu request, security context) | D4 | `--dry-run=server` clean; every parity surface in the AGENTS.md list agrees |
| **L8** | H8.1 (replace source-text tests) + H12 (denied-join message) + H10 doc updates in `SECURITY.md` | none | zero `readFileSync`-on-source assertions remain; a denied join reads differently from an offline blip |
| **L10** | H13 (image build must not need the public internet) | a Docker daemon to verify against | `docker build` succeeds with `unofficial-builds.nodejs.org` blocked, or (c) recorded as the decision |
| **L9** | H9 (decomposition + code splitting) — **measure first** | H9 baseline profile | first-paint improvement on a real device; no sync regressions |

---

## 7. How a future session validates its work

1. `npm run ci` (lint + type-check + test + build), then `npm run test:coverage`,
   `npm audit --omit=dev --audit-level=high` **and `npm run test:e2e`**. The
   Playwright suite is a separate mandatory step in the AGENTS.md before-commit
   sequence — it is *not* part of `npm run ci`, and D5 (whether CI runs it) does
   not excuse skipping it locally. Never lower a coverage threshold to make a
   change pass.
2. Run the **whole** unit suite before pushing, not just touched files — a
   change in one route breaks another suite's mock.
3. Every fix leaves a **committed** regression test that fails without it.
   Prefer a unit test; reach for Playwright only for integrated user flows.
4. For anything touching `update-session`/`_rev` or capacity, run
   `npm run test:load` against staging first.
5. Report per change: new tests, existing tests already covering the area, and
   a short manual list for what automation cannot cover (visual/layout, real
   offline and mobile behaviour, LLM output quality, multi-pod Socket.IO
   timing).
6. Watch the PR to green — including CodeQL and the Docker scan — and reply on
   every bot finding stating fixed-or-dismissed with the commit and test.
