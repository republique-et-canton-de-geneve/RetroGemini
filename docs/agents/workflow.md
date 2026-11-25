# Development workflow

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.

## Development Workflow

### Before Starting Work
1. Read the existing code to understand patterns
2. Check `types.ts` for data structures
3. Review similar existing features for patterns
4. If you change retrospective guidance or timebox suggestions, keep `components/session/retroTips.ts`, the related tests, and the automatic phase timer defaults aligned with the intended session flow. A health check's phase timeboxes are `HEALTH_CHECK_PHASE_TIMER_SECONDS` in `utils/sessionTimer.ts`, pinned by `__tests__/sessionTimer.test.ts`. Any value up to 99:59 fits both headers: the header-fit e2e measures them with the timer set to 99:59

### When Fixing a Bug (TDD Approach)
1. **Write a failing test first**: Reproduce the bug with a unit test or e2e test that fails, confirming the bug exists
2. **Fix the issue**: Follow existing patterns to make the failing test pass
3. **Verify the test passes**: Run the test suite to confirm the fix works
4. **Update VERSION**: Increment `Y` only (e.g. `23.4` → `23.5`); never touch `X`
5. **Do NOT touch CHANGELOG.md**: Bug fixes are never documented in the changelog

### When Adding a New Feature (TDD Approach)
1. **Write a failing test first**: Define the expected behavior with a test that fails because the feature doesn't exist yet
2. **Implement the feature**: Write the minimum code to make the test pass
3. **Refactor if needed**: Clean up the implementation while keeping tests green
4. **Update VERSION**: Increment `X`, reset `Y` to `0` (e.g. `23.4` → `24.0`)
5. **Update CHANGELOG**: Add exactly one `## [X.Y]` block with a single consolidated bullet under `### Added` (see the Version & Changelog golden rule), and its French twin in `CHANGELOG.fr.md`

### Before Committing
**CRITICAL**: Ensure that all GitHub CI checks will pass before committing. Run the full CI pipeline locally using `npm run ci` (which runs lint + type-check + test + build). The CI workflow (`.github/workflows/ci.yml`) also runs test coverage and a security audit, so verify those as well:
1. **Run linting**: `npm run lint` — a **two-way** warning ratchet
   (`scripts/lint.mjs`, decision D6). It fails if the warning count rises *and*
   if it falls: when you remove warnings, lower `BUDGET` in that file in the
   same change, otherwise the freed slots are silently spent by the next
   warning to appear. Errors always fail, budget or not. Two directories of
   local tooling, `.claude/worktrees/` and `.gstack/` (gstack's working
   directory, where `/qa` and `/review` write their probe scripts), are not
   linted (`eslint.config.js` → its global `ignores`), not collected by vitest
   (`vitest.config.ts` → `test.exclude`) and not counted by the whole-codebase
   coverage sweep (`scripts/coverage-scope.mjs` → `EXCLUDE`). vitest globs dot
   directories and reads no `.gitignore`, so a probe named `*.spec.ts` under
   `.gstack/` failed `npm run test`. `__tests__/localToolingExclusions.test.ts`
   holds the three lists together; it reads ESLint's list from its global
   ignores alone, since an `ignores` beside `files` or `rules` only narrows
   its own block.
2. **Run type check**: `npm run type-check`
3. **Run tests with coverage**: `npm run test:coverage`
4. **Run build**: `npm run build`
5. **Run security audit**: `npm audit --omit=dev --audit-level=high` (production dependencies only)
6. **Run e2e tests**: `npm run test:e2e` (end-to-end tests with Playwright)
7. **Run the production CSP gate**: `npm run test:e2e:prod` — required whenever
   you touch `server/services/securityHeaders.js`, `server/routes/staticRoutes.js`,
   `server/services/jsonCompression.js`, `scripts/precompressAssets.mjs`,
   `index.html`, or add any asset/connection the app loads at runtime.
   `npm run test:e2e` cannot catch a CSP or a delivery regression: it loads the
   app from Vite, not from `server.js`
