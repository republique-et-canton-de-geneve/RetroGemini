# RetroGemini Hardening Status

_Last updated: 2026-08-04 (H29, H30, H31 and H23's restore half; D8–D12 answered, so §5 is empty again and every remaining lot is waiting on an environment, not a decision)_

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

- **H31 — `/api/wifi-config` handed the Wi-Fi password to any anonymous
  caller.** Maintainer chose option (b): require a team credential. It is now a
  **POST**, because that is this codebase's idiom for an authenticated read
  (`/api/team/:teamId` fetches state the same way) and because a credential
  belongs in a body rather than in a URL that proxies and access logs retain.
  The 404 for an unconfigured deployment moved *behind* the credential too —
  whether a Wi-Fi exists is itself something an anonymous caller should not
  learn. Authenticating gave the route a store read it never had, so it is
  metered like its siblings; the three near-identical limiters in
  `publicRoutes.js` are now built by one `createTeamCredentialLimiter` helper,
  each route keeping its own budget so one route's probes cannot spend another's.
  **Three existing suites had to be rewritten, not deleted** — the route stopped
  being a public GET, so `unauthenticatedRouteLimits.test.ts`'s router-derived
  inventory lost an entry (it now asserts the route must *not* drift back to an
  anonymous GET), and both component suites had to grow the `dataService`
  credential accessors. Tests: `__tests__/wifiConfigAuthorization.test.ts`
  (9 cases, all failing before). — 2026-08-04
- **H30 — the finding was real but I had overstated it (obsolete as written).**
  My own §3 entry claimed the uploaded-restore route "cannot accept uncompressed
  JSON" and that the capability was unreachable. **It is reachable** — under
  `application/octet-stream`, which the global `express.json()` does not claim.
  Only the `application/json` *label* was dead. I had reasoned from the global
  parser to a conclusion about the whole capability without enumerating the four
  content types the route declares, which is the D1–D7 lesson (a finding resting
  on an unchecked premise is not a finding) arriving from the other direction:
  this time the premise made the problem look **bigger**, not smaller. The fix
  is therefore one line — `application/json` is gone from the raw parser's type
  list, since advertising a type that can never work is the entire defect — and
  provably zero behaviour change in production, where `server.js:98` mounts the
  global parser before every route. Option (a), rewiring global body parsing,
  would have been a medium-risk change for nothing. **Watch for this in test
  harnesses:** four `routeHardening.test.ts` cases posted the restore archive as
  `application/json` and passed only because those apps omit the global
  `express.json()` — an unfaithful harness that made a production-impossible
  path look supported. They now use `application/octet-stream`, which behaves
  the same with or without it. Tests:
  `__tests__/restoreArchiveContentTypes.test.ts` (4 cases pinning all four
  content types, wired the way `server.js` wires them — the point of the suite
  is that a harness without the global parser proves nothing). — 2026-08-04
- **H29 — `/api/notify-new-feedback` was the *second* unauthenticated mail
  relay, and nobody had looked at it.** Found by reading the uncovered branches
  of `publicRoutes.js`, §4's stated next target. H3 closed `/api/send-invite`
  because it mailed caller-supplied content through the deployment's SMTP
  identity with no credential; this route did exactly the same thing, sits **in
  the same file, 80 lines below it**, and was never re-read. Anyone able to
  reach the deployment could put chosen text — a 200-char subject and a
  10 000-char body — in the super admin's inbox, from the organisation's own
  domain, under the subject line of a product they trust; `/api/feedbacks/create`
  right beside it in the client authenticates, only the notification did not.
  A second defect rode along: the mail's `Team:` line came from the request
  body, so even an authenticated member of team A could file a report the admin
  reads as team B's. Both halves are now the H3/H4 rule — credential first
  (before payload validation *and* before the SMTP capability check, so an
  anonymous caller cannot even probe whether mail is configured), attribution
  from the authenticated record. The meter was rescoped to 401s alone, the H20
  lesson applied before it could bite: it counted *every* request at 20 per 15
  minutes per IP, and a bug-report burst after a bad release — one office, one
  egress address — is exactly when the admin most needs the mail.
  **The client half is the dangerous half of this change**: the call is
  fire-and-forget (`.catch(() => {})`), so a client that does not send the
  credential fails *silently* — the user files a report, the UI confirms it, the
  admin is never told, and nothing anywhere surfaces that. Hence a component
  test that drives the real submission flow, not just the route tests.
  **Lesson (the H28 lesson again, one level up):** H28 said "when a fix names a
  *shape* of bug, grep for the shape before closing it". H3 named a shape —
  *unauthenticated route that sends mail* — and the grep was never done, for two
  passes, on a file H4 had since edited twice. `grep -n "sendMail" server/routes`
  is four seconds and would have found this in 2026-08-03. Tests:
  `__tests__/feedbackNotificationAuthorization.test.ts` (9 cases, 6 failing
  before — including a forged token for a team that does not exist getting a
  204 and a real mail) and `__tests__/feedbackNotificationCredential.test.tsx`
  (2 cases, both failing before). One existing case in `routeHardening.test.ts`
  was *rewritten*, not deleted: it pins that a malformed payload is rejected
  before the store read, which is still true — it just has to carry a credential
  to reach the validation now, exactly like the invite cases above it.
  — 2026-08-04
- **H23's blocking half — a restore no longer puts plaintext passwords back.**
  The prerequisite that "actually blocks removal" of the plaintext fallback, and
  it was never blocked on anything this container lacked; the lot around it was.
  The startup migration (D1) runs once, at boot. A super-admin restore rewrites
  the whole store from an archive that may predate hashing, long after that boot,
  and nothing would ever run over those records again — so the store silently
  goes back to holding readable passwords, and after H23 removes the fallback the
  same restore would leave those teams unable to log in at all. Both restore
  routes now re-run `migrateLegacyPasswords` over the restored records, *after*
  the replace (running it first would hash the state the archive is about to
  overwrite) and without ever changing the restore's outcome — a restore that
  really happened must not be reported as failed, or an administrator starts a
  second rollback of state that is already correct. The common case, an archive
  taken since hashing shipped, costs one scan and no writes. H23 now waits on
  nothing but the two production boots. Tests:
  `__tests__/restorePasswordMigration.test.ts` (8 cases, 3 failing before; the
  other 5 guard against over-correcting — no writes when the archive is already
  hashed, no rehash when the restore was rejected or its pre-restore snapshot
  failed, and a restore still reported successful when the pass itself fails).
  — 2026-08-04
- **H28 — the H22 rule ("success follows the write, not the read") had been
  applied to one of five sibling routes.** Found by reading the uncovered
  branches of `feedbackRoutes.js`, §4's next target. All five look the feedback
  up once to choose where to write and re-check it inside the compare-and-swap;
  an aborted updater reads as "nothing to change", so any handler that trusts
  the first read reports success for a write that never happened, and a feedback
  can be deleted by its author at any moment. Three were still wrong.
  `/api/super-admin/feedbacks/comment` was the worst: it answered
  `{ success: true, comment }` for a reply stored nowhere, and `SuperAdmin.tsx`
  reads `response.ok`, closes the composer and reports "Comment added
  successfully" — so the admin's typed reply vanished — **and it mailed the team**
  ("The administrator has added a comment on your Bug Report") about a comment
  that is not on the board, using a title and address captured from the stale
  read. `/api/super-admin/feedbacks/update` reported a status change that never
  applied. `/api/feedbacks/comment/delete` reported a deletion that never
  happened, including when the updater refused it because the comment belongs to
  another team. All three now answer `404` decided by the write, with the mail
  moved behind it and its values read from the state actually written.
  `/api/super-admin/feedbacks/delete` was deliberately left alone — its updater
  filters unconditionally and never aborts, so its success is honest, and
  restructuring it only to match a pattern would be change without a defect.
  **Lesson:** when a fix names a *shape* of bug rather than one site, grep for
  the shape before closing it — H22 was written up as a property of
  `/api/feedbacks/comment` and the four siblings built the same way went
  unexamined for two passes. Two existing tests had to be *rewritten*, not
  deleted: `atomicUpdateFailureHandling.test.ts` used this route to assert "a
  no-op is not a lost write" (still true, and now pinned on a route where a
  no-op really is nothing-to-change, plus a new case that a missing target is a
  404 and never a 5xx), and `teamTokenAuth.test.ts` asserted `200` on a
  deliberately missing target when all it meant was "the credential passed".
  Tests: `__tests__/feedbackWriteAcknowledgement.test.ts` (11 cases, 6 failing
  before; 5 guard the live and orphaned paths that must keep working).
  — 2026-08-04
