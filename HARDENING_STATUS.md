# RetroGemini Hardening Status

_Last updated: 2026-08-05 (H34 — the sixth feedback sibling reporting a refused delete as success — and H35, the dropped stale persist nobody is told about, which reopens §5 with **D13**)_

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

- **H34 — `/api/feedbacks/delete` was the *sixth* sibling of the H22/H28 shape,
  and the one the enumeration of "all five" had missed.** Its updater aborts on
  three conditions — the team record carries no `teamFeedbacks`, the feedback is
  not in it, or the feedback belongs to another team — and an aborted updater
  reads as "nothing to change", so the route answered `{ success: true }` for
  all three. `TeamFeedback.tsx` reloads the board only on `response.ok`, so a
  refused delete left the entry on screen with the UI having reported no
  problem: the user cannot tell "deleted" from "I was not allowed to", and the
  obvious next move is to click delete again. The three refusals now share one
  opaque `404 feedback_not_found`, decided by the write, so the route cannot be
  used to probe which feedback ids exist or who owns them; the client reloads on
  `404` too, exactly as its `comment/delete` sibling already did. **Two existing
  tests were rewritten, not deleted** — `teamTokenAuth.test.ts` asserted `200`
  on a deliberately missing target when all it meant was "the credential
  passed", and `atomicUpdateFailureHandling.test.ts` used this route to pin "a
  no-op is not a lost write", which conflated the H2 guard (about
  `result.success`) with the *outcome* of a write that reached no target. Both
  halves are now pinned separately. **Lesson:** H28's write-up named "all five"
  routes built this way and the count was wrong — an enumeration is a claim like
  any other, and `grep -n "return null" server/routes/feedbackRoutes.js` checks
  it in seconds. Tests: 5 cases in
  `__tests__/feedbackWriteAcknowledgement.test.ts` (4 failing before; the fifth
  guards the live delete and its admin notification). — 2026-08-05
- **H20 — `AUTH_RATE_LIMIT_MAX` could lock real users out of a running
  retrospective** (closed 2026-07-30, removed from §3 here because it had been
  left sitting there marked `[P1, fixed]` and inflating the open-item count).
  The meter is scoped to `401` alone, so nothing a legitimate user does spends
  it. **Lesson, still load-bearing elsewhere in this file: an availability cost
  is a security property too** — "is this limit ever reached by someone doing
  their job?" belongs in the review of every limiter. — 2026-08-05
