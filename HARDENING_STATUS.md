# RetroGemini Hardening Status

_Last updated: 2026-08-03 (H21 + H22 — AI error disclosure and a discarded feedback comment; H17 re-measured)_

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

- **Bot review of PR #404 — four Codex findings, all four valid, all fixed.**
  Worth recording because two of them were *my own fix being incomplete*, which
  is the same lesson PR #402 produced: (1) **the H22 guard trusted the wrong
  read.** `found` was set from the preliminary `loadTeam`, so a delete landing
  between that read and the compare-and-swap made the updater abort — reported
  as `{ success: true }` — and the new 404 was skipped. That is the *same*
  deletion race the fix exists for, a few milliseconds later. Success now
  follows the write: both updaters assign the flag from the state the store
  hands them (assign, not set, because a lost race replays the updater and only
  the last attempt decided the outcome). (2) **The AI failure was logged
  twice.** `server.js:92` calls `logService.attachConsole()` before registering
  any route, and that wrapper already mirrors every `console.error` into the
  super-admin ring — so wiring `logService` into `aiRoutes` and calling
  `addServerLog` explicitly wrote two entries per failure. Since an
  authenticated caller skips the AI limiter, an upstream outage would fill the
  bounded 1 000-entry ring at twice the rate. The `logService` dependency was
  removed again; `console.error` alone reaches both destinations. (3) **The
  comment composer could post a draft to the wrong feedback** — pre-existing,
  and widened by the new 404 branch, which no longer cleared the shared
  `newComment`. Drafts are now keyed by feedback id and `handleAddComment` reads
  the key it is posting to. The regression test caught the real thing: without
  the fix it posts `'meant for Alphameant for Beta'` to `feedback-b`.
  (4) **The user-visible AI error flow had no e2e**, which AGENTS.md requires.
  Added to the existing spec rather than as a new test, so no second team
  sign-up. **Still open, pre-existing, out of scope:** `superAdminRoutes.js:1222`
  does `console.error` *and* `addServerLog` for the same event, so it
  double-logs the same way — harmless there (one entry per admin click, not a
  burst path) but the next person touching that file should collapse it.
  — 2026-08-03
- **H21 — the AI routes told every team member where the internal LLM lives.**
  All four `/api/ai/*` handlers put `err.message` into the response as
  `message`. Two shapes reach a browser that way: a Node transport error, which
  names the LLM's host, IP and port (`connect ECONNREFUSED 10.20.30.40:8080`,
  `getaddrinfo ENOTFOUND …`), and `aiService.js:102`'s
  `AI API error <status>: <first 200 chars of the upstream body>`, which
  forwards whatever the gateway said — API-key diagnostics included.
  `ReleaseAnalysisModal.tsx` rendered that string on screen, so it was not a
  response nobody reads. Reaching it needs only a team session token, which on a
  shared team password means anyone who ever received an invite link. The routes
  now answer `{ error: 'ai_error' }` and keep the detail in the pod log **and**
  the super-admin log ring — through `console.error` alone, since
  `attachConsole()` already mirrors it into the ring (see the PR #404 review
  entry above: an explicit `addServerLog` on top of it double-logs).
  `/api/super-admin/test-ai` stays the diagnostic path that *does* return the
  detail, because it is gated by the super-admin credential. The modal stopped
  reading `data.message` at all, so the leak stays closed even if a later change
  puts a detail field back. Tests: `__tests__/aiErrorDisclosure.test.ts` (10
  cases, all failing before) plus a browser-level case in
  `e2e/release-analysis.spec.ts`. — 2026-08-03
