# RetroGemini Hardening Status

_Last updated: 2026-08-03 (the seven open maintainer decisions were answered — D1…D7 — and every item they blocked shipped except the D1 follow-up, now H23)_

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

- **D1–D7 answered, and everything they blocked shipped in one pass.** Recorded
  as one entry because the lesson is shared: **four of the seven decisions were
  blocked on a premise that turned out to be false**, and checking took minutes
  each. D4 was "the root entrypoint conflicts with `runAsNonRoot`" — but this
  Deployment mounts no volume, so the chown it starts as root for has nothing to
  do, and the entrypoint already handles a non-root start. D1 was "announce a
  deprecation window or keep plaintext forever" — but a legacy record contains
  its own plaintext, so it can be hashed with nobody noticing. D7 was "the push
  probably fails on a protected branch" — the step never ran at all. D3's
  fallback question was already answered by the client, which sends
  `window.location.origin`, i.e. exactly the request `Host`. Three sessions had
  re-asked D3 and D4 cold instead. **The lesson for the next decision that looks
  blocked: read the code the decision is about before writing the question — a
  decision resting on a false premise is not a decision, and the maintainer
  cannot be expected to spot that from the question alone.** — 2026-08-03
- **H4 — the reset and invite mails would carry a token to any host the caller
  named.** `/api/send-password-reset` appended a **live reset token** to a
  body-supplied URL and mailed it to the real facilitator through the
  deployment's own SMTP identity: an attacker knowing a team name (listed by
  `/api/team/list`) and its facilitator address could have the system deliver a
  working token to a host they control. `/api/send-invite` was authenticated
  (H3) but equally free to mail a foreign-host phishing link. Both now rebuild
  the link on the server's own origin (`server/services/publicOrigin.js`):
  `PUBLIC_BASE_URL` when set, else the request's protocol + `Host`. The caller
  keeps its path and query, so every legitimate client — which sends
  `window.location.origin` — gets a byte-identical link and no deployment has to
  change anything. Note the path is **assigned**, never resolved relative to the
  base: `new URL('//evil.example/x', base)` resolves to evil.example, which is
  the one way this shape of fix goes wrong.
  **Codex review follow-up (same PR, P1, valid):** the first version of the fix
  still derived the origin from the request `Host` when `PUBLIC_BASE_URL` was
  unset — which the k8s manifest deliberately leaves unset. But `Host` is
  *caller-controlled*, and this route's caller is anonymous, so any edge
  forwarding an arbitrary `Host` (a default virtual host, or direct in-cluster
  access to the pod) preserved the very account-takeover path the change existed
  to close. The reset route now **fails closed**: no configured origin, no mail
  (`501 public_base_url_not_configured`), and the client says so instead of
  pretending it sent one. The invite route keeps the fallback on purpose — it is
  authenticated and mails a credential the caller already holds, so a forged
  `Host` gains an attacker nothing, while failing closed there would break
  invitations for every deployment that has not set the variable. The lesson: a
  fix that moves a value from the request *body* to a request *header* has not
  left the attacker's control. Tests:
  `__tests__/publicOriginLinks.test.ts` (16 cases), plus the 501 in
  `passwordResetRoutes.test.ts` and the client's handling of it in
  `dataService.test.ts`. `serverSecurity.test.ts`'s
  "audit H4 is still open" assertion was rewritten, not deleted: it now records
  that `sanitizeEmailLink` stays host-agnostic *by design*, because the rule
  lives one layer up. — 2026-08-03