- **H33 — both rename paths could brick a team name, and one reported a
  collision as success.** Found by grepping every `atomicTeamIndexUpdate` caller
  after the maintainer's workflow bug (H32) turned out to be *the same shape*:
  one side of a two-sided contract changed, the other never re-read. (1) The
  team-side rename released the old index key in the same write that claimed the
  new one, so for the width of the record write the old name was **unclaimed** —
  and its rollback then restored it *unconditionally*. A creation that took the
  name in that window was silently evicted: its record survives, its name
  resolves to the other team, and no UI reaches the state. A deletion landing in
  the same window left the restored name pointing at a deleted record — the
  terminal state invariant 15 exists for. This is the Codex PR #407 finding
  again, in the very handler the H24–H27 write-up had cited as the *precedent*
  for compensating writes: it was read as the good example and never checked
  against the rule it inspired. (2) `/api/super-admin/rename-team` let its index
  updater refuse a colliding name — `return null`, nothing written — and then
  renamed the record anyway, answering `{ success: true }`. The team ended up
  reachable only under the name it no longer displayed: its facilitator cannot
  log in, the picker lists two teams with one name, and `SuperAdmin.tsx` has
  handled `409` for this all along, so the client was written against a status
  the route never sent. Both now go through
  `server/services/teamNameIndex.js`: **claim the new key, write the record,
  release the old key** — a compensating write only ever removes a mapping it
  added itself, so no failure path restores anything. Deletion also had to stop
  clearing only the *first* key matching the team, since a rename in flight
  legitimately holds two. **Two existing super-admin tests were rewritten, not
  deleted**: they introspected the index updater in isolation against a mock
  that never applied it, so one of them asserted a refusal the *route* ignored —
  the H30 lesson (an unfaithful harness makes an unsupported path look
  supported) is what kept this invisible. Tests:
  6 cases in `__tests__/teamIndexIntegrity.test.ts` (3 failing before — eviction,
  ghost-after-delete, and the second index key surviving a deletion) plus 3
  guards against over-correcting, 2 rewritten + 1 new in
  `__tests__/superAdminRoutes.test.ts` (2 failing before), and
  `__tests__/teamNameIndex.test.ts` (11 cases on the ownership rules).
  **Codex review follow-up (same PR, P2, valid):** the first version released
  only the record's *current* old name, so an alias left by a lost release stayed
  claimed **for good** — nobody else could take that name and it kept resolving
  to the team. It also falsified what this tracker had just asserted, that the
  residual self-heals on the next rename. A rename now sweeps every key the team
  held **at claim time**, and that set is captured *before* the claim on purpose:
  a key claimed by a concurrent rename of the same team is not in it, so two
  overlapping renames cannot delete each other's claim and leave the team with no
  name at all — the failure the obvious "delete everything except the new key"
  would have introduced, and the reason a re-assert is not the answer either (it
  would put a mapping back onto a record a concurrent deletion had removed).
  Fixing it surfaced a second case: renaming *back* onto such an alias finds the
  name already the team's own, so the claim writes nothing — and the failure path
  must not release it, or a failed rename takes the team's own name away. Tests:
  3 more cases in `teamIndexIntegrity.test.ts` (2 failing before) and 1 in
  `superAdminRoutes.test.ts` (failing before). **Lesson:** "benign residual" is a
  claim about the *future*, so it has to name what cleans it up and be checked —
  this one named a mechanism that did not exist. — 2026-08-05
- **H32 — the release workflow had been dispatching a dead input since D7, so
  no merge to `main` published an image.** Reported by the maintainer, not the
  audit: `github-release.yml` still passed `-f update_k8s_manifests=false` to
  `docker-deploy.yml`, whose `workflow_dispatch` input D7 had deleted. The
  dispatch API validates the input set and rejects the **whole call**
  (`HTTP 422: Unexpected inputs provided`), so the step did not degrade — it
  dispatched nothing, on all three VERSION-bump merges since 2026-08-03. It
  stayed unnoticed because images kept appearing: they were being dispatched by
  hand from the feature branches. **Check Docker Hub for 27.35–27.37 before
  assuming they shipped.** The contract now lives in
  `deploymentManifestParity.test.ts` (invariant 11): every `-f` passed to
  `gh workflow run <target>` must be declared by `<target>`, and every
  `required: true` input of `<target>` must be passed. **Lesson — this is the
  H28/H29 "grep for the shape" rule outside the application code:** D7 was a
  *deletion*, and a deletion has callers too. It was recorded here as a clean
  win, with the workflow file read but not its dispatchers; `grep -rn
  "update_k8s_manifests" .github/` would have taken seconds. Anything a workflow
  removes — an input, a job name a branch-protection rule requires, an artifact
  another workflow downloads — is a contract with a second side that does not
  fail at merge time. Tests: 6 cases in
  `__tests__/deploymentManifestParity.test.ts` (1 failing before, plus two
  vacuity guards on the scanners themselves). — 2026-08-05
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
---

## 1. Verified baseline (measured 2026-08-05 on `claude/hardening-status-blocages-5kbmyb`)