- **The coverage percentage now says what it measures.** Raised by the
  maintainer: the reported figure had been read as repo-wide when it never was.
  It is not one number any more — `npm run test:coverage` gates the layer unit
  tests own (85.22% over 45.6% of production statements) and
  `npm run test:coverage:all` reports the whole codebase (60.97%), with a 57%
  floor and a CI job of its own. §4 carries both, their scopes, and the history
  that makes the trap obvious. Tests: `__tests__/coverageScope.test.ts` (6 cases
  on the pure aggregation — the arithmetic and the gated/not classification, not
  a percentage that moves with every change). — 2026-08-04
- **Bot review of PR #407 — two Codex findings, both valid, both were my own
  fix being incomplete.** Recorded because that is now the third pass in a row
  where the reviewer's value was on the *new* code, not on pre-existing debt.
  (1) **P1 — the delete rollback recreated the exact state it was added to
  prevent.** Restoring the index entry after a failed `deleteTeamRecord` is safe
  only for one request at a time: with two overlapping deletions, A clears the
  entry and fails, B finds no entry and deletes the record successfully, and A
  then restores a mapping to a record that no longer exists — the terminal,
  unrepairable state. I had reasoned about *sequential* failure and not about
  two writers. The fix is structural rather than conditional, because no
  re-check closes it (the record can vanish between the check and the write):
  **a deletion only ever narrows the index.** The residual — an un-retried
  failure leaves a record with no index entry — is repairable by retrying,
  which is the property the whole ordering is chosen for. (2) **P2 — idempotent
  was the wrong shape; it had to be an upsert.** Skipping an already-preserved
  feedback id froze the snapshot the failed attempt took, and because every
  feedback writer resolves the team record before `orphanedFeedbacks`, anything
  written between the failure and the retry lands on the live copy and was then
  lost when the record went. **Lesson:** a compensating write is itself a write,
  so it needs the same "what if another request is doing this too?" reading as
  the operation it compensates — and "make the retry idempotent" is not a
  synonym for "skip what is already there" when the source of truth keeps
  moving. Tests: 2 new cases in `__tests__/teamIndexIntegrity.test.ts`, both
  failing on the first commit; the concurrency one drives the real interleaving
  by running request B inside the store call that makes A fail. — 2026-08-04