- **H7.2 / H17 / D5 / D6 — four small ones that were each one decision away.**
  (1) The pod security context is no longer `{}`: base pins UID/GID 1000,
  `runAsNonRoot`, `RuntimeDefault` seccomp, no capabilities, no privilege
  escalation, and the OpenShift overlay nulls the UID fields because the
  restricted SCC **rejects at admission** a pod naming a UID outside the
  project's range — a detail worth keeping, since it turns a hardening patch
  into a deployment that never starts. `readOnlyRootFilesystem` was left out
  deliberately: real failure modes, no gain here. (2) The deploy workflow's
  auto-commit step is gone, and with it `contents: write` from the deploy job.
  (3) Playwright now runs on pull requests. (4) `npm run lint` is a two-way
  ratchet (`scripts/lint.mjs`): it fails when warnings rise *and* when they
  fall without the budget following, which is how the old `--max-warnings 110`
  silently handed a free slot to the next warning. Tests: 3 new cases in
  `deploymentManifestParity.test.ts`, 4 in `__tests__/lintBudget.test.ts`.
  — 2026-08-03
- **D1's unblocking half — legacy plaintext passwords are hashed at boot.**
  `server/services/passwordMigration.js` runs after the format migration and
  before the startup backup (so the snapshot captures hashes, not plaintext). It
  never throws, and its updater re-checks under the lock so two pods booting
  together cannot overwrite a fresh hash with one derived from stale plaintext.
  Removing the fallback itself is **H23**, on purpose. Tests:
  `__tests__/legacyPasswordMigration.test.ts` (7 cases). — 2026-08-03
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
---

## 1. Verified baseline (measured 2026-08-03 on `claude/hardening-blocked-decisions-tv7vfr`)