Note: a fresh container clone has no `node_modules` — run `npm ci` first, or
every check fails with `vitest: not found` / missing type definitions.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **pass** — 0 errors, **110 warnings**, exactly the budget. Since D6 the budget is a **two-way** ratchet (`scripts/lint.mjs`): it fails above *and* below, so removing warnings now requires lowering `BUDGET` in the same change |
| Types | `npm run type-check` | **pass** — 0 errors |
| Unit tests | `npm run test` | **pass** — 109 files, 1 238 tests (108/1 221 at the start of this pass) |
| Coverage (gate) | `npm run test:coverage` | **pass** — 86.53% stmts on the *gated scope*, which is 45.9% of production code (see §4) |
| Coverage (whole) | `npm run test:coverage:all` | **pass** — 61.90% stmts across the whole codebase, floor 57% |
| Build | `npm run build` | **pass** — 680 kB JS chunk (over Vite's 500 kB warning) |
| E2E | `npx playwright test` | **pass** — 10 tests, **~3.5 min** serially (`workers: 1`), twice in a row. Since D5 this also runs on every pull request, so a red e2e is now a blocked merge rather than a local surprise. The 2026-07-30 baseline run **failed** `retro-full-flow` on the announcement-modal race and took 9.1 min; H18 fixed it, and the time drop is the same cause (blocked clicks no longer burn a 6-min timeout). Beware the reporting trap that hid the failure: `npx playwright test \| tail` returns *tail's* exit status, so a failing run looks like exit 0 — read the summary line, not `$?` |
| Prod audit | `npm audit --omit=dev --audit-level=high` | **pass** — 0 vulnerabilities |
| Dev audit | `npm audit` | 1 high (`brace-expansion` DoS, dev-only — does not gate CI) |

**Tooling note:** `gstack` (§0.1) is **not installed** in the remote container
this pass ran in — `~/.claude/skills/` has no `gstack` entry and the repo has no
`.claude/` bootstrap. The review workflow therefore ran **without** it; that is
recorded here rather than claimed. (Re-checked and still true on the H32/H33
pass, 2026-08-05: `~/.claude/skills/` lists only the stock skills — docx, pdf,
pptx, xlsx, morning, session-start-hook, skill-creator — and the repo still has
no `.claude/`.)

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
    `VERSION`'s **major** (not to equal it — a human retags that line in the pull
    request that bumps the major, since D7 deleted the auto-commit step, so
    lagging by the `Y` bumps since the last retag is normal and correct) and
    checks that every kustomize overlay patches names that exist in `k8s/base`.
    Adding a knob or renaming a base resource fails the suite until the surfaces
    follow; do not weaken the contract to make a change pass — add the exemption
    *and its reason*.
    **It also holds the cross-workflow dispatch contract** (H32): the `-f` inputs
    a workflow passes to `gh workflow run <target>` must be exactly the inputs
    `<target>` declares — every one of them declared, and every `required: true`
    one passed. The dispatch API validates the set and rejects the whole call
    with `422`, so the two sides of that contract live in different files with
    nothing but this check between them.
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
    **Renaming obeys it too, and used not to** (H33). Both rename paths —
    `/api/team/:teamId/update` and `/api/super-admin/rename-team` — now go
    through `server/services/teamNameIndex.js`: **claim the new key, write the
    record, then release the old key.** Freeing the old key in the same write as
    the claim is what forced a *widening* rollback, and that rollback could evict
    a team that legitimately took the name in the window (its record survives,
    its name resolves to someone else) or restore a name onto a record a
    concurrent deletion had removed. The residual of the new order is benign and
    self-healing: if the final release is lost the team answers to both names,
    every mapping still points at a live record, and the next rename or deletion
    clears it — which is why deletion drops **every** key matching the team, and
    why a rename releases **every key the team held at claim time**, not just the
    record's current name (Codex, PR #413: releasing one key left the other
    claimed for good, so the "self-healing" claim was false as first written).
    That set is taken *before* the claim on purpose — a key claimed by a
    concurrent rename of the same team is not in it, so two overlapping renames
    cannot delete each other's claim and leave the team unreachable. The rules to
    carry forward: **a compensating write may only remove a mapping it added
    itself** (so a claim that finds the name already the team's own must not be
    released on failure), and a name is claimed before, never after, the record
    that justifies it.
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