- **H22 — a comment on a just-deleted feedback was discarded, and the user's
  text with it.** `/api/feedbacks/comment` stores into the owning team's record
  or, once that team is gone, into `retro-meta.orphanedFeedbacks`. When neither
  held the target, both updaters aborted — and `atomicMetaUpdate` maps an
  aborted updater to "nothing to change", which is indistinguishable from a
  successful write — so the route still answered `{ success: true, comment }`
  with a comment it had built and stored nowhere. `TeamFeedback.tsx` reads
  `response.ok` as proof and clears the textarea, so what the user had typed was
  gone from the screen and had never been persisted. The feedback board is
  shared across teams and an author may delete a feedback at any moment, so this
  is an ordinary race, not a crafted request. Now `404 feedback_not_found` —
  decided by whether the *write* found its target, never by the preliminary read
  (see the PR #404 review entry above) — and the client drops the draft with the
  feedback it belonged to and reloads, so the vanished entry stops being
  offered. **Distinct from H2**, which pinned *lost writes*: H2's guard checks
  `result.success`, and an aborted updater returns `success: true`, so no H2 fix
  could have caught this. `atomicUpdateFailureHandling.test.ts` deliberately
  asserts a store-level no-op stays a success — that contract is unchanged.
  Tests: `__tests__/feedbackCommentTargetMissing.test.ts` (5 cases, 3 failing
  before; the other 2 guard against over-correcting the two legitimate paths)
  and `__tests__/teamFeedbackCommentDrafts.test.tsx` (3 cases, all failing
  before) for the per-feedback draft scoping. — 2026-08-03
- **H18 — the e2e "What's New" flake was a broken helper, copy-pasted five
  times.** `retro-full-flow` failed on a clean baseline run with a 6-minute
  timeout and 697 retried clicks on `New Retrospective`, all reported against
  that button while the real culprit was the announcement modal's backdrop. The
  cause: five of the six specs asked
  `announcementHeading.isVisible({ timeout })` and returned early on `false`.
  **`isVisible()` does not wait** — the timeout it accepts changes nothing — and
  the modal only appears once `/api/version` resolves, so on a cold start the
  helper ran before the modal existed and the backdrop then swallowed every later
  click. `healthcheck-full-flow.spec.ts` already had the correct `waitFor`
  version; the other five never got it. Now one shared
  `e2e/helpers/announcements.ts`, which waits for the version check to *settle*
  (the modal and the header button render under the same `versionInfo` condition,
  so whichever appears first proves the fetch returned) instead of guessing. Two
  call sites also passed `2_000` to make the "nothing unread" case fast; that
  budget could expire before the version fetch even answered, and it is
  unnecessary — the header button gates that path, so it is already fast. Both now
  use the default. The same spec passes on the pre-fix tree too — it is a race,
  not a regression — so do not read a green run as proof the old helper was
  fine. — 2026-07-30
- **Bot review of PR #402 — four valid findings, all fixed, none dismissed.**
  Worth recording because three of them were *my own new work being wrong*, not
  pre-existing debt: (1) CodeQL flagged exponential backtracking in the parity
  test's YAML block regex (`/^metadata:\n(?:\s+.*\n)*?\s+name:/` — `\s` matches
  the newline, so the repetition is ambiguous); the manifests are now read with
  line scanners and single-line patterns. (2) Codex: the `openshift` overlay uses
  `patches[].path` exclusively, so the inline-`target:` regex resolved **zero**
  targets and the overlay assertion passed vacuously — path-based patches are now
  resolved to their file's kind/name, and a non-vacuity guard fails any overlay
  that declares patches but resolves none. (3) Codex: exempting `POSTGRES_*` from
  `README.md` "as a group under `DATABASE_URL`" was not a real justification —
  `DATABASE_URL` is a different mechanism — so the discrete group is now
  documented and the exemption is gone. (4) Codex: the new OpenShift paragraph
  claimed the platform injects database *credentials*; only
  `POSTGRESQL_SERVICE_HOST`/`_PORT` reach the app pod, while
  `POSTGRESQL_USER`/`_PASSWORD`/`_DATABASE` are set on the **database container**
  by the overlay and never propagate — following that guidance would have produced
  a connection failure. Corrected on both surfaces. Lesson for the next pass: a
  parity test that resolves nothing still goes green, so assert that the thing
  being checked was actually found. — 2026-07-30