Note: a fresh container clone has no `node_modules` — run `npm ci` first, or
every check fails with `vitest: not found` / missing type definitions.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **pass** — 0 errors, **110 warnings**, exactly the budget. Since D6 the budget is a **two-way** ratchet (`scripts/lint.mjs`): it fails above *and* below, so removing warnings now requires lowering `BUDGET` in the same change |
| Types | `npm run type-check` | **pass** — 0 errors |
| Unit tests | `npm run test` | **pass** — 99 files, 1 128 tests (96/1 095 before this pass) |
| Coverage | `npm run test:coverage` | **pass** — 84.65% stmts on the *gated scope* (see §4) |
| Build | `npm run build` | **pass** — 677 kB JS chunk (over Vite's 500 kB warning) |
| E2E | `npx playwright test` | **pass** — 10 tests, **~3.5 min** serially (`workers: 1`), twice in a row. Since D5 this also runs on every pull request, so a red e2e is now a blocked merge rather than a local surprise. The 2026-07-30 baseline run **failed** `retro-full-flow` on the announcement-modal race and took 9.1 min; H18 fixed it, and the time drop is the same cause (blocked clicks no longer burn a 6-min timeout). Beware the reporting trap that hid the failure: `npx playwright test \| tail` returns *tail's* exit status, so a failing run looks like exit 0 — read the summary line, not `$?` |
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
12. **A mailed link's origin is the server's, never the caller's** (H4/D3),
    and **`/api/send-password-reset` requires a *configured* origin.**
    `server/services/publicOrigin.js` rebuilds every reset and invite link on
    `PUBLIC_BASE_URL`, or on the request's own protocol + `Host` when unset; the
    caller keeps only the path/query (only the query when a base URL is
    configured). The reset route goes further and refuses to send at all
    (`501 public_base_url_not_configured`) when `PUBLIC_BASE_URL` is unset,
    because its caller is **anonymous** and controls `Host` too, so an edge that
    forwards an arbitrary one would put a live token back on a host the attacker
    picked (Codex, PR #405). `/api/send-invite` deliberately keeps the `Host`
    fallback: it is authenticated and mails a credential the caller already
    holds. Do not restore a code path that mails a body-supplied URL, do not
    "simplify" the reset route back to the fallback, and do not push the host
    check down into `sanitizeEmailLink` — that one is the protocol guard for
    HTML contexts and is deliberately host-agnostic.
13. **The pod security context is pinned in `k8s/base`, and the OpenShift
    overlay clears the UID fields** (H7.2/D4). Base runs as UID/GID 1000 with
    `runAsNonRoot`, `RuntimeDefault` seccomp, no capabilities and no privilege
    escalation, because plain Kubernetes enforces nothing on its own.
    OpenShift's restricted SCC allocates its own UID range and **rejects at
    admission** a pod naming a UID outside it, so `security-context.patch.yaml`
    nulls `runAsUser`/`runAsGroup`/`fsGroup` and keeps everything else. Both
    halves are asserted in `deploymentManifestParity.test.ts`; never "simplify"
    by deleting one.
14. **`isVisible()` is not a wait, in any spec.** It answers about *now* and
    ignores the timeout you pass it, so using it to decide whether a modal
    appeared is a race that later surfaces as a mystery click timeout somewhere
    else entirely (H18). Every spec dismisses the announcement modal through the
    single `e2e/helpers/announcements.ts`; do not re-inline a local copy.

---

## 3. Open findings

Severity: **P0** exploitable/data-losing · **P1** real risk · **P2** quality/ops.
Each item lists the failure scenario, acceptance criteria and the test that
must accompany the fix.

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

### H23 — [P2] The plaintext-compare fallback is still in the auth path

- **Files:** `server/services/passwordHashing.js` (the `if (!parsed)`
  constant-time plaintext branch), `server/services/teamService.js:30-45`
  (rehash-on-auth), `server/services/passwordMigration.js` (the new startup
  pass).
- **Where D1 got to:** the eager migration shipped, so a booted deployment
  leaves no legacy record for the fallback to serve. The fallback itself was
  deliberately **not** removed in the same change: if the migration silently
  fails (a store outage at boot), removing it turns a cosmetic problem into a
  team that cannot log in at all — the H20 lesson that an availability cost is a
  security property too.
- **Two prerequisites before removing it**, both concrete:
  1. Production boots reporting `upgraded: 0, failed: 0` — the migration only
     logs when it did something, so *silence in the logs is the pass signal*.
     Check two consecutive deployments.
  2. The same migration wired into the **restore** path
     (`/api/super-admin/restore` and `/api/super-admin/backups/restore`). A
     backup predating hashing puts plaintext records back; today they still
     authenticate through the fallback, but once it is gone they would not
     authenticate at all. This is the half that actually blocks removal.
- **Risk of leaving it:** low and shrinking — the window is a record that has
  never been read since the migration. The value of closing it is that
  `verifyPassword` stops having a branch where a stored string is compared
  directly against a submitted password.
- **Acceptance:** `verifyPassword` returns false for a non-hashed stored value;
  no team can authenticate against a plaintext record; the restore path runs the
  migration.
- **Tests:** extend `__tests__/legacyPasswordMigration.test.ts` (restore hook)
  and add a case to the password-hashing suite asserting a plaintext record no
  longer authenticates.
- **Effort:** S. **Regression risk:** medium — it is the authentication path,
  and the failure mode is a lockout.

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
- **Participant identity inside a session is self-asserted** (was H1b, closed by
  decision D2). `join-session` is authenticated at the *team* level (H1), but the
  `userId` in the payload is chosen by the client, so a team member can claim
  another member's authorship of tickets, votes and presence. This is a property
  of the shared-team-password product, not a socket bug: the same person could
  simply log in and pick that identity in the UI. Fixing it means introducing
  per-user identity, which is a product decision the maintainer declined. Do not
  re-report it as a vulnerability.

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

The `84.65%` figure gates `services/**/*.ts`, `server/services/**/*.js`,
`server/routes/**/*.js` and `utils/**/*.{ts,js}` — **4 542 of ~9 900 production
statements, i.e. ~45% of the codebase**. Measured on the gate's own scope
(`npm run test:coverage`), 2026-08-03:

| Layer | Measured | In gate? | Verdict |
|---|---|---|---|
| Backend services | **86.72%** | yes | good |
| — `dataStore.js` | **71.50% stmts / 60.06% branch** | yes | the PG branches are the remaining gap and need a real PostgreSQL |
| — `mailerService.js` | **0%** | yes | thin wrapper, low value |
| Backend routes | **85.63%** | yes | was 85.42% |
| — `superAdminRoutes.js` | **97.18%** | yes | largest backend file |
| — `passwordResetRoutes.js` | **99.19%** | yes | the H4/H5 surface; the residual is H4's new `invalid_link` branch |
| — `publicRoutes.js` | **74.71%** | yes | was 73.80% |
| — `teamRoutes.js` | **72.53%** | yes | **lowest route** now |
| — `feedbackRoutes.js` | **67.34%** | yes | the H2/H22 surface |
| — `aiRoutes.js` | **85.00%** | yes | H21 surface |
| Frontend services | **76.92%** | yes | good |
| Utils | **93.24%** | yes | `inviteLink.js` (85.5%) is the residual |
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

**None are open.** All seven (D1–D7) were answered on 2026-08-03 and the work
they blocked shipped in the same pass. The answers that lock in a rule are now
invariants 12 and 13 (§2); the rest are recorded here in one line each so nobody
re-opens a settled question:

- **D1 — retire the plaintext fallback: yes, via eager migration.** Framed as
  "announce a deprecation window vs keep it forever", it was neither: a legacy
  record *contains its own plaintext*, so it can be hashed with no user
  interaction and no broken invite link. The startup migration shipped; removing
  the fallback itself is **H23** below, deliberately a separate step.
- **D2 — per-user identity: no.** The shared-team-password model is deliberate,
  the retro is a trusted group, and the same person could log in and pick that
  identity in the UI anyway. H1b is therefore not a defect to fix but an accepted
  property of the product — moved into §3 H10. Re-opening it is a product
  decision, not a hardening one.
- **D3 — canonical public origin: `PUBLIC_BASE_URL`, with the request `Host` as
  the fallback.** Reproduces today's link for every legitimate caller (the client
  already sends `window.location.origin`) and changes only what an attacker can
  do, so no deployment has to act. Shipped as H4.
- **D4 — pod security context: keep the entrypoint, pin the context anyway.**
  The premise of the conflict was wrong: this Deployment mounts no volume, so the
  root `chown` has nothing to do, and the entrypoint already handles a non-root
  start. Shipped as H7.2, with the OpenShift overlay clearing the UID fields.
- **D5 — e2e in CI: run them on pull requests.** The alternative (weakening
  AGENTS.md) would have left ~5 000 statements of React with no automated gate at
  all. ~3.5 min per run is a cheap price for the only guard that layer has.
- **D6 — lint budget: ratchet, in both directions.** Implemented rather than
  promised — see invariant note in §1 and `scripts/lint.mjs`.
- **D7 — the dead manifest auto-commit: delete it.** It never executed in 209
  runs, and deploys are dispatched from feature branches, so a *repaired* version
  would have pushed retags onto arbitrary branches. Deleting it also dropped
  `contents: write` from the deploy job.

## 6. Suggested delivery lots

Small, independently shippable, ordered by risk-adjusted value. Each is a
`Y`-only version bump with no CHANGELOG entry unless noted.

| Lot | Contents | Prereq | Success metric |
|---|---|---|---|
| **L12** | H23 (remove the plaintext-compare fallback) — the restore hook is the real work | two clean production boots (see H23) | no team authenticates against a non-hashed record; restore runs the migration |
| **L4b** | H11 (enable the dormant `SOCKET_UPDATE_RATE` throttle) | staging env for `npm run test:load` | load test run at real cadence; non-zero rate live in staging then prod |
| **L11b** | H15 (a merged recovery lives only in React state until the resend fires) | staging env for `npm run test:load` (§7.4) | merged data survives an unmount inside the resend window, for every merged field |
| **L10** | H13 (image build must not need the public internet) | a Docker daemon to verify against | `docker build` succeeds with `unofficial-builds.nodejs.org` blocked, or (c) recorded as the decision |
| **L9** | H9 (decomposition + code splitting) — **measure first** | H9 baseline profile | first-paint improvement on a real device; no sync regressions |

Every lot left needs an **environment** this container does not have (a staging
deployment, a Docker daemon, a real device) or a **production observation**
(H23). Nothing is blocked on a decision any more.

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
