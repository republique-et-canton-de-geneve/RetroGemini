# RetroGemini Hardening Status

_Last updated: 2026-08-06 (**pre-production review pass**: `/cso` run against what
an organisational review board checks rather than what an attacker reaches, ahead
of the security / conformity / architecture commissions. Eleven findings recorded
— **H39–H47, H49 and H50** — and **§8 is new**: it maps every open finding to the
commission that asks for it and lists the evidence that already exists, which nine
passes have accumulated and none of which was discoverable from a findings list.
**H48 closed in the same pass**: `SECURITY.md` described an authentication path
H23 deleted. Baseline re-measured green — 111 files / 1 274 tests, 0 lint errors,
0 production vulnerabilities. Earlier that day: **H36 and H37 shipped**, **H11
closed as accepted by D17** — the socket throttle stays off because the deployment is internal, and the finding is documented rather than actioned — the app now sends security headers with an enforcing CSP on every response, gated by a production-mode Playwright config because the ordinary e2e suite loads from Vite and cannot see an Express header. H11's manifest is set too. First pass run with `gstack` actually installed, which is what surfaced H36)_

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
   **If the work is aimed at a review board, read §8 first and take its order
   instead** — it is the one written against a deadline, and it names which
   commission asks for each finding and what evidence already exists.
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

- **H48 — `SECURITY.md` documented an authentication path that H23 deleted.**
  It still said legacy clear-text records authenticate through a plaintext-verify
  fallback that "stays in place", and pointed at a "stage 7d" that had already
  happened — while `passwordHashing.js:118-120` refuses any stored value that is
  not a scrypt record. The reason this matters more than an ordinary stale
  paragraph: `SECURITY.md` is what a review board reads *instead of* the code, so
  a wrong description of the auth path is a wrong finding in someone else's
  report, and the error pointed the reassuring way — it described a weaker system
  than the one that ships. Four passages corrected (the hashing paragraph, the
  invite-link note, the cache's legacy-record bullet, the backup section), and
  four things that were true but undocumented added: the four-character password
  floor, the LLM API key stored unencrypted in `global-settings`, the
  `allowSelfSignedCerts` TLS-verification switch, and what a backup archive
  **omits** (global settings, session state — so a restore into an empty database
  loses the deployment's configuration). The general rule this leaves: a security
  document is a claim like any other, and the passages most worth re-deriving are
  the ones a finding *removed* a behaviour from, because nothing fails when they
  go stale. Tests: none — the file is prose, and invariant 10 forbids asserting
  on source text. — 2026-08-06
- **H36 — the app shipped with no security response headers on any production
  path, and now has an enforcing CSP.** Found by `/cso` on the first pass where
  gstack was actually installed. `nginx.conf` set three headers and was the
  reason it stayed invisible: it is reachable only through
  `docker-compose --profile with-proxy`, an opt-in its own comment calls
  "optional, for testing production setup", while Kubernetes/OpenShift, Railway,
  Render and plain Docker all serve bare from `server.js`. The CSP matters more
  than the other headers because it is the **machine-enforced half of the offline
  guarantee**: "no external URLs" was previously a convention plus reviewer
  attention, and nothing stopped a CDN asset that works on a laptop and leaves a
  blank box on an air-gapped phone. Written by hand, not `helmet` — ten lines of
  values do not justify a production dependency in an air-gapped deployment.
  **The two things to carry forward.** (1) *The ordinary e2e suite cannot gate a
  CSP* — `playwright.config.ts` loads from Vite on :5173, so an Express header
  governs nothing it renders; the suite would stay green while production is
  blank. Hence `playwright.prod.config.ts` + `e2e-prod/`, which build the
  frontend and drive it from `server.js`, wired into CI on every PR. (2) *A CSP
  fails silently*, so each directive that keeps a feature alive is pinned by its
  own test: the QR codes (`data:`), Tailwind (`'unsafe-inline'`), Socket.IO
  (`connect-src`) and the icon font. Both points came from the Codex review, and
  the QR case is the proof — dropping `data:` fails exactly one test out of six
  and nothing in the entire ordinary suite. Tests:
  `__tests__/securityHeaders.test.ts` (19 cases, 11 failing before) and
  `e2e-prod/production-csp.spec.ts` (6 cases; vacuity-checked by breaking
  `connect-src` and `img-src` in turn and watching the right test fail).
  — 2026-08-06
- **H37 — `trivy-action@master` was the one unpinned action in eight workflows.**
  Pinned to `0.33.1`, and the job given a least-privilege `permissions:` block
  (`contents: read`, `security-events: write`) instead of inheriting the
  repository default token. The point is not this one action: a mutable ref means
  upstream can change what executes in this repo's runner with **nothing here
  changing** — no merge, no review, no Dependabot PR. A pinned ref can only move
  through a commit, which is also why pinning costs nothing. Made a standing rule
  rather than a one-time fix: `deploymentManifestParity.test.ts` now fails on any
  `uses: …@master|main|HEAD`. Tests: 2 cases there (1 failing before, plus a
  vacuity guard on the scanner). — 2026-08-06

- **H23 — the plaintext-compare fallback is out of the auth path.** The last
  step of decision D1, and the one that had waited longest. `verifyPassword` no
  longer has a branch where a stored string is compared byte-for-byte against a
  submitted password; rehash-on-auth and the opportunistic upgrade in the token
  branch went with it, so **authentication performs no writes at all** and the
  H2 exception that call site enjoyed is gone. Unblocked by the maintainer
  reading `0 record(s) hashed, 0 failed, 33 team(s) scanned` in the super-admin
  log viewer — which is only visible because the previous pass made the pass
  report its clean result instead of staying silent. **One relevant correction
  to this tracker's own instructions:** it demanded *two* consecutive boots. That
  rule exists for a first boot reporting `N > 0` (you then need the next one to
  confirm nothing remains); a first boot reporting `0 hashed` had nothing to
  convert, and since the store is shared across pods the line is a statement
  about the **database**, not about the pod that printed it. A second reading
  would re-read the same rows. **Four existing tests were rewritten, not
  deleted** — they pinned rehash-on-auth, whose behaviour now has an opposite,
  and deleting them would have left the removal itself unpinned; they assert the
  refusal and that the stored value comes out byte-identical. A team holding a
  valid session token still authenticates, so this cannot throw anyone out of a
  live session — only its *password* stops working, and only for a record no
  longer thought to exist. Tests: 4 rewritten in `passwordHashing.test.ts` (2
  failing before) and 4 in `teamTokenAuth.test.ts` (3 failing before); the
  safety net stays `restorePasswordMigration.test.ts`. — 2026-08-05
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

## 1. Verified baseline (measured 2026-08-06 on `claude/hardening-status-priorities-yv0t31`)

**Re-measured this pass, all green:** lint 0 errors / **110 warnings** (exactly
the budget), type-check 0 errors, **110 files / 1 252 tests pass** (55 s),
`npm audit --omit=dev --audit-level=high` **0 vulnerabilities**. The table below
carries the rest from the previous pass; only the rows above were re-run.

Note: a fresh container clone has no `node_modules` — run `npm ci` first, or
every check fails with `vitest: not found` / missing type definitions.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **pass** — 0 errors, **110 warnings**, exactly the budget. Since D6 the budget is a **two-way** ratchet (`scripts/lint.mjs`): it fails above *and* below, so removing warnings now requires lowering `BUDGET` in the same change |
| Types | `npm run type-check` | **pass** — 0 errors |
| Unit tests | `npm run test` | **pass** — 110 files, 1 251 tests (108/1 221 at the start of this pass) |
| Coverage (gate) | `npm run test:coverage` | **pass** — 86.54% stmts on the *gated scope*, which is 45.9% of production code (see §4) |
| Coverage (whole) | `npm run test:coverage:all` | **pass** — 61.90% stmts across the whole codebase, floor 57% |
| Build | `npm run build` | **pass** — 680 kB JS chunk (over Vite's 500 kB warning) |
| E2E | `npx playwright test` | **pass** — 10 tests, **~3.5 min** serially (`workers: 1`), twice in a row. Since D5 this also runs on every pull request, so a red e2e is now a blocked merge rather than a local surprise. The 2026-07-30 baseline run **failed** `retro-full-flow` on the announcement-modal race and took 9.1 min; H18 fixed it, and the time drop is the same cause (blocked clicks no longer burn a 6-min timeout). Beware the reporting trap that hid the failure: `npx playwright test \| tail` returns *tail's* exit status, so a failing run looks like exit 0 — read the summary line, not `$?` |
| Prod audit | `npm audit --omit=dev --audit-level=high` | **pass** — 0 vulnerabilities |
| Dev audit | `npm audit` | 1 high (`brace-expansion` DoS, dev-only — does not gate CI) |

**Tooling note — this is the first pass that actually ran with `gstack`
(2026-08-06).** Five previous passes recorded it as missing and worked without
it. The cause was structural, not forgetfulness: `gstack-team-init required`
installs a **`PreToolUse` deny hook** and nothing that installs anything, while
every web session starts from an ephemeral container with no
`~/.claude/skills/gstack`. So the repo's own enforcement would have *blocked*
every skill call rather than enabling one — which is why the honest note kept
being written instead of the tool being used. (`AGENTS.md` had described that
bootstrap as a `SessionStart` hook; it never was. Corrected there.)

The repo now carries the missing half: `.claude/hooks/session-start.sh` installs
npm dependencies **and** gstack in a web container, so `check-gstack.sh` is a
safety net instead of a wall. Cold path measured at **24 s**;
`.claude/hooks/gstack-route.sh` then injects the command routing table on every
prompt. **H36 came out of the first `/cso` run** — evidence the tool was worth
unblocking. `telemetry` and `artifacts_sync_mode` are set to `off`: this is a
public-sector repo and shipping usage data anywhere is the maintainer's call to
make, not a default to inherit.

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
7. **Only a scrypt record authenticates.** `verifyPassword` has no branch
   comparing a stored string against a submitted password (H23), so a legacy
   plaintext record cannot log in. Converting one is
   `passwordMigration.js`'s job alone — at startup **and after either restore
   route**, which is what stops a rollback to a pre-hashing archive from
   stranding teams. Do not reintroduce a plaintext compare in the auth path.
8. **The authentication path performs no writes.** Rehash-on-auth and the
   opportunistic upgrade in the token branch went with the fallback they
   depended on. That call site used to be the one place where ignoring an
   `atomicTeamUpdate` result was correct (audit H2); **that exception no longer
   exists**, so any ignored result in `teamService.js` is now a defect.
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

> **H39–H47, H49 and H50 came from the pre-production review pass of 2026-08-06**
> (`/cso`, scoped to what an organisational review board checks rather than to
> what an attacker reaches). Read **§8** first if you are picking them up: it
> says which commission asks for each one and what evidence already exists, and
> several items are cheap to close only because the surrounding work is already
> done. They are *not* a re-audit of the application logic — that axis has had
> nine passes and the last three found documentation defects, not exploits. What
> they cover is the axis those passes never looked at: platform hardening,
> supply chain, data protection, accessibility and operability.
> **H50 came from Codex's review of the pull request that recorded the other
> ten**, which is worth noting as method rather than as credit: it was found by
> checking a *claim* in §8's readiness table against the code, not by scanning
> for defects. A summary table asserting "HA is strong" is a falsifiable
> statement, and falsifying it found a real gap.

### H39 — [P1] A team password may be four characters, and nothing else constrains it

- **Files:** `server/routes/teamRoutes.js:205` (create) and `:798` (change),
  `server/routes/passwordResetRoutes.js:239` (reset),
  `server/routes/superAdminRoutes.js:637` (admin set),
  `components/TeamLogin.tsx:244,338,850`, `components/Dashboard.tsx:395`,
  `components/SuperAdmin.tsx:605`.
- **Problem:** every one of those five server paths enforces the same rule and
  it is `length < 4`. There is no complexity requirement, no dictionary or
  reuse check, no expiry and no lockout. The only brake is the limiter on
  `/api/team/login` — **`loginLimiter`, 20 rejected attempts per 15 minutes,
  keyed on IP *and* team name** (`teamRoutes.js:55-65`), **per pod** (H19).
  **It is not `AUTH_RATE_LIMIT_MAX`** (Codex, PR #418): that one is 5, and it
  guards `/api/team/create` and `/api/team/restore-session`, neither of which
  verifies a guessed password. Quoting the wrong limiter understates the real
  attack rate fourfold, which is the wrong direction to be wrong in front of a
  review board. Neither limiter was designed as an anti-guessing control — both
  exist to bound an anonymous prober's store reads (H5).
- **Why this is the first thing a security cell will find.** It is one grep, it
  is checkable without reading the codebase, and no published baseline admits
  it: OWASP ASVS 2.1.1 asks for 12 characters, NIST SP 800-63B for 8 with a
  breached-password check. A team password is a **shared** secret guarding that
  team's whole history — every retrospective, every member name, every
  facilitator email — and it is also what older invite links embed in a URL.
- **Failure scenario:** a four-character lowercase password is ~460 000
  combinations. At 20 attempts per 15 minutes that is 1 920/day per pod, and
  the limiter keeps no shared store, so two replicas admit ~3 840/day from one
  address against one team — roughly **four months** for a single source, and
  under two weeks from ten addresses. An insider on the corporate network, which
  is the population this internal deployment is exposed to, has ten addresses.
  The cheaper attack needs no arithmetic at all: four characters is short enough
  that teams pick the team name, the sprint number or `1234`, and the limiter is
  irrelevant against a first guess.
- **Acceptance:** one minimum enforced in one place, at **12 characters or
  more**, applied to all five server paths and mirrored client-side. Two things
  must be true or the change is worse than the gap: **existing shorter
  passwords must keep authenticating** (the rule binds on write, never on
  verify — an availability cost is a security property too, H20), and the
  message must say the rule *before* the user types, not after the submit.
  Decide explicitly whether to force a rotation; the safe default is not to.
- **Tests:** one unit case per write path asserting an 11-character password is
  refused and a 12-character one accepted, one asserting a pre-existing short
  password still logs in, and one client test per form. Extract the rule into a
  shared module and test it once, rather than repeating the literal five times.
- **Effort:** S. **Regression risk:** low, but it is **user-visible** — bump
  `X`, one CHANGELOG bullet.

### H40 — [P1] The pod holding all the data has no security context at all

- **Files:** `k8s/base/postgresql-deployment.yaml` — `securityContext: {}` on
  the pod spec, and no container-level block.
- **Problem:** H7.2/D4 hardened the application pod (`runAsNonRoot`, UID 1000,
  `RuntimeDefault` seccomp, all capabilities dropped, no privilege escalation)
  and stopped there. The PostgreSQL Deployment beside it in the same
  kustomization is exactly the empty `{}` that finding called out — on the pod
  that holds every team record, every retrospective and every backup. The
  application pod is the one with no persistent data.
- **Failure scenario:** `postgres:15-alpine` starts as root before dropping to
  the `postgres` user, keeps the default capability set and runs under the
  cluster's default seccomp. Anyone reaching code execution in that container —
  a PostgreSQL RCE, or an operator with `exec` rights — has **unrestricted root
  inside the container**, with the full default capability set and the data
  volume mounted, and plain Kubernetes admits the pod without comment because
  nothing in the manifest asks for better.
  **State the exposure at that level and no higher** (Codex, PR #418): container
  root is *not* node root here. These manifests set no `privileged`, no
  `hostPID`/`hostNetwork`, and mount no host path, so reaching the node still
  needs a separate container escape — which is precisely what the dropped
  capabilities and the seccomp profile make harder, and precisely why the fix is
  worth doing. Overstating it costs more than it gains: a review board that
  catches one inflated scenario discounts the rest of the list.
- **What makes this narrower than it looks, and why it still ships:** the
  OpenShift overlay patches the image (`postgresql-image.patch.yaml`) to the Red
  Hat build, and the restricted SCC imposes a context whatever the manifest
  says — so the *production* target is covered by the platform. The gap is the
  base manifest, which is the documented plain-Kubernetes path and the one a
  reviewer reads. Fixing the base costs nothing on OpenShift and closes it
  everywhere else.
- **Acceptance:** the PostgreSQL pod carries the same four guarantees as the
  application pod, with the UID handled the way the app's is — pinned in `base`,
  nulled by the OpenShift overlay. Verify against the actual image before
  claiming it: `postgres:15-alpine` needs `fsGroup` to match the volume and
  `PGDATA` pointed at a subdirectory of the mount, or initdb fails on a
  non-empty lost+found. Do not set `runAsNonRoot` without checking that.
- **Tests:** extend `__tests__/deploymentManifestParity.test.ts` — it already
  asserts the app pod's context and the overlay's null patch (invariant 13); add
  the symmetric assertions for `postgresql-retrogemini`, so the next pod added
  to `k8s/base` cannot ship with `{}` either.
- **Effort:** M (the manifest is small; validating the image's UID behaviour is
  the work, and no cluster is reachable from this container). **Regression
  risk:** medium — a wrong `fsGroup` stops the database from starting.

### H41 — [P1] No retention rule, no purge, and one deliberate barrier to erasure

- **Files:** `types.ts` (`Member.name/email`, `Team.facilitatorEmail`,
  `InvitedUser.email`, `TeamFeedback.submittedByName`),
  `server/services/dataStore.js` (no purge of `session:*` or of anything else),
  `server/routes/teamRoutes.js` (deletion moves feedbacks to
  `orphanedFeedbacks`).
- **Problem:** the application stores personal data — member names, facilitator
  and invitee email addresses, and free-text tickets that routinely name
  colleagues and judge their work — and **nothing ever removes any of it**.
  `session:*` rows accumulate for the life of the deployment. Retrospectives
  have no age limit. Deleting a team is the one erasure path that exists, and it
  deliberately **preserves** that team's feedbacks, including
  `submittedByName`, in `orphanedFeedbacks` indefinitely.
- **Why this is the conformité cell's first question, not the security cell's.**
  Nothing here is a vulnerability. It is the absence of a documented answer to
  "what personal data do you hold, on what basis, for how long, and how does
  someone get it deleted" — which for a cantonal administration is LIPAD, and
  for anything touching EU residents is GDPR art. 5(1)(e) and art. 17. The
  orphaned-feedback rule is the sharp edge: it was introduced for a good
  operational reason (a bug report must survive the team that filed it) and it
  is a documented decision to retain identified personal data after the subject's
  record is deleted. That needs a written justification or a change; it cannot
  stay implicit.
- **Failure scenario:** the review board asks for the retention schedule and
  the erasure procedure. Neither exists. Worse, the honest answer to "if a
  member asks to be forgotten, what do you do?" is currently "delete the whole
  team, and their name stays in the feedback board anyway".
- **Acceptance:** three artefacts, and the code follows them rather than the
  reverse. (1) A retention section in `SECURITY.md` or a dedicated
  `DATA_PROTECTION.md`: every personal-data field, why it is held, for how long.
  (2) A decision on `session:*` and on old retrospectives — a purge job, or a
  written "kept indefinitely because the retrospective history is the product"
  with the operator told how to prune. (3) An erasure procedure that actually
  reaches `orphanedFeedbacks` — either anonymise `submittedByName` on team
  deletion (the cheap fix: the bug report survives, the person does not) or
  document why the name is required.
- **Tests:** if anonymisation is chosen, a unit test on the deletion path
  asserting the preserved feedback keeps its `id`/`title`/`description` and
  loses its author identity. The policy documents need no test; the parity
  suite can assert the document exists if that is wanted.
- **Effort:** M — mostly writing, and the writing is the deliverable.
  **Regression risk:** low if scoped to anonymisation; high if a purge job is
  added carelessly (it deletes data by design).

### H42 — [P1] Accessibility has never been assessed

- **Files:** the whole `components/` tree; `eslint.config.js` (no
  `eslint-plugin-jsx-a11y`); `e2e/` (no axe run); no accessibility statement
  anywhere in the repo.
- **Problem:** 15 432 lines of React carry **28 ARIA attributes in total**
  (18 `aria-label`, 3 `aria-hidden`, 3 `aria-checked`, 2 `aria-disabled`, 1
  `aria-pressed`, 1 `aria-modal`). Nothing checks keyboard reachability, focus
  order, focus trapping in the many modals, or colour contrast.
- **The one already confirmed by reading the code**, so the audit does not start
  from zero: grouping tickets in the Group phase is pointer-only.
  `components/Session.tsx:1762-1763` sets `draggable={mode === 'GROUP'}` and
  `onDragStart` on the ticket card, and there is no `onKeyDown` on that path —
  the keyboard handlers in `components/session/*` are all Enter-to-submit on text
  inputs. A facilitator who cannot use a mouse cannot group, which is a core
  phase of the product and a WCAG 2.1.1 (Keyboard) failure, not a polish item.
- **Why it belongs in a pre-production tracker:** for a Geneva public-sector
  deployment this is not a quality nicety, it is a conformance obligation
  (eCH-0059 / WCAG 2.1 AA, and the equivalent obligation exists in most public
  administrations). It is also the finding with the longest lead time on this
  list, which is the argument for measuring it **now** even if the remediation
  lands later: a commission can accept a documented gap with a plan, and cannot
  accept "we have never looked".
- **Failure scenario:** the conformité cell asks for the accessibility
  statement and the audit that backs it. There is neither, and the first axe run
  happens in front of them.
- **Acceptance:** in order of value, not of effort. (1) Run axe-core against
  the four main flows (login, dashboard, a full retrospective, a health check)
  and **record the result in this tracker** — the measurement is the
  deliverable even if nothing is fixed yet. (2) **A manual keyboard-and-focus
  pass over the same four flows**, recorded the same way: tab through each one
  with the mouse unplugged, and note every operation with no keyboard path,
  every modal that does not trap focus and does not return it on close, and
  every focus indicator that is invisible. (3) Add `eslint-plugin-jsx-a11y` at
  `warn` and fold its count into the existing two-way budget (`scripts/lint.mjs`),
  so the number can only go down. (4) Fix what the audit finds, worst first;
  expect the modals and the Group-phase drag to dominate. (5) Publish an
  accessibility statement naming the standard, the audit date and the known
  gaps.
- **Step (2) is not optional padding, and the drag proves it** (Codex, PR #418).
  Axe and a lint plugin inspect the DOM that exists; neither can report an
  operation that has **no** keyboard path, because there is no bad markup to
  find — the ticket card is a perfectly well-formed `div` that simply cannot be
  reached without a pointer. So an acceptance built on automation alone would
  produce a recorded baseline that misses the one WCAG 2.1.1 failure this
  tracker has already confirmed, and would report the assessment half as done.
  This is the same shape as the whole pass: automated tooling cannot see an
  absent control. Budget for the manual pass, or do not claim H42 is measured.
- **Tests:** an `@axe-core/playwright` check in the e2e suite per main flow,
  failing on serious/critical violations only at first, with the threshold
  ratcheted down as the count falls. Do not gate on zero violations from day
  one; that guarantees the gate gets disabled.
- **Effort:** L (measuring is S; remediating is L, and the split is deliberate
  — do the S half first). **Regression risk:** low for the audit and the lint
  rule; medium for the fixes, which touch component markup broadly.

### H43 — [P1] The backups share a failure domain with the data, and are not a full recovery point

- **Files:** `server/services/dataStore.js:60-70` and `:145-156` (the `backups`
  table lives in the same database as `kv_store`),
  `server/services/dataStore.js:877-891` (`loadPersistedData` builds the
  archive), `k8s/base/pvc.yaml`, `k8s/README.md:298-325`.
- **Problem:** two distinct gaps that a DR review reads as one.
  **(a) Co-location.** Every automatic and manual backup is a row in the
  `backups` table of the same PostgreSQL instance, on the same 5 Gi
  ReadWriteOnce PVC, as the live data. They protect against a bad restore, an
  accidental team deletion or a bad release — genuinely useful, and that is
  what they were built for. They protect against **nothing** that takes the
  volume: a PVC deletion, a storage failure, a namespace wiped by a bad
  `kustomize` apply. `k8s/README.md` documents a manual `pg_dump` as the
  independent path, with no cadence, no off-cluster target, no retention and no
  rehearsal.
  **(b) The archive is partial.** `loadPersistedData()` builds it from teams +
  meta only, so `global-settings` — AI configuration and its API key, the admin
  email, the info banner — is not in it. Restoring into a fresh database gives
  back the data and silently loses the deployment's configuration.
- **Failure scenario:** the cluster's storage tier loses the volume. Every
  backup is inside it. Recovery depends on whether an operator happened to run
  `pg_dump` recently, and the answer is undocumented.
  **The two recovery paths are not interchangeable, and (b) applies to only one
  of them** (Codex, PR #418). A `pg_dump` restores the whole `kv_store`,
  `global-settings` included, so a deployment recovered that way comes back
  complete — that is an argument *for* the independent dump, not against it. The
  partial archive is the **application** one: recovering by uploading a
  `.json.gz` into `/api/super-admin/restore` on a fresh installation gives back
  the teams and leaves AI disabled with no admin email, and nobody knows why
  until someone opens the super-admin panel. Do not merge the two paths when
  presenting this — the fix for (a) and the fix for (b) are different work.
- **Acceptance:** (1) a scheduled dump landing **outside** the cluster's storage
  — a CronJob to object storage, or the institution's existing backup agent
  pointed at the database, whichever the platform team already operates; (2) a
  stated RPO and RTO in `k8s/README.md`, however modest, because "24 h / best
  effort" written down beats an unstated better number; (3) **one rehearsed
  restore into an empty database**, with the result recorded here — this is the
  single most valuable item on the list and the only one that proves the rest;
  (4) either add `globalSettings` to the archive or document the manual
  re-entry (already documented in `SECURITY.md` as of this pass).
- **Tests:** a unit test asserting the archive round-trips global settings, if
  (4) is closed in code. The rest is operational and belongs in `k8s/README.md`,
  not in the suite.
- **Effort:** M, and mostly platform work rather than application work.
  **Regression risk:** none for (1)-(3); low for (4).

### H50 — [P1] A pod that lost its cross-pod adapter still reports ready

- **Files:** `server/routes/coreRoutes.js:3` (`/ready` is an unconditional
  `200 READY`), `server/services/socketAdapter.js:47-58` and `:62-82` (both
  adapter initialisers catch and return `false`), `server.js:206-212`
  (`startServer` stores the result in `serverRuntime.multiPodAdapter` and calls
  `server.listen` regardless).
- **Found by Codex on PR #418**, reviewing §8's claim that cross-pod
  synchronisation is unconditionally strong. It is not, and the gap is the same
  shape as everything else in this pass: the control that would catch it does
  not exist, so no coverage number could ever have pointed at it.
- **Problem:** at `replicas: 2` the Socket.IO adapter is what makes two pods one
  application. If `initPostgresAdapter` fails — the `CREATE TABLE
  socket_io_attachments` denied by a restricted database grant is the realistic
  case, and a Redis blip is the other — the error is logged, `false` is
  returned, and the pod keeps Socket.IO's **in-memory** adapter. It then serves
  traffic normally: `/health` and `/ready` both answer 200 because neither knows
  the adapter exists.
- **Failure scenario:** two participants join the same retrospective and are
  balanced onto different pods. Each sees their own tickets and votes; neither
  ever sees the other's. Nothing is down, no probe is red, no alert fires, and
  the facilitator's report is "the retro is broken for some people" — the
  hardest class of incident to diagnose, made harder by H44 (no metrics would
  show the adapter strategy in use).
- **Why the fix is not simply "fail readiness"** — and this is the part a future
  session must not skip. If *both* pods fail adapter init, failing readiness on
  both empties the Service and turns degraded collaboration into a total
  outage, which is strictly worse. The behaviour has to distinguish "some pods
  are healthy" from "none are", and Kubernetes readiness alone cannot express
  that. The honest options: (a) log loudly, expose the adapter strategy on a
  status endpoint and alert on it, leaving routing alone — cheapest, and it
  makes the failure *visible*, which is the actual problem; (b) fail readiness
  only when a shared adapter was **configured and expected**, accepting the
  all-pods-down case as a deliberate fail-stop; (c) retry the adapter
  initialisation in the background so a transient failure heals itself.
- **Acceptance:** a decision between (a), (b) and (c), recorded, and the
  behaviour implemented. **(a) plus (c) is the recommendation** — visibility and
  self-healing, no new way to take the application down. Until it ships, §8's
  architecture row says so rather than claiming HA is unconditional.
- **Tests:** unit tests on the startup path — an adapter failure leaves
  `multiPodAdapter` false and surfaces on whatever signal (a) or (b) chooses;
  a retry succeeding on the second attempt flips it to true. Both are reachable
  with the existing store mocks; neither needs a cluster.
- **Effort:** S for (a), M with (c). **Regression risk:** low for (a); **high
  for (b)** — it adds a path that can refuse traffic, on the probe that governs
  the zero-downtime guarantee.

### H44 — [P2] Nothing about the running system is observable

- **Files:** `server/services/logService.js` (the whole logging story),
  `server.js` (no request logging, no metrics route).
- **Problem:** logging is `console.log` mirrored into a **1000-entry in-memory
  ring per pod**, lost on restart, unstructured (a truncated 500-character
  string with the source guessed from substring matches), with no request id, no
  team or session correlation, no level control and no access log. There is no
  `/metrics`, no tracing, and no health signal beyond liveness/readiness
  booleans.
- **Failure scenario:** at `replicas: 2`, a facilitator reports that a
  retrospective lost votes at 14:20. There is no way to find the requests
  involved: the two pods' rings hold different fragments, a rolling update since
  then has emptied both, and nothing ties a socket event to the HTTP call that
  preceded it. The zero-downtime guarantee this product is built around is
  therefore unmeasured — nobody can say how often a heal round-trip fires, or
  whether re-joins after a rolling update actually succeed.
- **Why it is P2 and not P1:** nothing is broken, and the platform (OpenShift's
  own log aggregation and pod metrics) covers part of it. But an architecture
  cell asks "how do you diagnose an incident" and the honest answer today is
  "read the pod's stdout and hope it has not rotated".
- **Acceptance:** structured JSON to stdout with a level, a timestamp and a
  request/session correlation id — the platform aggregator does the rest, so no
  new infrastructure is needed. Keep the in-memory ring: it is what the
  super-admin log viewer reads and it is useful. Then either expose a small
  `/metrics` (active sessions, socket connections, CAS rejections, heal
  round-trips — the four numbers that would have answered every capacity
  question this tracker has asked) or state in writing that pod metrics suffice.
- **Tests:** unit tests on the formatter (one line per record, valid JSON,
  level and correlation id present, secrets never interpolated) and one
  asserting the super-admin viewer still parses what it is given.
- **Effort:** M. **Regression risk:** low, but it touches every log call site —
  do it as a wrapper, not a find-and-replace.

### H45 — [P2] Privileged actions leave no durable trace

- **Files:** `server/routes/superAdminRoutes.js` (all of it),
  `server/services/logService.js`.
- **Problem:** the super admin is a single shared password from
  `SUPER_ADMIN_PASSWORD`, with no per-administrator identity and no second
  factor. It can read every team's data, rename and delete teams, download and
  restore backups, and reconfigure the LLM endpoint. The only record of any of
  that is the volatile in-memory ring of H44 — so after a restart there is no
  evidence that a restore happened, let alone who ran it.
- **Failure scenario:** a team's retrospectives disappear. Was it a deletion, a
  restore of an old archive, or a bug? Nothing can answer, because the ring was
  emptied by the next rolling update, and even a surviving entry names no actor.
  The same gap makes the shared-password model unfalsifiable: there is no way to
  show that only the intended person used it.
- **Acceptance:** persist security-relevant events durably and append-only —
  super-admin authentication (success and failure), team deletion and rename,
  backup creation/restore/download, password changes, AI reconfiguration — each
  with a timestamp, the source IP and the outcome. A `security_events` table
  beside `backups` is enough; this does not need new infrastructure. Then decide
  the identity question separately and record it: per-administrator credentials
  are a product change, and "one shared account, use is attributed to the person
  holding the credential" is an acceptable answer **if written down**.
- **Tests:** a unit test per event asserting the row is written with the actor
  and outcome, and one asserting a failed super-admin authentication is recorded
  (that is the one that matters and the one most likely to be forgotten).
- **Effort:** M. **Regression risk:** low — additive.

### H46 — [P2] The Kubernetes network posture is unconstrained, and the base manifests contradict our own advice

- **Files:** all of `k8s/` — no `NetworkPolicy` exists; `k8s/base/deployment.yaml`
  (no `automountServiceAccountToken`, no `serviceAccountName`);
  `k8s/base/service.yaml` (`type: NodePort`, `nodePort: 30080`);
  `k8s/base/ingress.yaml` (no `tls:` block).
- **Problem:** four items of the same shape — the platform is left at its
  permissive default.
  1. **No NetworkPolicy anywhere.** Any pod in the cluster that can resolve
     `postgresql:5432` can attempt to connect to it; the application pod accepts
     ingress from anywhere. `SECURITY.md` has recommended "use network policies
     to restrict pod-to-pod communication" for as long as it has existed, and
     the manifests we ship implement none.
  2. **The default ServiceAccount token is mounted** into a pod that never
     calls the Kubernetes API (CIS Kubernetes 5.1.5/5.1.6). A compromised
     application process gets a cluster credential it has no use for.
  3. **The base Service is a NodePort on 30080**, reachable on every node,
     bypassing the Route and its TLS termination. The OpenShift overlay patches
     it to `ClusterIP`, so production is fine — the base, which is the
     documented plain-Kubernetes path, is not.
  4. **The base Ingress has no TLS block** and points at `retrogemini.local`.
     Combined with (3), a deployment following the base manifests serves team
     passwords and session tokens over plain HTTP.
- **Failure scenario:** on the OpenShift target, (3) and (4) do not apply and
  (1) and (2) are real. On any other cluster, someone follows `k8s/README.md`
  and stands up an installation whose credentials cross the network in clear
  text on a port that bypasses the ingress entirely.
- **Acceptance:** NetworkPolicies that are **default-deny on ingress**, with two
  explicit allows (ingress-controller → app:8080, app → postgresql:5432);
  `automountServiceAccountToken: false` on both pods; the base Service moved to
  `ClusterIP` with the NodePort relegated to an opt-in overlay for local
  testing; and either a `tls:` block on the base Ingress or a prominent note
  that the base manifests are an example requiring TLS to be supplied. Verify
  the policies against the actual cluster's CNI — a NetworkPolicy on a CNI that
  does not enforce them is worse than none, because it reads as protection.
  **Deny ingress, not egress, unless the egress set is enumerated first**
  (Codex, PR #418). A default-deny that covers egress and allows only the two
  flows above breaks the application in ways that do not look like a network
  problem: DNS goes first, so the pod cannot even resolve `postgresql`, and then
  SMTP (invitations, password resets), Redis (the multi-pod Socket.IO adapter)
  and the LLM endpoint all fail silently one by one, each of them optional and
  therefore each of them failing quietly. If egress restriction is wanted, it is
  a **separate** piece of work: enumerate kube-dns plus every configured
  endpoint, and accept that the list changes whenever an operator configures a
  new one. Ingress-only default-deny closes the finding — any pod in the cluster
  reaching `postgresql:5432` — at a fraction of the risk.
- **Tests:** `deploymentManifestParity.test.ts` for the static half — the
  NetworkPolicies exist and are referenced by the kustomization, both pods set
  `automountServiceAccountToken: false`, the base Service is not a NodePort.
  Enforcement itself needs a cluster and cannot be tested here.
- **Effort:** M. **Regression risk:** medium — a wrong policy takes the
  application off the network. Roll it to a non-production project first.

### H47 — [P2] Supply chain: mutable action tags, two workflows with no `permissions`, no SBOM

- **Files:** `.github/workflows/ci.yml` and `e2e.yml` (no `permissions:` block
  at all); every workflow's `uses:` lines except the two `trivy-action` ones;
  no SBOM anywhere; `.github/workflows/docker-deploy.yml` (no provenance or
  signature).
- **Problem:** three gaps that the same review reads as one posture.
  1. **Actions ride mutable tags.** H37 pinned `trivy-action` to a full SHA and
     made `@master|main|HEAD` a test failure — but `actions/checkout@v7`,
     `setup-node@v7`, `upload-artifact@v7`, `docker/*@v4|v7`,
     `github/codeql-action/*@v3` and `dependabot/fetch-metadata@v3` are all
     mutable major tags, which is the same finding one notch down. The owner of
     any of them can change what runs in this repository's runner with nothing
     here moving.
  2. **`ci.yml` and `e2e.yml` declare no `permissions:`**, so they inherit the
     repository default `GITHUB_TOKEN`. Five of the seven workflows already
     carry a least-privilege block; these two — the ones that run `npm ci`, and
     therefore execute dependency lifecycle scripts — do not.
  3. **No SBOM, no provenance, no signature.** The published image can be
     scanned (Trivy runs on every PR) but its contents cannot be attested, and
     an air-gapped operator has no manifest of what they are installing.
- **Failure scenario:** a compromised release of a popular action publishes a
  malicious `v7`. Every workflow here picks it up on the next run; in `ci.yml`
  it executes with whatever the repository's default token grants, on a
  repository that deploys to production from its own workflows.
- **Acceptance:** SHA-pin every third-party action with the version in a
  trailing comment (Dependabot updates SHA pins natively, so this costs nothing
  ongoing); add `permissions: contents: read` to the two workflows that lack
  one; extend `deploymentManifestParity.test.ts`'s existing `uses:` check from
  "not a branch name" to "a 40-character SHA", which turns the rule into the
  standing guard H37 intended; and produce an SBOM as a release artefact
  (`docker buildx build --sbom=true`, or `npm sbom --sbom-format cyclonedx` for
  the dependency half). Signing (cosign) is a separate decision — take it or
  record why not.
- **Tests:** extend the existing workflow-pinning assertions in
  `deploymentManifestParity.test.ts` (invariant 11) — SHA shape, and a
  `permissions:` block present in every workflow. Both are static checks on
  files the suite already parses.
- **Effort:** S for the pinning and the permissions blocks, M with the SBOM.
  **Regression risk:** low — a wrong SHA fails the workflow immediately and
  visibly.

### H49 — [P2] Nothing states where retrospective content goes when AI is enabled

- **Files:** `server/services/aiService.js:36-48` (the request, including the
  `rejectUnauthorized: false` branch), `server/routes/aiRoutes.js`,
  `server/routes/superAdminRoutes.js:1251-1288` (settings read/write).
- **Problem:** turning AI on sends ticket text, group titles and session
  content — free text that routinely names colleagues and characterises their
  work — to whatever `apiUrl` a super admin types, with an API key stored
  unencrypted in `global-settings`, optionally over a connection whose TLS
  certificate is **not verified** (`allowSelfSignedCerts`). Every one of those
  is a defensible engineering choice for an internal LLM behind an enterprise
  CA. None of them was written down anywhere an auditor looks until this pass
  added a section to `SECURITY.md`.
- **Why it stays open after that section:** documentation closes the *disclosure*
  half. What remains is the control half — there is no restriction on the
  endpoint, so a misconfiguration (or a super admin who does not think of it as
  an export) ships personal data to a public LLM provider with no signal that
  anything unusual happened.
- **Failure scenario:** an administrator pastes a public API endpoint into the
  panel to try the feature. Retrospective content leaves the institution's
  network. Nothing warns, nothing logs it durably (H45), and the only trace is
  a settings record nobody re-reads.
- **Acceptance:** a decision, recorded. Either (a) leave it open and rely on the
  documentation plus H45's audit event for the settings change — defensible for
  an internal tool with a small, trusted admin population; or (b) warn or refuse
  on a non-private `apiUrl` unless a confirmation flag is set. Do **not**
  implement (b) as a silent block: an operator with a legitimate external
  endpoint must be able to proceed deliberately.
- **Tests:** if (b), a unit test per case (private range accepted, public host
  refused without the flag, accepted with it). If (a), none — record the
  decision in §5.
- **Effort:** S. **Regression risk:** low.

### H38 — [P2] The gstack bootstrap tracks an unpinned upstream HEAD

- **Files:** `.claude/hooks/session-start.sh` (the clone), `.claude/settings.json`.
- **Problem:** self-reported, and it is the same shape as H37 one level up. The
  SessionStart hook clones `garrytan/gstack` at its **default-branch HEAD** and
  runs `./setup`, which executes upstream shell in the session container. That is
  what "team mode" is designed to do — auto-update is the point — but it means a
  third party can change what executes here without anything in this repository
  moving. Worth stating plainly for a public-sector repo rather than leaving it
  implicit in a hook nobody re-reads.
- **Why it is not simply pinned:** pinning to a tag freezes the skills and drops
  the auto-update the maintainer asked for, and gstack ships no stable release
  tags to pin *to*. What genuinely narrows it: the hook runs only in the
  **ephemeral web container** (`CLAUDE_CODE_REMOTE`), never on a developer
  machine; the token it could reach is scoped to this one repository; and every
  change still lands through a reviewed pull request against a protected `main`.
- **Do not repeat the rationale this entry first carried** — "it touches `$HOME`,
  never the repository, and holds no repository secret". Codex rejected it on
  PR #417 and was right: the setup shell runs as the session user, so a working
  directory is not a boundary. It can read `$CLAUDE_PROJECT_DIR`, reach the
  session's GitHub token and call `git` directly. Accept the exposure at
  **repository level** or pin; do not argue it away.
- **Failure scenario:** upstream compromise runs arbitrary code in a session
  container that has a GitHub token scoped to this repository.
- **Acceptance:** a maintainer decision, recorded — accept the auto-update (with
  the reasoning above), or pin `--branch <tag>` in the hook and accept manual
  refreshes. Do not leave it undecided.
- **Tests:** none meaningful; this is a posture decision, not a code defect.
- **Effort:** S. **Regression risk:** none.

### H35 — [P2] A live session's full-blob persist can still overwrite a rename

**Partly done (this pass):** the reported half is fixed. What remains is a
narrower residual, described below — and it may well deserve *"si c'est pas
grave, rien faire"*, which is why it is P2 now rather than P1.

- **What was fixed.** Renaming a retrospective or health check from the
  Dashboard rode on the **full-blob** persist, which carries the caller's cached
  `_rev`. Any retro that was actually run has had its stored revision advanced
  by the live session since the Dashboard loaded, so that blob is stale by
  definition: the rev guard dropped the entire write, the route answered
  `{ success: true }` (an aborted updater reads as "nothing to change"), and
  `persistRetrospective` is fire-and-forget — so the title reverted with nothing
  anywhere reporting a problem. **Confirmed from the field by the maintainer**
  (2026-08-05: "il y a déjà eu des rétros renommées qui sont revenues à leur
  titre original"), which is what turned D13 from a judgement call into a bug.
  The fix is the pattern this codebase already uses for closing an action: a
  **granular endpoint** owning one field, carrying no `_rev`, so there is
  nothing for the guard to reject.
- **What remains.** The rename lands in the team record, not in the live session
  blob. While a session for that retro is still open, its next full persist
  carries the *old* name and overwrites the new one. Narrower than the fixed
  half — it needs the rename to happen **during** a live session, whereas the
  fixed half fired whenever the Dashboard's copy was merely out of date, which
  is the normal state after any retro has been run.
- **Why it is not fixed here.** Closing it means the rename reaching the live
  session — an `update-session` write or a targeted broadcast — which is the
  shared sync path, and §7.4 gates that on `npm run test:load`. The maintainer
  has a multi-pod + PostgreSQL dev environment (2026-08-05) but this container
  cannot reach it, so that run is theirs.
- **Do not "fix" it by weakening the rev guard, or by making the full-blob
  persist skip `name`.** The guard is correct — it was the payload that was
  wrong. And dropping `name` from the full persist would break the *other*
  direction: a rename made **inside** a session (`name` is a facilitator-only
  field in `sessionGuard.js`, so the socket path does sync it) would then never
  reach the team record.
- **Acceptance:** either a rename during a live session survives that session's
  next persist, or the residual is moved to §3 H10 with what would reopen it.
- **Tests:** `__tests__/sessionRenamePersist.test.ts` (10 cases, 8 failing
  before) and the client half in `__tests__/dataService.test.ts` — checked for
  vacuity by pointing `updateSessionName` back at the full-blob persist, which
  fails it. A fix for the remaining half would add a case where a session
  persist after a rename does not revert it.
- **Effort:** M. **Regression risk:** high — it is the sync path.

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
- **H9 — the 680 kB single JS chunk and the 2000-line components.**
  `Session.tsx` 2646 lines, `SuperAdmin.tsx` 2336, `Dashboard.tsx` 2057,
  `dataService.ts` 1883; one 680 kB chunk (178 kB gzip), no code splitting.
  **Accepted (maintainer, 2026-08-05): leave it, documented.** The item had
  demanded a first-paint measurement on a real phone before acting, and the
  maintainer declined to run one — which settles it, because the measurement was
  never the goal: it was the evidence that would have justified an **effort-L,
  high-regression-risk** change to `Session.tsx`, i.e. to the sync/merge paths
  the zero-downtime guarantee rides on. With no evidence of a problem, that
  trade is clearly wrong, and *"si c'est pas grave, le mieux c'est de rien
  faire"* applies exactly as it did to D10–D12. **What would reopen it:** a
  field report of the app being slow to open (a phone on corporate Wi-Fi is the
  primary client), or a first-paint figure landing in someone's hands for
  another reason. If it reopens, do **code splitting alone first** — it is the
  low-risk half and carries most of the gain; decomposing the components is a
  separate, later decision. The `npm run build` warning about the 500 kB
  threshold is expected output, not a regression to chase.
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

### H11 — [CLOSED as accepted] The `update-session` throttle stays off

**Closed 2026-08-06 by decision D17: leave `SOCKET_UPDATE_RATE` at `0`,
document when to turn it on.** Kept here rather than deleted because two earlier
passes carried this as an open P1 and the next one would otherwise "rediscover"
it.

- **Why off is the right setting.** The threat the token bucket answers is a
  hostile client driving unbounded DB writes and room broadcasts. **This
  deployment is internal and not reachable from the internet**, so that client
  does not exist here; what is left is a *looping* client, which is rare. The
  throttle's cost is not zero: a legitimate burst that trips it costs a heal
  round-trip, paid by a real facilitator in a live retro. A certain cost against
  an uncertain benefit is the wrong trade — the maintainer's standing rule, *"si
  c'est pas grave, le mieux c'est de rien faire"*, applied for the fifth time.
- **The reasoning this replaces was mine and it was wrong.** I argued the value
  should go non-zero because "the status quo being protected is no limit at
  all". That framing smuggles in an attacker: with no internet exposure there is
  nothing to protect *against*, so "no limit" is not a risk being tolerated, it
  is simply the correct configuration. Do not re-derive it.
- **What would reopen it:** the app becoming reachable beyond the internal
  network, or a runaway client actually observed saturating the write path.
  Then set `20` — timer sync is ~1/s per client, so that keeps an order of
  magnitude of headroom — with the burst at `2 ×`, staging first, watching for
  heal round-trips. A throttled write is healed with authoritative state and
  re-sent, never dropped, so an over-tight limit costs a round-trip rather than
  a user action; that asymmetry is what makes the value safe to pick without a
  load test if it is ever needed.
- **Documented on all four surfaces** (`.env.example`, `README.md`, `AGENTS.md`,
  `k8s/base/deployment.yaml`), each stating the default *and* the trigger to
  enable, so an operator meets the reasoning where they meet the knob.

## 4. Real test-coverage map

**There are two numbers now, and each says what it measures** — because the
single one was misread as repo-wide more than once, which is exactly the failure
mode a coverage percentage invites:

| Command | Scope | 2026-08-05 |
|---|---|---|
| `npm run test:coverage` | the gate: `services/**/*.ts`, `server/services/**/*.js`, `server/routes/**/*.js`, `utils/**/*.{ts,js}` — **4 635 of 10 089 production statements, 45.9%** | **86.54%** stmts |
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
| Backend routes | **90.78%** | yes | was 88.00% |
| — `superAdminRoutes.js` | **97.75%** | yes | largest backend file; the dip is H33's new release paths, whose `.catch` arms no test drives |
| — `passwordResetRoutes.js` | **99.21%** | yes | the H4/H5 surface; the residual is H4's new `invalid_link` branch |
| — `publicRoutes.js` | **85.43%** | yes | was 74.71% before the H29/H31 tests |
| — `teamRoutes.js` | **83.11%** | yes | was 75.87% at the start of this pass (branches 66.8% → 76.8%). H24–H27, H33 *and* H35 all came out of that gap |
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

**Three are open (D18–D20), all raised by the pre-production pass of 2026-08-06.**
None of them blocks the lot it belongs to from *starting* — each gates one choice
inside it — but all three are policy rather than engineering, so guessing is the
wrong move.

### D18 — H39 — what happens to the team passwords that are already too short?

Raising the minimum to 12 characters binds on write. The question is the existing
records, and there are three answers with genuinely different costs:

- **(a) Leave them.** Old passwords keep working; only new ones and changes meet
  the rule. Zero disruption, and the weak credentials stay weak indefinitely.
- **(b) Force a rotation at next login.** Every team is prompted once. Closes the
  gap completely and interrupts every facilitator, including one opening a
  retrospective with twelve people waiting.
- **(c) Warn without forcing** — a dismissible banner in the dashboard for teams
  below the threshold.

**Recommendation: (a) now, (c) in the same release if it is cheap.** The rule
that keeps being right in this tracker is that an availability cost is a security
property too (H20), and (b) pays that cost at the worst possible moment. (a)
plus (c) converges without ever blocking anyone.

### D19 — H41 — does an identified feedback survive its author's team?

Team deletion preserves feedbacks in `orphanedFeedbacks` **with
`submittedByName`**. That was a deliberate choice — a bug report must outlive the
team that filed it — and it is also a deliberate retention of identified personal
data past the deletion of the subject's record.

- **(a) Anonymise on deletion.** The report keeps its title, description and
  history; the author becomes "Deleted team". Cheap, one function, and it makes
  the erasure answer clean.
- **(b) Keep the name**, and write the justification into the data-protection
  document.

**Recommendation: (a).** The name is display metadata for the super-admin board;
nothing depends on it. (b) is defensible but spends credibility in a commission
to keep a field nobody uses.

### D20 — H49 — should the AI endpoint be restricted, or only documented?

Enabling AI exports retrospective content to whatever `apiUrl` a super admin
enters. `SECURITY.md` now says so.

- **(a) Documentation only.** The admin population is small and trusted; H45's
  audit event would record the change if it lands.
- **(b) Warn or refuse on a non-private host** unless a confirmation flag is set.

**Recommendation: (a) for now, revisit if the admin population grows.** (b) is a
guess about a mistake that has not happened, and a silent block would strand a
legitimate external endpoint. If (b) is taken, it must warn-and-allow, never
refuse outright.

---

D14 and D15 were raised and answered on 2026-08-06, in the same
exchange; D16 was volunteered by the maintainer alongside them and **superseded
by D17 hours later** — read D17 first, it is the one in force. D1–D13 were
answered across three earlier rounds. The
answers that lock in a rule are invariants 12, 13 and 17 (§2); the rest are
recorded below so nobody re-opens a settled question.

### D17 — **answered 2026-08-06: leave `SOCKET_UPDATE_RATE` at `0` and document it.**

Supersedes D16 below, hours after it. The maintainer's words: *"je ne veux pas
créer des anomalies où y a pas besoin, l'outil est interne, pas ouvert sur
internet"*.

**The premise I had never checked.** Both D16 and my H11 write-up argued from
"one hostile or looping client saturates the write path". On a deployment that
is not reachable from the internet, the *hostile* half of that sentence has no
referent — and I had carried it forward from the original audit for five passes
without asking whether the threat could reach this product at all. What remains
is a looping client: rare, and weighed against a throttle whose cost is **not**
zero, because a legitimate burst that trips it spends a heal round-trip on a real
facilitator in a live retro. Certain cost, uncertain benefit.

**The specific error worth remembering:** I wrote that "the status quo being
protected is *no limit at all*", which sounds like a risk being tolerated. It is
not — with no exposure there is nothing to protect against, so "no limit" is
simply the correct configuration. A phrase that makes inaction sound negligent is
worth re-reading for a smuggled premise.

The knob stays, fully documented on all four surfaces with the trigger to enable
it (see §3 H11). This is the fifth time *"si c'est pas grave, le mieux c'est de
rien faire"* has been the right answer; the pattern to learn is that a hardening
finding inherited from a generic audit still has to be re-grounded in *this*
deployment's exposure before it earns a change.

### D16 — **answered 2026-08-06, then superseded by D17 the same day.**

Recorded because it is instructive, not because it is in force. The maintainer
dropped the load test as the way to pick the value ("on laisse tomber le coup du
`npm run test:load`"), which unblocked H11 — and I immediately shipped
`SOCKET_UPDATE_RATE: 20`, treating "no longer blocked" as "therefore do it".
That does not follow: removing a prerequisite says nothing about whether the
change is worth making. D17 reverted the value the same day.

**The half of D16 that survives** is its scope note, still binding: what was
dropped is the load test as the way to pick *a number*. It is **not** a general
repeal of §7.4 — L13 (H35's remaining half) changes the shared
`update-session`/merge path rather than a value, so it stays gated. Re-confirm
before treating L13 as unblocked.

### D14 — H36 — how strict a CSP, and enforce or report-only? **Answered 2026-08-06: enforcing.**

The maintainer chose the enforcing policy ("csp bloquant"). That settles the
*mode*; it does not remove the engineering the option depends on — the
production-mode gate below is what makes enforcing safe rather than reckless, and
it is required work, not an alternative to it.

The header set itself is not the question — `X-Frame-Options`, `nosniff`,
`Referrer-Policy` and HSTS are uncontroversial and land as they are. The
`Content-Security-Policy` is the decision, because getting it wrong in enforcing
mode is a blank page for every user at once.

**The existing e2e suite cannot be the gate, and that changes the answer**
(Codex, PR #417 — it caught the first version of this entry recommending exactly
that). `playwright.config.ts:17` sets `baseURL: 'http://localhost:5173'` and
every spec calls `goto('/')`, so the tests load the page from **Vite**; only
`/api` and Socket.IO reach `server.js`. A CSP middleware on Express would never
govern the HTML, scripts or styles these tests exercise — the suite would stay
green while the production, Express-served app is blank. Any option below needs
an assertion that boots the **built** frontend from `server.js`.

- **(a) Report-only first, enforce next release.** Ship
  `Content-Security-Policy-Report-Only`, read what it would have blocked, then
  flip it. Zero risk of breaking the app; the protection only starts with the
  second release, so the window stays open for one cycle.
- **(b) Enforce immediately**, gated by a new production-mode check (a Playwright
  project pointed at `server.js` on the built `dist/`, or a boot assertion in the
  unit suite that fetches the served `index.html` and diffs its asset list
  against the policy).
- **(c) Headers now, CSP later.** Cheapest, and leaves the offline guarantee
  unenforced, which is the main reason H36 is P1 rather than P2.

**Recommendation: (b), but only with the production-mode gate built first** — and
the policy is *not* a bare `default-src 'self'`. Two directives are already known
to be required:
- `img-src 'self' data:` — `components/InviteModal.tsx:71,92` renders both the
  invite QR code and the Wi-Fi QR code from `QRCode.toDataURL`, i.e. `data:`
  URLs. `default-src 'self'` blocks them, and the existing e2e flows open that
  modal but only read the invitation *link*, so they would stay green while both
  QR codes silently fail — breaking precisely the offline workflow H36 exists to
  protect (Codex, PR #417).
- `style-src 'self' 'unsafe-inline'` — Tailwind injects styles at runtime.

Verify each directive against the built app rather than assuming: the QR case is
the proof that "the tests are green" and "the feature works" are different
statements here.

### D15 — H38 — pin the gstack bootstrap, or accept the auto-update? **Answered 2026-08-06: accept (a).**

The SessionStart hook clones `garrytan/gstack` at default-branch HEAD and runs
its `setup`, so upstream can change what executes in the session container
without anything here moving.

**The first version of this entry argued the exposure was bounded because setup
"touches `$HOME` and never the repo, and holds no repository secret". That
reasoning is wrong and Codex was right to reject it** (PR #417). A working
directory is not a sandbox: the setup shell runs as the session user, so it can
read `$CLAUDE_PROJECT_DIR`, reach the session's repo-scoped GitHub token, and
call `git` or the GitHub API directly. The honest framing is that this is a
**repository-level** exposure, and the decision is whether to accept one.

- **(a) Accept it, documented.** Auto-update is what team mode is for and what
  was asked for, and gstack ships no stable release tags to pin to. What
  genuinely narrows it: the hook runs only in the ephemeral web container (never
  on a developer machine), the token is scoped to this one repository, and every
  change still arrives through a reviewed pull request — so the realistic blast
  radius is what an attacker could push to a branch, not a silent write to
  `main`, which branch protection gates.
- **(b) Pin `--branch <tag>` and refresh by hand.** Removes the standing
  exposure; costs a manual bump and drops the auto-update.

**Recommendation: (a)** — but as an accepted repository-level risk, stated as
such, not as a boundary that does not exist. Note the asymmetry with H37, which
is *not* the same call: pinning `trivy-action` costs nothing, since Dependabot
bumps a pinned action for you.

### D13 — H35 — **answered 2026-08-05: it is a real bug, fix it.**

Asked as "heal the dropped persist or accept the residual?". The maintainer
settled it with an observation the audit could not have made from the code:
**retros renamed from the Dashboard had already been seen reverting in
production.** That moved it out of "how likely is this?" entirely.

The fix taken was neither of the two options as framed — both assumed the
full-blob persist had to keep carrying the rename. It does not: a **granular
rename endpoint** carries no `_rev`, so the guard has nothing to reject, and the
sync path is untouched (so §7.4's load-test gate never applied). Shipped; the
narrower residual left behind is H35 in §3.

**Lesson worth keeping:** the two options I offered both took the payload for
granted and argued about the response code. Asking *why is a title change
sending 40 kB of session state at all?* dissolved the choice. When a decision
looks like "risky fix vs accept the bug", check whether a third option is hiding
in a premise neither branch questioned.

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
| **L15** | H39 — one enforced password minimum of 12 characters on all five write paths, existing shorter passwords still logging in | none | an 11-character password is refused everywhere, a pre-existing short one still authenticates. **User-visible: bump `X`, one CHANGELOG bullet** |
| **L16** | H42's measurement half — axe against the four main flows, result recorded here; `eslint-plugin-jsx-a11y` at `warn` folded into the lint budget | none | a written accessibility baseline exists, with a violation count per flow |
| **L17** | H47 — SHA-pin every third-party action, `permissions: contents: read` on `ci.yml` and `e2e.yml`, parity test tightened from "not a branch" to "a 40-hex SHA" | none | the suite fails on any `uses:` that is not a SHA, and on a workflow with no `permissions` block |
| **L21** | H50 — make a lost cross-pod adapter *visible* (option (a): a status signal + a loud log) and retry it in the background (option (c)); do **not** take option (b) without reading why | none | an adapter failure is observable without reading pod logs, and a transient one heals itself. No new path can refuse traffic |
| **L18** | H41 — the data-protection document (fields, basis, retention, erasure) plus anonymising `submittedByName` when a team is deleted | none for the document; the code half is one function | the erasure question has a written answer, and a preserved feedback keeps its content and loses its author |
| **L19** | H40 + H46 — the database pod's security context, default-deny NetworkPolicies, `automountServiceAccountToken: false`, base Service to `ClusterIP` | a non-production cluster to verify against; none of it can be validated from the agent container | `kubectl apply --dry-run=server` passes, the app still reaches PostgreSQL, and the parity suite asserts each one statically |
| **L20** | H43 — a scheduled dump outside the cluster's storage, a stated RPO/RTO, **one rehearsed restore into an empty database** | platform-team involvement for the dump target | the restore is rehearsed and the result written into §1 |
| **L13** | H35's remaining half (a live session's persist still overwrites a rename) | still §7.4: it changes the shared sync path, and D16's surviving scope note covers only a *value* | a rename during a live session survives that session's next persist — or the residual is documented in §3 H10 |

**L14 shipped on 2026-08-06** (H36 + H37 — see *Recently closed*). **L4b is
gone:** D17 closed H11 by deciding the throttle stays off on an internal
deployment, so there is no rollout to perform.

**Take L15 → L17 → L16 first.** L15 is the finding a reviewer reaches without
reading any code; L17 is mechanical and turns H37's rule into a guard that
actually holds; L16's *measurement* is what a commission needs, and it is small —
the remediation it uncovers is the large part and can be scheduled. L19 and L20
need a cluster and a platform conversation, so start them early even though they
finish late. H44, H45 and H49 have no lot on purpose: schedule them with a date
rather than closing them in a rush, since a documented gap with a plan is
acceptable to a review board and silence is not.

**Ordering note.** The list above is longer than this tracker has carried before,
and that is a property of the axis rather than of the code: none of H39–H47 came
from reading application logic. If the commission moves, re-derive the order from
§8's *What to do before the commission* rather than from this table — it is the
one written against the deadline.

**Nothing is blocked on a decision** — D14, D15, D16 and D17 were all answered on
2026-08-06.
**L12 is gone** — H23 shipped once the maintainer read the migration's clean
line in the super-admin log viewer. **L9 is gone:**
H9 was accepted as a residual on 2026-08-05 rather than measured, and the four
decisions that closed by *accepting* the residual (D10, D11, D12 and H9) are all
recorded in §3 H10 with what would reopen each one.

After L14, **go to §4** and write route tests against the lowest-covered
branches — every finding of the last seven passes (H21, H22, H24–H28, H29, H33,
H34) came out of exactly that, and none of them needed anything this container
lacks. **H36 adds a caveat worth keeping:** all of those came from reading
*uncovered code*, and H36 was invisible to that method because the defect is code
that does not exist — no route, no branch, nothing to be uncovered. A coverage
table cannot report a missing middleware. That is the gap `/cso`'s
attack-surface census filled on its first run, and the reason to keep alternating
the two methods instead of settling into the coverage loop. Two refinements worth carrying: H33 started from a *reported* bug (H32)
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
   `npm audit --omit=dev --audit-level=high`, **`npm run test:e2e`** and
   **`npm run test:e2e:prod`** (the CSP gate, H36 — the ordinary e2e suite loads
   from Vite and cannot see a header set by `server.js`). The
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

---

## 8. Pre-production review readiness (commissions)

Written for the review boards the application goes through before production —
security, conformity, architecture. Two things it does, and the second matters
more than the first: it maps every open finding to the commission that will ask
for it, and it lists **what already exists as evidence**, because nine hardening
passes have produced a great deal of it and none of that is discoverable from a
findings list.

**The overall picture.** The application-logic axis is in good shape and has the
receipts: 1 274 unit tests across 111 files, an e2e suite on every pull request,
a production-mode CSP gate, CodeQL, a container scan, a machine-checked
configuration-parity contract, and seventeen written invariants (§2) that encode
what previous failures taught. The gaps found in this pass are almost all on the
axis those passes never covered — **platform hardening, supply chain, data
protection, accessibility and operability** — plus one application-level item
(H39, the four-character password) that survived nine passes precisely because
it is a policy question rather than a defect.

### Cellule sécurité

| Ask | State | Evidence / gap |
|---|---|---|
| Authentication and session management | **strong** | Scrypt at rest, only a scrypt record authenticates (invariant 7), no writes on the auth path (invariant 8), HMAC-signed tokens with type/iat/exp/nonce, 7-day expiry, socket channel authenticated and team-scoped (invariant 2), server-side role enforcement (invariant 3) |
| Password policy | **gap — H39** | Four-character minimum, no complexity, no lockout. The one finding here that a reviewer finds without reading code |
| Injection / XSS / CSRF | **strong** | No `dangerouslySetInnerHTML` anywhere, all SQL parameterised, credentials travel in request bodies rather than cookies so there is no CSRF surface, `escapeHtml` on every mail body |
| Response headers / CSP | **strong** | Enforcing CSP on every response, gated by a production-mode Playwright suite because the ordinary one cannot see an Express header (H36) |
| Secrets management | **adequate** | No secret in the repository or in git history; Kubernetes Secrets applied out-of-band; `SESSION_TOKEN_SECRET` never in the database or in backups. Note the LLM API key is the exception (H49) |
| Platform hardening | **gap — H40, H46** | The application pod is hardened (invariant 13); the database pod is `{}`, and no NetworkPolicy exists |
| Supply chain | **partial — H47** | 0 production vulnerabilities, Dependabot with auto-merge, Trivy on every PR, CodeQL, `trivy-action` SHA-pinned. Other actions ride mutable tags; two workflows have no `permissions`; no SBOM |
| Privileged access | **gap — H45** | One shared super-admin password, no MFA, no durable audit trail |
| Rate limiting / abuse | **adequate, documented** | Per-IP limiters scoped to rejected credentials so legitimate use cannot trip them; per-pod ceiling documented (H19). The socket throttle is deliberately off (D17) |
| Known accepted risks | **documented** | §3 H10 — read it before the commission; each entry says what would reopen it |

### Cellule conformité

| Ask | State | Evidence / gap |
|---|---|---|
| Inventory of personal data | **gap — H41** | Names, facilitator and invitee emails, free-text content naming colleagues. Never written down in one place |
| Retention and erasure | **gap — H41** | No retention rule, no purge, and team deletion deliberately preserves identified feedbacks |
| Data residency / third parties | **partial — H49** | Self-hosted by design, no telemetry, no CDN, no third-party analytics — a genuinely strong position. The exception is AI, which exports content to an operator-chosen endpoint; now documented in `SECURITY.md`, not yet controlled |
| Accessibility | **gap — H42** | Never assessed. The longest lead time on this list; measure before the commission even if the fixes land after |
| Traceability of administrative acts | **gap — H45** | No durable record of who deleted, restored or reconfigured |
| Security documentation | **good, corrected this pass** | `SECURITY.md` described an authentication path removed by H23 and has been corrected; sections added for the LLM credential, the TLS-verification switch, what a backup archive omits, and the password-policy limit |
| Licensing | **clear** | Unlicense (public domain); dependency licences not enumerated — an SBOM (H47) covers this if asked |

### Cellule architecture

| Ask | State | Evidence / gap |
|---|---|---|
| High availability | **strong, with one gap — H50** | `replicas: 2`, RollingUpdate with `maxUnavailable: 0`, PodDisruptionBudget, liveness/readiness/startup probes, graceful shutdown with a preStop drain, cross-pod Socket.IO adapter, automatic session re-join after a pod restart. **The gap:** if the cross-pod adapter fails to initialise the pod keeps the in-memory one and still reports ready, so two replicas silently stop sharing broadcasts with every probe green |
| State and concurrency | **strong** | Per-team KV records so writes to different teams never contend, optimistic concurrency on `_rev` with heal-and-resend rather than dropped writes, compensating writes on the index (invariant 15), degraded mode that keeps sessions live through a database outage |
| Scalability | **adequate** | Documented per-pod knobs (`PG_POOL_MAX`, `SESSION_CACHE_MAX`, roster-broadcast coalescing), a load-test harness. No HPA — fixed at 2 replicas, which is a deliberate fit for the population |
| Backup and restore | **gap — H43** | Automatic backups, a protected pre-restore snapshot, a faithful-replace restore that aborts if the snapshot fails (invariant 4). But the backups live in the database they protect, the *application* archive omits global settings (a `pg_dump` does not), and no restore has been rehearsed |
| Observability | **gap — H44** | Health probes only. No structured logs, correlation ids, metrics or tracing |
| Deployment reproducibility | **strong** | Multi-stage image, non-root, machine-checked manifest parity, image tag tied to `VERSION`'s major, no auto-commit in the deploy path (D7) |
| Performance | **accepted residual** | One 680 kB JS bundle, no code splitting — accepted with the reasoning and the reopening condition recorded in §3 H10 (H9) |
| Operational runbook | **partial** | `MAINTENANCE.md` is a developer-quality guide, `k8s/README.md` covers deployment and backups. Missing: incident procedure, rollback drill, RPO/RTO (folded into H43) |

### What to do before the commission, in order

1. **H39** (password minimum) — S, and it is the finding a reviewer reaches first.
2. **H42 measurement only** — run axe, record the result. The audit is what a
   commission needs; the fixes can be scheduled.
3. **H43 (3)** — rehearse one restore into an empty database and write down what
   happened. It proves the backup story, and it is the only item here that
   cannot be argued, only demonstrated.
4. **H47 pinning + permissions** — S, mechanical, and it turns H37's rule into a
   guard that holds.
5. **H50 option (a)** — S, and it is the one finding here that is a live
   production risk rather than a posture gap: two replicas can already be
   failing to share broadcasts today with nothing reporting it.
6. **H41 documentation** — the retention and erasure answer, written down.
   Anonymising orphaned feedbacks is the cheap code half.
7. **H40, H46** — platform manifests. Cheap to write, and they need a
   non-production cluster to verify, so start them early.
8. **H44, H45, H49** — schedule with a date rather than closing. A commission
   accepts a documented gap with a plan; it does not accept silence.