### H35 — [P1] A dropped stale persist is reported as success, and nothing heals the client

**Found by writing the `teamRoutes.js` failure-path tests, not by a report.** It
is the H22/H28/H34 shape ("success follows the write, not the read") in a second
file — but the fix is *not* the same, which is why this is an item and not a
patch. **Needs a decision (§5, D13) before any code moves.**

- **Files:** `server/routes/teamRoutes.js` (the rev guards in
  `/api/team/:teamId/retrospective/:retroId` and `/healthcheck/:hcId`),
  `services/dataService.ts:369-394` (`persistRetrospective` /
  `persistHealthCheck`), `services/dataService.ts:901-911`
  (`updateSessionName`).
- **The mechanism:** the rev guard aborts the updater when
  `incomingRev < existingRev`. That is correct and must stay — it is what stops
  a stale blob clobbering newer state. But an aborted updater is reported by
  `atomicTeamUpdate` as "nothing to change", so the route answers
  `{ success: true }` for a write it deliberately dropped, and the client half
  is fire-and-forget: `persistRetrospective` only `console.warn`s on error and
  returns `void`. There is no re-fetch, no retry, no user-visible signal.
- **Failure scenario (the one that is not merely cosmetic):** a facilitator
  renames a retrospective from the Dashboard while that retro is live in a
  session elsewhere. The Dashboard client is not in the socket room, so its
  `_rev` never advanced; the socket path advanced the stored one. The rename is
  dropped, the server answers success, and the name reverts on next load with
  nothing having reported a problem. The socket path heals this exact race
  (`session-ack` + the merge in `mergeRemoteSession.ts`); the HTTP path does
  not.
- **Why it is not a one-line fix.** Answering `409` instead of `200` changes
  nothing on its own — the client would turn a silent success into a silent
  `console.warn`. Making it *matter* means giving the HTTP persist a healing
  round-trip, which is a change to the shared sync path, and §7.4 requires
  `npm run test:load` against staging before touching that. The maintainer has a
  multi-pod + PostgreSQL dev environment (2026-08-05) but this container has no
  access to it, so the load test is theirs to run, not this session's.
- **Do not "fix" it by weakening the guard.** Letting the stale blob through
  restores the clobber the guard exists to prevent. The scope of any fix is the
  *notification*, never the drop.
- **Acceptance:** either (a) the persist routes answer a distinguishable status
  and `dataService` re-fetches and re-applies, with the load test run first, or
  (b) the residual is accepted and moved to §3 H10 with what would reopen it.
- **Tests already in place:** `__tests__/teamPersistFailurePaths.test.ts` pins
  the guard itself (a stale revision is dropped, an equal one applies, a blob
  with no `_rev` is untouched by it) and was checked for vacuity by mutating the
  guard to `if (false)` — 2 cases fail without it. Those stay valid under either
  answer. A fix would add the client-side re-apply case.
- **Effort:** M for (a), S for (b). **Regression risk:** high for (a) — it is
  the sync path.

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
- **A rename whose last write is lost leaves the team holding two names** (H33).
  The new order claims the new index key, writes the record, then releases the
  old key; if that last release fails, both keys map to the team. Benign while it
  lasts — every mapping points at a live record and login works under either
  name — and it does not last: the next rename sweeps **every** key the team held
  at claim time, and deletion drops every key matching the team. Both of those
  are the fix for Codex's PR #413 finding, which caught this entry claiming the
  alias self-healed when the release covered only the record's current old name,
  so a stale one stayed claimed for good. The sweep is deliberately scoped to the
  keys observed *before* the claim: a key claimed by a concurrent rename of the
  same team is not in that set, so two overlapping renames cannot delete each
  other's claim and leave the team with no name at all. Do not "tidy" any of this
  with a rollback or a re-assert.
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