- **H16 — the `dev` and `prod` kustomize overlays were dead, and nobody could
  have noticed.** Both patched `Deployment/team-retrospective`, a name the base
  has not used for a long time (it is `retrogemini`). Kustomize fails the *whole*
  build on a patch target that matches nothing, so `kubectl apply -k
  k8s/overlays/prod` could not work at all; their `images[].name` was equally
  stale, and that half fails **silently** (kustomize applies no retag and ships
  the base tag). Found while restoring H7's parity. Both targets fixed. The prod
  resource patch was **deleted rather than repaired**: its values had drifted
  *below* base (a 256Mi memory limit against base's 384Mi, and a replica count
  identical to base's), so repairing the target would have quietly tightened
  production memory as a side effect of a parity fix — base already carries the
  production shape.

  **Resolution: both overlays were deleted, on the maintainer's call.** Nothing
  referenced them — `k8s/README.md` documented only `overlays/openshift`, and the
  deployments use `base` + `openshift` — so repairing manifests nobody applies
  would have been dead code with a maintenance cost. The parity suite still checks
  patch targets and image names against `k8s/base`, now enumerating
  `k8s/overlays/` at run time rather than from a hard-coded list, plus a guard
  that the overlay set is not empty. — 2026-07-30
- **H5 — the anonymous store-backed routes are metered, and `/confirm` no longer
  takes the meta write lock for garbage.** `/api/password-reset/verify`,
  `/api/password-reset/confirm`, `/api/team/exists/:teamName`,
  `/api/info-message` and `/api/ai-status` were all unauthenticated *and*
  unlimited while doing a data-store read per call. Reset tokens are
  `randomBytes(32).toString('hex')` and only their SHA-256 is persisted, so a
  value that is not 64 lowercase hex characters cannot match anything: both
  token routes now reject that shape up front and answer exactly as before,
  which keeps garbage off `atomicMetaUpdate` — the lock real reset-token writes
  queue behind. Caps are per IP and injectable (the `inviteAuthLimiterMax`
  precedent), so **no new env var and no config-parity surface**: reset pair
  20/15min (shared — one verify + one confirm per real flow), `/api/team/exists`
  folded into the existing `teamReadLimiter` next to its sibling
  `/api/team/list`, public GETs 600/min shared. The public cap is deliberately
  two orders of magnitude above real traffic because these deployments put a
  whole office behind one NAT egress address and both endpoints fire on
  component mount — a cap a login rush can reach is an outage, not a safeguard.
  `/api/wifi-config` (env only) and `/api/data` (constant 410) stay unmetered by
  design, asserted.
  **Codex review follow-up (same PR):** adding limiters introduced a response
  the client had never seen — `429` — and both consumers treated any non-2xx as
  a *domain answer*. `verifyResetToken` collapsed it into `{valid:false}`, so a
  throttled user was told their link had expired and sent off to request a new
  one (burning the reset-email limiter too); `renameTeam` skipped the
  availability check on any non-OK reply and renamed anyway, so the UI reported
  a rename the server could still reject. Both now fail closed with a distinct
  throttled result. Two **pre-existing** bugs surfaced while fixing them and are
  fixed here: `handleRenameTeam` never `await`ed the async `renameTeam`, so *no*
  rejection — including the old "name already taken" — could reach its own
  `catch` and the success banner was unconditional; and `TeamLogin`'s `LIST`
  view never rendered `error`, so the reset-link explanation was set into state
  and silently discarded. — 2026-07-30
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

## 1. Verified baseline (measured 2026-08-03 on `claude/hardening-work-continuation-u9qn3i`)

Note: a fresh container clone has no `node_modules` — run `npm ci` first, or
every check fails with `vitest: not found` / missing type definitions.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **pass** — 0 errors, **110 warnings** (budget is exactly `--max-warnings 110`: zero headroom) |
| Types | `npm run type-check` | **pass** — 0 errors |
| Unit tests | `npm run test` | **pass** — 96 files, 1 095 tests (93/1 077 before this pass) |
| Coverage | `npm run test:coverage` | **pass** — 84.41% stmts on the *gated scope* (see §4) |
| Build | `npm run build` | **pass** — 677 kB JS chunk (over Vite's 500 kB warning) |
| E2E | `npx playwright test` | **pass** — 10 tests, **~3.5 min** serially (`workers: 1`), twice in a row. The 2026-07-30 baseline run **failed** `retro-full-flow` on the announcement-modal race and took 9.1 min; H18 fixed it, and the time drop is the same cause (blocked clicks no longer burn a 6-min timeout). Beware the reporting trap that hid the failure: `npx playwright test \| tail` returns *tail's* exit status, so a failing run looks like exit 0 — read the summary line, not `$?` |
| Prod audit | `npm audit --omit=dev --audit-level=high` | **pass** — 0 vulnerabilities |
| Dev audit | `npm audit` | 1 high (`brace-expansion` DoS, dev-only — does not gate CI) |

**Tooling note:** `gstack` (§0.1) is **not installed** in the remote container
this pass ran in — `~/.claude/skills/` has no `gstack` entry and the repo has no
`.claude/` bootstrap. The review workflow therefore ran **without** it; that is
recorded here rather than claimed. (Still true on 2026-08-03.)

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
- Docker build / Trivy scan — the `docker` **client** is installed but there is
  no daemon (`/var/run/docker.sock` absent), so `docker build` cannot run. Leaves
  image CVE posture unverified and keeps H13 blocked. Do not conclude from
  `docker version` printing a version that a build is possible.
- `kubectl` / `kustomize` — **not installed**, so no `kubectl apply
  --dry-run=server` and no `kustomize build`. The manifest work of 2026-07-30 is
  therefore checked *statically* by `deploymentManifestParity.test.ts` (patch
  targets and image names resolved against `k8s/base`) and has not been through a
  real kustomize render.

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
    *The one deliberate exception* is `deploymentManifestParity.test.ts`
    (invariant 11): documentation and manifests **are** the artefact under test
    there, so there is no behaviour to assert instead. Do not use it as
    precedent for grepping production source.
11. **The deployment surfaces are machine-checked.**
    `__tests__/deploymentManifestParity.test.ts` holds the AGENTS.md
    configuration-parity rule as data: every env var the server reads is listed,
    and must be mentioned on every surface it is not excused from *by a written
    reason*. It also requires `k8s/base/deployment.yaml`'s image tag to share
    `VERSION`'s **major** (not to equal it — `docker-deploy.yml` owns that line
    and deploys are manual, so lagging by the `Y` bumps since the last deploy is
    normal and correct) and checks that every kustomize overlay patches names
    that exist in `k8s/base`. Adding a knob or renaming a base resource fails the
    suite until the surfaces follow; do not weaken the contract to make a change
    pass — add the exemption *and its reason*.
12. **`isVisible()` is not a wait, in any spec.** It answers about *now* and
    ignores the timeout you pass it, so using it to decide whether a modal
    appeared is a race that later surfaces as a mystery click timeout somewhere
    else entirely (H18). Every spec dismisses the announcement modal through the
    single `e2e/helpers/announcements.ts`; do not re-inline a local copy.

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

### H7 — [P2] Unset pod security context

**Partly done (see git log, 2026-07-30):** H7.1 (image tag) and H7.4 (env parity)
are closed and machine-checked by `__tests__/deploymentManifestParity.test.ts`.

**H7.3 is closed as "will not fix", by the maintainer.** The `1m` CPU request is
what this cluster's OpenShift administrators specified, and it works in practice.
The audit's reasoning — that the scrypt login path needs a real guaranteed share —
was a theory about a cluster the auditor cannot see, and the people who run it
overruled it. The manifest now carries a comment saying so, and the test
deliberately asserts **nothing** about the CPU request. Do not re-open this: an
agent "fixing" `1m` upwards again would be re-litigating a decision that has
already been made by the people with the operational facts. **Only H7.2, the
pod security context, remains, and it is blocked on D4.** What the parity work
also turned up, for the record: five `POSTGRESQL_*` fallbacks that
`dataStore.js:15-19` reads were documented on *no* surface at all (they are the
Kubernetes service-discovery variables for the `postgresql` Service plus the Red
Hat PostgreSQL image's own names, i.e. the reason a bound OpenShift database
works with no configuration), and the `README.md` table was missing whole
families whose siblings were present (`BACKUP_*`, `PG_POOL_MAX`,
`SESSION_CACHE_MAX`, `SOCKET_MAX_BUFFER_SIZE`, `LAST_CONNECTION_DEBOUNCE_MS`,
`CORS_ORIGIN`, `REDIS_PORT`/`REDIS_PASSWORD`).

- **File:** `k8s/base/deployment.yaml`.
- **Problem:** `securityContext: {}` — no `runAsNonRoot`,
  `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`,
  `capabilities: drop: [ALL]` or seccomp profile. The image drops to UID 1000 via
  `docker-entrypoint.sh`, but the pod spec enforces nothing on plain Kubernetes.
  The empty context now carries a comment saying so and pointing at D4, so it
  reads as a known gap rather than an oversight.
- **Note:** the entrypoint intentionally starts as root to fix volume
  permissions, which conflicts with `runAsNonRoot: true`. **Blocked by D4.**
- **Acceptance:** a documented decision on the security context, applied.
- **Tests:** not unit-testable. Verify with `kubectl apply --dry-run=server`
  and a rollout in a non-prod namespace — neither `kubectl` nor `kustomize` is
  installed in the container this pass ran in, so the manifest edits are checked
  statically by the parity suite and have **not** been through a real
  `kustomize build`.
- **Effort:** M. **Regression risk:** medium — a wrong context can make pods
  unschedulable or unable to write their volume.

### H20 — [P1, fixed] `AUTH_RATE_LIMIT_MAX` could lock real users out of a running retrospective

**Closed 2026-07-30**, raised by the maintainer reviewing PR #402 ("je ne veux pas
me retrouver bloqué à cause de ça") — a better instinct than the audit's, which
had treated the limiter purely as a safeguard and never asked what it cost.

- **The defect:** `authLimiter` counted *every* request, and it guards
  `/api/team/restore-session`, which `App.tsx:167-183` calls on **every page
  load** for anyone with a saved session. At the default of 5 per 15 minutes per
  IP per pod, a handful of reloads from one office egress address locked people
  out of a retrospective already in progress. This was pre-existing, not
  introduced by the parity work — surfacing the variable in the manifest is what
  made someone read it.
- **The fix:** the meter is scoped to `401` alone
  (`requestWasSuccessful: (_req, res) => res.statusCode !== 401`), matching the
  `/api/send-invite` idiom already in `publicRoutes.js`. Nothing a legitimate user
  does counts — a restored session (200), no stored token (400), a deleted team
  (404), a team-name collision (409). The anonymous prober guessing tokens is
  still bounded, which is the only property the limiter was ever for.
- **Also corrected:** the audit and this tracker had claimed
  `AUTH_RATE_LIMIT_MAX` covers `/api/super-admin/verify`. It does not — that route
  has its own limiter, fixed at 5 and ignoring the variable. It was given the same
  401 scoping so a super admin cannot lock themselves out by signing in
  repeatedly.
- **Tests:** `__tests__/authLimiterCountsFailuresOnly.test.ts` — 4 cases, 3 of
  which fail on the pre-fix tree: ten consecutive reloads all served, five
  team-name collisions all served, five malformed requests all served, and the
  prober still refused on the third bad token.
- **Lesson:** an availability cost is a security property too. "Is this limit
  ever reached by someone doing their job?" belongs in the review of every
  limiter, and the answer here needed only reading the one caller.

### H19 — [P3] The rate limiters are per pod, so the real ceiling is `N ×` the value

- **File:** `server/routes/teamRoutes.js:25-60` (and the other `rateLimit(...)`
  call sites).
- **Problem:** every limiter is built without a `store`, so `express-rate-limit`
  keeps its counters in each pod's memory. At `replicas: 2` a load-balanced client
  gets up to `2 × AUTH_RATE_LIMIT_MAX` attempts per window — 10, not the
  documented 5. Found by the Codex reviewer on PR #402; the documentation now
  says so on all three surfaces, which was the immediate defect.
- **Why it is P3 and not higher:** the limiters exist to bound *store work* by an
  anonymous prober (H5), and `N ×` a small number is still a small number. It
  matters for the brute-force reading of `/api/team/login`, where the effective
  ceiling is what an attacker actually gets.
- **Options:** (a) leave it, documented — a NAT'd office argues for the looser
  bound anyway; (b) give the limiters a Redis store, but only where Redis is
  already deployed, and note that the manifests deliberately deploy none (the
  PostgreSQL Socket.IO adapter is used instead), so this would introduce a new
  dependency for a small gain; (c) enforce the hard ceiling at the Ingress/Route
  or WAF, which is where a cluster-wide limit belongs.
- **Acceptance:** either (a) with the documentation in place (already true), or a
  chosen store/edge limit with the documented numbers updated to match.
- **Tests:** a shared-store change needs a test that two limiter instances sharing
  a store reject at the *combined* count, not per instance.
- **Effort:** S (a, done) / M (b) / operator work (c). **Regression risk:** medium
  for (b) — a limiter that fails closed on a Redis outage locks out logins.

### H17 — [P2] The deploy workflow's manifest auto-commit has never run once

**The original hypothesis was wrong, and the measurement is done — do not
re-investigate.** H17 said the `git push` "probably cannot push" to a protected
`main`. It does not fail: it never executes. Measured 2026-08-03 against the
Actions history (`docker-deploy.yml`, 209 runs):

- `Update k8s manifests` is **`skipped`** in every run sampled — 30558458032 and
  30542180785 (2026-07-30), 30275888154 (2026-07-27), 29006973770 (2026-07-09).
  Its `if: inputs.update_k8s_manifests` evaluates false, so the `git push` the
  item worried about is never reached.
- The 30 most recent runs all concluded `success`, so no run ever failed at the
  push.
- `git log --all` contains no `chore: update k8s image tag` commit and no
  `github-actions[bot]` commit at all. The step's only observable effect has
  never happened. (The local clone is shallow — 163 commits back to 2026-07-01 —
  so this covers the sampled window, not all of history.)

So the *symptom* H7.1 fixed (a manifest tag 17 majors stale) is explained, and
the branch-protection theory is void. Whether the input is unchecked by hand at
each dispatch or is falsy for a structural reason, the outcome is the same: a
step that silently does nothing while looking like a feature.

- **File:** `.github/workflows/docker-deploy.yml:78-102` (step), `:16-19`
  (the `update_k8s_manifests` input, `default: true`).
- **Blocked by:** D7 — which of the three options is a maintainer call, and it
  touches their deploy pipeline. *Asked on 2026-08-03; unanswered.*
- **Note for whoever picks this up:** the workflow requests
  `permissions: contents: write` **solely** for this step, so dropping it also
  drops a write credential from the deploy job (least privilege). Note too that
  deploys are dispatched from feature branches as well as `main` — four of the
  sampled runs were on `claude/*` branches — so a repaired auto-commit would
  push the retag onto whatever branch was dispatched, which is an argument
  against repairing it in place.
- **Acceptance:** either a deployment demonstrably leaves the manifest retagged,
  or the dead step is removed so nothing silently pretends to work.
- **Tests:** not unit-testable (workflow behaviour against repo settings). The
  parity suite already catches the *symptom* on the next pull request.
- **Effort:** S. **Regression risk:** low — it touches only the deploy workflow's
  bookkeeping step, after the image is pushed.

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

The `84.39%` figure gates `services/**/*.ts`, `server/services/**/*.js`,
`server/routes/**/*.js` and `utils/**/*.{ts,js}` — **4 474 of ~9 850 production
statements, i.e. ~45% of the codebase**. Measured on the gate's own scope
(`npm run test:coverage`), 2026-08-03:

| Layer | Measured | In gate? | Verdict |
|---|---|---|---|
| Backend services | **86.31%** | yes | good |
| — `dataStore.js` | **71.50% stmts / 60.06% branch** | yes | the PG branches are the remaining gap and need a real PostgreSQL |
| — `mailerService.js` | **0%** | yes | thin wrapper, low value |
| Backend routes | **85.42%** | yes | was 83.64% |
| — `superAdminRoutes.js` | **97.18%** | yes | largest backend file |
| — `passwordResetRoutes.js` | **100%** | yes | the H4/H5 surface |
| — `publicRoutes.js` | **73.80%** | yes | was 56.62% (H5) |
| — `teamRoutes.js` | **72.53%** | yes | **lowest route** now |
| — `feedbackRoutes.js` | **66.83%** | yes | was 65.28%; the H2/H22 surface |
| — `aiRoutes.js` | **85.18%** | yes | was 64.28% (H21) |
| Frontend services | **76.70%** | yes | good |
| Utils | **92.56%** | yes | `inviteLink.js` (81.8%) is the residual |
| React components | `components/**` + `App.tsx` ~37% | **no** | owned by e2e; see D5 |
| Server bootstrap | `server.js` **0%** | no | wiring only |
| E2E | `e2e/*.spec.ts` 6 specs | not run in CI | see D5 |

Note: the previous revision of this table mixed gate-scope and repo-wide
measurements, and several rows had drifted by up to 11 points against the real
numbers. The rows above are all read from one `npm run test:coverage` run, so
they are comparable with each other and with the gate.

**Gate thresholds** in `vitest.config.ts` are ratcheted to the measured actuals
minus ~3 points of Node 22/26 matrix margin (lines 83.5 / funcs 84 / branches 72
/ stmts 81). Raise them when coverage lands; never lower them to pass.

**Priority order for the next tests** (risk-weighted, not percentage-chasing):

1. `teamRoutes.js` (72.5%) — the login/team-CRUD surface, now the lowest route.
2. `feedbackRoutes.js` (66.8%) — the H2/H22 surface. Most of the residual is the
   two admin-notification mail bodies, which is low-value; the *logic* left
   uncovered is the comment/delete orphan paths.
3. `publicRoutes.js` (73.8%) — the invite-mail surface, where H4's second half
   still lives.
4. `dataStore.js` PostgreSQL branches — needs a real PG instance, so it is an
   environment problem rather than a test-writing one.
5. `socketHandlers.js` — the residual identity/authorization branches.

**Writing route tests is how the last two findings were found** (H21, H22), not
a percentage exercise: both were spotted while reading the uncovered branches of
the two lowest-covered routes. Read the uncovered lines before writing the test.

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

**D3 — Canonical public origin. (blocks H4; H3 and H5 are closed.)**
Fixing reset/invite links properly needs the server to know its own public
URL. *Options:* (a) add a `PUBLIC_BASE_URL` env var (then update
`.env.example`, README, AGENTS.md, k8s together per the parity rule);
(b) same, but falling back to the request `Host` header when it is unset, so
existing deployments keep working without an operator touching anything;
(c) allowlist hosts; (d) derive from `Host` only — no new variable and no
parity surface, but spoofable behind a proxy, so it interacts with
`TRUST_PROXY`.
*Asked three times — twice on 2026-07-30 (here and in the session that shipped
the H7 parity work), and again on 2026-08-03 as a direct multiple-choice
question with (b) marked as the recommendation. Still unanswered.* H4 stays
untouched rather than guessing an origin policy, per §0.3. This is the single
decision gating the last open P1, so it is the highest-value answer the
maintainer can give. A hint for whoever answers: the client already sends
`window.location.origin` (`dataService.ts:1709`), so option (b) — configured
value first, request `Host` as the fallback — reproduces today's behaviour
exactly for every legitimate caller and only changes what an attacker can do.
**Do not keep re-asking it cold.** Three sessions have now spent the question
and got nothing; the next one should either receive the answer with the task or
treat H4 as parked and spend its budget elsewhere.

**D4 — Pod security context vs the root entrypoint. (blocks H7.2, the only part
of H7 still open.) Asked on 2026-07-30 and again on 2026-08-03 — the second time
as a direct multiple-choice question recommending (a). Still unanswered.**
`docker-entrypoint.sh` starts as root to fix volume permissions, which is
incompatible with `runAsNonRoot: true`. *Options:* (a) keep the entrypoint and
set only the compatible fields; (b) drop the chown step, require correctly
pre-owned volumes (`fsGroup`), and enforce the full restricted context;
(c) leave as-is and rely on OpenShift SCC — which does not protect plain
Kubernetes users.

**D7 — The dead manifest auto-commit in `docker-deploy.yml`. (blocks H17.)
Asked on 2026-08-03 and unanswered.** The step has never executed (evidence in
H17), so it is not a bug to repair but a choice about what the deploy pipeline
should do. *Options:* (a) delete the step, its `update_k8s_manifests` input and
the now-unneeded `contents: write` permission — the retag stays a manual part of
an `X` bump, which `deploymentManifestParity.test.ts` already enforces;
(b) repair it to open a pull request instead of pushing, so branch protection is
satisfied and the retag is reviewable — but note deploys are dispatched from
feature branches too; (c) leave it, and record that the input is unchecked
deliberately at each dispatch, so the next reader does not re-open this.

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
| **L3** | H4 (link host) — H5 shipped separately, it was not D3-blocked | D3 | foreign-host reset and foreign-host invite both send no mail |
| **L4b** | H11 (enable the dormant `SOCKET_UPDATE_RATE` throttle) | staging env for `npm run test:load` | load test run at real cadence; non-zero rate live in staging then prod |
| **L7b** | H17 (the deploy workflow's manifest retag step has never executed — measured, see H17) | D7 | a deployment leaves the manifest retagged, or the dead step is gone |
| **L7** | H7.2 only (pod security context) — image tag and env parity shipped 2026-07-30; H7.3 closed as will-not-fix by the maintainer | D4 | `--dry-run=server` clean; pod runs with the agreed context |
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