8. **Accessibility ratchets down, never up — and `BASELINE` is now at zero.**
   `npm run lint` carries `eslint-plugin-jsx-a11y` findings inside its two-way
   budget (`scripts/lint.mjs` is the authority: its `BUDGET` and its header
   carry the current figure and composition — no number is repeated here, so
   it cannot go stale), and
   `e2e/accessibility-audit.spec.ts` caps the serious/critical
   WCAG rules axe-core reports on ten screens (two of them **dark**) — **at 0
   since 2026-08-25** — plus six states with a second participant (the
   Members tab with one member per participant colour, the invite link's
   member picker, the participant's own Group screen, the Group phase with
   the participant marked as departed, the Brainstorm phase while the
   participant writes a card, and the Vote phase's participants panel, audited
   on its own; every retro screen from the icebreaker on now shows two avatars
   of different colours), the first four at 0 since 2026-10-22 and the last two
   since they joined (43.0);
   `e2e/admin-console-accessibility.spec.ts` caps the whole super-admin console
   once per tab (Teams, a team's inline editor, the settings cards opened up,
   Feedback and its comment dialog, Live, Logs, Backups), behind an allowlist
   that aborts any console call it did not mean to make; `e2e/jira.spec.ts` the
   seven Jira screens, at 0 since they joined (2026-10-20);
   `e2e/retro-open-board.spec.ts` the open board and, scoped, its settings
   dialog; `e2e/avatars.spec.ts` the avatar picker over a session, scoped
   (45.0), and the one-time avatar band, scoped, in two states: a guest's on
   a French phone in a retrospective (`avatar-hint`) and the facilitator's on
   the dashboard (`avatar-hint-dashboard`, 45.3);
   `e2e/login-team-picker.spec.ts` the login screen's team list as tiles, in
   French, the whole page (`login-team-grid`, 45.3: the main flows' `login`
   reads whatever list the server holds, which may be short); and
   `e2e/admin-team-merge.spec.ts` / `e2e/admin-team-restore.spec.ts` the merge,
   delete and one-team-restore dialogs and the backup import card, scoped, so
   any new serious or critical rule on those screens fails the pull request.
   `accessibility-audit.spec.ts` also runs in the `motion` project, and
   `audit()` waits for the page's animations to end before axe reads a colour
   (see *Test runs emulate reduced motion*).
   All of them run `audit()` from `e2e/helpers/axe.ts`, which holds the one
   `BASELINE` table; a screen joins it at 0, and a card added to a screen the
   audit never walked is audited on its own (`{ scope }`), so it neither
   carries that screen's findings nor hides them — list them in
   `ACCESSIBILITY.md` instead. A state that joins or leaves `BASELINE` changes
   the count of audited states `ACCESSIBILITY.md` gives (its one "N in all")
   in the same change: `__tests__/accessibilityStatementCount.test.ts` reads
   the table's keys with the TypeScript parser and fails until the statement
   gives their number.
   When a fix removes a finding, **lower the number in the same change** —
   `BUDGET` in `scripts/lint.mjs`, `BASELINE` in the helper. Never raise either to
   make a change pass: a new accessibility violation is a defect like any other.
   Note the spec counts *rules*, not nodes, on purpose (node counts moved with
   how many teams the test server happened to hold); the node counts are printed
   for review. `ACCESSIBILITY.md` is the public statement — what is claimed,
   what is tested, and what is knowingly missing; keep it true when you change
   the UI

Or use the shorthand: `npm run ci` (lint + type-check + test + build) then `npm run test:coverage`, `npm audit --omit=dev --audit-level=high`, and `npm run test:e2e` separately.

**IMPORTANT**: If your changes impact user-facing behavior (UI, interactions, workflows), you MUST also update the e2e tests in the `e2e/` directory to reflect those changes. E2e tests must pass before committing.

### After Opening a Pull Request

Do not consider a PR done the moment it is pushed. You MUST watch it through to a
green state and address automated feedback:

1. **Wait for and read every CI check**, not just the unit-test job. This repo runs
   `Lint, Type-Check & Test` (on multiple Node majors), `Build Production`,
   `Security Audit`, **CodeQL code-scanning**, and a **Docker image vulnerability
   scan**. A red CodeQL or security check blocks the PR just like a failing test —
   investigate the specific alert (file + line + rule id) and fix the root cause.