| Command | Scope | 2026-08-05 |
|---|---|---|
| `npm run test:coverage` | the gate: `services/**/*.ts`, `server/services/**/*.js`, `server/routes/**/*.js`, `utils/**/*.{ts,js}` — **4 635 of 10 089 production statements, 45.9%** | **86.53%** stmts |
| `npm run test:coverage:all` | **the whole production codebase**, 10 089 statements | **61.90%** stmts |

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

The gate's own rows, from one `npm run test:coverage` run, 2026-08-05:

| Layer | Measured | In gate? | Verdict |
|---|---|---|---|
| Backend services | **86.96%** | yes | good |
| — `dataStore.js` | **71.50% stmts / 60.06% branch** | yes | the PG branches are the remaining gap and need a real PostgreSQL |
| — `mailerService.js` | **0%** | yes | thin wrapper, low value |
| Backend routes | **90.76%** | yes | was 88.00% |
| — `superAdminRoutes.js` | **97.75%** | yes | largest backend file; the dip is H33's new release paths, whose `.catch` arms no test drives |
| — `passwordResetRoutes.js` | **99.21%** | yes | the H4/H5 surface; the residual is H4's new `invalid_link` branch |
| — `publicRoutes.js` | **85.43%** | yes | was 74.71% before the H29/H31 tests |
| — `teamRoutes.js` | **82.26%** | yes | was 75.87% before the H35 failure-path tests (branches 66.8% → 75.7%). H24–H27, H33 *and* H35 all came out of that gap |
| — `feedbackRoutes.js` | **83.00%** | yes | was 73.33% before the H34 tests. The H2/H22/H28/H34 surface. **A previous revision of this table said 77.32%, which was never measured** — re-measure before quoting a row |
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

1. **`aiRoutes.js` (85.0% stmts but 68.7% branches) — now the weakest branch
   coverage of any route**, on the H21 surface (the routes that must never leak
   internal LLM detail). It inherited the top slot from `teamRoutes` rather than
   getting worse; nothing here has been read yet.
