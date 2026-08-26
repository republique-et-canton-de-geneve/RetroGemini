# RetroGemini Hardening Status

_Last updated: 2026-08-25 (**H40 and H46 closed** — the database pod now carries
the same security context as the application pod, and the namespace denies
ingress by default with PostgreSQL reachable from the application alone. Both
were carried as "cannot be validated from the agent container"; both were, with
`kustomize` + `kubeconform` and the image's own Dockerfile, which is the second
time this pass that a prerequisite turned out to be a habit rather than a fact.
Earlier the same day: **H42 remediated, H51 fixed, and H43's restore
rehearsed**. The rehearsal is the one worth reading: it was carried for five
passes as impossible in this container, and it was not — `/usr/lib/postgresql/16/bin`
holds a full server, so the database was destroyed and restored into an empty
one in about ten minutes. Everything came back, **including ticket votes and the
password hashes**; the deployment *configuration* did not, which is now measured
rather than argued. **H42**: grouping is reachable from the keyboard through a
control that stays off screen until focused, every overlay is a real dialog, and
the axe baseline is **zero on nine screens**, two of them dark. **H51**: closing
a mouse-opened dialog with Escape no longer leaves the browser's outline on the
opener. **H41 and H49 closed as decisions**; §5 has no open questions. What is
left needs a cluster or a platform conversation.)_

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

- **H42 — accessibility: measured on 2026-08-24, remediated on 2026-08-25.**
  The part worth keeping is *where the defects actually were*. Six screens
  reported 1-2 serious/critical rules each, which reads as six problems and was
  four colour tokens: a muted grey at 2.63:1 used 150 times, a brand primary
  whose white-on-indigo measured 4.46:1 against a 4.5:1 floor (so **every**
  primary button in the product failed by four hundredths), and two tinted
  backgrounds. Fixing tokens fixed screens. The one defect that could not be
  fixed by choosing better values is column titles — the facilitator picks that
  colour, so `readableTextColor` keeps the hue and darkens it only as far as
  the floor requires. The keyboard finding is the one to remember for method:
  the Group phase had **no** control to fix, only a `div` with `draggable`, so
  no scanner could report it and the manual pass is what found it; the fix
  reuses the touch flow's state machine rather than inventing a second model.
  Thirteen overlays and one `role="dialog"` became one shared `ModalDialog`.
  Baseline 1-2 → **0** per screen, lint 192 → 183, both ratchets lowered in the
  same change as each fix. **Not done, and named in `ACCESSIBILITY.md` rather
  than left silent:** 29 unassociated form labels, 17 `autoFocus` attributes,
  the screens outside the audited nine, and — the real one — no test with an
  actual screen reader or switch device, and no external audit. — 30.0 — 2026-08-25
- **H41, H49, D18 (c), D19 — answered by not acting, 2026-08-25.** All four
  closed the same way: an internal deployment, a small trusted population, and
  a change whose cost is certain against a benefit that is speculative. No
  data-protection document, orphaned feedbacks keep their author's name, the AI
  endpoint stays unrestricted, and no warning is shown to teams holding a
  pre-rule password. Each is recorded in §3/§5 **with what would reopen it** —
  a decision not to act is only durable if the trigger to revisit it is written
  down beside it. — 2026-08-25
- **H47 — the supply chain: mutable action tags, two ungoverned tokens, no SBOM.**
  Every `uses:` now carries a 40-character commit SHA with the version in a
  trailing comment. The part worth keeping is *why the first-party exemption
  went*: H37 pinned `trivy-action` and left `actions/*`, `github/*`, `docker/*`
  and `dependabot/*` on major tags because rewriting GitHub's own actions
  "would be churn with a much weaker argument". That reasoning treats the
  publisher as the risk, but `@v7` is a **mutable pointer its owner controls**,
  and H47's own failure scenario is a compromised release of a *popular*
  action — which describes `actions/checkout` better than any third party in
  these workflows. `ci.yml` and `e2e.yml`, the two workflows that run `npm ci`
  and therefore execute dependency lifecycle scripts, had no `permissions:`
  block at all and inherited the repository default token; both are now
  `contents: read`. The release workflow generates a CycloneDX SBOM of the
  **production** tree (`--omit dev`, matching the image's own
  `npm ci --omit=dev`) and attaches it to the GitHub release, because an
  air-gapped operator cannot query npm at install time. **Not taken, and
  recorded rather than skipped:** cosign signing and registry attestations —
  both change the production publish path, and nothing in CI or in this
  container can verify that a downstream registry mirror accepts an attestation
  index before a release depends on it. Tests
  (`deploymentManifestParity.test.ts`): the pinning check moved from "not a
  branch" to "a 40-hex SHA" for every action; a new `permissions:` check accepts
  either placement (top-level or every job) and refuses silence, with a vacuity
  guard pinning both shapes; and the SBOM guard ties the *produced* filename to
  the *uploaded* one — which is how that step fails silently rather than loudly.
  **Codex found the SBOM shipping the wrong identity:** `npm sbom` builds the
  root component from `package.json`, which has read `1.1.0` since the repo
  began, so the asset named `retrogemini-29.2-sbom.cdx.json` described itself as
  `retrogemini@1.1.0` — and so would every release after it. A filename is not
  an identity: an inventory scanner reads `metadata.component`, and identical
  identities across releases is the exact confusion an SBOM exists to remove.
  `scripts/stampSbom.mjs` stamps `VERSION` onto the root component **and** the
  dependency graph hanging off its `bom-ref` — stopping at `metadata` would
  leave a document pointing at a component that no longer exists, which is worse
  than the wrong-but-coherent one it replaced. Tested in
  `__tests__/sbomVersion.test.ts` (6 cases, including a scoped name and the two
  refusals) and guarded statically in the parity suite. — 2026-08-24
- **H50 — a pod that lost its cross-pod adapter still reported ready.**
  The root cause was a boolean. `initSocketAdapter` returned `false` both when
  no shared adapter was *configured* (a healthy single-pod deployment) and when
  a configured one *failed* (a silent split-brain at `replicas: 2`), so nothing
  downstream could tell them apart and therefore nothing could report the
  second. It now returns `{ strategy, expected, active, degraded }`, and
  `startSocketAdapter` publishes that on `serverRuntime`, logs a degraded
  adapter loudly, and retries with exponential backoff. **Three decisions worth
  keeping.** (1) Option (b) — failing readiness — was refused and is now pinned
  by a test: with both pods failing at once it empties the Service and turns
  degraded collaboration into a total outage, and readiness cannot express
  "some pods are healthy". (2) The retry is **bounded** (~12 attempts, 5s→60s):
  the transient case heals in seconds, while the realistic permanent case (a
  `CREATE TABLE` refused by a restricted grant) would otherwise write an error a
  minute into a 1 000-entry log ring and bury the message that explains it.
  Giving up on the retry is not giving up on the pod. (3) `/health` does **not**
  return the upstream error text — it names internal hosts, ports and grants and
  the endpoint is anonymous, the same rule that keeps `detail` off `/api/ai/*`.
  Found by Codex on PR #418, reviewing §8's claim that cross-pod sync was
  unconditionally strong. **`/review` then found the fix's own version of the
  same bug, and it is the one worth remembering:** `io.adapter()` does not
  attach an adapter, it *replaces* the instance on every namespace, and the
  replacement starts with empty room bookkeeping. At startup that is harmless —
  nothing is connected until `server.listen`. On a **retry** every socket that
  joined a session during the degraded window would have kept its connection and
  silently stopped receiving broadcasts: H50's exact failure mode, reintroduced
  by H50's fix, in the code written to remove it. Room membership is now
  captured before the swap and re-applied after it (own-id room included —
  Socket.IO routes `io.to(socketId)` through it). **The general rule: a
  self-healing path re-runs startup code at a moment startup's assumptions no
  longer hold.** Ask what was true at boot that is not true on attempt two.
  **Codex then found two more on the pull request, and both are that rule one
  level deeper.** (1) The membership snapshot was taken *before* the connection
  work rather than next to the swap, so anything that joined or left during the
  seconds spent dialling Redis or running `CREATE TABLE` was already stale —
  capture, swap and restore now run with no `await` between them, which on a
  single-threaded runtime is a window of exactly zero. (2) **node-redis's
  `connect()` never rejects against an unreachable server**: the default
  reconnect strategy answers every refusal with a backoff number and the socket
  loops while the client is open and not ready, so the promise stays pending for
  ever (read `@redis/client/dist/lib/client/socket.js` before changing this).
  It is awaited *before* `server.listen`, so a deployment whose Redis was down
  would never have listened at all — failing its startup probe in a loop instead
  of serving degraded, the precise outcome this module exists to prevent. The
  first attempt is now bounded by a 10s race, while the client keeps its own
  reconnect strategy so an established connection still heals itself. **Both
  were pre-existing shapes that only became reachable because H50 added a
  retry — a new caller makes old code newly wrong.** Tests: 9 in
  `socketAdapter.test.ts`, 5 in `coreRoutes.test.ts`. — 2026-08-24
