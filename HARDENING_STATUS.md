# RetroGemini Hardening Status

_Last updated: 2026-07-29 (L6 coverage lot + H14; supersedes the previous completed-work journal)_

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

- **H15 — a write sent behind `join-session` is no longer dropped.** Since H1 the
  join handler `await`s a database read to authorize the socket *before* setting
  `socket.sessionId`, and Socket.IO does not wait for one handler to settle
  before dispatching the next event on the same socket. A write emitted right
  behind the join therefore ran with `socket.sessionId` still null and was
  discarded with **no ack and no healing snapshot** — the one rejection shape
  `syncService` cannot recover from, since its re-send is triggered by a healing
  `session-update`. Two real flows sit in that window: session creation, and the
  automatic re-join after a rolling update. Found by `npm run test:load`, which
  showed the session-creating write burning a full 8 s op timeout before its
  retry landed (`team` preset 14.6 s → 6.5 s once fixed). The join promise is now
  published on the socket and writes wait for it; a write behind a *denied* join
  still finds no `sessionId` and is still refused, so H1 is unchanged. Making
  `leave-session` wait too exposed a second race (Codex P1 on PR #399): switching
  sessions emits leave(A) then join(B), and B can settle during the wait, so
  leaving "whatever this socket is in" evicted it from the room it had just
  joined. `leave-session` now leaves only the session the event names. — 2026-07-29
- H8.1 / H12 / H10-doc — lot **L8** closed. Every `readFileSync`-on-source test is
  gone (`wifiConfig`, `inviteModalLayout`, `feedbackPreservation`,
  `assignableMembers`, `groupOverlay` — the last one was outside H8.1's list but
  inside L8's success metric); a denied join now reads as an expired session with
  a route back to login instead of "Reconnecting…"; and the in-memory
  plaintext-password cache is in `SECURITY.md`'s threat model. — 2026-07-29
- **H14 / L11 — healed sessions no longer lose the invitee list.** Sending
  invites writes `invitedUsers` through the ordinary `update-session` CAS, and
  `mergeRemoteSession` did not re-apply it, so a lost write race silently erased
  the "Invited · waiting to join" list with no retry. Now merged like the action
  snapshots (add-only field ⇒ a missing entry always means a lost race) and
  re-sent. This was the cause of the flaky `retro-participants-origin` e2e spec
  — 4/4 green after the fix, where it failed 2 of 3 runs before. — 2026-07-29
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
| Unit tests | `npm run test` | **pass** — 84 files, 993 tests |
| Coverage | `npm run test:coverage` | **pass** — 82.58% stmts on the *gated scope* (see §4) |
| Build | `npm run build` | **pass** — 677 kB JS chunk (over Vite's 500 kB warning) |
| E2E | `npx playwright test` | **pass** — 10 tests, ~3.3 min. `retro-participants-origin.spec.ts` was flaky before H14 closed (failed 2 of 3 clean-tree runs); it now passes 4 runs in a row |
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
9. **A refused join is not a disconnection.** `join-denied` leaves the socket
   connected, so both session components record the denial and a later `connect`
   event must **not** clear it — editing stays paused and the banner keeps
   saying the session expired, with a route back to login
   (`components/session/SessionConnectionStatus.tsx`). Reusing the offline
   affordance leaves the user waiting for a reconnect that cannot help.
10. **Tests assert behaviour, never source text.** No test may `readFileSync` a
    production file and `toContain('…')` on it: such a test passes while the
    code is broken and fails on a rename. If a rule is hard to reach, extract
    the unit that carries it (as H8.1 did for the ticket card and the
    assignable-member roster) rather than grepping the file.

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

### H15 — [P2] A merged recovery lives only in React state until the resend fires

- **Files:** `components/Session.tsx:540-566` (the `onSessionUpdate` listener)
  and `:663-665` (the cleanup); `scheduleSessionResend` lives in `components/session/mergeRemoteSession.ts`. `HealthCheckSession.tsx` shares the pattern.
- **Problem:** raised by the Codex reviewer on PR #397 and **confirmed by
  reading the code** — it is real, but it is a property of the *whole* merge
  mechanism, not of any one field. After a healed write race the listener calls
  `dataService.applyRemoteSession(team.id, normalizedSession)` with the
  **unmerged** incoming state (deliberate: re-persisting on every broadcast
  multiplied team-record writes by the participant count), while the recovered
  data exists only in React state until the jittered 150–400 ms resend runs.
  The effect cleanup clears `resendTimerRef` unconditionally.
- **Failure scenario:** the user navigates away or the component unmounts
  inside that 150–400 ms window. The timer is cleared, the resend never runs,
  and the merged data is lost from both the local cache and the server.
- **Scope — this is not specific to `invitedUsers` (H14).** Every merged field
  rides the same path: own votes, happiness/ROTI, proposal votes, ratings,
  unconfirmed ticket/proposal creations and the open/history action snapshots.
  H14 added one more field to an existing mechanism; it did not create the
  window. Fixing it for one field only would be misleading.
- **Options:** (a) cache the merged state instead of the normalized one — needs
  the merge lifted out of the `setSession` updater, since a state updater must
  stay pure and React StrictMode double-invokes it; (b) flush a pending resend
  during cleanup instead of just clearing it — racy against the socket already
  leaving the room; (c) accept it and document the window.
- **Acceptance:** a merged recovery survives an unmount inside the resend
  window, for *every* merged field, not just invitees.
- **Tests:** component test that unmounts between the healed update and the
  resend deadline, asserting the merged data is still recoverable.
- **Why it was not fixed in PR #397:** it changes the shared sync/merge/apply
  flow, and §7.4 requires `npm run test:load` against staging before touching
  that path — unavailable in the container that pass ran in.
- **Effort:** M. **Regression risk:** medium — it is the sync path.

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
  Deliberate, documented in code **and** now in `SECURITY.md` (*Verified
  Passwords in Process Memory*), which qualifies the "hashed at rest" claim.
  Nothing left to do — keep the two in sync if the cache changes.
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

**D6 — Lint budget.** `--max-warnings 110` sits exactly on the current count,
so any new warning fails CI while a fixed one silently frees a slot. *Options:*
(a) burn the 110 down and lower the cap; (b) ratchet the cap downward as work
lands; (c) leave it and accept the brittleness.

---

## 6. Suggested delivery lots

Small, independently shippable, ordered by risk-adjusted value. Each is a
`Y`-only version bump with no CHANGELOG entry unless noted.

| Lot | Contents | Prereq | Success metric |
|---|---|---|---|
| **L3** | H5 (limiters) + H4 (link host) | D3 | foreign-host reset sends no mail; limiter tests pass |
| **L4b** | H11 (enable the dormant `SOCKET_UPDATE_RATE` throttle) | staging env for `npm run test:load` | load test run at real cadence; non-zero rate live in staging then prod |
| **L7** | H7 (k8s image tag, env parity, cpu request, security context) | D4 | `--dry-run=server` clean; every parity surface in the AGENTS.md list agrees |
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