- **H24–H27 — `team-index` and `team:{id}` could be left disagreeing, and a
  team name is then unusable for good.** Four defects in `teamRoutes.js`, found
  by reading the uncovered branches of the lowest-covered route exactly as §4
  says to. The shared shape: creation and deletion each touch two store records
  with **no transaction spanning them**, and the failure handling assumed the
  second write always happens. (1) *Creation* claims the name in the index
  **before** writing the record, so a store failure at `saveTeam` left a claim
  pointing at nothing — `/api/team/create` then answers `409 team_name_exists`
  from the index alone, `/api/team/login` resolves an id whose record is missing
  (`401`), and `/api/team/list` scans `team:` records so the team is not even
  visible. Unrepairable from the UI, forever. Now a compensating release, keyed
  on the id we claimed so a concurrent creation that won the name is never
  evicted. (2) *Deletion* deleted the record **before** clearing the index, so a
  failure on the last write produced the same ghost — and worse, the retry then
  `401`s, because there is no longer a record to authenticate against. The two
  writes are now index-first, so any single failure leaves the team whole and
  the retry completes — and the index is only ever *narrowed* on this path; see
  the PR #407 review entry above for why a rollback there is not the tidier
  option it looks like.
  (3) Deletion's feedback-preservation step ran before those writes and pushed
  **unconditionally**, so every retry appended a second copy of every feedback —
  visible twice on the board, since `/api/feedbacks/all` concatenates team and
  orphaned feedbacks, and only one copy of the pair would ever be commented on
  again (every writer resolves an orphan by first match). Now an upsert by
  feedback id. (4) `/api/team/exists/:teamName` called `decodeURIComponent` on a
  parameter **Express had already decoded**: a bare `%` in the name threw
  `URIError` → `500`, and `dataService.renameTeam` fails the rename when that
  check does not answer — so no team could ever be renamed to "Sprint 50%", with
  a "please try again" message that could never come true. A name that still
  looked encoded after decoding was silently answered *about a different name*.
  The second decode is gone. Creation also now trims the name, which the rename
  path already did — untrimmed, "Alpha " and "Alpha" were two index keys and two
  teams that render identically in the login picker, and a whitespace-only name
  satisfies the form's `required` attribute. **Lesson:** three of the four are
  the same omission — a compensating write for a partial failure. The rename
  path in this very file already had one (its index rollback); nobody had asked
  whether the *other* multi-write paths needed the same. When reviewing a
  handler that writes two records, ask what the second failure leaves behind,
  and whether a retry can reach it. Tests:
  `__tests__/teamIndexIntegrity.test.ts` (13 cases, 9 failing before across the
  two commits — the rest guard against over-correcting: an existing team must
  survive a colliding creation's rollback, a failed record delete must stay
  retryable with the record intact, a clean deletion still frees the name,
  ordinary names still resolve) and 2 cases in `dataService.test.ts` for the
  client-side trim. — 2026-08-04
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
---