- **H38 — the gstack bootstrap decision was made and never written down.**
  D15 answered it on 2026-08-06 (accept the auto-update), and the finding stayed
  open in §3 for eighteen days asking for the decision it already had. Closed by
  doing the half that was actually missing: `SECURITY.md` now carries a supply
  chain section stating the exposure at **repository level** — the installer
  runs as the session user and can reach the session's repository-scoped token,
  so a working directory is not a boundary (Codex, PR #417) — together with what
  narrows it and the fact that nothing in it reaches the runtime image. **The
  process lesson:** an answered decision leaves a *finding* behind, and "decided"
  is not "closed". Check §5 against §3 when resuming, or the tracker
  accumulates items whose only remaining work is a paragraph. — 2026-08-24
- **H39 — the four-character password minimum is now eight, in one place.**
  The finding §8 put first because a reviewer reaches it without reading any
  code, and the only application-level item the pre-production pass produced.
  The rule lives in `utils/passwordPolicy.js` and is imported by the **four**
  server write paths, by all four React forms and by `dataService`'s own
  change-password guard, so a screen can no longer
  state a rule the route does not enforce — which it had been doing in the other
  direction all along: three forms advertised "min 4 characters" in a
  placeholder, and the create form stated no rule at all.
  **The property that matters more than the number: it binds on write, never on
  verify.** Nothing calls the module from an authentication path, so a team
  whose password predates the rule keeps logging in and becomes compliant the
  next time it changes it (decision D18, option (a) — which H39's own acceptance
  named as the safe default, so no guess was involved). Refusing to verify would
  have locked out the entire existing user base: the H20 lesson, that an
  availability cost is a security property too, and this is the second finding
  in a row where it decided the design. `server/services/passwordMigration.js`
  is excluded for the mirror-image reason — it re-hashes the short plaintext a
  legacy record *contains*, so a minimum there would make those records
  unconvertible and, after H23, unable to authenticate at all.
  **Three corrections, and the third is the one worth reading.** (1) The tracker
  said "five server paths" and listed four; there are four —
  `grep -rn "hashPassword(" server/` settles it in seconds. (2) `SECURITY.md`
  stated the four-character floor as a documented limitation, so the change had
  to move it; a security document that describes a *weaker* system than the one
  shipping is the H48 failure mode, and it goes stale silently because nothing
  fails when it does. (3) **`/review` found a fifth client site I had missed**:
  `services/dataService.ts`'s `changeTeamPassword` carries its own length check,
  and it still said `< 4` with the message "at least 4 characters" after every
  form had moved. It is the only client-side *write* check that does not live in
  a form, so no form test could reach it, and the Dashboard's own check masked it
  in the one flow that exercises it — a caller reaching `dataService` directly
  would have been told the wrong rule. **The lesson is the H34 lesson applied to
  my own work in the same commit that quotes it:** I had grepped
  `server/ components/` for `length < 4` and concluded "four server paths, four
  forms". `services/` was not in the grep, so the enumeration was wrong the
  moment I wrote it. When a change is defined as *"replace every instance of X"*,
  the search that proves completeness must be **repo-wide and run again at the
  end** — scoping it to where you expect the hits is how you find exactly the
  hits you expected. The final sweep is now part of the work, not a formality.
  **What this does not do, and should be said in front of a commission:**
  raising a minimum on write does not strengthen a single password already in
  use. Option (c) of D18 (a dismissible banner for teams below the floor) is
  still open and is the cheap way to converge; forced rotation (b) stays
  refused. There is still no complexity, reuse or breach check — deliberately,
  per NIST and ASVS, and a breach check needs an external service an air-gapped
  deployment cannot have. Tests: `__tests__/passwordPolicy.test.ts` (7 cases on
  the rule), `__tests__/passwordMinimumLength.test.ts` (13 cases — a boundary
  pair per write path, the two ordering guards, and three that pin a
  pre-existing short password still logging in, reading its record and being
  able to rotate), `__tests__/passwordPolicyForms.test.tsx` (9 cases, one hint +
  one refusal per form) and 4 in `dataService.test.ts` (the error mapping, plus
  the rewritten guard case the review exposed).
  **Vacuity checked on two axes, because the suite guards two different things
  and one probe cannot test both.** Every boundary case is written as
  `PASSWORD_MIN_LENGTH ± 1`, so lowering the constant makes them *follow* it
  rather than fail — which is correct (they exist to prove each write path
  consults the shared rule, not to re-state the policy) but means the obvious
  probe proves less than it looks. So: (1) setting the constant back to 4 fails
  exactly `passwordPolicy.test.ts`'s pinned-value case, which is the guard
  against the *number* moving unnoticed; (2) deleting the guard from a single
  route fails exactly that route's refusal case, which is the guard against a
  write path *stopping* consulting the rule. Both were run. If a future change
  makes the pinned case derive from the module too, axis (1) is gone and nothing
  will notice a silent policy change.
  **Nine existing suites were updated, not deleted** — they
  create teams as fixtures with short passwords and assert entirely different
  things (token auth, index integrity, rename persistence); their literals were
  lengthened, and the wrong-password probes deliberately left short so the
  verify path stays visibly unconstrained. — 2026-08-06
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

## 1. Verified baseline (measured 2026-08-25 on `claude/hardening-work-continuation-f9i6i5`)

**Re-measured this pass, all green:** lint 0 errors / **181 warnings** (exactly
the budget — it fell 192 → 181 with H42's remediation), type-check 0 errors,
**122 files / 1 409 tests pass**, `npm run build` **pass**,
`npm run test:coverage` **86.95% stmts** on the gated scope, `npm audit --omit=dev --audit-level=high`
**0 vulnerabilities**, and both Playwright suites (`test:e2e` and the
`test:e2e:prod` CSP gate) **pass**.

**The accessibility gate is now zero, and that is the number to protect.**
`e2e/accessibility-audit.spec.ts` reports **0 axe violations at any severity**
on all nine screens (it was 1-2 serious/critical rules each on the six then
audited). A gate at zero
fails the pull request on any new serious or critical rule, which an allowance
could not. Both ratchets — `BASELINE` there and `BUDGET` in `scripts/lint.mjs` —
may only be lowered.

**A note on the test count:** +55 over the previous pass, all of it new
behaviour: 14 cases for the Group-phase grouping rules, 8 for their wiring into
`Session.tsx` (driving the keyboard for real — `user.tab()` until the control has
focus, because "unreachable" was the finding), 16 for the shared dialog shell, 13
for the colour maths, and 4 for phase headings and the icon-button names.

**`eslint-plugin-jsx-a11y` needs an `overrides` entry to install.** Its latest
release (6.10.2) declares `peer eslint ^3 || … || ^9`, and this repo runs ESLint
10, so a plain `npm install` fails `ERESOLVE` and — more to the point — so does
**`npm ci`, which is what every workflow runs**. The fix is the pattern the repo
already uses for `eslint-plugin-react-hooks`: a scoped
`"overrides": { "eslint-plugin-jsx-a11y": { "eslint": "$eslint" } }` in
`package.json`. Do **not** reach for `--legacy-peer-deps` or an `.npmrc`: those
disable strict resolution repo-wide and would silently absorb a real conflict
later, which is a poor trade the same week H47 tightened the supply chain. The
plugin itself runs correctly under ESLint 10 — verified, all 39 rules load.

Note: a fresh container clone has no `node_modules` — run `npm ci` first, or
every check fails with `vitest: not found` / missing type definitions.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **pass** — 0 errors, **181 warnings**, exactly the budget (110 pre-existing + 71 accessibility, H42). Since D6 the budget is a **two-way** ratchet (`scripts/lint.mjs`): it fails above *and* below, so removing warnings now requires lowering `BUDGET` in the same change |
| Types | `npm run type-check` | **pass** — 0 errors |
| Unit tests | `npm run test` | **pass** — 122 files, 1 409 tests (116/1 346 at the start of this pass) |
| Coverage (gate) | `npm run test:coverage` | **pass** — 86.95% stmts on the *gated scope*, which is 45.9% of production code (see §4) |
| Coverage (whole) | `npm run test:coverage:all` | **pass** — 61.90% stmts across the whole codebase, floor 57% |
| Build | `npm run build` | **pass** — 680 kB JS chunk (over Vite's 500 kB warning) |
| E2E | `npx playwright test` | **pass** — 12 tests (the twelfth is the H42 accessibility audit, now asserting **zero** violations rather than a per-screen allowance), **~4 min** serially (`workers: 1`). Since D5 this also runs on every pull request, so a red e2e is a blocked merge rather than a local surprise. Beware the reporting trap that once hid a failure: `npx playwright test \| tail` returns *tail's* exit status, so a failing run looks like exit 0 — read the summary line, not `$?` |
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

**One entry left this list on 2026-08-25, and the reason matters more than the
entry.** A restore rehearsal was carried for five passes as impossible here. It
was not: `/usr/lib/postgresql/16/bin` holds `initdb`, `postgres`, `pg_ctl`,
`psql` and `pg_dump`, so a full cluster starts in this container in about ten
seconds. Nobody had looked. Before writing "unverifiable here" about anything
below, run the cheap probe that would settle it.

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
18. **Readiness never gates on the cross-pod adapter** (H50). `/ready` is an
    unconditional `200`, and `__tests__/coreRoutes.test.ts` keeps it that way
    with the degraded state fed in. The tempting fix — refuse traffic when the
    shared Socket.IO adapter is missing — takes the whole application down in
    exactly the case it is meant to protect: if both pods fail to initialise,
    failing readiness on both empties the Service, turning "collaboration is
    degraded" into "the application is gone". Kubernetes readiness cannot
    express "some pods are healthy", so the adapter is reported (`/health`,
    the pod log, a bounded background retry) and never routed on. The same
    endpoint must also keep the upstream error text *out* of its body: it names
    internal hosts, ports and database grants, and it is anonymous.

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
> **Of that set, H39, H47, H48, H50 and H42's measurement half have since
> closed** — look for them in *Recently closed* rather than here.

### H51 — [CLOSED 2026-08-25] The focus ring left on a dialog's opener

Closed. Kept as a pointer because the *distinction* it turns on is the reusable
part, and a future pass that sees focus being returned without a ring will
otherwise read it as a bug.

**Measured, not assumed.** Opening a modal with the mouse and closing it with
Escape left `focused: true`, `:focus-visible: true`, `outline: auto 1px` — the
browser's own black double ring, on a button the user only ever clicked. Closing
the same dialog by clicking the backdrop left nothing. The browser calls the
restored focus keyboard-driven because Escape was the last key pressed.

**What was fixed, and what deliberately was not.** Returning focus is not
optional — a keyboard user would otherwise be dropped at the top of the document
every time a dialog closes (WCAG 2.4.3), and that behaviour is unchanged. What
changed is only the *paint*: `ModalDialog` records whether the opener was
`:focus-visible` when the dialog opened (a mouse-clicked button is focused but
not focus-visible; one activated with Enter is both), and suppresses the ring on
restore only in the pointer case, via `[data-focus-restore='pointer']` cleared
on the next blur. A keyboard user keeps the indicator they need.

**Not done, and available if it is ever wanted:** a house `:focus-visible` style
for the whole application, replacing the browser default everywhere. It would be
a genuine improvement and it is a broad visual change, so it is the maintainer's
to ask for rather than ours to slip in.

**Tests:** three cases in `__tests__/modalDialog.test.tsx` (pointer suppresses,
keyboard does not, blur clears it) — jsdom has no `:focus-visible`, so the state
is stubbed there. The assertion with teeth is in
`e2e/accessibility-audit.spec.ts`: open by mouse, close with Escape, and read
`document.activeElement` plus the computed outline in a real browser. Verified
non-vacuous by setting the rule back to `outline: auto`, which fails it.

### H40 — [CLOSED 2026-08-25] The pod holding all the data has no security context at all

`k8s/base/postgresql-deployment.yaml` carried `securityContext: {}` — the exact
empty context H7.2/D4 called out on the application pod, left in place on the
pod that holds every team record, every retrospective and every backup, while
the application pod is the one with no persistent data.

**Closed with the four pod guarantees and the two container ones, the same as
the application pod:** `runAsNonRoot: true`, `runAsUser`/`runAsGroup`/`fsGroup`
70, `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false` and
`capabilities: drop: [ALL]`. The OpenShift overlay nulls the three UID/GID
fields on this Deployment too, so the restricted SCC keeps assigning them.

**The acceptance criterion said "verify against the actual image before claiming
it", and it was verified rather than assumed:**

- `postgres:15-alpine` creates its account with `addgroup -g 70 -S postgres` /
  `adduser -u 70 -S … postgres` (docker-library/postgres, `15/alpine3.24/Dockerfile`).
  The **Debian** variants use `--uid=999`. `initdb` calls `getpwuid()` and
  refuses a UID with no passwd entry, so the pair (image, `runAsUser`) has one
  correct value — and the parity suite now checks the pair, so swapping the
  image without the UID fails a test instead of failing a rollout.
- **`drop: [ALL]` and a root start are incompatible**, which is the part that
  would have broken the database if done carelessly: `docker-entrypoint.sh`
  re-execs itself through `gosu` when it starts as root, and `gosu` needs
  `CAP_SETUID`/`CAP_SETGID`. Naming the UID skips that branch entirely. This is
  why the fix is one decision, not two.
- **`PGDATA` now points at `…/data/pgdata`**, a subdirectory of the mount, for
  two independent reasons: an ext4 PersistentVolume arrives with a `lost+found`
  at its root and `initdb` refuses a non-empty directory (reproduced locally
  with a real `initdb`, not assumed), and `fsGroup` makes the mount root
  group-writable, which `initdb` also refuses. The entrypoint creates PGDATA
  itself with `mkdir -p; chmod 00700`, so the subdirectory gets the mode it
  wants.

**The one thing an operator must read before upgrading** is
*"Moving PGDATA on an existing volume"* in `k8s/README.md`: on a plain-Kubernetes
installation whose data sits at the mount root, PostgreSQL will not find it and
will initialise an empty cluster beside it. Nothing is deleted, and the section
gives both ways out (keep the old value in an overlay, or move the data once
with the Deployment scaled to zero). **OpenShift is unaffected** — the overlay
swaps in the Red Hat image, which mounts elsewhere and manages its own data
directory, so the overlay deletes the variable.

**Tests:** `__tests__/deploymentManifestParity.test.ts` — the database pod is
held to `expectHardenedPodSpec`, the same helper the application pod is held to,
so the next pod added to `k8s/base` cannot ship with `{}` either; plus the
image/UID pair and the PGDATA-under-mountPath rule.

**Validated on a real cluster, 2026-08-26.** Applied to the Geneva dev project
(`lab-froudj-retrogemini`): the database pod started first time and stayed up
(`postgresql-retrogemini … Running 0 restarts`), so the restricted SCC admits
the hardened context, `initdb` was content, and the application reached the
database normally. This is the half of the platform work that actually holds —
unlike the NetworkPolicies (H46, decision D21).

**Correction to this tracker's own claim.** The item said "no cluster is
reachable from this container", and §6 said none of L19 "can be validated from
the agent container". Half of that was wrong in the same way the H43 entry was:
`kustomize` and `kubeconform` are single binaries and both downloaded fine, so
all three kustomizations were **built and schema-validated offline** before
landing — which is what caught nothing here but would have caught a stale patch
target. What still needs a cluster is admission (does your SCC accept the pod)
and enforcement (does your CNI honour a NetworkPolicy). The commands are in
`k8s/README.md` → *Validating the manifests without a cluster*.

### H41 — [CLOSED 2026-08-25 by decision] Retention, purge and erasure

**Closed by the maintainer, not by code:** *"pas besoin de document de protection
des données, on est en interne, c'est pas une app cloud ouverte au public"*, and
D19 answered the same day — an orphaned feedback **keeps** its author's name.

Recorded rather than deleted because the next pass would otherwise re-raise it
verbatim, and because the answer has a boundary worth knowing:

- **What was decided.** No retention schedule, no purge job, no erasure
  procedure, and no data-protection document. `session:*` rows and old
  retrospectives are kept indefinitely; deleting a team still preserves its
  feedbacks in `orphanedFeedbacks` **with `submittedByName`**.
- **What the decision rests on.** The deployment is internal and not a public
  cloud service, and the population is the institution's own staff. That is a
  legitimate call, and it is the maintainer's to make.
- **What would reopen it.** The application becoming reachable beyond the
  internal network; a subject-access or erasure request actually arriving; or a
  conformity cell asking for the inventory in writing — at which point the
  cheapest answer is still the one this item always named: anonymise
  `submittedByName` on team deletion (one function, the report survives, the
  person does not), and write the field inventory that `types.ts` already
  contains in all but name.

### H42 — [CLOSED 2026-08-25] Accessibility

Closed. Kept as a pointer rather than deleted, because the *statement* it
produced is the artefact a commission asks for and a future session needs to
know where it lives: **`ACCESSIBILITY.md`** — the standard claimed
(WCAG 2.1 AA / eCH-0059), how it is tested, what was fixed, and what is still
missing. The remaining tail is lot **L23** in §6.

**A third defect surfaced after H42 closed** and is recorded here because it is
the same shape as the finding H42 was opened for. Tap-to-group — the oldest
interaction in the Group phase — had **no test at all**. The ticket card guarded
its gesture with an 8px movement threshold; the group container carried a bare
`onTouchEnd`. Touch events bubble, so the container did not merely lack a guard,
it *overrode* the card's: a swipe beginning on a ticket inside a group was
correctly ignored by the ticket and then acted on by its parent, silently
regrouping a card the user was only scrolling past. Fixed in
`components/session/groupingTouch.ts` (one gesture, one claim, 8px slop), with
the first touch tests this repository has had.

Two rules survive it and belong to whoever touches the UI next:

- **Neither ratchet may be raised.** `BASELINE` in
  `e2e/accessibility-audit.spec.ts` is now **zero on all nine screens** — a new
  serious or critical rule fails the pull request. `BUDGET` in
  `scripts/lint.mjs` is 181. Lower them in the change that removes a finding;
  never raise one to make a change pass.
- **New overlays use `components/common/ModalDialog.tsx`.** Hand-rolling the
  `fixed inset-0` pattern is exactly how the product reached thirteen overlays
  with one `role="dialog"` between them.
- **A colour sweep is not a global find-and-replace.** Darkening muted text for
  contrast is right on a white background and *wrong* on a dark one — the same
  change that fixed six light screens broke both dark close screens, taking
  their muted grey from 6.78:1 to 3.74:1. Codex caught it; the audit could not,
  because it walked no dark screen. It now walks two. **When you change a colour
  token, ask which surfaces it lands on before you replace it everywhere.**

### H43 — [P1] The backups share a failure domain with the data

**Partly done (2026-08-25): the rehearsal is done, and it is the half that could
only be demonstrated.** Acceptance (2), (3) and (4) are closed. What remains is
(1) — a scheduled dump landing outside the cluster's storage — which needs a
target and the platform team, not code.

- **The rehearsal, and how to repeat it.** Run against **PostgreSQL 16 started
  inside the agent container** — `initdb`, `pg_ctl`, `psql` and `pg_dump` are
  all present at `/usr/lib/postgresql/16/bin`, so *this item was never blocked
  here*. Five earlier passes recorded it as needing an environment that does not
  exist; the binaries were on disk the whole time. **Check the claim before
  inheriting it** — that is the reusable lesson, and it is the same one D17 and
  D18 taught about parameters.
  The method: run the app against a real PostgreSQL, create a team with a
  retrospective, take a backup through `/api/super-admin/backups/create`,
  download it, then `dropdb` + `createdb` (zero tables), restart on the empty
  database and `POST /api/super-admin/restore` the archive back.
- **What came back, verified item by item:** the team and its facilitator email,
  both members, the retrospective with its status and phase, the ticket **with
  its two votes**, the action with its assignee and done-state, the ROTI, and
  the feedback with its author. The original password still authenticated, so
  the scrypt hashes survive the round trip — the concern
  `restorePasswordMigration.test.ts` guards, now observed rather than inferred.
  A **protected pre-restore snapshot** was written before the replace, so
  invariant 4 holds in practice and not only in the unit tests.
- **What did not come back — (b), measured rather than argued.** Before the wipe
  the AI settings read `enabled: true, apiUrl: "https://llm.internal.example/v1"`
  with an API key; after the restore they read `enabled: false, apiUrl: ""`, and
  `global-settings` was gone from the store. So an application-archive recovery
  gives back the data and silently loses the AI configuration, the admin email
  and the info banner.
  **Do not "fix" that by adding `globalSettings` to the archive without deciding
  about the credential first.** The archive is downloadable by the super admin
  and `ai.apiKey` is live. Including it, stripping the key, or leaving the
  omission and making it loud are three different answers with different risks.
  `__tests__/archiveContract.test.ts` pins the current one so the next person
  has to choose deliberately.
- **What is left: (1), the independent copy.** Automatic backups are still rows
  in the database they protect. A scheduled `pg_dump` landing outside the
  cluster's storage — a CronJob to object storage, or the institution's existing
  backup agent — is platform work and the only part of this item that needs
  someone other than us. `k8s/README.md` now states the RPO (24 h, the backup
  interval) and the RTO (under an hour once someone has an archive), and says
  plainly that both assume the archive still exists.
- **Tests:** `__tests__/archiveContract.test.ts` (2 cases; fails if the archive
  starts carrying the configuration — verified by adding it, which fails the
  test). The rehearsal itself is operational and lives in `k8s/README.md`.
- **Effort:** the rest is platform work. **Regression risk:** none.

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

### H46 — [PARTLY CLOSED 2026-08-25, network half closed by decision D21 on 2026-08-26] The Kubernetes network posture is unconstrained

Four items of one shape — the platform left at its permissive default — all four
now closed in `k8s/`.

| Was | Now |
|---|---|
| No `NetworkPolicy` anywhere; any pod in the cluster that could resolve `postgresql:5432` could try to connect | `k8s/base/networkpolicy.yaml`: a namespace-wide **default-deny on ingress**, an allow to the app on 8080, and an allow to PostgreSQL on 5432 **from the application pods only** |
| The default ServiceAccount token mounted into pods that never call the Kubernetes API (CIS 5.1.5/5.1.6) | `automountServiceAccountToken: false` on **both** Deployments |
| The base `Service` a NodePort on 30080 — reachable on every node, bypassing the Ingress and its TLS | `ClusterIP`, with the NodePort relegated to an opt-in `k8s/overlays/nodeport` for local clusters |
| The base `Ingress` with no `tls:` block, so a deployment following `k8s/README.md` served team passwords and session tokens in clear text | a `tls:` block with a documented placeholder Secret, and a *TLS* section in `k8s/README.md` |

**Two judgements inside this that a future pass should not quietly reverse.**

- **Ingress only. No policy restricts egress**, and the Codex note on PR #418
  that said so is right: a default-deny covering egress breaks the application
  in ways that do not look like a network problem. DNS goes first, so the pod
  cannot even resolve `postgresql`; then SMTP, Redis and the LLM endpoint each
  fail *quietly*, because each of them is optional. Egress restriction means
  enumerating kube-dns plus every endpoint an operator may configure later, and
  is a separate piece of work with its own rollout.
- **`retrogemini-allow-http` deliberately does not name a source.** Naming the
  ingress controller's namespace would be tighter, but the selector differs per
  platform and an OpenShift router running with `hostNetwork` is not selectable
  by namespace at all — its traffic arrives from the node address. Getting that
  wrong takes the application off the network, which is worse than leaving 8080
  as reachable as it already was; the value of this change is the policy below
  it. Leaving the source open also keeps the kubelet's probes working on every
  CNI. The README says how to tighten it once the platform is known.

**What still needs the cluster, and it is not optional:** whether the CNI
enforces NetworkPolicy at all. Calico, Cilium, OVN-Kubernetes and OpenShift SDN
do; plain flannel accepts the objects and ignores them, which is worse than
having none because the cluster then *reads* as protected. `k8s/README.md` →
*Network policies* carries the two-command check (`get networkpolicy`, then a
throwaway pod that must fail to reach `postgresql:5432`) and the instruction to
roll this to a non-production project first.

**Tests:** `__tests__/deploymentManifestParity.test.ts` — the policies exist and
are applied from the base kustomization, the default-deny really selects every
pod and carries no ingress rule, the database policy names the application as
its only peer, **no policy declares Egress**, both pods refuse the token, the
base Service is not a NodePort and the overlay's is, and the base Ingress
declares TLS. All three kustomizations were also built with `kustomize` and
schema-validated with `kubeconform` before landing.

**⚠️ THE NETWORK HALF DOES NOT HOLD ON THIS DEPLOYMENT — measured, not argued
(2026-08-26, decision D21).** The three NetworkPolicies were applied to the dev
project and then *tested*, and the test failed:

```
DB_REACHABLE
APP_REACHABLE
```

A throwaway pod reached PostgreSQL on 5432 with all three policies installed.
The cause is not the CNI and not a wrong selector — it is that **a NetworkPolicy
cannot deny anything.** The model is a union of allows: traffic passes as soon
as one policy permits it, and nothing overrides an allow. A "default deny" works
only by being the *sole* policy selecting a pod. The project carries two
platform-applied policies that select every pod:

```
expose-all-pod-from-outside      podSelector: {}   [Ingress]
discuss-within-same-namespace    podSelector: {}   [Ingress]
```

so every policy this repository adds is inert there, and no change to this
repository can alter that.

**Decision D21: the policies become opt-in and are no longer installed by
`apply -k`.** Shipping them would have been worse than shipping nothing — an
auditor reads three NetworkPolicies and concludes the database is isolated. The
file stays, carrying the check that tells an operator whether applying it would
achieve anything, and `k8s/README.md` → *Network policies* has the two-step
procedure (look for an existing allow-all, then prove the result with a probe
that has its own control).

**What would reopen it:** the platform team narrowing or removing
`expose-all-pod-from-outside` on these projects. That is the only thing that
makes the isolation reachable, and it is a one-sentence question to ask them —
not work for this repository. Until then the exposure is bounded by *their*
posture, which applies to every application they host, and which is a
defensible institutional choice **provided it is written down**, which is what
this entry is for.

**What was learned, and belongs to whoever writes a policy next:** the check I
wrote before the rollout asked *"is anything else running in this namespace?"*
That was the wrong question. The right one is **"are there already
NetworkPolicies in this namespace, and what do they select?"** — a co-tenant
workload is harmless; a co-tenant *policy* silently voids your own.

**The rest of H46 stands and is unaffected:** `automountServiceAccountToken:
false` on both pods, the base Service moved to `ClusterIP`, and the base Ingress
declaring TLS with an HTTP→HTTPS redirect.

**Codex reviewed the landed commit and found two more, both real, both fixed:**

- **A `tls:` block is not HTTPS-only.** It offers HTTPS; on most controllers the
  same host keeps answering plain HTTP, so the finding this closed — team
  passwords in clear text — was only half closed. The Ingress now also carries
  `nginx.ingress.kubernetes.io/ssl-redirect`, and the manifest and
  `k8s/README.md` both say plainly that this annotation is **ingress-nginx's and
  is silently ignored by Traefik, HAProxy, Contour and Istio**, listing each
  one's equivalent. OpenShift's Route already had
  `insecureEdgeTerminationPolicy: Redirect`; that is now asserted too, so it
  cannot be dropped.
- **The `PGDATA` migration procedure would have bricked the database it was
  written to rescue.** It said "mount the PVC in a throwaway pod, `mkdir`,
  `mv`, `chmod 0700`" — and a default throwaway pod runs as **root**, so the new
  directory would be `root:root` and the `chmod` would lock UID 70 out of its
  own data. The procedure now runs the migration pod under the *same*
  `runAsUser`/`fsGroup` 70 as the Deployment, which needs no `chown` and proves
  the result is readable by the pod that has to read it, and it names the check
  (`ls -ld pgdata` must print 70). A second defect in the same snippet: the
  `!(pgdata|lost+found)` glob is bash's, and the image's shell is `sh`.

The lesson is the one this pass keeps re-learning: **the dangerous half of a
manifest change is the runbook beside it**, which no test executes.

**One pre-existing oddity found while rendering the overlays, deliberately left
alone:** on OpenShift the database container ends up with the same PVC mounted at
**two** paths (`/var/lib/pgsql/data` from the image patch, `/var/lib/postgresql/data`
from the base). `volumeMounts` merges on `mountPath`, not on `name`, so the
patch adds rather than replaces. It is harmless — only the Red Hat path is used,
and nothing points at the other any more now that the overlay deletes `PGDATA` —
and removing it would change a live production mount for no gain. Recorded so
the next reader does not mistake it for a bug in this change.

### H49 — [CLOSED 2026-08-25 by decision D20] Where retrospective content goes when AI is enabled

**Answered: documentation only.** The `apiUrl` a super admin enters is not
restricted, warned about, or checked against a private-address range. The
disclosure half was already closed by `SECURITY.md`'s AI section; the control
half is deliberately not built.

- **Why.** The admin population is small and trusted, and (b) — warn or refuse
  on a non-private host — is a guess about a mistake that has not happened. The
  maintainer's standing rule applies: *si c'est pas grave, le mieux c'est de
  rien faire*.
- **What would reopen it.** The admin population growing beyond people who can
  be told; an endpoint actually being misconfigured; or H45 landing, at which
  point the audit event for a settings change is nearly free and worth taking.
  **If it reopens, it must warn and allow** — never refuse outright, or an
  operator with a legitimate external endpoint is stranded with no way through.

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

**None are open.** D18 (c), D19 and D20 were answered on 2026-08-25, D21 on
2026-08-26, and all four were answered *not to act* — which is a decision, not a
deferral, and is why each is written down rather than left implied. The
dependent items (H41, H49, H46's network half) are closed in §3 with what would
reopen them.

### Answered 2026-08-26

### D21 — answered: the NetworkPolicies become opt-in, and the isolation is not pursued

**The question.** The three NetworkPolicies were applied to the dev project and
measured. A throwaway pod still reached PostgreSQL on 5432. The project carries
two platform-applied policies selecting every pod
(`expose-all-pod-from-outside`, `discuss-within-same-namespace`), and since a
NetworkPolicy is a union of allows with no construct that overrides an allow,
nothing this repository adds can restrict anything there. Ship them anyway,
remove them, or chase the platform team?

**The answer: remove them from `apply -k`, keep the file opt-in, write it
down.** Shipping them would have been the worst option — an auditor reads three
NetworkPolicies and concludes the database is isolated, which is the "protection
that only reads as protection" this whole axis exists to remove. The maintainer's
standing rule applies: *si c'est pas grave, le mieux c'est de rien faire* — and
here doing something would have been actively misleading.

**What it rests on.** The exposure is bounded by the platform's own posture,
which applies to every application it hosts and is therefore an institutional
choice rather than this application's defect. It is defensible before a review
board **provided it is written down** — which is the entire point of this entry.

**What would reopen it.** The platform team narrowing `expose-all-pod-from-outside`
on these projects; the application moving to a namespace without a blanket
allow-all; or a conformity cell asking for pod-level segmentation in writing. At
that point the work is already done: apply the file and run the probe in
`k8s/README.md` → *Network policies*.

**Do not re-derive this.** A future pass reading "no NetworkPolicy is installed"
will want to add them back. The reason they are absent is measured and recorded
above; re-adding them without first re-running the two-step check reintroduces
decoration, not security.

### Answered 2026-08-25

- **D18 (c) — warn teams whose password predates the eight-character floor:
  no.** The rule binds on write and nothing schedules a change, so a team that
  never rotates keeps a short password indefinitely. That is accepted and is to
  be said out loud in front of a commission rather than papered over. The
  alternative was not the small change it looked like: the store holds only a
  scrypt hash, so the server cannot tell which teams are affected — marking one
  at login means **writing on the authentication path**, which invariant 8
  forbids. Refusing a rule to avoid breaking an invariant is the right trade
  here, because what actually bounds guessing is `loginLimiter` (20 failures /
  15 min / IP + team), not the entropy.
  **What would reopen it:** the application becoming internet-reachable, at
  which point the flag-on-next-compliant-write option (no auth-path write) is
  the one to take.
- **D19 — does an identified feedback survive its author's team: yes, keep the
  name.** No anonymisation on team deletion. This follows the same reasoning as
  H41: an internal tool, staff of the institution, no public exposure.
  Recommendation had been to anonymise; the maintainer's call is recorded as
  taken, and the cheap fix is written into H41's *what would reopen it*.
- **D20 — restrict the AI endpoint: no, document only.** See H49.

### D18 — H39 — **the number is 8, not 12; (a) shipped, (b) and (c) refused.**

**The number, answered 2026-08-06 after the pull request was already green.** H39
specified twelve (OWASP ASVS 2.1.1) and the maintainer settled it at **eight**
(NIST SP 800-63B's floor), declining to merge twelve. Recorded here in full
because the *reasoning* is the reusable part, and because a future pass that
finds `8` and a tracker item demanding `12` would otherwise read it as a
regression:

- **The usage does not match the standard's assumption.** ASVS 2.1.1's twelve is
  written for a personal password living in a password manager. This one is a
  **shared** secret — read aloud or written on a whiteboard, then typed by a
  dozen people on phone keyboards. The maintainer's objection was that twelve
  makes the product *painful* for every new team, and that is a real cost paid at
  every retro, against a benefit that turns out not to exist:
- **On the reachable axis the difference is nil.** `loginLimiter` allows 20
  failures per 15 minutes per IP *and* team name, ~3 800 guesses a day at two
  replicas. Four lowercase characters fall in ~2 months (~6 days from ten
  addresses); eight take on the order of 10⁴ years. **Online guessing is already
  over at eight — the limiter binds, not the entropy.** The 8→12 gap only buys
  resistance to an *offline* attack on stolen scrypt hashes, which implies a
  compromise with worse consequences than a guessed team password.
- **The real defect at four was never the search space.** Four characters force
  `1234`, the team name or the sprint number — guessed on the first attempt,
  which no rate limiter defends against. Essentially all of the gain is between
  four and eight; the rest was cargo-culted from the baseline.
- **What eight still buys in front of a commission:** a citable standard. Four is
  the one number with no published baseline behind it, and it is found in one
  `grep`. That is why "leave it at four" was declined even though the deployment
  is internal — this is the axis where D17's *"l'outil est interne"* reasoning
  stops short, because §8 exists for external reviewers, not for attackers.

**The general lesson, and it is D17's with the sign flipped.** D17 established
that a finding inherited from a generic audit must be re-grounded in *this*
deployment's exposure before it earns a change. The same test applies to a
finding's **parameter**, not only to whether it ships: I had carried ASVS's
twelve across the whole implementation without once asking what the limiter
already guaranteed, or who types this password and on what keyboard. The
arithmetic that settles it took two minutes and I ran it only when challenged.
**Check the number, not just the change.**

The rest of D18 concerned the existing records:

- **(a) Leave them.** Old passwords keep working; only new ones and changes meet
  the rule. **Shipped 2026-08-06.** This was not a guess: H39's own acceptance
  named it as the safe default ("decide explicitly whether to force a rotation;
  the safe default is not to"), it is the reversible choice, and the alternative
  locks out the whole existing user base.
- **(b) Force a rotation at next login.** **Refused.** It interrupts every
  facilitator, including one opening a retrospective with twelve people waiting —
  the H20 rule that an availability cost is a security property too.
- **(c) Warn without forcing** — a dismissible banner in the dashboard for teams
  below the threshold. **Refused 2026-08-25** — see the summary at the top of
  this section for the reasoning, which is the one worth keeping: the server
  cannot tell which teams are affected without writing on the authentication
  path.

**The limit, stated for the commission.** (a) alone means *no password already
in use got any stronger*: the floor applies to the next change and nothing
schedules one. Answered above, and the honest sentence is the deliverable.

### D19 — answered: the feedback keeps its author's name

Team deletion preserves feedbacks in `orphanedFeedbacks` **with
`submittedByName`**, and that stays. The recommendation had been to anonymise
(the report keeps its title, description and history; the author becomes
"Deleted team" — one function). The maintainer chose to keep the name, on the
same ground as H41: internal deployment, institution staff, no public exposure.
Do not re-raise it as a defect; it is a recorded choice.

### D20 — answered: documentation only

See H49 in §3 for the reasoning and for what would reopen it.

---

D14 and D15 were raised and answered on 2026-08-06, in the same
exchange; **D15 is now retired** — its answer (accept gstack's auto-update as a
repository-level exposure) is written into `SECURITY.md`'s supply chain section,
which is where a reviewer looks, and H38 closed with it. D16 was volunteered by
the maintainer alongside them and **superseded by D17 hours later** — read D17
first, it is the one in force. D1–D13 were
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
| **L23** | H42's remaining gap — 29 form labels not programmatically associated with their control, and 17 `autoFocus` attributes to judge one by one | none (the ratchets make progress visible) | the lint budget falls below 183, and `ACCESSIBILITY.md`'s *Known gaps* 1 and 2 shrink |
| ~~**L19b**~~ | ~~Roll the manifests to a non-production project~~ — **done 2026-08-26.** The database pod is admitted and runs; the NetworkPolicies proved inert and are now opt-in (decision D21). Nothing is left here except, if anyone wants the isolation, one question to the platform team: *can `expose-all-pod-from-outside` be narrowed on these projects?* | — | done |
| **L20** | H43 — a scheduled dump outside the cluster's storage, a stated RPO/RTO, **one rehearsed restore into an empty database** | platform-team involvement for the dump target | the restore is rehearsed and the result written into §1 |
| **L13** | H35's remaining half (a live session's persist still overwrites a rename) | still §7.4: it changes the shared sync path, and D16's surviving scope note covers only a *value* | a rename during a live session survives that session's next persist — or the residual is documented in §3 H10 |

**L14 and L15 shipped on 2026-08-06** (H36 + H37, then H39). **L4b is gone:**
D17 closed H11 by deciding the throttle stays off on an internal deployment, so
there is no rollout to perform.

**L22 shipped on 2026-08-25** (H42's remediation — see *Recently closed*), and
**L18 is gone**: the maintainer answered on 2026-08-25 that a data-protection
document is not wanted for an internal, non-public deployment, and D19 the other
way — orphaned feedbacks keep their author's name. H41 is closed as a decision,
not as work.

**What is left is what this container cannot finish alone.** L19b and L20 need a
cluster and a platform conversation, so open them now even though they finish
late: they are the only items whose *lead time* is not ours to control. **L19 as
originally written shipped on 2026-08-25** — its prerequisite line ("none of it
can be validated from the agent container") turned out to be wrong twice over:
`kustomize` and `kubeconform` are single binaries that downloaded fine, and the
image facts the database context depended on are in a Dockerfile, not in a
running cluster. What genuinely needs a cluster is admission and enforcement,
which is all L19b now is. L23 is
the accessibility tail — real work, no prerequisites, and the two ratchets make
progress visible. H44, H45 and H49 have no lot on purpose — schedule them with a
date rather than closing them in a rush, since a documented gap with a plan is
acceptable to a review board and silence is not.

**Ordering note.** The list above is longer than this tracker has carried before,
and that is a property of the axis rather than of the code: none of H39–H47 came
from reading application logic. If the commission moves, re-derive the order from
§8's *What to do before the commission* rather than from this table — it is the
one written against the deadline.

**Process note — land more often (Codex, PR #436).** That pull request carried
**four separately deployable units** across four sessions: the accessibility
release (`30.0`), a focus-ring fix, the restore rehearsal, and the platform
hardening — plus a fifth for the review round itself. Codex read `AGENTS.md`'s
*"one unit of work / pull request = one version bump"* and asked for `VERSION`
to be reset to `30.0`. That was declined, and the reason is worth keeping: the
intermediate numbers were **not** unreleased bookkeeping. `30.0` was deployed
and being tested against, and the maintainer had asked for the number to move
precisely so a redeploy is distinguishable from what is already running —
resetting it would recreate the problem that request came from.

But Codex was right about the shape. The rule is not wrong; the branch was. A
branch that accumulates four deployable units should have been four pull
requests, and the remedy is to land each unit as it finishes rather than to
renumber releases after the fact. Applies to the lots above: **L19b, L20, L23,
H44 and H45 are separate pull requests, not one "hardening" branch.**

**No decision is open.** D18 (c), D19 and D20 were all answered on 2026-08-25 —
see §5; each was answered *not to act*, and each of those answers is now
recorded rather than implied. D14, D16 and D17 were answered on 2026-08-06; D15
is retired, its answer written into `SECURITY.md`.
**L12 is gone** — H23 shipped once the maintainer read the migration's clean
line in the super-admin log viewer. **L9 is gone:**
H9 was accepted as a residual on 2026-08-05 rather than measured, and the four
decisions that closed by *accepting* the residual (D10, D11, D12 and H9) are all
recorded in §3 H10 with what would reopen each one.

When no lot is pressing, **go to §4** and write route tests against the
lowest-covered branches — every finding of the last seven passes (H21, H22, H24–H28, H29, H33,
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
receipts: 1 335 unit tests across 115 files, an e2e suite on every pull request,
a production-mode CSP gate, CodeQL, a container scan, a machine-checked
configuration-parity contract, and seventeen written invariants (§2) that encode
what previous failures taught. The gaps found in this pass are almost all on the
axis those passes never covered — **platform hardening, supply chain, data
protection, accessibility and operability**. The one application-level item
(H39, the four-character password) survived nine passes precisely because it is
a policy question rather than a defect, and **it has since shipped**: the
minimum is eight characters, enforced in one place.

**What moved on 2026-08-24**, and the pattern in it is worth naming: supply
chain, high availability and accessibility all went from *asserted* to
*measured*. Every action is pinned to a SHA and every workflow's token is
scoped, both machine-checked; a lost cross-pod adapter is now reported instead
of silent; and accessibility has a written baseline with numbers per screen.
None of these was found by reading application logic — they are the axis the
first nine passes never covered, and the reason §8 exists as a separate
ordering.

### Cellule sécurité

| Ask | State | Evidence / gap |
|---|---|---|
| Authentication and session management | **strong** | Scrypt at rest, only a scrypt record authenticates (invariant 7), no writes on the auth path (invariant 8), HMAC-signed tokens with type/iat/exp/nonce, 7-day expiry, socket channel authenticated and team-scoped (invariant 2), server-side role enforcement (invariant 3) |
| Password policy | **adequate** | Eight-character minimum (NIST SP 800-63B's floor) enforced from one module on all four write paths and mirrored in the forms (H39). **Be ready for "why not ASVS 2.1.1's twelve?"** — the answer is written in `SECURITY.md` and `utils/passwordPolicy.js`: the password is a *shared* secret typed by a dozen people on phone keyboards, and `loginLimiter` (20 failures / 15 min / IP+team) already puts online guessing out of reach at eight, so the 8→12 gap only buys resistance to an offline attack on stolen scrypt hashes. Still no complexity, reuse or breach check — deliberate. **Say the limit out loud:** the rule binds on write, so passwords already in use were not strengthened (D18 (c) was **refused** on 2026-08-25 — the store holds only a hash, so the server cannot tell which teams are affected without writing on the authentication path, which invariant 8 forbids) |
| Injection / XSS / CSRF | **strong** | No `dangerouslySetInnerHTML` anywhere, all SQL parameterised, credentials travel in request bodies rather than cookies so there is no CSRF surface, `escapeHtml` on every mail body |
| Response headers / CSP | **strong** | Enforcing CSP on every response, gated by a production-mode Playwright suite because the ordinary one cannot see an Express header (H36) |
| Secrets management | **adequate** | No secret in the repository or in git history; Kubernetes Secrets applied out-of-band; `SESSION_TOKEN_SECRET` never in the database or in backups. Note the LLM API key is the exception (H49) |
| Platform hardening | **pod half closed and validated on a cluster; network half closed by decision D21 — H40, H46** | Both pods carry the same four guarantees (`runAsNonRoot`, a pinned non-root UID, `RuntimeDefault` seccomp, all capabilities dropped) and mount no ServiceAccount token; the base Service is `ClusterIP` and the base Ingress declares TLS with an HTTP→HTTPS redirect. **The pod half was applied to a real cluster on 2026-08-26 and holds**: the SCC admits the hardened database pod and it runs with no restarts. **The network half does not, and is closed by decision D21**: the project carries platform-applied allow-all policies, and a NetworkPolicy cannot override an allow, so ours were inert and are no longer installed by `apply -k` — measured with a probe, not assumed |
| Supply chain | **strong, with one stated gap** | 0 production vulnerabilities, Dependabot with auto-merge, Trivy on every PR, CodeQL. **Every** action pinned to a full commit SHA — GitHub's own included — and every workflow declaring least-privilege `GITHUB_TOKEN` permissions, both failing the test suite if reverted (H47). Each release carries a CycloneDX SBOM of the production tree. **The gap, stated rather than hidden:** the image is not signed (cosign) and carries no registry attestations — both change the production publish path and cannot be verified before a release depends on them. The AI development tooling's upstream-HEAD bootstrap is an accepted repository-level exposure, documented in `SECURITY.md` (H38/D15) |
| Privileged access | **gap — H45** | One shared super-admin password, no MFA, no durable audit trail |
| Rate limiting / abuse | **adequate, documented** | Per-IP limiters scoped to rejected credentials so legitimate use cannot trip them; per-pod ceiling documented (H19). The socket throttle is deliberately off (D17) |
| Known accepted risks | **documented** | §3 H10 — read it before the commission; each entry says what would reopen it |

### Cellule conformité

| Ask | State | Evidence / gap |
|---|---|---|
| Inventory of personal data | **decided, not documented — H41** | Names, facilitator and invitee emails, free-text content naming colleagues. The maintainer decided on 2026-08-25 that a data-protection document is not warranted for an internal, non-public deployment. **Say it as a decision, with its boundary** — it is defensible for staff of the institution and stops being defensible the day the application is reachable from outside. The fields themselves are enumerated in `types.ts` and in H41 |
| Retention and erasure | **decided — H41/D19** | No retention rule, no purge, and team deletion deliberately preserves identified feedbacks **with the author's name** (D19, 2026-08-25). Same reasoning and same boundary as the row above. The cheap change if it is ever challenged is written into H41: anonymise `submittedByName` on deletion — one function, the report survives, the person does not |
| Data residency / third parties | **documented, deliberately uncontrolled — H49/D20** | Self-hosted by design, no telemetry, no CDN, no third-party analytics — a genuinely strong position. The exception is AI, which exports content to an operator-chosen endpoint. Documented in `SECURITY.md`; the endpoint is **not** restricted, decided 2026-08-25 (D20) on the ground that the admin population is small and trusted. If pressed, the answer is that a warning-and-allow on a non-private host is the change we would make, and why we have not made it yet |
| Accessibility | **remediated 2026-08-25 — H42 closed** | An audit exists, runs on every pull request, and now reports **zero axe violations at any severity** across nine screens — it was 1-2 serious/critical rules each on the six then audited. The gate is therefore a gate: a new serious or critical rule fails the pull request. Fixed this pass: grouping tickets from the keyboard (WCAG 2.1.1, a core phase that no automated tool could report as broken, because there was no control to find), all thirteen overlays turned into real dialogs with Escape and a focus trap, contrast fixed at the colour-token level, every `<select>` named, a focus indicator on the phase bar, and phase titles turned into headings. **`ACCESSIBILITY.md` is the artefact to hand over**: standard claimed (WCAG 2.1 AA / eCH-0059), method, what was fixed, and — the part that earns credibility — what is *not* done: 29 unassociated form labels, the screens outside the audited nine, and **no test with a real screen reader and no external audit**. **What to say:** we measured, we fixed what we found, the gate is at zero and can only be lowered, and we can name what remains |
| Traceability of administrative acts | **gap — H45** | No durable record of who deleted, restored or reconfigured |
| Security documentation | **good, corrected this pass** | `SECURITY.md` described an authentication path removed by H23 and has been corrected; sections added for the LLM credential, the TLS-verification switch, what a backup archive omits, and the password-policy limit |
| Licensing | **clear** | Unlicense (public domain); dependency licences not enumerated — an SBOM (H47) covers this if asked |

### Cellule architecture

| Ask | State | Evidence / gap |
|---|---|---|
| High availability | **strong** | `replicas: 2`, RollingUpdate with `maxUnavailable: 0`, PodDisruptionBudget, liveness/readiness/startup probes, graceful shutdown with a preStop drain, cross-pod Socket.IO adapter, automatic session re-join after a pod restart. **The gap found in the previous pass is closed (H50):** a pod that fails to initialise its shared adapter now says so on `/health`, logs it loudly and retries in the background, instead of serving split-brain with every probe green. Readiness deliberately does **not** gate on it — with both pods failing that would empty the Service and turn degraded collaboration into an outage (invariant 18). Alerting on `status: degraded` is an operator action, documented in `k8s/README.md` |
| State and concurrency | **strong** | Per-team KV records so writes to different teams never contend, optimistic concurrency on `_rev` with heal-and-resend rather than dropped writes, compensating writes on the index (invariant 15), degraded mode that keeps sessions live through a database outage |
| Scalability | **adequate** | Documented per-pod knobs (`PG_POOL_MAX`, `SESSION_CACHE_MAX`, roster-broadcast coalescing), a load-test harness. No HPA — fixed at 2 replicas, which is a deliberate fit for the population |
| Backup and restore | **rehearsed, one gap left — H43** | Automatic backups, a protected pre-restore snapshot, and a faithful-replace restore that aborts if the snapshot fails (invariant 4) — all three **observed in a rehearsal on 2026-08-25**, not merely coded: the database was destroyed and restored into an empty one, and the team, members, retrospective, ticket votes, action assignee, ROTI, feedback author and the working password all came back. Two things to say without being asked: the *application* archive does **not** carry the deployment configuration (AI settings, admin email, info banner — a `pg_dump` does), so a recovery that way needs those re-entered; and automatic backups are rows in the database they protect, so a scheduled independent dump is the remaining gap. RPO 24 h / RTO under an hour, written into `k8s/README.md` |
| Observability | **gap — H44** | Health probes only, now carrying the cross-pod adapter state (H50). No structured logs, correlation ids, metrics or tracing |
| Deployment reproducibility | **strong** | Multi-stage image, non-root, machine-checked manifest parity, image tag tied to `VERSION`'s major, no auto-commit in the deploy path (D7) |
| Performance | **accepted residual** | One 680 kB JS bundle, no code splitting — accepted with the reasoning and the reopening condition recorded in §3 H10 (H9) |
| Operational runbook | **partial** | `MAINTENANCE.md` is a developer-quality guide, `k8s/README.md` covers deployment and backups. Missing: incident procedure, rollback drill, RPO/RTO (folded into H43) |

### What to do before the commission, in order

1. ~~**H39** (password minimum)~~, ~~**H42**~~, ~~**H47**~~, ~~**H50**~~ —
   **done** (2026-08-06, 2026-08-24 and 2026-08-25). H39's follow-up D18 (c) was
   refused rather than left open: nothing already in use got stronger, and that
   is to be said plainly (§5 carries the reasoning, which is that the fix would
   have meant writing on the authentication path).
2. ~~**H43 (3)** — rehearse one restore into an empty database~~ — **done
   2026-08-25**, against a real PostgreSQL 16 started in the agent container.
   Everything came back including the ticket votes and the password hashes; the
   deployment **configuration** did not, which is the sentence to have ready.
   `k8s/README.md` carries the method, the RPO/RTO and the runbook.
   **What is left of H43 is (1)**, a scheduled dump landing outside the
   cluster's storage — platform work, and the only part whose lead time is not
   ours.
3. ~~**H40, H46** — platform manifests~~ — **done 2026-08-25.** Both pods now
   carry the application pod's security context, the namespace denies ingress by
   default with PostgreSQL reachable only from the app, neither pod mounts a
   ServiceAccount token, the base Service is `ClusterIP` and the base Ingress
   asks for TLS. **What is left is a rollout, not a change** (lot L19b): apply
   the overlay to a non-production project and confirm the SCC admits the
   database pod and the CNI enforces the policies. The one sentence to have
   ready for an operator is the `PGDATA` move — on a plain-Kubernetes
   installation with data at the mount root, PostgreSQL will not find it, and
   `k8s/README.md` gives both ways out.
4. **H44, H45** — schedule with a date rather than closing. A commission accepts
   a documented gap with a plan; it does not accept silence. H45 (a durable
   record of privileged actions) is the one a security cell asks about first,
   and it is additive work with no decision blocking it.
5. **The three answered-by-not-acting items** (H41, H49, D19) need no work —
   they need someone able to *say* them: no data-protection document, orphaned
   feedbacks keep their author's name, and the AI endpoint is unrestricted, each
   because the deployment is internal, and each with the trigger to revisit
   written beside it. A decision stated with its boundary reads as judgement; the
   same decision stated without one reads as an oversight.

**One thing to have ready that is not a finding:** §8's evidence columns are the
answer to "show me", and they are now mostly *machine-checked* rather than
asserted — the parity suite, the two ratchets (lint budget, axe baseline), the
CSP gate, invariants 11 and 18. That is the difference between a claim and a
control, and it is worth saying in those words.