2. **Read and act on automated bot review comments** — CodeQL /
   `github-advanced-security`, the Codex reviewer (`chatgpt-codex-connector`),
   Dependabot, etc. For each finding: fix it if it is a real issue, or, if it is a
   false positive, say why (in a brief reply and in `HARDENING_STATUS.md`) and get
   it dismissed rather than silently ignored. There is repo precedent for
   dismissing documented CodeQL false positives — but never restructure code *only*
   to silence a scanner without understanding the alert.
   **Always leave a traceability reply on every bot finding** — fixed *or*
   dismissed — directly on its review thread, stating what was done and pointing
   to the fixing commit and the regression test (e.g. "✅ Addressed in
   `<commit>` — <one-line what changed>; test: `<file> › <test name>`"). Do NOT
   rely on GitHub's "outdated" marker as the signal that a comment was handled:
   "outdated" only means a later commit rewrote the exact diff lines the comment
   was anchored to — a finding can be fully fixed yet not show "outdated" (the
   anchored lines survived the fix), or show "outdated" while ignored (the lines
   changed for unrelated reasons). The human reviewer must be able to see at a
   glance, from the reply on each thread, that every bot finding was consciously
   handled.
3. **Re-run the full local suite before pushing a fix**, not just the files you
   touched: a change in one route (e.g. an auth handler) can break another suite's
   mock. `npm run test` runs every test file; do not push after re-running only a
   subset.
4. **Keep pushing until CI is green and bot findings are resolved or explicitly
   dismissed with a rationale.** A pushed-but-red PR is not finished.

### Keep the guide current
- After any change to the project, update the file of `docs/agents/` that covers its area. `AGENTS.md` holds only the rules every change follows and the index of these files: add to it a file you create, and keep it short.

## Commit Message Convention

Use conventional commits for clarity:

```
feat: Add dark mode toggle to settings
fix: Resolve timer sync issue in retrospectives
improve: Optimize session loading performance
docs: Update README with deployment instructions
refactor: Simplify vote counting logic
test: Add tests for health check session
```

**Prefix meanings** (note: only `feat:` and `improve:` add a changelog entry):
- `feat:` → New feature (bump VERSION `X`, one CHANGELOG `### Added` entry)
- `improve:` → User-visible enhancement (bump VERSION `X`, one CHANGELOG `### Changed` entry)
- `fix:` → Bug fix (bump VERSION `Y`, **no CHANGELOG entry**)
- `security:` → Security patch (bump VERSION `Y`, **no CHANGELOG entry** — not user-visible)
- `refactor:` → Code refactoring (bump VERSION `Y`, no CHANGELOG entry)
- `docs:` → Documentation only (bump VERSION `Y`, no CHANGELOG entry)
- `test:` → Adding/updating tests (bump VERSION `Y`, no CHANGELOG entry)

## Common Pitfalls to Avoid

1. **Get VERSION/CHANGELOG right** - User-visible change → bump `X` + **one** consolidated CHANGELOG bullet, and its French twin in `CHANGELOG.fr.md`. Bug fix / internal change → bump `Y` + **no** CHANGELOG entry. Never write a `### Fixed` entry, and never split one version into multiple bullets.
2. **Keep code and docs in English, and every user-facing string in both languages** - Code, comments and documentation are English (the one French document is `CHANGELOG.fr.md`); UI text goes through `t()` with entries in both `i18n/locales/en/` and `i18n/locales/fr/`, never as a literal in JSX
3. **Don't skip tests** - Run `npm run test` before committing
4. **Don't break the build** - Run `npm run build` to verify
5. **Don't ignore TypeScript errors** - Run `npm run type-check`
6. **Don't add files to Docker without checking `.dockerignore`**

## Quick Reference Commands

```bash
# Development
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Start production server

# Quality checks
npm run lint         # Run ESLint with the two-way warning budget (scripts/lint.mjs)
npm run type-check   # TypeScript check
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode

# Full CI check (run before committing)
npm run ci           # lint + type-check + test + build
```