2. `feedbackRoutes.js` — **the false-success half is closed** (H34: the delete
   route's three refusals now share one opaque `404`). What is left is the
   *notification* side effects: the two admin-notification mail bodies of the
   delete and comment routes are the largest uncovered block, and no test drives
   their `catch` arms.
3. **`teamRoutes.js`** — the granular persist failure paths are now covered by
   `teamPersistFailurePaths.test.ts`, and reading them is what surfaced **H35**.
   What is still uncovered: the `/create` admin-notification mail body, the
   `/update` rename arms, and `/delete`'s store-failure paths.
4. `dataStore.js` PostgreSQL branches — needs a real PG instance, so it is an
   environment problem rather than a test-writing one.
5. `socketHandlers.js` — the residual identity/authorization branches.

`publicRoutes.js` has moved off this list (74.7% → 85.4%): the H29 tests took
it, and H29 itself came straight out of reading its uncovered lines.

**Writing route tests is how the last several findings were found** (H21, H22,
then H24–H27, H28, H29, H33 and now H34), not a percentage exercise: every one was spotted while
reading the uncovered branches of the lowest-covered routes. Read the uncovered lines before
writing the test. Note what H24–H27 add to that rule: the uncovered lines were
not the *feature* paths but the **failure** paths — the `catch` that never runs
in a test because the mock store never fails. Making a store operation fail on
demand is what exposed all four, and H33 needed one turn more of the same screw:
a fault that runs *another request to completion* inside the failing call, which
is the only way a two-writer interleaving becomes deterministic.

**Do not** chase 100%. Components stay out of unit coverage and are owned by
e2e (see D5).

---

## 5. Decisions the maintainer must make

**One is open: D13.** D1–D7 were answered on 2026-08-03 and D8–D12 on
2026-08-04; in both rounds the work they blocked shipped in the same pass. The
answers that lock in a rule are invariants 12, 13 and 17 (§2); the rest are
recorded below in one line each so nobody re-opens a settled question.

### D13 — H35: heal the dropped HTTP persist, or accept the residual?

The rev guard on `/retrospective/:retroId` and `/healthcheck/:hcId` correctly
drops a stale blob and then answers `{ success: true }`, and the client is
fire-and-forget, so a Dashboard rename of a live retro is silently lost. Two
answers, and the framing of D8–D12 (*"si c'est pas grave, le mieux c'est de rien
faire"*) genuinely could go either way here:

- **(a) Heal it.** The persist routes answer a distinguishable status and
  `dataService` re-fetches and re-applies, the way the socket path already
  does. **Prerequisite:** `npm run test:load` against the multi-pod dev
  environment *first* — §7.4 gates every change to the shared sync path, and
  this is that path. That run is the maintainer's to make; this container has no
  access to the environment.
- **(b) Accept it.** Move H35 to §3 H10 with what would reopen it (field reports
  of retro names or dashboard edits reverting). The argument for (b) is the H15
  argument: the loss is one edit, the window needs a client outside the socket
  room writing to a retro that is live inside it, and every fix edits the code
  the zero-downtime guarantee rides on.

What would settle it cheaply: **has anyone reported a retro name or a dashboard
edit reverting?** If not, (b) is the better trade.

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
  `contents: write` from the deploy job. **The answer was right and the
  implementation was incomplete** (H32): deleting the step also deleted the
  `update_k8s_manifests` input, and `github-release.yml` kept passing it, so
  every post-merge image publish 422'd for two days. Kept here as the standing
  warning that a *deletion* has callers too.

## 6. Suggested delivery lots

Small, independently shippable, ordered by risk-adjusted value. Each is a
`Y`-only version bump with no CHANGELOG entry unless noted.

| Lot | Contents | Prereq | Success metric |
|---|---|---|---|
| **L13** | H35 (the dropped stale persist nobody is told about) | **D13** — heal it or accept it | either the client re-applies its lost edit, or the residual is documented in §3 H10 |
| **L12** | H23 (remove the plaintext-compare fallback) — only the removal itself is left; the restore hook shipped | two clean production boots (see H23) | no team authenticates against a non-hashed record |
| **L4b** | H11 (enable the dormant `SOCKET_UPDATE_RATE` throttle) | `npm run test:load` against the multi-pod dev environment — which **exists** (maintainer, 2026-08-05) but is not reachable from this container, so the run is theirs | load test run at real cadence; non-zero rate live in staging then prod |
| **L9** | H9 (decomposition + code splitting) — **measure first** | H9 baseline profile | first-paint improvement on a real device; no sync regressions |

**Every lot left needs something this container does not have**: a decision
(L13/D13), a **production observation** (L12/H23), or an environment it cannot
reach — the multi-pod dev environment for the load test (L4b) and a real device
to profile (L9). D8–D12 cleared the previous round of decisions on 2026-08-04,
and the three they closed by *accepting* the residual are recorded in §3 H10
with what would reopen each one.

That means a session picking this up with no new environment has no §6 lot to
take. **Go to §4 instead** and write route tests against the lowest-covered
branches — every finding of the last seven passes (H21, H22, H24–H28, H29, H33,
H34) came out of exactly that, and none of them needed anything this container
lacks. Two refinements worth carrying: H33 started from a *reported* bug (H32)
rather than from the coverage table, and the route in was to grep every caller
of the API the bug touched — when a maintainer reports something, ask what shape
it is before fixing it, then look for the shape elsewhere. H34 adds the cheaper
one: a previous pass's **enumeration** ("all five routes built this way") is a
claim like any other, and re-deriving it with a grep costs seconds.

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