## 1. Verified baseline (measured 2026-08-04 on `claude/hardening-status-continuation-h68mbn`)

Note: a fresh container clone has no `node_modules` — run `npm ci` first, or
every check fails with `vitest: not found` / missing type definitions.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **pass** — 0 errors, **110 warnings**, exactly the budget. Since D6 the budget is a **two-way** ratchet (`scripts/lint.mjs`): it fails above *and* below, so removing warnings now requires lowering `BUDGET` in the same change |
| Types | `npm run type-check` | **pass** — 0 errors |
| Unit tests | `npm run test` | **pass** — 107 files, 1 193 tests (102/1 162 at the start of this pass) |
| Coverage (gate) | `npm run test:coverage` | **pass** — 85.46% stmts on the *gated scope*, which is 45.7% of production code (see §4) |
| Coverage (whole) | `npm run test:coverage:all` | **pass** — 61.33% stmts across the whole codebase, floor 57% |
| Build | `npm run build` | **pass** — 679 kB JS chunk (over Vite's 500 kB warning) |
| E2E | `npx playwright test` | **pass** — 10 tests, **~3.5 min** serially (`workers: 1`), twice in a row. Since D5 this also runs on every pull request, so a red e2e is now a blocked merge rather than a local surprise. The 2026-07-30 baseline run **failed** `retro-full-flow` on the announcement-modal race and took 9.1 min; H18 fixed it, and the time drop is the same cause (blocked clicks no longer burn a 6-min timeout). Beware the reporting trap that hid the failure: `npx playwright test \| tail` returns *tail's* exit status, so a failing run looks like exit 0 — read the summary line, not `$?` |
| Prod audit | `npm audit --omit=dev --audit-level=high` | **pass** — 0 vulnerabilities |
| Dev audit | `npm audit` | 1 high (`brace-expansion` DoS, dev-only — does not gate CI) |

**Tooling note:** `gstack` (§0.1) is **not installed** in the remote container
this pass ran in — `~/.claude/skills/` has no `gstack` entry and the repo has no
`.claude/` bootstrap. The review workflow therefore ran **without** it; that is
recorded here rather than claimed. (Re-checked and still true on the H29 pass,
2026-08-04: `~/.claude/skills/` lists only the stock skills — docx, pdf, pptx,
xlsx, morning, session-start-hook, skill-creator — and the repo still has no
`.claude/`.)

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
    On Kubernetes the value is per environment (dev and prod have different
    generated Route hostnames), so `k8s/base/deployment.yaml` carries only the
    wiring: a `configMapKeyRef` to `retrogemini-config` with **`optional: true`**,
    supplied once per project from `k8s/config-templates/` on the Secrets'
    apply-once lifecycle. Keep `optional: true` — without it an environment that
    deliberately has no ConfigMap (a dev project that sends no reset mail) could
    not start its pods at all, which turns a missing origin into an outage.
    Asserted by `deploymentManifestParity.test.ts`.
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
15. **`team-index` and `team:{id}` are kept consistent by compensating writes**
    (H24–H27). No transaction spans the two records, so every handler that
    writes both must be able to answer "what does a failure on the second write
    leave behind, and can a retry reach it?". The two rules that follow from it:
    creation claims the index entry *before* the record and therefore
    **releases the claim** if `saveTeam` fails (keyed on its own team id, so a
    concurrent winner is never evicted); deletion clears the index entry
    **first**, because only that order leaves the record — and hence the ability
    to authenticate a retry — intact. Do not "simplify" either back to a single
    unguarded sequence: the state it produces (a name resolving to no record) is
    unusable for creation, unusable for login, invisible in `/api/team/list`,
    and unreachable from the UI.
    **On the failure paths the index is only ever narrowed, never widened** —
    and deletion has *no* rollback for exactly that reason (Codex, PR #407).
    Restoring the entry when `deleteTeamRecord` fails looks tidier and
    reintroduces the terminal state as soon as two deletions overlap: A clears
    the entry and fails, B sees no entry and deletes the record successfully, A
    restores a mapping to a record that is gone. No re-check closes it, because
    the record can vanish between the check and the write; only the structural
    rule does. Creation's release obeys the same rule — it removes a mapping it
    added itself.
    Deletion's feedback preservation is an **upsert** by feedback id: the retry
    this ordering enables must neither duplicate the board nor keep a stale
    snapshot, and since every feedback writer resolves the team record before
    `orphanedFeedbacks`, a change made in that window is on the live copy.
    Asserted by `__tests__/teamIndexIntegrity.test.ts`.
16. **Express has already percent-decoded `req.params`.** Decoding again is a
    double decode: it throws `URIError` on a legitimate `%` in a team name and
    silently answers about a different name when the decoded value still looks
    encoded (H27). Creation, rename and the availability check all trim the
    name, so all three agree on what a given name resolves to; keep them
    aligned when touching any one of them.
17. **Every route that sends mail is authenticated, and every mail's identity
    fields come from the authenticated record** (H3, H4, H29). A route that
    calls `mailerService.mailer.sendMail` puts caller-supplied content into
    somebody's inbox signed by the organisation's own domain, so an anonymous
    one is a spam and phishing relay with the deployment's reputation attached.
    All three that exist obey it: `/api/send-invite` and
    `/api/notify-new-feedback` require a team credential,
    `/api/send-password-reset` is anonymous by necessity and is therefore the
    one that fails closed without a configured origin (invariant 12). The
    ordering is part of the rule — credential *before* payload validation and
    *before* the SMTP capability check, so an anonymous caller cannot probe
    whether mail is configured. So is the attribution: the team name in an
    invite and the `Team:` line in a feedback notification are read from the
    authenticated team record, never from the request body.
    **Before closing any finding of this shape, grep for the shape**:
    `grep -n "sendMail" server/routes` is the four-second check that would have
    found H29 two passes before it was found. Asserted by
    `__tests__/inviteMailAuthorization.test.ts` and
    `__tests__/feedbackNotificationAuthorization.test.ts`; the client half of
    the second (a fire-and-forget call that fails silently without its
    credential) by `__tests__/feedbackNotificationCredential.test.tsx`.

---

## 3. Open findings

Severity: **P0** exploitable/data-losing · **P1** real risk · **P2** quality/ops.
Each item lists the failure scenario, acceptance criteria and the test that
must accompany the fix.

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

### H23 — [P2] The plaintext-compare fallback is still in the auth path

**Partly done:** prerequisite 2 (the restore hook) is closed — both restore
routes re-run `migrateLegacyPasswords` over the restored records. What remains
is prerequisite 1, a **production observation**, plus the removal itself.

- **Files:** `server/services/passwordHashing.js` (the `if (!parsed)`
  constant-time plaintext branch), `server/services/teamService.js:30-45`
  (rehash-on-auth), `server/services/passwordMigration.js` (the startup pass),
  `server/routes/superAdminRoutes.js` (`rehashRestoredPasswords`, called by both
  restore routes).
- **Where D1 got to:** the eager migration shipped, so a booted deployment
  leaves no legacy record for the fallback to serve. The fallback itself was
  deliberately **not** removed in the same change: if the migration silently
  fails (a store outage at boot), removing it turns a cosmetic problem into a
  team that cannot log in at all — the H20 lesson that an availability cost is a
  security property too.
- **The one prerequisite left:** production boots reporting
  `upgraded: 0, failed: 0` — the migration only logs when it did something, so
  *silence in the logs is the pass signal*. Check two consecutive deployments.
  Nothing in the code blocks the removal any more.
- **Risk of leaving it:** low and shrinking — the window is a record that has
  never been read since the migration. The value of closing it is that
  `verifyPassword` stops having a branch where a stored string is compared
  directly against a submitted password.
- **Acceptance:** `verifyPassword` returns false for a non-hashed stored value;
  no team can authenticate against a plaintext record.
- **Tests:** add a case to the password-hashing suite asserting a plaintext
  record no longer authenticates. The restore hook is already guarded by
  `__tests__/restorePasswordMigration.test.ts`, whose "credential survives the
  upgrade" assertions are what stop the removal from silently locking a restored
  team out.
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

- **H13 — the image build reaches `unofficial-builds.nodejs.org`** when
  `better-sqlite3` has no musl prebuild for the pinned Node and `node-gyp`
  rebuilds from source. **Accepted (maintainer, 2026-08-04): re-run the job when
  it flakes.** The premise that made it look worse than it is: the offline
  guarantee this product sells is about the **runtime**, not the build, and
  images are built in GitHub Actions, which has internet. So the real cost is a
  CI flake wearing a frightening name — *"Scan Docker Image for
  Vulnerabilities"* fails with no vulnerability involved. **What would reopen
  it:** a requirement to build images inside the air-gapped network itself, or
  the flake becoming frequent enough to cost more than the re-runs. Do not
  "fix" it blind: there is no Docker daemon in the agent container, so a
  Dockerfile change cannot be verified here, and the tracker's own note puts
  the regression risk at medium.
- **H15 — a merged recovery lives only in React state until the resend fires.**
  After a lost write race the client merges its own data back in and re-sends
  150–400 ms later; unmounting inside that window clears the timer and the
  merged data is lost from both the cache and the server.
  **Accepted (maintainer, 2026-08-04): document the window, change nothing.**
  The reasoning: it needs *two* coincidences (a lost optimistic-concurrency race
  **and** an unmount within ~a quarter of a second) and costs one user action —
  a vote, a ticket. Every available fix edits the shared sync/merge/apply path,
  which is the most dangerous code in this repo (the zero-downtime guarantee
  rides on it), §7.4 requires `npm run test:load` against staging before
  touching it, and no staging exists. Trading a rare lost click for a risk to
  every live session is the wrong trade. **What would reopen it:** field reports
  of vanished votes, or a staging environment making the load test possible —
  at which point option (a), caching the merged state, is the one to take.
- **H19 — the rate limiters are per pod, so the real ceiling is `N ×` the
  documented value.** At `replicas: 2` a load-balanced client gets
  `2 × AUTH_RATE_LIMIT_MAX`. **Accepted (maintainer, 2026-08-04): leave it,
  documented** — which it already is, on all three surfaces. The limiters exist
  to bound *store work* by an anonymous prober (H5), and `N ×` a small number is
  still a small number; a NAT'd office argues for the looser bound anyway.
  **What would reopen it:** a hard cluster-wide ceiling being required, in which
  case it belongs at the Ingress/Route or WAF (option c) rather than in a Redis
  store the manifests deliberately do not deploy.
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

**There are two numbers now, and each says what it measures** — because the
single one was misread as repo-wide more than once, which is exactly the failure
mode a coverage percentage invites:

| Command | Scope | 2026-08-04 |
|---|---|---|
| `npm run test:coverage` | the gate: `services/**/*.ts`, `server/services/**/*.js`, `server/routes/**/*.js`, `utils/**/*.{ts,js}` — **4 595 of 10 049 production statements, 45.7%** | **85.46%** stmts |
| `npm run test:coverage:all` | **the whole production codebase**, 10 049 statements | **61.33%** stmts |

The gap is almost entirely `components/**`: 5 033 statements at **40.9%**,
deliberately outside the gate because that layer is owned by the Playwright
suite (D5). The other unmeasured area is `(root)` — `App.tsx` and `server.js`,
421 statements at 37.1%.

**History, so nobody re-discovers it as a surprise:** the gate originally
included `services/**` *alone* — two files, ~2.6% of the repo — while reporting a
number in the eighties. Widening it to the four directories above was the first
correction; publishing the whole-codebase figure beside it
(`scripts/coverage-scope.mjs`, floor 57%, wired into CI as *Coverage (whole
codebase)*) is the second. Do not quote the gate figure as the project's
coverage without naming its scope.

The gate's own rows, from one `npm run test:coverage` run, 2026-08-04:

| Layer | Measured | In gate? | Verdict |
|---|---|---|---|
| Backend services | **86.77%** | yes | good |
| — `dataStore.js` | **71.50% stmts / 60.06% branch** | yes | the PG branches are the remaining gap and need a real PostgreSQL |
| — `mailerService.js` | **0%** | yes | thin wrapper, low value |
| Backend routes | **87.77%** | yes | was 85.87% |
| — `superAdminRoutes.js` | **98.04%** | yes | largest backend file |
| — `passwordResetRoutes.js` | **99.21%** | yes | the H4/H5 surface; the residual is H4's new `invalid_link` branch |
| — `publicRoutes.js` | **85.43%** | yes | was 74.71% before the H29/H31 tests |
| — `teamRoutes.js` | **74.92%** | yes | now the lowest route, and the weakest branch coverage at 64.3% |
| — `feedbackRoutes.js` | **73.33%** | yes | the H2/H22/H28 surface. **The previous revision of this table said 77.32%, which was never measured** — a clean-tree run at the start of this pass reads 73.33%, so the figure had drifted, not regressed. Re-measure before quoting a row |
| — `aiRoutes.js` | **85.00%** | yes | H21 surface |
| Frontend services | **77.14%** | yes | good |
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

1. `feedbackRoutes.js` (73.3%) — now the lowest route, and the number the table
   had wrong. Its residual is not only the two admin-notification mail bodies:
   lines 364–409 are uncovered, which is where the *notification* side effects
   of the delete and comment routes live.
2. `teamRoutes.js` (74.9%) — its **branch** coverage is 64.3%, the weakest of the
   routes, and H24–H27 all came out of that gap.
3. `aiRoutes.js` (85.0% stmts but **68.7% branches**) — the weakest branch
   coverage after `teamRoutes`, on the H21 surface.
4. `dataStore.js` PostgreSQL branches — needs a real PG instance, so it is an
   environment problem rather than a test-writing one.
5. `socketHandlers.js` — the residual identity/authorization branches.

`publicRoutes.js` has moved off this list (74.7% → 84.0%): the H29 tests took
it, and H29 itself came straight out of reading its uncovered lines.

**Writing route tests is how the last several findings were found** (H21, H22,
then H24–H27, H28 and now H29), not a percentage exercise: every one was spotted while
reading the uncovered branches of the lowest-covered routes. Read the uncovered lines before
writing the test. Note what H24–H27 add to that rule: the uncovered lines were
not the *feature* paths but the **failure** paths — the `catch` that never runs
in a test because the mock store never fails. Making a store operation fail on
demand is what exposed all four.

**Do not** chase 100%. Components stay out of unit coverage and are owned by
e2e (see D5).

---

## 5. Decisions the maintainer must make

**None are open.** D1–D7 were answered on 2026-08-03, and D8–D12 on 2026-08-04;
in both rounds the work they blocked shipped in the same pass. The answers that
lock in a rule are invariants 12, 13 and 17 (§2); the rest are recorded here in
one line each so nobody re-opens a settled question.

⚠️ **Keep this section honest.** The previous revision kept saying "none are
open" while §3 had grown two items whose acceptance criterion was literally "a
recorded decision" — the header was written once and never re-read. When you add
a §3 item that needs an arbitration, add it *here* in the same edit.

**Round 2 — D8–D12, answered 2026-08-04.** The maintainer's framing is worth
keeping, because it is a decision rule and not just five answers: *"si c'est pas
grave, le mieux c'est de rien faire"*. Three of the five were closed by applying
it, and that is the correct outcome, not a shortcut — a P3 whose fix touches the
sync path or global body parsing costs more than it buys.

- **D8 — `/api/wifi-config` anonymous (H31): require a team credential.**
  Shipped; see *Recently closed*.
- **D9 — the restore route's dead `application/json` (H30): fix it well.**
  Investigating first changed the answer — the capability was never missing, only
  mislabelled — so the fix is one line rather than the body-parser rewiring the
  original write-up implied. See *Recently closed*.
- **D10 — per-pod rate limiters (H19): leave them, documented.** Now an accepted
  residual in §3 H10.
- **D11 — the image build's internet dependency (H13): accept and re-run.** Now
  an accepted residual in §3 H10, with what would reopen it.
- **D12 — the merge/resend window (H15): document it, change nothing.** Now an
  accepted residual in §3 H10. This is the one where "do nothing" is most
  actively right: every fix edits the shared sync path, and §7.4 gates that on a
  load test no environment here can run.

**Round 1 — D1–D7, answered 2026-08-03:**

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
| **L12** | H23 (remove the plaintext-compare fallback) — only the removal itself is left; the restore hook shipped | two clean production boots (see H23) | no team authenticates against a non-hashed record |
| **L4b** | H11 (enable the dormant `SOCKET_UPDATE_RATE` throttle) | staging env for `npm run test:load` | load test run at real cadence; non-zero rate live in staging then prod |
| **L9** | H9 (decomposition + code splitting) — **measure first** | H9 baseline profile | first-paint improvement on a real device; no sync regressions |

**Every lot left now needs an environment this container does not have** (a
staging deployment for the load test, a real device to profile) or a
**production observation** (H23). Nothing is blocked on a decision: D8–D12
cleared the last of those on 2026-08-04, and the three they closed by *accepting*
the residual are recorded in §3 H10 with what would reopen each one.

That means a session picking this up with no new environment has no §6 lot to
take. **Go to §4 instead** and write route tests against the lowest-covered
branches — every finding of the last five passes (H21, H22, H24–H28, H29) came
out of exactly that, and none of them needed anything this container lacks.

**A note for the next session, because this pass is the second in a row where it
mattered:** "the lot is blocked" and "every part of the lot is blocked" are
different statements. L12 sat behind two prerequisites, one of which (the restore
hook) was ordinary code work needing nothing this container lacks — it had been
carried as blocked for two passes because the *lot* was. Before accepting a
`Prereq` column, read the item's own body and ask which half of it the
prerequisite actually gates.

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
